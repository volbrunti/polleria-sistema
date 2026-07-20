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

// Vectores de ataque de la auditoría del módulo 2 (HANDOFF-AUDITORIA-MODULO-2.md
// §5): carreras, pagos raros, aislamiento y stock mínimo con combos.
// Corre en serie: el efectivo del turno se mantiene en 0 a propósito (todos
// los cobros son electrónicos) para poder cerrar y re-bloquear al final.

let app: FastifyInstance;
let f: Fixtures;

let empanadaId: number;
let papasId: number;
let comboPapasId: number;
let cajero2: { id: number; token: string };
let cajeroSinSucursal: { id: number; token: string };

beforeAll(async () => {
  validarDbDeTest();
  await limpiarDb();
  f = await sembrarFixtures();
  app = await getApp();

  const prisma = await getPrisma();
  const admin = f.usuarios.admin.id;

  const empanada = await prisma.producto.create({
    data: { nombre: 'Empanada de carne', categoria: 'Test', tipo: 'ELABORADO', unidadDeMedida: 'UNIDAD' },
  });
  empanadaId = empanada.id;
  const papas = await prisma.producto.create({
    data: { nombre: 'Papas fritas grande', categoria: 'Test', tipo: 'ELABORADO', unidadDeMedida: 'UNIDAD' },
  });
  papasId = papas.id;
  const combo = await prisma.producto.create({
    data: {
      nombre: 'Combo papas',
      categoria: 'Combos',
      tipo: 'COMBO',
      unidadDeMedida: 'UNIDAD',
      componentesDelCombo: { create: [{ productoComponenteId: papasId, cantidad: new Prisma.Decimal(1) }] },
    },
  });
  comboPapasId = combo.id;
  // producto MARCADO: necesario para la referencia ciega de pollos en la apertura
  await prisma.producto.create({
    data: { nombre: 'Pollo a la leña (entero) — MARCADO', categoria: 'Pollos', tipo: 'ELABORADO', unidadDeMedida: 'UNIDAD' },
  });

  const precio = (productoId: number, monto: number, cantidad = 1) =>
    prisma.precio.create({ data: { productoId, monto, cantidad, usuarioId: admin } });
  await precio(f.productos.milanesa, 2500);
  await precio(empanadaId, 1600);
  await precio(comboPapasId, 9000);

  const ajuste = (productoId: number, cantidad: number, sucursalId: number) =>
    prisma.movimientoStock.create({
      data: {
        productoId,
        sucursalId,
        tipo: 'AJUSTE',
        cantidad: new Prisma.Decimal(cantidad),
        usuarioId: admin,
        tipoOrigen: 'Ajuste',
        origenId: 0,
      },
    });
  await ajuste(f.productos.milanesa, 40, f.sucursales.local1);
  await ajuste(empanadaId, 40, f.sucursales.local1);
  await ajuste(papasId, 6, f.sucursales.local1);

  // stock mínimo de papas: 5 — la venta del combo tiene que cruzarlo
  await prisma.configuracionStockMinimo.create({
    data: {
      productoId: papasId,
      sucursalId: f.sucursales.local1,
      minimo: new Prisma.Decimal(5),
    },
  });

  // cajero de Local 2 (para la clave cruzada) y cajero SIN sucursal
  const bcrypt = await import('bcryptjs');
  const { firmarAccessToken } = await import('../../src/plugins/auth');
  const hash = await bcrypt.default.hash('clave123', 4);
  const crearUsuario = async (username: string, sucursalId: number | null) => {
    const u = await prisma.usuario.create({
      data: { nombre: username, username, passwordHash: hash, rol: 'CAJERO', sucursalId },
    });
    return { id: u.id, token: firmarAccessToken({ id: u.id, username: u.username, rol: u.rol }) };
  };
  cajero2 = await crearUsuario('cajero2', f.sucursales.local2);
  cajeroSinSucursal = await crearUsuario('cajero-sin-sucursal', null);
});

afterAll(async () => {
  await app.close();
});

describe('Aislamiento y usuarios mal configurados', () => {
  it('cajero SIN sucursal asignada: error claro, no un 500', async () => {
    const abrir = await app.inject({
      method: 'POST',
      url: '/api/turnos/abrir',
      headers: auth(cajeroSinSucursal.token),
      payload: { conteoEfectivo: 0, conteoPollosMarcados: 0 },
    });
    expect(abrir.statusCode).toBe(400);
    expect(abrir.json().mensaje).toMatch(/sucursal asignada/i);
  });

  it('ENCARGADO de Local 1 no puede consultar el turno activo de Local 2 (403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/turnos/activo?sucursalId=${f.sucursales.local2}`,
      headers: auth(f.usuarios.encargado.token),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Carreras (requests en paralelo)', () => {
  it('abre el turno de Local 1', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/turnos/abrir',
      headers: auth(f.usuarios.cajero.token),
      payload: { conteoEfectivo: 0, conteoPollosMarcados: 0 },
    });
    expect(res.json().bloqueado).toBe(false);
  });

  it('doble click en confirmar (mismo token de idempotencia): UN solo pedido, stock descontado una vez', async () => {
    const stockAntes = await stockDe(f.productos.milanesa, f.sucursales.local1);
    const payload = {
      tipo: 'PRESENCIAL',
      items: [{ productoId: f.productos.milanesa, cantidad: 2 }],
      tokenIdempotencia: 'doble-click-test-0001',
    };
    const [r1, r2] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/pedidos', headers: auth(f.usuarios.cajero.token), payload }),
      app.inject({ method: 'POST', url: '/api/pedidos', headers: auth(f.usuarios.cajero.token), payload }),
    ]);
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r1.json().id).toBe(r2.json().id);

    const prisma = await getPrisma();
    const pedidos = await prisma.pedido.count({ where: { tokenIdempotencia: 'doble-click-test-0001' } });
    expect(pedidos).toBe(1);
    expect(await stockDe(f.productos.milanesa, f.sucursales.local1)).toBe(stockAntes - 2);
  });

  it('retry secuencial con el mismo token también devuelve el pedido original', async () => {
    const payload = {
      tipo: 'PRESENCIAL',
      items: [{ productoId: f.productos.milanesa, cantidad: 1 }],
      tokenIdempotencia: 'retry-secuencial-0001',
    };
    const r1 = await app.inject({ method: 'POST', url: '/api/pedidos', headers: auth(f.usuarios.cajero.token), payload });
    const r2 = await app.inject({ method: 'POST', url: '/api/pedidos', headers: auth(f.usuarios.cajero.token), payload });
    expect(r2.json().id).toBe(r1.json().id);
  });

  it('cobrar el mismo pedido dos veces en paralelo: un solo cobro, un solo juego de pagos', async () => {
    const pedido = (
      await app.inject({
        method: 'POST',
        url: '/api/pedidos',
        headers: auth(f.usuarios.cajero.token),
        payload: { tipo: 'PRESENCIAL', items: [{ productoId: empanadaId, cantidad: 2 }] },
      })
    ).json();

    const cobro = { pagos: [{ medio: 'MERCADO_PAGO', monto: 3200 }] };
    const [r1, r2] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/pedidos/${pedido.id}/cobrar`, headers: auth(f.usuarios.cajero.token), payload: cobro }),
      app.inject({ method: 'POST', url: `/api/pedidos/${pedido.id}/cobrar`, headers: auth(f.usuarios.cajero.token), payload: cobro }),
    ]);
    const codigos = [r1.statusCode, r2.statusCode].sort();
    expect(codigos[0]).toBe(200);
    expect(codigos[1]).toBeGreaterThanOrEqual(400); // el que pierde la carrera corta

    const prisma = await getPrisma();
    const pagos = await prisma.pago.count({ where: { pedidoId: pedido.id } });
    expect(pagos).toBe(1);
  });

  it('anular el mismo pedido dos veces en paralelo: el stock se repone UNA sola vez', async () => {
    const stockAntes = await stockDe(empanadaId, f.sucursales.local1);
    const pedido = (
      await app.inject({
        method: 'POST',
        url: '/api/pedidos',
        headers: auth(f.usuarios.cajero.token),
        payload: { tipo: 'PRESENCIAL', items: [{ productoId: empanadaId, cantidad: 3 }] },
      })
    ).json();
    expect(await stockDe(empanadaId, f.sucursales.local1)).toBe(stockAntes - 3);

    const [r1, r2] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/pedidos/${pedido.id}/anular`, headers: auth(f.usuarios.cajero.token) }),
      app.inject({ method: 'POST', url: `/api/pedidos/${pedido.id}/anular`, headers: auth(f.usuarios.cajero.token) }),
    ]);
    const codigos = [r1.statusCode, r2.statusCode].sort();
    expect(codigos[0]).toBe(200);
    expect(codigos[1]).toBeGreaterThanOrEqual(400);

    // si la reposición corriera dos veces, quedaría stockAntes + 3
    expect(await stockDe(empanadaId, f.sucursales.local1)).toBe(stockAntes);
    const prisma = await getPrisma();
    const reposiciones = await prisma.movimientoStock.count({
      where: { tipo: 'ANULACION_REPOSICION', origenId: pedido.id },
    });
    expect(reposiciones).toBe(1);
  });
});

describe('Pagos raros', () => {
  it('pago 100% electrónico con monto mayor al total: rechazado (el vuelto no sale de MP)', async () => {
    const pedido = (
      await app.inject({
        method: 'POST',
        url: '/api/pedidos',
        headers: auth(f.usuarios.cajero.token),
        payload: { tipo: 'PRESENCIAL', items: [{ productoId: empanadaId, cantidad: 1 }] },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/api/pedidos/${pedido.id}/cobrar`,
      headers: auth(f.usuarios.cajero.token),
      payload: { pagos: [{ medio: 'MERCADO_PAGO', monto: 5000 }] }, // total: 1600
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().codigo).toBe('VUELTO_SIN_EFECTIVO');

    // y con el monto exacto sí cobra (para no dejar el pedido colgado)
    const ok = await app.inject({
      method: 'POST',
      url: `/api/pedidos/${pedido.id}/cobrar`,
      headers: auth(f.usuarios.cajero.token),
      payload: { pagos: [{ medio: 'MERCADO_PAGO', monto: 1600 }] },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe('Stock mínimo con combos', () => {
  it('vender un combo evalúa el mínimo de los COMPONENTES y dispara la alerta al cruzarlo', async () => {
    // papas: stock 6, mínimo 5. El combo lleva 1 papa; vender 2 combos → 4 (< 5, cruza)
    const res = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: auth(f.usuarios.cajero.token),
      payload: { tipo: 'PRESENCIAL', items: [{ productoId: comboPapasId, cantidad: 2 }] },
    });
    expect(res.statusCode).toBe(201);
    const avisos = res.json().avisosStockMinimo as { productoId: number }[];
    expect(avisos.some((a) => a.productoId === papasId)).toBe(true);

    const prisma = await getPrisma();
    const alerta = await prisma.alerta.findFirst({ where: { tipo: 'STOCK_MINIMO' } });
    expect(alerta).not.toBeNull();
    expect((alerta!.detalle as { productoId: number }).productoId).toBe(papasId);
  });
});

describe('Clave de emergencia cruzada', () => {
  it('una clave generada para el turno de Local 2 NO desbloquea el turno de Local 1 (error genérico)', async () => {
    // 1) Local 2 queda BLOQUEADO (efectivo esperado 0, contado 999)
    const bloqueo2 = await app.inject({
      method: 'POST',
      url: '/api/turnos/abrir',
      headers: auth(cajero2.token),
      payload: { conteoEfectivo: 999, conteoPollosMarcados: 0 },
    });
    expect(bloqueo2.json().bloqueado).toBe(true);
    const turnoLocal2 = bloqueo2.json().turno.id as number;

    // 2) clave para ESE turno
    const clave = (
      await app.inject({
        method: 'POST',
        url: '/api/claves-emergencia',
        headers: auth(f.usuarios.admin.token),
        payload: { turnoId: turnoLocal2 },
      })
    ).json() as { codigo: string };

    // 3) Local 1: cerrar el turno abierto (efectivo esperado 0: todos los
    //    cobros de este archivo fueron electrónicos) y reabrir bloqueado
    const cierre = await app.inject({
      method: 'POST',
      url: '/api/turnos/cerrar',
      headers: auth(f.usuarios.cajero.token),
      payload: { conteoEfectivo: 0, conteoPollosMarcados: 0 },
    });
    expect(cierre.statusCode).toBe(200);
    const bloqueo1 = await app.inject({
      method: 'POST',
      url: '/api/turnos/abrir',
      headers: auth(f.usuarios.cajero.token),
      payload: { conteoEfectivo: 555, conteoPollosMarcados: 0 },
    });
    expect(bloqueo1.json().bloqueado).toBe(true);
    const turnoLocal1 = bloqueo1.json().turno.id as number;

    // 4) la clave del turno de Local 2 contra el turno de Local 1: rechazada
    //    con el MISMO error genérico (no revela por qué)
    const cruzada = await app.inject({
      method: 'POST',
      url: '/api/claves-emergencia/usar',
      headers: auth(f.usuarios.cajero.token),
      payload: { codigo: clave.codigo, turnoId: turnoLocal1 },
    });
    expect(cruzada.statusCode).toBeGreaterThanOrEqual(400);
    expect(cruzada.json().codigo).toBe('CLAVE_INVALIDA');

    // 5) y en SU turno sí funciona (la clave no quedó quemada por el intento cruzado)
    const propia = await app.inject({
      method: 'POST',
      url: '/api/claves-emergencia/usar',
      headers: auth(cajero2.token),
      payload: { codigo: clave.codigo, turnoId: turnoLocal2 },
    });
    expect(propia.statusCode).toBe(200);
    expect(propia.json().desbloqueado).toBe(true);
  });
});
