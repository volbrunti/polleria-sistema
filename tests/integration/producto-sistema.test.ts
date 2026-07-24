import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validarDbDeTest, limpiarDb, sembrarFixtures, getApp, getPrisma, auth, type Fixtures } from './helpers';

// Producto.esProductoSistema (agregado 2026-07-24, hallazgo de auditoría del
// módulo 2): "Pollo a la leña (entero) — MARCADO" y cualquier otro producto
// que sostenga un mecanismo interno del sistema no debe poder renombrarse ni
// desactivarse desde el catálogo de admin — rompería ese mecanismo en
// silencio (ver CLAUDE-MODULO-2.md §0).

let app: FastifyInstance;
let f: Fixtures;
let productoSistemaId: number;

beforeAll(async () => {
  validarDbDeTest();
  await limpiarDb();
  f = await sembrarFixtures();
  app = await getApp();

  const prisma = await getPrisma();
  const productoSistema = await prisma.producto.create({
    data: {
      nombre: 'Pollo a la leña (entero) — MARCADO',
      categoria: 'Pollos',
      tipo: 'ELABORADO',
      unidadDeMedida: 'UNIDAD',
      esProductoSistema: true,
    },
  });
  productoSistemaId = productoSistema.id;
});

afterAll(async () => {
  await app.close();
});

describe('Productos de sistema — protección contra rename/desactivación', () => {
  it('rechaza renombrar un producto de sistema', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/productos/${productoSistemaId}`,
      headers: auth(f.usuarios.admin.token),
      payload: { nombre: 'Pollo marcado (renombrado)' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().codigo).toBe('PRODUCTO_RESERVADO_SISTEMA');
  });

  it('rechaza desactivar un producto de sistema', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/productos/${productoSistemaId}`,
      headers: auth(f.usuarios.admin.token),
      payload: { activo: false },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().codigo).toBe('PRODUCTO_RESERVADO_SISTEMA');
  });

  it('permite cambiar la categoría de un producto de sistema', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/productos/${productoSistemaId}`,
      headers: auth(f.usuarios.admin.token),
      payload: { categoria: 'Pollos (marcados)' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().categoria).toBe('Pollos (marcados)');
  });

  it('permite renombrar un producto normal (no de sistema)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/productos/${f.productos.nalga}`,
      headers: auth(f.usuarios.admin.token),
      payload: { nombre: 'Nalga de pollo (kg) — renombrada' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().nombre).toBe('Nalga de pollo (kg) — renombrada');
  });
});
