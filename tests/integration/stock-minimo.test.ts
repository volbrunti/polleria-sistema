import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { validarDbDeTest, limpiarDb, sembrarFixtures, getApp, getPrisma, auth, type Fixtures } from './helpers';

// Módulo 2 — Alertas de stock mínimo desde el POS (CLAUDE-MODULO-2.md §6.6):
// aviso repetido en CADA venta bajo el mínimo (no bloquea), Alerta al admin
// solo al CRUZAR el umbral, bloqueo real recién en stock cero.

let app: FastifyInstance;
let f: Fixtures;

beforeAll(async () => {
  validarDbDeTest();
  await limpiarDb();
  f = await sembrarFixtures();
  app = await getApp();

  const prisma = await getPrisma();
  await prisma.precio.create({
    data: { productoId: f.productos.milanesa, monto: 2500, usuarioId: f.usuarios.admin.id },
  });
  // stock inicial: 8 milanesas en Local 1
  await prisma.movimientoStock.create({
    data: {
      productoId: f.productos.milanesa,
      sucursalId: f.sucursales.local1,
      tipo: 'AJUSTE',
      cantidad: new Prisma.Decimal(8),
      usuarioId: f.usuarios.admin.id,
      tipoOrigen: 'Ajuste',
      origenId: 0,
    },
  });
  // turno abierto para poder vender
  await app.inject({
    method: 'POST',
    url: '/api/turnos/abrir',
    headers: auth(f.usuarios.cajero.token),
    payload: { conteoEfectivo: 0, conteoPollosMarcados: 0 },
  });
});

afterAll(async () => {
  await app.close();
});

async function vender(cantidad: number) {
  return app.inject({
    method: 'POST',
    url: '/api/pedidos',
    headers: auth(f.usuarios.cajero.token),
    payload: { tipo: 'PRESENCIAL', items: [{ productoId: f.productos.milanesa, cantidad }] },
  });
}

describe('Configuración', () => {
  it('el CAJERO no puede configurar mínimos (403); el ADMIN sí', async () => {
    const intento = await app.inject({
      method: 'POST',
      url: '/api/config-stock-minimo',
      headers: auth(f.usuarios.cajero.token),
      payload: { productoId: f.productos.milanesa, sucursalId: f.sucursales.local1, minimo: 5 },
    });
    expect(intento.statusCode).toBe(403);

    const res = await app.inject({
      method: 'POST',
      url: '/api/config-stock-minimo',
      headers: auth(f.usuarios.admin.token),
      payload: { productoId: f.productos.milanesa, sucursalId: f.sucursales.local1, minimo: 5 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().minimo).toBe('5');
  });
});

describe('Avisos y alertas al vender', () => {
  it('venta que queda EN o SOBRE el mínimo: sin aviso', async () => {
    const res = await vender(3); // 8 → 5 (= mínimo, no "bajo")
    expect(res.statusCode).toBe(201);
    expect(res.json().avisosStockMinimo).toEqual([]);
  });

  it('venta que CRUZA el umbral: aviso en el POS + Alerta al admin', async () => {
    const res = await vender(1); // 5 → 4 < 5
    expect(res.statusCode).toBe(201);
    const avisos = res.json().avisosStockMinimo;
    expect(avisos).toHaveLength(1);
    expect(avisos[0].stockRestante).toBe('4');
    expect(avisos[0].minimo).toBe('5');

    const prisma = await getPrisma();
    expect(await prisma.alerta.count({ where: { tipo: 'STOCK_MINIMO' } })).toBe(1);
  });

  it('la venta siguiente bajo el mínimo repite el aviso pero NO crea otra alerta', async () => {
    const res = await vender(1); // 4 → 3
    expect(res.json().avisosStockMinimo).toHaveLength(1);
    const prisma = await getPrisma();
    expect(await prisma.alerta.count({ where: { tipo: 'STOCK_MINIMO' } })).toBe(1); // sigue en 1
  });

  it('se puede vender hasta CERO, pero no más (bloqueo real)', async () => {
    const hastaCero = await vender(3); // 3 → 0
    expect(hastaCero.statusCode).toBe(201);

    const sinStock = await vender(1);
    expect(sinStock.statusCode).toBe(400);
    expect(sinStock.json().codigo).toBe('STOCK_INSUFICIENTE');
  });

  it('al reponerse por encima del mínimo, los avisos desaparecen solos', async () => {
    const prisma = await getPrisma();
    await prisma.movimientoStock.create({
      data: {
        productoId: f.productos.milanesa,
        sucursalId: f.sucursales.local1,
        tipo: 'AJUSTE',
        cantidad: new Prisma.Decimal(10), // 0 → 10
        usuarioId: f.usuarios.admin.id,
        tipoOrigen: 'Ajuste',
        origenId: 0,
      },
    });
    const res = await vender(1); // 10 → 9 ≥ 5
    expect(res.statusCode).toBe(201);
    expect(res.json().avisosStockMinimo).toEqual([]);
  });

  it('volver a cruzar el umbral genera una alerta NUEVA', async () => {
    const res = await vender(5); // 9 → 4 < 5, cruce de nuevo
    expect(res.json().avisosStockMinimo).toHaveLength(1);
    const prisma = await getPrisma();
    expect(await prisma.alerta.count({ where: { tipo: 'STOCK_MINIMO' } })).toBe(2);
  });

  it('una config desactivada no genera avisos', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/config-stock-minimo',
      headers: auth(f.usuarios.admin.token),
      payload: { productoId: f.productos.milanesa, sucursalId: f.sucursales.local1, minimo: 5, activa: false },
    });
    const res = await vender(1); // 4 → 3, bajo el mínimo pero config inactiva
    expect(res.json().avisosStockMinimo).toEqual([]);
  });

  it('el SOCIO puede ver la configuración (solo lectura)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/config-stock-minimo',
      headers: auth(f.usuarios.socio.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });
});
