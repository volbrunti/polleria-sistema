import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
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
import { pedidosNoRetiradosParaAvisar } from '../../src/modules/pedidos/pedidos.service';

// Módulo 2 — Pedidos / POS (CLAUDE-MODULO-2.md §4). Corre en serie: el stock
// y el turno se encadenan entre tests.

let app: FastifyInstance;
let f: Fixtures;

// productos propios de este archivo
let empanadaId: number;
let polloEnteroId: number;
let polloMedioId: number;
let polloMarcadoId: number;
let comboId: number;

beforeAll(async () => {
  validarDbDeTest();
  await limpiarDb();
  f = await sembrarFixtures();
  app = await getApp();

  const prisma = await getPrisma();
  const admin = f.usuarios.admin.id;

  const crear = (nombre: string, tipo: 'ELABORADO' | 'COMBO') =>
    prisma.producto.create({
      data: { nombre, categoria: 'Test', tipo, unidadDeMedida: 'UNIDAD' },
    });

  const empanada = await crear('Empanada de carne', 'ELABORADO');
  const entero = await crear('Pollo a la leña (entero)', 'ELABORADO');
  const medio = await crear('Pollo a la leña (medio)', 'ELABORADO');
  const marcado = await crear('Pollo a la leña (entero) — MARCADO', 'ELABORADO');
  empanadaId = empanada.id;
  polloEnteroId = entero.id;
  polloMedioId = medio.id;
  polloMarcadoId = marcado.id;

  // combo: 2 milanesas a precio propio
  const combo = await prisma.producto.create({
    data: {
      nombre: 'Combo 2 milanesas',
      categoria: 'Combos',
      tipo: 'COMBO',
      unidadDeMedida: 'UNIDAD',
      componentesDelCombo: {
        create: [{ productoComponenteId: f.productos.milanesa, cantidad: new Prisma.Decimal(2) }],
      },
    },
  });
  comboId = combo.id;

  // precios: milanesa 2500, empanadas con tabla (1/6/12), pollos, combo
  const precio = (productoId: number, monto: number, cantidad = 1) =>
    prisma.precio.create({ data: { productoId, monto, cantidad, usuarioId: admin } });
  await precio(f.productos.milanesa, 2500);
  await precio(empanadaId, 1600, 1);
  await precio(empanadaId, 8500, 6);
  await precio(empanadaId, 16000, 12);
  await precio(polloEnteroId, 21000);
  await precio(polloMedioId, 12000);
  await precio(comboId, 4500);

  // stock inicial en Local 1 (AJUSTE directo — el flujo real viene del módulo 1)
  const ajuste = (productoId: number, cantidad: number) =>
    prisma.movimientoStock.create({
      data: {
        productoId,
        sucursalId: f.sucursales.local1,
        tipo: 'AJUSTE',
        cantidad: new Prisma.Decimal(cantidad),
        usuarioId: admin,
        tipoOrigen: 'Ajuste',
        origenId: 0,
      },
    });
  await ajuste(f.productos.milanesa, 20);
  await ajuste(empanadaId, 50);
  await ajuste(polloMarcadoId, 10); // ya marcados (el evento de marcado es Fase 4)
});

afterAll(async () => {
  await app.close();
});

describe('Pedidos — confirmación y stock', () => {
  it('sin turno abierto no se puede vender (409 TURNO_NO_ABIERTO)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: auth(f.usuarios.cajero.token),
      payload: { tipo: 'PRESENCIAL', items: [{ productoId: f.productos.milanesa, cantidad: 2 }] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().codigo).toBe('TURNO_NO_ABIERTO');
  });

  it('abre el turno y confirma un pedido: el stock se descuenta AL CONFIRMAR', async () => {
    const apertura = await app.inject({
      method: 'POST',
      url: '/api/turnos/abrir',
      headers: auth(f.usuarios.cajero.token),
      payload: { conteoEfectivo: 0, conteoPollosMarcados: 10 },
    });
    expect(apertura.json().bloqueado).toBe(false);

    const res = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: auth(f.usuarios.cajero.token),
      payload: {
        tipo: 'PRESENCIAL',
        items: [{ productoId: f.productos.milanesa, cantidad: 2, aclaraciones: 'sin sal' }],
      },
    });
    expect(res.statusCode).toBe(201);
    const pedido = res.json();
    expect(pedido.estado).toBe('EN_PREPARACION');
    expect(pedido.items[0].montoTotal).toBe('5000');

    // stock ya descontado sin cobrar
    expect(await stockDe(f.productos.milanesa, f.sucursales.local1)).toBe(18);

    // ticket NUEVO registrado (comandera mock)
    const prisma = await getPrisma();
    const ticket = await prisma.ticketCocina.findFirst({ where: { pedidoId: pedido.id, tipo: 'NUEVO' } });
    expect(ticket).not.toBeNull();
    expect(ticket!.impreso).toBe(true);
  });

  it('la tabla por volumen se aplica al confirmar (6 empanadas = $8.500, no $9.600)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: auth(f.usuarios.cajero.token),
      payload: { tipo: 'PRESENCIAL', items: [{ productoId: empanadaId, cantidad: 6 }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().items[0].montoTotal).toBe('8500');
    // cobrar exacto en MP para dejarlo ENTREGADO
    const cobro = await app.inject({
      method: 'POST',
      url: `/api/pedidos/${res.json().id}/cobrar`,
      headers: auth(f.usuarios.cajero.token),
      payload: { pagos: [{ medio: 'MERCADO_PAGO', monto: 8500 }] },
    });
    expect(cobro.statusCode).toBe(200);
    expect(cobro.json().vuelto).toBe('0');
  });

  it('venta de combo descuenta los COMPONENTES, no el combo', async () => {
    const antes = await stockDe(f.productos.milanesa, f.sucursales.local1);
    const res = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: auth(f.usuarios.cajero.token),
      payload: { tipo: 'PRESENCIAL', items: [{ productoId: comboId, cantidad: 1 }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().items[0].montoTotal).toBe('4500'); // precio propio del combo
    expect(await stockDe(f.productos.milanesa, f.sucursales.local1)).toBe(antes - 2);
    expect(await stockDe(comboId, f.sucursales.local1)).toBe(0); // el combo no tiene stock

    await app.inject({
      method: 'POST',
      url: `/api/pedidos/${res.json().id}/cobrar`,
      headers: auth(f.usuarios.cajero.token),
      payload: { pagos: [{ medio: 'EFECTIVO', monto: 4500 }] },
    });
  });

  it('el pollo (entero y medio) descuenta del stock de MARCADOS, no del fresco', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: auth(f.usuarios.cajero.token),
      payload: {
        tipo: 'PRESENCIAL',
        items: [
          { productoId: polloEnteroId, cantidad: 2 },
          { productoId: polloMedioId, cantidad: 1 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    // 10 marcados − 2 enteros − 0.5 = 7.5
    expect(await stockDe(polloMarcadoId, f.sucursales.local1)).toBe(7.5);
    // el fresco no se tocó (no hay stock de fresco cargado y no dio insuficiente)
    expect(await stockDe(polloEnteroId, f.sucursales.local1)).toBe(0);

    await app.inject({
      method: 'POST',
      url: `/api/pedidos/${res.json().id}/cobrar`,
      headers: auth(f.usuarios.cajero.token),
      payload: { pagos: [{ medio: 'EFECTIVO', monto: 54000 }] },
    });
  });

  it('sin pollos marcados suficientes, la venta de pollo se bloquea', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: auth(f.usuarios.cajero.token),
      payload: { tipo: 'PRESENCIAL', items: [{ productoId: polloEnteroId, cantidad: 8 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().codigo).toBe('STOCK_INSUFICIENTE');
    expect(res.json().mensaje).toContain('MARCADO');
  });

  it('stock insuficiente bloquea todo el pedido (nada se descuenta a medias)', async () => {
    const antesMilanesa = await stockDe(f.productos.milanesa, f.sucursales.local1);
    const res = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: auth(f.usuarios.cajero.token),
      payload: {
        tipo: 'PRESENCIAL',
        items: [
          { productoId: f.productos.milanesa, cantidad: 1 },
          { productoId: empanadaId, cantidad: 999 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(await stockDe(f.productos.milanesa, f.sucursales.local1)).toBe(antesMilanesa);
  });
});

describe('Cobro', () => {
  it('pago mixto con vuelto: el efectivo se registra NETO', async () => {
    const pedido = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: auth(f.usuarios.cajero.token),
      payload: { tipo: 'PRESENCIAL', items: [{ productoId: f.productos.milanesa, cantidad: 4 }] }, // $10.000
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/pedidos/${pedido.json().id}/cobrar`,
      headers: auth(f.usuarios.cajero.token),
      payload: {
        pagos: [
          { medio: 'MERCADO_PAGO', monto: 6000 },
          { medio: 'EFECTIVO', monto: 5000 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().vuelto).toBe('1000');
    expect(res.json().pedido.estado).toBe('ENTREGADO');

    const prisma = await getPrisma();
    const pagos = await prisma.pago.findMany({ where: { pedidoId: pedido.json().id } });
    const efectivo = pagos.find((p) => p.medio === 'EFECTIVO')!;
    expect(efectivo.monto.toString()).toBe('4000'); // 5000 recibidos − 1000 de vuelto
  });

  it('un pedido ENTREGADO no puede anularse', async () => {
    const prisma = await getPrisma();
    const entregado = await prisma.pedido.findFirst({ where: { estado: 'ENTREGADO' } });
    const res = await app.inject({
      method: 'POST',
      url: `/api/pedidos/${entregado!.id}/anular`,
      headers: auth(f.usuarios.cajero.token),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().codigo).toBe('ESTADO_PEDIDO_INVALIDO');
  });
});

describe('Anulación y modificación', () => {
  it('anular repone TODO el stock y guarda el snapshot completo en auditoría', async () => {
    const antes = await stockDe(f.productos.milanesa, f.sucursales.local1);
    const pedido = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: auth(f.usuarios.cajero.token),
      payload: { tipo: 'PRESENCIAL', items: [{ productoId: f.productos.milanesa, cantidad: 3 }] },
    });
    expect(await stockDe(f.productos.milanesa, f.sucursales.local1)).toBe(antes - 3);

    const res = await app.inject({
      method: 'POST',
      url: `/api/pedidos/${pedido.json().id}/anular`,
      headers: auth(f.usuarios.cajero.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().estado).toBe('ANULADO');
    expect(await stockDe(f.productos.milanesa, f.sucursales.local1)).toBe(antes);

    const prisma = await getPrisma();
    const registro = await prisma.registroAuditoria.findFirst({
      where: { accion: 'ANULAR_PEDIDO', entidadId: pedido.json().id },
    });
    expect(registro).not.toBeNull();
    const snapshot = registro!.datosAnteriores as { items: { producto: string; cantidad: string; montoTotal: string }[] };
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0].cantidad).toBe('3');
    expect(snapshot.items[0].montoTotal).toBe('7500');

    const ticket = await prisma.ticketCocina.findFirst({
      where: { pedidoId: pedido.json().id, tipo: 'ANULACION' },
    });
    expect(ticket).not.toBeNull();
  });

  it('modificar ajusta el stock por la diferencia y manda ticket de actualización', async () => {
    const antes = await stockDe(f.productos.milanesa, f.sucursales.local1);
    const pedido = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: auth(f.usuarios.cajero.token),
      payload: { tipo: 'PRESENCIAL', items: [{ productoId: f.productos.milanesa, cantidad: 2 }] },
    });
    // 2 milanesas → 1 milanesa + 6 empanadas
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/pedidos/${pedido.json().id}`,
      headers: auth(f.usuarios.cajero.token),
      payload: {
        items: [
          { productoId: f.productos.milanesa, cantidad: 1 },
          { productoId: empanadaId, cantidad: 6 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(await stockDe(f.productos.milanesa, f.sucursales.local1)).toBe(antes - 1); // repuso 1
    const prisma = await getPrisma();
    const ticket = await prisma.ticketCocina.findFirst({
      where: { pedidoId: pedido.json().id, tipo: 'ACTUALIZACION' },
    });
    expect(ticket).not.toBeNull();

    await app.inject({
      method: 'POST',
      url: `/api/pedidos/${pedido.json().id}/anular`,
      headers: auth(f.usuarios.cajero.token),
    });
  });
});

describe('No retirado: reasignación y perdido', () => {
  async function crearPedidoListo(cantidad: number) {
    const pedido = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: auth(f.usuarios.cajero.token),
      payload: { tipo: 'A_RETIRAR', items: [{ productoId: empanadaId, cantidad }] },
    });
    await app.inject({
      method: 'POST',
      url: `/api/pedidos/${pedido.json().id}/marcar-listo`,
      headers: auth(f.usuarios.cajero.token),
    });
    await app.inject({
      method: 'POST',
      url: `/api/pedidos/${pedido.json().id}/no-retirado`,
      headers: auth(f.usuarios.cajero.token),
    });
    return pedido.json().id as number;
  }

  it('reasignar NO descuenta stock de nuevo y vincula ambos pedidos', async () => {
    const originalId = await crearPedidoListo(6);
    const stockAntes = await stockDe(empanadaId, f.sucursales.local1);

    const res = await app.inject({
      method: 'POST',
      url: `/api/pedidos/${originalId}/reasignar`,
      headers: auth(f.usuarios.cajero.token),
    });
    expect(res.statusCode).toBe(201);
    const nuevo = res.json();
    expect(nuevo.estado).toBe('LISTO');
    expect(nuevo.pedidoOrigenId).toBe(originalId);
    expect(nuevo.items[0].montoTotal).toBe('8500'); // precio congelado del original
    // el stock NO se movió
    expect(await stockDe(empanadaId, f.sucursales.local1)).toBe(stockAntes);

    const prisma = await getPrisma();
    const original = await prisma.pedido.findUnique({ where: { id: originalId } });
    expect(original!.estado).toBe('REASIGNADO');

    // el nuevo se cobra normalmente
    const cobro = await app.inject({
      method: 'POST',
      url: `/api/pedidos/${nuevo.id}/cobrar`,
      headers: auth(f.usuarios.cajero.token),
      payload: { pagos: [{ medio: 'EFECTIVO', monto: 8500 }] },
    });
    expect(cobro.statusCode).toBe(200);
  });

  it('marcar perdido: sin reposición de stock, líneas a costo cero DESPERDICIO_QUEMADO', async () => {
    const pedidoId = await crearPedidoListo(6);
    const stockAntes = await stockDe(empanadaId, f.sucursales.local1);

    const res = await app.inject({
      method: 'POST',
      url: `/api/pedidos/${pedidoId}/marcar-perdido`,
      headers: auth(f.usuarios.cajero.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().estado).toBe('PERDIDO');
    expect(res.json().items[0].esVentaCostoCero).toBe(true);
    expect(res.json().items[0].tipoCostoCero).toBe('DESPERDICIO_QUEMADO');
    expect(await stockDe(empanadaId, f.sucursales.local1)).toBe(stockAntes);
  });
});

describe('RBAC y aislamiento', () => {
  it('SOCIO y PRODUCCION no pueden crear pedidos (403)', async () => {
    for (const usuario of [f.usuarios.socio, f.usuarios.produccion]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/pedidos',
        headers: auth(usuario.token),
        payload: { tipo: 'PRESENCIAL', items: [{ productoId: f.productos.milanesa, cantidad: 1 }] },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('el CAJERO de Local 1 no puede vender en Local 2 (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: auth(f.usuarios.cajero.token),
      payload: {
        sucursalId: f.sucursales.local2,
        tipo: 'PRESENCIAL',
        items: [{ productoId: f.productos.milanesa, cantidad: 1 }],
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().codigo).toBe('SUCURSAL_NO_AUTORIZADA');
  });

  it('no se vende materia prima ni productos sin precio', async () => {
    const materiaPrima = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: auth(f.usuarios.cajero.token),
      payload: { tipo: 'PRESENCIAL', items: [{ productoId: f.productos.nalga, cantidad: 1 }] },
    });
    expect(materiaPrima.statusCode).toBe(400);

    const sinPrecio = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: auth(f.usuarios.cajero.token),
      payload: { tipo: 'PRESENCIAL', items: [{ productoId: polloMarcadoId, cantidad: 1 }] },
    });
    expect(sinPrecio.statusCode).toBe(400);
    expect(sinPrecio.json().codigo).toBe('PRODUCTO_SIN_PRECIO');
  });

  it('el cierre del turno cuadra: esperado = pagos en efectivo del turno', async () => {
    // efectivo cobrado en este archivo: 4500 (combo) + 54000 (pollos) + 4000
    // (mixto neto) + 8500 (reasignado) = 71000; apertura fue 0
    const res = await app.inject({
      method: 'POST',
      url: '/api/turnos/cerrar',
      headers: auth(f.usuarios.cajero.token),
      payload: { conteoEfectivo: 71000, conteoPollosMarcados: 7.5 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().turno.estado).toBe('CERRADO');
    // sin alerta de discrepancia: el conteo coincide con lo esperado
    const prisma = await getPrisma();
    const alerta = await prisma.alerta.findFirst({ where: { tipo: 'DISCREPANCIA_CAJA' } });
    expect(alerta).toBeNull();
    // y el resumen por unidad refleja lo vendido, sin montos
    const ventas = res.json().ventasPorUnidad as { producto: string; unidades: string }[];
    expect(ventas.find((v) => v.producto === 'Pollo a la leña (entero)')?.unidades).toBe('2');
  });
});

describe('Soporte del POS: más vendidos y precios en bloque', () => {
  it('GET /pedidos/mas-vendidos rankea por unidades vendidas de la sucursal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/pedidos/mas-vendidos',
      headers: auth(f.usuarios.cajero.token),
    });
    expect(res.statusCode).toBe(200);
    const ranking = res.json() as { productoId: number; unidades: string }[];
    expect(ranking.length).toBeGreaterThan(0);
    // ordenado desc por unidades
    const unidades = ranking.map((r) => Number(r.unidades));
    expect([...unidades].sort((a, b) => b - a)).toEqual(unidades);
    // la empanada (vendida por docena en este archivo) está en el ranking
    expect(ranking.some((r) => r.productoId === empanadaId)).toBe(true);
  });

  it('GET /productos/precios-vigentes devuelve la tabla completa por producto y la puede leer el CAJERO', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/productos/precios-vigentes',
      headers: auth(f.usuarios.cajero.token),
    });
    expect(res.statusCode).toBe(200);
    const filas = res.json() as { productoId: number; precios: { cantidad: number; monto: string }[] }[];
    const empanada = filas.find((x) => x.productoId === empanadaId);
    // la tabla de la empanada trae sus 3 tiers (1/6/12) ordenados por cantidad
    expect(empanada?.precios.map((p) => p.cantidad)).toEqual([1, 6, 12]);
  });

  it('PRODUCCION no accede a los endpoints del POS (403)', async () => {
    for (const url of ['/api/pedidos/mas-vendidos', '/api/productos/precios-vigentes']) {
      const res = await app.inject({ method: 'GET', url, headers: auth(f.usuarios.produccion.token) });
      expect(res.statusCode).toBe(403);
    }
  });
});

describe('Timer de pedido no retirado (CLAUDE-MODULO-2.md §9)', () => {
  beforeAll(async () => {
    // el turno se cerró en el describe de arriba y el stock de empanada ya
    // se consumió a lo largo del archivo — reabre turno y repone stock para
    // no depender del estado acumulado de ejecución.
    const prisma = await getPrisma();
    await prisma.movimientoStock.create({
      data: {
        productoId: empanadaId,
        sucursalId: f.sucursales.local1,
        tipo: 'AJUSTE',
        cantidad: new Prisma.Decimal(100),
        usuarioId: f.usuarios.admin.id,
        tipoOrigen: 'Ajuste',
        origenId: 0,
      },
    });
    // debe coincidir con lo contado en el cierre anterior (línea ~480) para
    // que la apertura ciega no bloquee por discrepancia.
    const apertura = await app.inject({
      method: 'POST',
      url: '/api/turnos/abrir',
      headers: auth(f.usuarios.cajero.token),
      payload: { conteoEfectivo: 71000, conteoPollosMarcados: 7.5 },
    });
    expect(apertura.json().bloqueado).toBe(false);
  });

  async function crearPedidoNoRetirado() {
    const pedido = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: auth(f.usuarios.cajero.token),
      payload: { tipo: 'A_RETIRAR', items: [{ productoId: empanadaId, cantidad: 6 }] },
    });
    expect(pedido.statusCode).toBe(201);
    const id = pedido.json().id as number;
    await app.inject({
      method: 'POST',
      url: `/api/pedidos/${id}/marcar-listo`,
      headers: auth(f.usuarios.cajero.token),
    });
    await app.inject({
      method: 'POST',
      url: `/api/pedidos/${id}/no-retirado`,
      headers: auth(f.usuarios.cajero.token),
    });
    return id;
  }

  it('no avisa antes de cumplirse el umbral', async () => {
    const id = await crearPedidoNoRetirado();
    const vencidos = await pedidosNoRetiradosParaAvisar(30);
    expect(vencidos.some((p) => p.id === id)).toBe(false);
  });

  it('avisa una sola vez cuando ya pasó el umbral, y no reemite en la corrida siguiente', async () => {
    const id = await crearPedidoNoRetirado();
    const prisma = await getPrisma();
    // simula que entró a LISTO_NO_RETIRADO hace 40 minutos
    await prisma.pedido.update({
      where: { id },
      data: { fechaListoNoRetirado: new Date(Date.now() - 40 * 60 * 1000) },
    });

    const primeraCorrida = await pedidosNoRetiradosParaAvisar(30);
    expect(primeraCorrida.map((p) => p.id)).toContain(id);

    const segundaCorrida = await pedidosNoRetiradosParaAvisar(30);
    expect(segundaCorrida.map((p) => p.id)).not.toContain(id);

    const actualizado = await prisma.pedido.findUniqueOrThrow({ where: { id } });
    expect(actualizado.avisoNoRetiradoEmitido).toBe(true);
  });
});
