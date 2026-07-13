import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  validarDbDeTest,
  limpiarDb,
  sembrarFixtures,
  getApp,
  getPrisma,
  auth,
  stockDe,
  type Fixtures,
} from './helpers';

// FLUJO COMPLETO módulo 1: ingreso → lote de producción → transferencia →
// recepción (con y sin discrepancia). En cada paso el stock debe cuadrar
// exactamente con la suma de MovimientoStock (CLAUDE.md §12.4).

let app: FastifyInstance;
let f: Fixtures;

beforeAll(async () => {
  validarDbDeTest();
  await limpiarDb();
  f = await sembrarFixtures();
  app = await getApp();
});

afterAll(async () => {
  await app.close();
  const prisma = await getPrisma();
  await prisma.$disconnect();
});

describe('Flujo 1 — Ingreso de mercadería', () => {
  it('registra ingreso con múltiples líneas y sube stock por cantidad REAL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingresos',
      headers: auth(f.usuarios.produccion.token),
      payload: {
        proveedorId: f.proveedores.normal,
        lineas: [
          { productoId: f.productos.nalga, cantidadSegunRemito: 10, cantidadRealPesada: 9.8 },
          { productoId: f.productos.panRallado, cantidadSegunRemito: 5, cantidadRealPesada: 5 },
          { productoId: f.productos.huevo, cantidadSegunRemito: 60, cantidadRealPesada: 60 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const ingreso = res.json();
    expect(ingreso.lineas).toHaveLength(3);

    // stock = cantidad real pesada, no la del remito
    expect(await stockDe(f.productos.nalga, f.sucursales.produccion)).toBe(9.8);
    expect(await stockDe(f.productos.panRallado, f.sucursales.produccion)).toBe(5);
    expect(await stockDe(f.productos.huevo, f.sucursales.produccion)).toBe(60);
  });

  it('rechaza ingreso sin líneas', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingresos',
      headers: auth(f.usuarios.produccion.token),
      payload: { proveedorId: f.proveedores.normal, lineas: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rechaza cantidades <= 0', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingresos',
      headers: auth(f.usuarios.produccion.token),
      payload: {
        proveedorId: f.proveedores.normal,
        lineas: [{ productoId: f.productos.nalga, cantidadSegunRemito: 0, cantidadRealPesada: -1 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('proveedor "Otro" exige comentario', async () => {
    const sinComentario = await app.inject({
      method: 'POST',
      url: '/api/ingresos',
      headers: auth(f.usuarios.produccion.token),
      payload: {
        proveedorId: f.proveedores.otro,
        lineas: [{ productoId: f.productos.nalga, cantidadSegunRemito: 2, cantidadRealPesada: 2 }],
      },
    });
    expect(sinComentario.statusCode).toBe(400);

    const conComentario = await app.inject({
      method: 'POST',
      url: '/api/ingresos',
      headers: auth(f.usuarios.produccion.token),
      payload: {
        proveedorId: f.proveedores.otro,
        comentarioProveedorOtro: 'Carnicería de la esquina, compra de urgencia',
        lineas: [{ productoId: f.productos.nalga, cantidadSegunRemito: 2, cantidadRealPesada: 2 }],
      },
    });
    expect(conComentario.statusCode).toBe(201);
    // nalga: 9.8 + 2 = 11.8
    expect(await stockDe(f.productos.nalga, f.sucursales.produccion)).toBeCloseTo(11.8, 3);
  });
});

describe('Flujo 2 — Producción', () => {
  let lineaNalgaId: number;
  let lineaPanId: number;
  let lineaHuevoId: number;
  let loteId: number;

  it('lista líneas de ingreso disponibles para elegir lote', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/ingresos/lineas-disponibles?productoId=${f.productos.nalga}`,
      headers: auth(f.usuarios.produccion.token),
    });
    expect(res.statusCode).toBe(200);
    const lineas = res.json();
    expect(lineas.length).toBeGreaterThanOrEqual(2); // 9.8 kg + 2 kg
    lineaNalgaId = lineas[0].id;

    const pan = await app.inject({
      method: 'GET',
      url: `/api/ingresos/lineas-disponibles?productoId=${f.productos.panRallado}`,
      headers: auth(f.usuarios.produccion.token),
    });
    lineaPanId = pan.json()[0].id;
    const huevo = await app.inject({
      method: 'GET',
      url: `/api/ingresos/lineas-disponibles?productoId=${f.productos.huevo}`,
      headers: auth(f.usuarios.produccion.token),
    });
    lineaHuevoId = huevo.json()[0].id;
  });

  it('BLOQUEA lote con insumo mayor al stock disponible', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/produccion/lotes',
      headers: auth(f.usuarios.produccion.token),
      payload: {
        productoElaboradoId: f.productos.milanesa,
        insumos: [
          { productoInsumoId: f.productos.nalga, lineaIngresoOrigenId: lineaNalgaId, cantidadUsada: 999 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    const cuerpo = res.json();
    expect(['STOCK_INSUFICIENTE', 'LINEA_INGRESO_INSUFICIENTE']).toContain(cuerpo.codigo);
  });

  it('abre lote sobre líneas específicas — respuesta SIN campos ciegos', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/produccion/lotes',
      headers: auth(f.usuarios.produccion.token),
      payload: {
        productoElaboradoId: f.productos.milanesa,
        insumos: [
          { productoInsumoId: f.productos.nalga, lineaIngresoOrigenId: lineaNalgaId, cantidadUsada: 9 },
          { productoInsumoId: f.productos.panRallado, lineaIngresoOrigenId: lineaPanId, cantidadUsada: 2.5 },
          { productoInsumoId: f.productos.huevo, lineaIngresoOrigenId: lineaHuevoId, cantidadUsada: 25 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const lote = res.json();
    loteId = lote.id;
    // CONTROL CIEGO: el operario no recibe el esperado
    expect(lote).not.toHaveProperty('unidadesEsperadas');
    expect(lote).not.toHaveProperty('desvioPct');
    expect(lote).not.toHaveProperty('alertaDisparada');
    expect(lote.estado).toBe('ABIERTO');
  });

  it('el esperado quedó calculado internamente (visible solo en DB/admin)', async () => {
    const prisma = await getPrisma();
    const lote = await prisma.loteDeProduccion.findUniqueOrThrow({ where: { id: loteId } });
    // 9 kg / 0.18 = 50 brutas × 0.95 = 47.5 esperadas
    expect(lote.unidadesEsperadas?.toNumber()).toBeCloseTo(47.5, 2);
  });

  it('cierra lote: descuenta insumos y líneas, alta de producidas, desperdicio; dispara alerta por desvío', async () => {
    const stockNalgaAntes = await stockDe(f.productos.nalga, f.sucursales.produccion);

    // 40 reales vs 47.5 esperadas → desvío -15.79% → supera umbral 10% → alerta
    const res = await app.inject({
      method: 'POST',
      url: `/api/produccion/lotes/${loteId}/cerrar`,
      headers: auth(f.usuarios.produccion.token),
      payload: { unidadesProducidasReales: 40, desperdicioRealKg: 0.9 },
    });
    expect(res.statusCode).toBe(200);
    const lote = res.json();
    expect(lote.estado).toBe('CERRADO');
    // sigue ciego al cerrar
    expect(lote).not.toHaveProperty('unidadesEsperadas');
    expect(lote).not.toHaveProperty('desvioPct');
    expect(lote).not.toHaveProperty('alertaDisparada');

    // stock cuadra: nalga -9 (consumo 8.1 + desperdicio 0.9)
    expect(await stockDe(f.productos.nalga, f.sucursales.produccion)).toBeCloseTo(stockNalgaAntes - 9, 3);
    expect(await stockDe(f.productos.panRallado, f.sucursales.produccion)).toBeCloseTo(2.5, 3);
    expect(await stockDe(f.productos.huevo, f.sucursales.produccion)).toBe(35);
    // alta del elaborado
    expect(await stockDe(f.productos.milanesa, f.sucursales.produccion)).toBe(40);

    // líneas de ingreso consumidas
    const prisma = await getPrisma();
    const linea = await prisma.lineaIngreso.findUniqueOrThrow({ where: { id: lineaNalgaId } });
    expect(linea.cantidadRestanteDisponible.toNumber()).toBeCloseTo(0.8, 3); // 9.8 - 9

    // desvío calculado y alerta SOLO para admin
    const loteDb = await prisma.loteDeProduccion.findUniqueOrThrow({ where: { id: loteId } });
    expect(loteDb.desvioPct?.toNumber()).toBeCloseTo(-15.79, 1);
    expect(loteDb.alertaDisparada).toBe(true);

    const alertas = await prisma.alerta.findMany({ where: { tipo: 'DESVIO_PRODUCCION' } });
    expect(alertas).toHaveLength(1);
    expect(alertas[0]!.origenId).toBe(loteId);
  });

  it('no permite cerrar dos veces', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/produccion/lotes/${loteId}/cerrar`,
      headers: auth(f.usuarios.produccion.token),
      payload: { unidadesProducidasReales: 1, desperdicioRealKg: 0 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().codigo).toBe('LOTE_YA_CERRADO');
  });

  it('ADMIN sí ve campos ciegos del lote', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/produccion/lotes/${loteId}`,
      headers: auth(f.usuarios.admin.token),
    });
    const lote = res.json();
    expect(lote.unidadesEsperadas).toBe('47.5');
    expect(lote.alertaDisparada).toBe(true);
  });
});

describe('Flujo 3 — Transferencias', () => {
  let transferenciaId: number;

  it('genera transferencia: valida stock y descuenta producción', async () => {
    // hay 40 milanesas en producción
    const res = await app.inject({
      method: 'POST',
      url: '/api/transferencias',
      headers: auth(f.usuarios.produccion.token),
      payload: {
        sucursalDestinoId: f.sucursales.local1,
        lineas: [{ productoId: f.productos.milanesa, cantidadEnviada: 30 }],
      },
    });
    expect(res.statusCode).toBe(201);
    transferenciaId = res.json().id;
    expect(res.json().estado).toBe('PENDIENTE_RECEPCION');
    // emisor SÍ ve cantidadEnviada
    expect(res.json().lineas[0].cantidadEnviada).toBe('30');

    expect(await stockDe(f.productos.milanesa, f.sucursales.produccion)).toBe(10);
    expect(await stockDe(f.productos.milanesa, f.sucursales.local1)).toBe(0);
  });

  it('NO deja generar si el stock no alcanza', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/transferencias',
      headers: auth(f.usuarios.produccion.token),
      payload: {
        sucursalDestinoId: f.sucursales.local1,
        lineas: [{ productoId: f.productos.milanesa, cantidadEnviada: 500 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().codigo).toBe('STOCK_INSUFICIENTE');
  });

  it('el receptor ve la pendiente SIN cantidadEnviada (conteo ciego)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/transferencias/${transferenciaId}`,
      headers: auth(f.usuarios.cajero.token),
    });
    expect(res.statusCode).toBe(200);
    const t = res.json();
    expect(t.lineas[0]).not.toHaveProperty('cantidadEnviada');
    expect(t.lineas[0]).not.toHaveProperty('diferencia');
    expect(t.lineas[0].producto).toBeDefined(); // sí ve QUÉ llega, no CUÁNTO
  });

  it('conteo que no coincide → mensaje genérico sin revelar diferencia, nada se persiste', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/transferencias/${transferenciaId}/recepcion`,
      headers: auth(f.usuarios.cajero.token),
      payload: { lineas: [{ productoId: f.productos.milanesa, cantidadRecibida: 28 }] },
    });
    expect(res.statusCode).toBe(200);
    const cuerpo = res.json();
    expect(cuerpo.coincide).toBe(false);
    // no revela diferencia, ni lado, ni cantidades
    expect(JSON.stringify(cuerpo)).not.toContain('30');
    expect(JSON.stringify(cuerpo)).not.toContain('diferencia');

    // nada persistido: sigue pendiente, stock local sin tocar
    const prisma = await getPrisma();
    const t = await prisma.transferencia.findUniqueOrThrow({ where: { id: transferenciaId } });
    expect(t.estado).toBe('PENDIENTE_RECEPCION');
    expect(await stockDe(f.productos.milanesa, f.sucursales.local1)).toBe(0);
  });

  it('recontar con número correcto → CONFIRMADA + entrada de stock', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/transferencias/${transferenciaId}/recepcion`,
      headers: auth(f.usuarios.cajero.token),
      payload: { lineas: [{ productoId: f.productos.milanesa, cantidadRecibida: 30 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().coincide).toBe(true);
    expect(res.json().transferencia.estado).toBe('CONFIRMADA');

    expect(await stockDe(f.productos.milanesa, f.sucursales.local1)).toBe(30);
  });

  it('confirmar con discrepancia: stock según receptor + alerta con ambos números y firmas', async () => {
    // nueva transferencia de 10
    const gen = await app.inject({
      method: 'POST',
      url: '/api/transferencias',
      headers: auth(f.usuarios.produccion.token),
      payload: {
        sucursalDestinoId: f.sucursales.local1,
        lineas: [{ productoId: f.productos.milanesa, cantidadEnviada: 10 }],
      },
    });
    const t2 = gen.json().id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/transferencias/${t2}/confirmar-con-discrepancia`,
      headers: auth(f.usuarios.cajero.token),
      payload: { lineas: [{ productoId: f.productos.milanesa, cantidadRecibida: 8 }] },
    });
    expect(res.statusCode).toBe(200);
    const t = res.json();
    expect(t.estado).toBe('CONFIRMADA_CON_DISCREPANCIA');
    // receptor cajero: sin cantidadEnviada ni diferencia aun después de confirmar
    expect(t.lineas[0]).not.toHaveProperty('cantidadEnviada');
    expect(t.lineas[0]).not.toHaveProperty('diferencia');

    // stock del local por la cantidad DECLARADA (30 + 8 = 38)
    expect(await stockDe(f.productos.milanesa, f.sucursales.local1)).toBe(38);

    // alerta al admin con todo el detalle
    const prisma = await getPrisma();
    const alerta = await prisma.alerta.findFirst({
      where: { tipo: 'DISCREPANCIA_TRANSFERENCIA', origenId: t2 },
    });
    expect(alerta).not.toBeNull();
    const detalle = alerta!.detalle as {
      usuarioEmisorId: number;
      usuarioReceptorId: number;
      lineas: { cantidadEnviada: string; cantidadRecibida: string; diferencia: string }[];
    };
    expect(detalle.usuarioEmisorId).toBe(f.usuarios.produccion.id);
    expect(detalle.usuarioReceptorId).toBe(f.usuarios.cajero.id);
    expect(detalle.lineas[0]!.cantidadEnviada).toBe('10');
    expect(detalle.lineas[0]!.cantidadRecibida).toBe('8');
    expect(detalle.lineas[0]!.diferencia).toBe('-2');
  });

  it('no se puede recepcionar una transferencia ya confirmada', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/transferencias/${transferenciaId}/recepcion`,
      headers: auth(f.usuarios.cajero.token),
      payload: { lineas: [{ productoId: f.productos.milanesa, cantidadRecibida: 30 }] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().codigo).toBe('TRANSFERENCIA_YA_CONFIRMADA');
  });

  // Hallazgo de auditoría §5.2/§9.1: sin esta validación, cualquier CAJERO/
  // ENCARGADO podía ver Y confirmar transferencias dirigidas a OTRO local.
  it('CAJERO de Local 1 no ve ni puede recepcionar una transferencia dirigida a Local 2', async () => {
    const gen = await app.inject({
      method: 'POST',
      url: '/api/transferencias',
      headers: auth(f.usuarios.produccion.token),
      payload: {
        sucursalDestinoId: f.sucursales.local2,
        lineas: [{ productoId: f.productos.panRallado, cantidadEnviada: 1 }],
      },
    });
    expect(gen.statusCode).toBe(201);
    const paraLocal2 = gen.json().id;

    // ni pidiéndolo explícitamente por query param la ve en su listado
    const lista = await app.inject({
      method: 'GET',
      url: `/api/transferencias?estado=PENDIENTE_RECEPCION&sucursalDestinoId=${f.sucursales.local2}`,
      headers: auth(f.usuarios.cajero.token),
    });
    expect(idsDe(lista.json())).not.toContain(paraLocal2);

    // ni accediendo directo por ID puede confirmarla
    const intento = await app.inject({
      method: 'POST',
      url: `/api/transferencias/${paraLocal2}/recepcion`,
      headers: auth(f.usuarios.cajero.token),
      payload: { lineas: [{ productoId: f.productos.panRallado, cantidadRecibida: 1 }] },
    });
    expect(intento.statusCode).toBe(403);
    expect(intento.json().codigo).toBe('SUCURSAL_NO_AUTORIZADA');
    expect(await stockDe(f.productos.panRallado, f.sucursales.local2)).toBe(0);

    // ADMINISTRADOR sí puede (acceso total, CLAUDE.md §2)
    const comoAdmin = await app.inject({
      method: 'POST',
      url: `/api/transferencias/${paraLocal2}/recepcion`,
      headers: auth(f.usuarios.admin.token),
      payload: { lineas: [{ productoId: f.productos.panRallado, cantidadRecibida: 1 }] },
    });
    expect(comoAdmin.statusCode).toBe(200);
    expect(comoAdmin.json().coincide).toBe(true);
    expect(await stockDe(f.productos.panRallado, f.sucursales.local2)).toBe(1);
  });
});

function idsDe(transferencias: { id: number }[]): number[] {
  return transferencias.map((t) => t.id);
}

describe('Trazabilidad y auditoría de punta a punta', () => {
  it('la cadena LineaIngreso → InsumoUsado → Lote → Transferencia es navegable', async () => {
    const prisma = await getPrisma();
    const insumo = await prisma.insumoUsado.findFirst({
      where: { productoInsumoId: f.productos.nalga },
      include: {
        lineaIngresoOrigen: { include: { ingresoMercaderia: { include: { proveedor: true } } } },
        loteDeProduccion: { include: { fichaTecnicaVersion: true } },
      },
    });
    expect(insumo).not.toBeNull();
    // de qué proveedor vino la nalga de este lote
    expect(insumo!.lineaIngresoOrigen.ingresoMercaderia.proveedor.nombre).toBe('Granja San José');
    // con qué versión de ficha se produjo (congelada)
    expect(insumo!.loteDeProduccion.fichaTecnicaVersion.numeroVersion).toBe(1);
  });

  it('toda la operatoria quedó auditada', async () => {
    const prisma = await getPrisma();
    const acciones = (await prisma.registroAuditoria.findMany()).map((r) => r.accion);
    expect(acciones).toContain('REGISTRAR_INGRESO_MERCADERIA');
    expect(acciones).toContain('ABRIR_LOTE_PRODUCCION');
    expect(acciones).toContain('CERRAR_LOTE_PRODUCCION');
    expect(acciones).toContain('GENERAR_TRANSFERENCIA');
    expect(acciones).toContain('CONFIRMAR_TRANSFERENCIA');
    expect(acciones).toContain('CONFIRMAR_TRANSFERENCIA_CON_DISCREPANCIA');
  });
});
