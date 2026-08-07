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
  type Fixtures,
} from './helpers';

// Módulo 3 — Dashboard (CLAUDE.md §9). Sin tests de integración (pendiente
// documentado). Arma un turno con venta + anulado + gasto + retiro +
// atención + merma, más un lote de producción con desvío grande (dispara
// DESVIO_PRODUCCION), y valida cada KPI agregado contra esos datos conocidos.

let app: FastifyInstance;
let f: Fixtures;

beforeAll(async () => {
  validarDbDeTest();
  await limpiarDb();
  f = await sembrarFixtures();
  app = await getApp();

  const prisma = await getPrisma();
  const admin = f.usuarios.admin;

  await prisma.precio.create({ data: { productoId: f.productos.milanesa, monto: 2500, usuarioId: admin.id } });

  // Stock de milanesa en Local 1 (AJUSTE directo — el flujo real de ingreso
  // se ejercita en reportes.test.ts, acá alcanza con el stock ya disponible)
  await prisma.movimientoStock.create({
    data: {
      productoId: f.productos.milanesa,
      sucursalId: f.sucursales.local1,
      tipo: 'AJUSTE',
      cantidad: new Prisma.Decimal(10),
      usuarioId: admin.id,
      tipoOrigen: 'Ajuste',
      origenId: 0,
    },
  });

  // Lote con desvío grande → Alerta DESVIO_PRODUCCION + lotesConDesvio
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
  await app.inject({
    method: 'POST',
    url: `/api/produccion/lotes/${lote.json().id}/cerrar`,
    headers: auth(f.usuarios.produccion.token),
    payload: { unidadesProducidasReales: 6, desperdicioRealKg: 0.2 }, // esperado ≈9.5 → desvío ~ -37%
  });

  // Turno: venta $5.000 (efectivo $3.000 + MP $2.000, sin vuelto), anulado, gasto, retiro, atención, merma
  await app.inject({
    method: 'POST',
    url: '/api/turnos/abrir',
    headers: auth(f.usuarios.cajero.token),
    payload: { conteoEfectivo: 0, conteoPollosMarcados: 0 },
  });

  const pedidoVenta = await app.inject({
    method: 'POST',
    url: '/api/pedidos',
    headers: auth(f.usuarios.cajero.token),
    payload: { tipo: 'PRESENCIAL', items: [{ productoId: f.productos.milanesa, cantidad: 2 }] },
  });
  await app.inject({
    method: 'POST',
    url: `/api/pedidos/${pedidoVenta.json().id}/cobrar`,
    headers: auth(f.usuarios.cajero.token),
    payload: {
      pagos: [
        { medio: 'EFECTIVO', monto: 3000 },
        { medio: 'MERCADO_PAGO', monto: 2000 },
      ],
    },
  });

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
    url: '/api/atenciones',
    headers: auth(f.usuarios.cajero.token),
    payload: { productoId: f.productos.milanesa, cantidad: 1, motivoCodigo: 'CLIENTE_FRECUENTE' },
  });
  await app.inject({
    method: 'POST',
    url: '/api/costo-cero',
    headers: auth(f.usuarios.cajero.token),
    payload: { productoId: f.productos.milanesa, cantidad: 1, tipo: 'DESPERDICIO_QUEMADO', motivo: 'se cayó' },
  });

  await app.inject({
    method: 'POST',
    url: '/api/turnos/cerrar',
    headers: auth(f.usuarios.cajero.token),
    payload: { conteoEfectivo: 2200, conteoPollosMarcados: 0 }, // 0 + 3.000 − 500 − 300
  });
});

afterAll(async () => {
  await app.close();
});

describe('Dashboard — RBAC', () => {
  it('ADMIN y SOCIO acceden; CAJERO/ENCARGADO/PRODUCCION reciben 403', async () => {
    const admin = await app.inject({ method: 'GET', url: '/api/dashboard', headers: auth(f.usuarios.admin.token) });
    expect(admin.statusCode).toBe(200);
    const socio = await app.inject({ method: 'GET', url: '/api/dashboard', headers: auth(f.usuarios.socio.token) });
    expect(socio.statusCode).toBe(200);
    for (const rol of ['cajero', 'encargado', 'produccion'] as const) {
      const res = await app.inject({ method: 'GET', url: '/api/dashboard', headers: auth(f.usuarios[rol].token) });
      expect(res.statusCode).toBe(403);
    }
  });
});

describe('Dashboard — KPIs agregados', () => {
  it('refleja exactamente la venta cobrada, sin el pedido anulado', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/dashboard', headers: auth(f.usuarios.admin.token) });
    expect(res.statusCode).toBe(200);
    const kpis = res.json();

    expect(kpis.totalVentas).toBe('5000');
    expect(kpis.cantidadPedidos).toBe(1);
    expect(kpis.ticketPromedio).toBe('5000');

    const efectivo = kpis.ventasPorMedio.find((v: { medio: string }) => v.medio === 'EFECTIVO');
    const mp = kpis.ventasPorMedio.find((v: { medio: string }) => v.medio === 'MERCADO_PAGO');
    expect(efectivo.total).toBe('3000');
    expect(mp.total).toBe('2000');

    expect(kpis.totalGastos).toBe('500');
    expect(kpis.totalRetiros).toBe('300');
    expect(kpis.mermas).toMatchObject({ cantidadEventos: 1, totalUnidades: '1' });
    expect(kpis.cantidadAtenciones).toBe(1);
    expect(kpis.lotesConDesvio).toBe(1);
    expect(kpis.alertasPendientes).toBeGreaterThanOrEqual(1);
  });

  it('filtra por sucursal: Local 2 (sin actividad) da todo en cero', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/dashboard?sucursalId=${f.sucursales.local2}`,
      headers: auth(f.usuarios.admin.token),
    });
    const kpis = res.json();
    expect(kpis.totalVentas).toBe('0');
    expect(kpis.cantidadPedidos).toBe(0);
    expect(kpis.totalGastos).toBe('0');
  });
});
