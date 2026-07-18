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

// Módulo 2 — Caja (atenciones/gastos/retiros) y circuito completo del pollo
// (CLAUDE-MODULO-2.md §4.8–§4.10, §5.2): fresco → marcado → vendido /
// atención / retornado / quemado → cierre que cuadra al centavo.

let app: FastifyInstance;
let f: Fixtures;
let polloEnteroId: number;
let polloMedioId: number;
let polloMarcadoId: number;

beforeAll(async () => {
  validarDbDeTest();
  await limpiarDb();
  f = await sembrarFixtures();
  app = await getApp();

  const prisma = await getPrisma();
  const admin = f.usuarios.admin.id;

  const crear = (nombre: string) =>
    prisma.producto.create({
      data: { nombre, categoria: 'Pollos', tipo: 'ELABORADO', unidadDeMedida: 'UNIDAD' },
    });
  polloEnteroId = (await crear('Pollo a la leña (entero)')).id;
  polloMedioId = (await crear('Pollo a la leña (medio)')).id;
  polloMarcadoId = (await crear('Pollo a la leña (entero) — MARCADO')).id;

  await prisma.precio.create({ data: { productoId: polloEnteroId, monto: 21000, usuarioId: admin } });
  await prisma.precio.create({ data: { productoId: polloMedioId, monto: 12000, usuarioId: admin } });

  // 10 pollos FRESCOS en Local 1 (en la vida real llegan por transferencia)
  await prisma.movimientoStock.create({
    data: {
      productoId: polloEnteroId,
      sucursalId: f.sucursales.local1,
      tipo: 'AJUSTE',
      cantidad: new Prisma.Decimal(10),
      usuarioId: admin,
      tipoOrigen: 'Ajuste',
      origenId: 0,
    },
  });
});

afterAll(async () => {
  await app.close();
});

describe('Circuito del pollo dentro de un turno', () => {
  it('abre el turno (primer turno: referencia de pollos = stock marcado actual, 0)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/turnos/abrir',
      headers: auth(f.usuarios.cajero.token),
      payload: { conteoEfectivo: 0, conteoPollosMarcados: 0 },
    });
    expect(res.json().bloqueado).toBe(false);
  });

  it('no se pueden marcar más pollos que los frescos disponibles', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/marcado-pollos',
      headers: auth(f.usuarios.cajero.token),
      payload: { cantidad: 15 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().codigo).toBe('STOCK_INSUFICIENTE');
  });

  it('marcar 6 pollos: fresco −6, marcado +6, evento y auditoría registrados', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/marcado-pollos',
      headers: auth(f.usuarios.cajero.token),
      payload: { cantidad: 6 },
    });
    expect(res.statusCode).toBe(201);
    expect(await stockDe(polloEnteroId, f.sucursales.local1)).toBe(4);
    expect(await stockDe(polloMarcadoId, f.sucursales.local1)).toBe(6);

    const prisma = await getPrisma();
    const registro = await prisma.registroAuditoria.findFirst({ where: { accion: 'MARCAR_POLLOS' } });
    expect(registro).not.toBeNull();
  });

  it('vende 2 enteros + 1 medio en efectivo: descuenta 2,5 marcados', async () => {
    const pedido = await app.inject({
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
    expect(pedido.statusCode).toBe(201);
    await app.inject({
      method: 'POST',
      url: `/api/pedidos/${pedido.json().id}/cobrar`,
      headers: auth(f.usuarios.cajero.token),
      payload: { pagos: [{ medio: 'EFECTIVO', monto: 54000 }] },
    });
    expect(await stockDe(polloMarcadoId, f.sucursales.local1)).toBe(3.5);
    expect(await stockDe(polloEnteroId, f.sucursales.local1)).toBe(4); // el fresco no se toca
  });

  it('atención (regalía): 1 pollo entero sin cargo descuenta del marcado, sin pago', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/atenciones',
      headers: auth(f.usuarios.cajero.token),
      payload: { productoId: polloEnteroId, cantidad: 1, motivoCodigo: 'CLIENTE_FRECUENTE' },
    });
    expect(res.statusCode).toBe(201);
    expect(await stockDe(polloMarcadoId, f.sucursales.local1)).toBe(2.5);

    const prisma = await getPrisma();
    const movimiento = await prisma.movimientoStock.findFirst({ where: { tipo: 'ATENCION' } });
    expect(movimiento!.productoId).toBe(polloMarcadoId); // pollo → marcado, también en atenciones
    expect(await prisma.pago.count()).toBe(1); // solo el de la venta anterior
  });

  it('motivo OTRO sin detalle se rechaza', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/atenciones',
      headers: auth(f.usuarios.cajero.token),
      payload: { productoId: polloEnteroId, cantidad: 1, motivoCodigo: 'OTRO' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('retorno a producción: sale del local y entra a Producción como insumo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/costo-cero',
      headers: auth(f.usuarios.cajero.token),
      payload: { productoId: polloMarcadoId, cantidad: 1, tipo: 'RETORNO_A_PRODUCCION' },
    });
    expect(res.statusCode).toBe(201);
    expect(await stockDe(polloMarcadoId, f.sucursales.local1)).toBe(1.5);
    expect(await stockDe(polloMarcadoId, f.sucursales.produccion)).toBe(1);
  });

  it('quemado: medio pollo marcado muere ahí, no entra a ningún lado', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/costo-cero',
      headers: auth(f.usuarios.cajero.token),
      payload: { productoId: polloMarcadoId, cantidad: 0.5, tipo: 'DESPERDICIO_QUEMADO', motivo: 'se pasó en la parrilla' },
    });
    expect(res.statusCode).toBe(201);
    expect(await stockDe(polloMarcadoId, f.sucursales.local1)).toBe(1);
    expect(await stockDe(polloMarcadoId, f.sucursales.produccion)).toBe(1); // sin cambios

    const prisma = await getPrisma();
    const merma = await prisma.movimientoStock.findFirst({ where: { tipo: 'MERMA_QUEMADO' } });
    expect(merma!.cantidad.toString()).toBe('-0.5');
  });

  it('gastos y retiros: validaciones y registro', async () => {
    const gasto = await app.inject({
      method: 'POST',
      url: '/api/gastos-caja',
      headers: auth(f.usuarios.cajero.token),
      payload: { monto: 2000, medio: 'EFECTIVO', categoria: 'LIMPIEZA' },
    });
    expect(gasto.statusCode).toBe(201);

    const gastoOtroSinDetalle = await app.inject({
      method: 'POST',
      url: '/api/gastos-caja',
      headers: auth(f.usuarios.cajero.token),
      payload: { monto: 500, medio: 'EFECTIVO', categoria: 'OTRO' },
    });
    expect(gastoOtroSinDetalle.statusCode).toBe(400);

    const gastoDebito = await app.inject({
      method: 'POST',
      url: '/api/gastos-caja',
      headers: auth(f.usuarios.cajero.token),
      payload: { monto: 500, medio: 'DEBITO', categoria: 'LIMPIEZA' },
    });
    expect(gastoDebito.statusCode).toBe(400); // gastos solo EFECTIVO o MP

    const retiro = await app.inject({
      method: 'POST',
      url: '/api/retiros-caja',
      headers: auth(f.usuarios.cajero.token),
      payload: { monto: 10000, medio: 'EFECTIVO', socio: 'ARIEL' },
    });
    expect(retiro.statusCode).toBe(201);

    const socioInvalido = await app.inject({
      method: 'POST',
      url: '/api/retiros-caja',
      headers: auth(f.usuarios.cajero.token),
      payload: { monto: 10000, medio: 'EFECTIVO', socio: 'PEPE' },
    });
    expect(socioInvalido.statusCode).toBe(400); // selector cerrado

    const prisma = await getPrisma();
    const registroRetiro = await prisma.registroAuditoria.findFirst({
      where: { accion: 'REGISTRAR_RETIRO_CAJA' },
    });
    expect((registroRetiro!.datosNuevos as { socio: string }).socio).toBe('ARIEL');
  });

  it('el cierre cuadra al centavo con TODO el movimiento del turno', async () => {
    // Efectivo esperado: 0 + 54.000 (venta) − 2.000 (gasto) − 10.000 (retiro) = 42.000
    // (la atención no mueve caja). Pollos: 0 + 6 marcados − 2,5 vendidos
    // − 1 atención − 1 retorno − 0,5 quemado = 1
    const res = await app.inject({
      method: 'POST',
      url: '/api/turnos/cerrar',
      headers: auth(f.usuarios.cajero.token),
      payload: { conteoEfectivo: 42000, conteoPollosMarcados: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().turno.estado).toBe('CERRADO');

    const prisma = await getPrisma();
    const alerta = await prisma.alerta.findFirst({ where: { tipo: 'DISCREPANCIA_CAJA' } });
    expect(alerta).toBeNull(); // coincidió — sin alerta
  });

  it('el resumen financiero del turno (solo admin/socio) muestra todo', async () => {
    const prisma = await getPrisma();
    const turno = await prisma.turno.findFirst({ where: { estado: 'CERRADO' } });

    const paraCajero = await app.inject({
      method: 'GET',
      url: `/api/turnos/${turno!.id}/resumen`,
      headers: auth(f.usuarios.cajero.token),
    });
    expect(paraCajero.statusCode).toBe(403);

    const res = await app.inject({
      method: 'GET',
      url: `/api/turnos/${turno!.id}/resumen`,
      headers: auth(f.usuarios.admin.token),
    });
    expect(res.statusCode).toBe(200);
    const resumen = res.json();
    expect(resumen.ventasPorMedio).toEqual([{ medio: 'EFECTIVO', total: '54000' }]);
    expect(resumen.turno.retiros[0].socio).toBe('ARIEL');
    expect(resumen.turno.gastos).toHaveLength(1);
    expect(resumen.turno.atenciones).toHaveLength(1);
    expect(resumen.turno.eventosMarcado).toHaveLength(1);
    // el admin sí ve el arqueo completo
    expect(res.body).toContain('valorEsperado');
  });
});

describe('RBAC de caja', () => {
  it('SOCIO y PRODUCCION no pueden registrar nada de caja (403)', async () => {
    for (const usuario of [f.usuarios.socio, f.usuarios.produccion]) {
      const gasto = await app.inject({
        method: 'POST',
        url: '/api/gastos-caja',
        headers: auth(usuario.token),
        payload: { monto: 100, medio: 'EFECTIVO', categoria: 'LIMPIEZA' },
      });
      expect(gasto.statusCode).toBe(403);
      const marcado = await app.inject({
        method: 'POST',
        url: '/api/marcado-pollos',
        headers: auth(usuario.token),
        payload: { cantidad: 1 },
      });
      expect(marcado.statusCode).toBe(403);
    }
  });

  it('sin turno abierto, nada de caja funciona (409)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/marcado-pollos',
      headers: auth(f.usuarios.cajero.token),
      payload: { cantidad: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().codigo).toBe('TURNO_NO_ABIERTO');
  });
});
