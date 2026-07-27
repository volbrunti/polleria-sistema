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

// Módulo 3 — Reportes (CLAUDE.md §9, CLAUDE-MODULO-2.md). No tenían tests de
// integración (pendiente documentado). Arma la cadena completa de
// trazabilidad (ingreso → lote → transferencia → venta) más un turno con
// venta, pedido anulado, gasto, retiro, atención y merma, y valida cada
// reporte contra esos datos conocidos.

let app: FastifyInstance;
let f: Fixtures;
let pedidoVentaId: number;
let loteId: number;
let transferenciaId: number;

beforeAll(async () => {
  validarDbDeTest();
  await limpiarDb();
  f = await sembrarFixtures();
  app = await getApp();

  const prisma = await getPrisma();
  const admin = f.usuarios.admin;

  // Precio de venta de la milanesa (no lo trae el fixture base)
  await prisma.precio.create({ data: { productoId: f.productos.milanesa, monto: 2500, usuarioId: admin.id } });

  // ── Cadena de trazabilidad real: ingreso → lote → transferencia ──
  const ingreso = await app.inject({
    method: 'POST',
    url: '/api/ingresos',
    headers: auth(f.usuarios.produccion.token),
    payload: {
      proveedorId: f.proveedores.normal,
      lineas: [
        { productoId: f.productos.nalga, cantidadSegunRemito: 5, cantidadRealPesada: 5 },
        { productoId: f.productos.panRallado, cantidadSegunRemito: 2, cantidadRealPesada: 2 },
        { productoId: f.productos.huevo, cantidadSegunRemito: 20, cantidadRealPesada: 20 },
      ],
    },
  });
  expect(ingreso.statusCode).toBe(201);
  const lineas = ingreso.json().lineas as Array<{ id: number; productoId: number }>;
  const lineaDe = (productoId: number) => lineas.find((l) => l.productoId === productoId)!.id;

  const lote = await app.inject({
    method: 'POST',
    url: '/api/produccion/lotes',
    headers: auth(f.usuarios.produccion.token),
    payload: {
      productoElaboradoId: f.productos.milanesa,
      insumos: [
        { productoInsumoId: f.productos.nalga, lineaIngresoOrigenId: lineaDe(f.productos.nalga), cantidadUsada: 1.8 },
        {
          productoInsumoId: f.productos.panRallado,
          lineaIngresoOrigenId: lineaDe(f.productos.panRallado),
          cantidadUsada: 0.5,
        },
        { productoInsumoId: f.productos.huevo, lineaIngresoOrigenId: lineaDe(f.productos.huevo), cantidadUsada: 5 },
      ],
    },
  });
  expect(lote.statusCode).toBe(201);
  loteId = lote.json().id;

  // Esperado ≈ (1.8/0.18) × 0.95 = 9.5 — producimos 6: desvío grande, dispara alerta
  const cierreLote = await app.inject({
    method: 'POST',
    url: `/api/produccion/lotes/${loteId}/cerrar`,
    headers: auth(f.usuarios.produccion.token),
    payload: { unidadesProducidasReales: 6, desperdicioRealKg: 0.2 },
  });
  expect(cierreLote.statusCode).toBe(200);

  const transferencia = await app.inject({
    method: 'POST',
    url: '/api/transferencias',
    headers: auth(f.usuarios.produccion.token),
    payload: {
      sucursalDestinoId: f.sucursales.local1,
      lineas: [{ productoId: f.productos.milanesa, cantidadEnviada: 5 }],
    },
  });
  expect(transferencia.statusCode).toBe(201);
  transferenciaId = transferencia.json().id;

  const recepcion = await app.inject({
    method: 'POST',
    url: `/api/transferencias/${transferenciaId}/recepcion`,
    headers: auth(f.usuarios.cajero.token),
    payload: { lineas: [{ productoId: f.productos.milanesa, cantidadRecibida: 5 }] },
  });
  expect(recepcion.json().coincide).toBe(true);
  expect(await stockDe(f.productos.milanesa, f.sucursales.local1)).toBe(5);

  // ── Turno con venta, anulación, gasto, retiro, atención y merma ──
  const apertura = await app.inject({
    method: 'POST',
    url: '/api/turnos/abrir',
    headers: auth(f.usuarios.cajero.token),
    payload: { conteoEfectivo: 0, conteoPollosMarcados: 0 },
  });
  expect(apertura.json().bloqueado).toBe(false);

  const pedidoVenta = await app.inject({
    method: 'POST',
    url: '/api/pedidos',
    headers: auth(f.usuarios.cajero.token),
    payload: { tipo: 'PRESENCIAL', items: [{ productoId: f.productos.milanesa, cantidad: 2 }] },
  });
  expect(pedidoVenta.statusCode).toBe(201);
  pedidoVentaId = pedidoVenta.json().id;
  const cobro = await app.inject({
    method: 'POST',
    url: `/api/pedidos/${pedidoVentaId}/cobrar`,
    headers: auth(f.usuarios.cajero.token),
    payload: {
      pagos: [
        { medio: 'MERCADO_PAGO', monto: 3000 },
        { medio: 'EFECTIVO', monto: 2000 },
      ],
    },
  });
  expect(cobro.statusCode).toBe(200);

  // Pedido anulado: no debe aparecer en ningún reporte de ventas
  const pedidoAnular = await app.inject({
    method: 'POST',
    url: '/api/pedidos',
    headers: auth(f.usuarios.cajero.token),
    payload: { tipo: 'PRESENCIAL', items: [{ productoId: f.productos.milanesa, cantidad: 1 }] },
  });
  await app.inject({
    method: 'POST',
    url: `/api/pedidos/${pedidoAnular.json().id}/anular`,
    headers: auth(f.usuarios.cajero.token),
  });

  await app.inject({
    method: 'POST',
    url: '/api/atenciones',
    headers: auth(f.usuarios.cajero.token),
    payload: { productoId: f.productos.milanesa, cantidad: 1, motivoCodigo: 'CLIENTE_FRECUENTE' },
  });

  await app.inject({
    method: 'POST',
    url: '/api/gastos-caja',
    headers: auth(f.usuarios.cajero.token),
    payload: { monto: 500, medio: 'EFECTIVO', categoria: 'LIMPIEZA' },
  });

  await app.inject({
    method: 'POST',
    url: '/api/retiros-caja',
    headers: auth(f.usuarios.cajero.token),
    payload: { monto: 300, medio: 'EFECTIVO', socio: 'ARIEL' },
  });

  await app.inject({
    method: 'POST',
    url: '/api/costo-cero',
    headers: auth(f.usuarios.cajero.token),
    payload: { productoId: f.productos.milanesa, cantidad: 1, tipo: 'DESPERDICIO_QUEMADO', motivo: 'se cayó' },
  });

  // Efectivo esperado: 0 + 2.000 (venta) − 500 (gasto) − 300 (retiro) = 1.200
  const cierre = await app.inject({
    method: 'POST',
    url: '/api/turnos/cerrar',
    headers: auth(f.usuarios.cajero.token),
    payload: { conteoEfectivo: 1200, conteoPollosMarcados: 0 },
  });
  expect(cierre.statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
});

describe('Reportes — RBAC', () => {
  const endpoints = [
    '/api/reportes/ventas-por-producto',
    '/api/reportes/ventas-por-medio',
    '/api/reportes/cierres-caja',
    '/api/reportes/retiros-por-socio',
    '/api/reportes/mermas',
    '/api/reportes/produccion',
    '/api/reportes/gastos',
    '/api/reportes/atenciones',
  ];

  it.each(endpoints)('%s: ADMIN y SOCIO acceden, CAJERO/ENCARGADO/PRODUCCION no (403)', async (url) => {
    const admin = await app.inject({ method: 'GET', url, headers: auth(f.usuarios.admin.token) });
    expect(admin.statusCode).toBe(200);
    const socio = await app.inject({ method: 'GET', url, headers: auth(f.usuarios.socio.token) });
    expect(socio.statusCode).toBe(200);
    for (const rol of ['cajero', 'encargado', 'produccion'] as const) {
      const res = await app.inject({ method: 'GET', url, headers: auth(f.usuarios[rol].token) });
      expect(res.statusCode).toBe(403);
    }
  });
});

describe('Reportes — contenido', () => {
  it('ventas por producto: solo cuenta el pedido cobrado, no el anulado', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reportes/ventas-por-producto',
      headers: auth(f.usuarios.admin.token),
    });
    const milanesa = res.json().find((r: { producto: string }) => r.producto === 'Milanesa de nalga');
    expect(milanesa.unidadesVendidas).toBe('2');
    expect(milanesa.montoTotal).toBe('5000');
  });

  it('ventas por medio de pago: efectivo neto + mercado pago, porcentajes suman 100', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reportes/ventas-por-medio',
      headers: auth(f.usuarios.admin.token),
    });
    const { porMedio, total } = res.json();
    expect(total).toBe('5000');
    const efectivo = porMedio.find((p: { medio: string }) => p.medio === 'EFECTIVO');
    const mp = porMedio.find((p: { medio: string }) => p.medio === 'MERCADO_PAGO');
    expect(efectivo.total).toBe('2000');
    expect(mp.total).toBe('3000');
  });

  it('cierres de caja: el turno cerrado coincide al centavo (sin discrepancia)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reportes/cierres-caja',
      headers: auth(f.usuarios.admin.token),
    });
    const turno = res.json()[0];
    expect(turno.efectivo.resultado).toBe('COINCIDE');
    expect(turno.efectivo.valorContado).toBe('1200');
    expect(turno.pollos.resultado).toBe('COINCIDE');
  });

  it('retiros por socio: ARIEL con $300 en efectivo', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reportes/retiros-por-socio',
      headers: auth(f.usuarios.admin.token),
    });
    const { porSocio, total } = res.json();
    expect(total).toBe('300');
    expect(porSocio).toHaveLength(1);
    expect(porSocio[0]).toMatchObject({ socio: 'ARIEL', medio: 'EFECTIVO', total: '300' });
  });

  it('mermas por producto: 1 quemado (el costo-cero), no incluye lo vendido ni la atención', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reportes/mermas',
      headers: auth(f.usuarios.admin.token),
    });
    const milanesa = res.json().find((r: { producto: string }) => r.producto === 'Milanesa de nalga');
    expect(milanesa.quemados).toBe('1');
    expect(milanesa.total).toBe('1');
  });

  it('gastos por categoría: LIMPIEZA $500', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reportes/gastos',
      headers: auth(f.usuarios.admin.token),
    });
    const { porCategoria, total } = res.json();
    expect(total).toBe('500');
    expect(porCategoria[0]).toMatchObject({ categoria: 'LIMPIEZA', total: '500', cantidad: 1 });
  });

  it('atenciones: 1 milanesa por CLIENTE_FRECUENTE', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reportes/atenciones',
      headers: auth(f.usuarios.admin.token),
    });
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0]).toMatchObject({ producto: 'Milanesa de nalga', cantidad: '1', motivoCodigo: 'CLIENTE_FRECUENTE' });
  });

  it('rendimiento de producción: expone el desvío y la alerta disparada (dato ADMIN/SOCIO, nunca ciego acá)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reportes/produccion',
      headers: auth(f.usuarios.admin.token),
    });
    const lote = res.json().find((l: { loteId: number }) => l.loteId === loteId);
    expect(lote.unidadesProducidas).toBe('6');
    expect(lote.alertaDisparada).toBe(true);
    expect(Number(lote.desvioPct)).toBeLessThan(-30); // (6−9.5)/9.5 ≈ −36.8%
  });

  it('trazabilidad completa del pedido: reconstruye proveedor → ingreso → lote → transferencia', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/reportes/trazabilidad/pedido/${pedidoVentaId}`,
      headers: auth(f.usuarios.admin.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item.producto).toBe('Milanesa de nalga');
    expect(item.origen.transferencia.id).toBe(transferenciaId);
    expect(item.origen.transferencia.cantidadEnviada).toBe('5');
    expect(item.origen.lote.id).toBe(loteId);
    expect(item.origen.lote.aproximado).toBe(true);
    const insumoNalga = item.origen.insumos.find((i: { producto: string }) => i.producto === 'Nalga de pollo (kg)');
    expect(insumoNalga.proveedor).toBe('Granja San José');
    expect(insumoNalga.cantidadUsada).toBe('1.8');
  });
});
