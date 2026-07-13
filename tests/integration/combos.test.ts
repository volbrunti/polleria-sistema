import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validarDbDeTest, limpiarDb, sembrarFixtures, getApp, auth, type Fixtures } from './helpers';

// Combos (CLAUDE.md §9, agregado 2026-07-13): bundle de productos existentes
// a un precio propio, no calculado por descuento. No tienen stock propio ni
// versionado — a diferencia de las fichas técnicas, no hace falta "congelar"
// una composición histórica (todavía no existe módulo de ventas que la use).

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
});

describe('Combos — creación', () => {
  it('ADMIN crea un combo con varios componentes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/productos/combos',
      headers: auth(f.usuarios.admin.token),
      payload: {
        nombre: 'Combo Milanesa + Nalga extra',
        categoria: 'Combos',
        componentes: [
          { productoComponenteId: f.productos.milanesa, cantidad: 1 },
          { productoComponenteId: f.productos.nalga, cantidad: 0.5 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const combo = res.json();
    expect(combo.tipo).toBe('COMBO');
    expect(combo.unidadDeMedida).toBe('UNIDAD');
    expect(combo.componentesDelCombo).toHaveLength(2);
  });

  it('rechaza un combo sin componentes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/productos/combos',
      headers: auth(f.usuarios.admin.token),
      payload: { nombre: 'Combo vacío', categoria: 'Combos', componentes: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rechaza un componente que no existe', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/productos/combos',
      headers: auth(f.usuarios.admin.token),
      payload: {
        nombre: 'Combo con fantasma',
        categoria: 'Combos',
        componentes: [{ productoComponenteId: 999999, cantidad: 1 }],
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().codigo).toBe('NO_ENCONTRADO');
  });

  it('rechaza combos anidados (un componente que es otro combo)', async () => {
    const primero = await app.inject({
      method: 'POST',
      url: '/api/productos/combos',
      headers: auth(f.usuarios.admin.token),
      payload: {
        nombre: 'Combo base',
        categoria: 'Combos',
        componentes: [{ productoComponenteId: f.productos.milanesa, cantidad: 1 }],
      },
    });
    const comboBaseId = primero.json().id;

    const anidado = await app.inject({
      method: 'POST',
      url: '/api/productos/combos',
      headers: auth(f.usuarios.admin.token),
      payload: {
        nombre: 'Combo anidado',
        categoria: 'Combos',
        componentes: [{ productoComponenteId: comboBaseId, cantidad: 1 }],
      },
    });
    expect(anidado.statusCode).toBe(400);
    expect(anidado.json().codigo).toBe('VALIDACION');
  });

  it('SOCIO no puede crear combos', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/productos/combos',
      headers: auth(f.usuarios.socio.token),
      payload: {
        nombre: 'Combo prohibido',
        categoria: 'Combos',
        componentes: [{ productoComponenteId: f.productos.milanesa, cantidad: 1 }],
      },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Combos — lectura y edición', () => {
  let comboId: number;

  it('el combo aparece en GET /productos?tipo=COMBO con sus componentes', async () => {
    const crear = await app.inject({
      method: 'POST',
      url: '/api/productos/combos',
      headers: auth(f.usuarios.admin.token),
      payload: {
        nombre: 'Combo para editar',
        categoria: 'Combos',
        componentes: [{ productoComponenteId: f.productos.milanesa, cantidad: 2 }],
      },
    });
    comboId = crear.json().id;

    const res = await app.inject({
      method: 'GET',
      url: '/api/productos?tipo=COMBO',
      headers: auth(f.usuarios.admin.token),
    });
    expect(res.statusCode).toBe(200);
    const encontrado = res.json().find((p: { id: number }) => p.id === comboId);
    expect(encontrado).toBeDefined();
    expect(encontrado.componentesDelCombo[0].productoComponente.nombre).toBe('Milanesa de nalga');
  });

  it('reemplaza la composición completa del combo', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/productos/combos/${comboId}/componentes`,
      headers: auth(f.usuarios.admin.token),
      payload: {
        componentes: [
          { productoComponenteId: f.productos.panRallado, cantidad: 3 },
          { productoComponenteId: f.productos.huevo, cantidad: 6 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const componentes = res.json().componentesDelCombo;
    expect(componentes).toHaveLength(2);
    expect(componentes.map((c: { productoComponenteId: number }) => c.productoComponenteId).sort()).toEqual(
      [f.productos.panRallado, f.productos.huevo].sort(),
    );
  });

  it('el precio del combo funciona igual que el de cualquier producto (historial, nunca se pisa)', async () => {
    const p1 = await app.inject({
      method: 'POST',
      url: `/api/productos/${comboId}/precios`,
      headers: auth(f.usuarios.admin.token),
      payload: { monto: 15000 },
    });
    expect(p1.statusCode).toBe(201);

    const p2 = await app.inject({
      method: 'POST',
      url: `/api/productos/${comboId}/precios`,
      headers: auth(f.usuarios.admin.token),
      payload: { monto: 16000 },
    });
    expect(p2.statusCode).toBe(201);

    const historial = await app.inject({
      method: 'GET',
      url: `/api/productos/${comboId}/precios`,
      headers: auth(f.usuarios.admin.token),
    });
    expect(historial.json()).toHaveLength(2);
  });
});

// Precio por cantidad (CLAUDE.md §9, agregado 2026-07-13 al ver la planilla
// real del cliente): un combo pedido en cantidad N no siempre cuesta N ×
// precio de 1 — la planilla trae su propia tabla no lineal por volumen.
describe('Precio por cantidad', () => {
  let comboId: number;

  it('crea el combo para probar la tabla de precios', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/productos/combos',
      headers: auth(f.usuarios.admin.token),
      payload: {
        nombre: 'Combo con precio por volumen',
        categoria: 'Combos',
        componentes: [{ productoComponenteId: f.productos.milanesa, cantidad: 1 }],
      },
    });
    comboId = res.json().id;
  });

  it('un producto normal sigue usando cantidad=1 por default (retrocompatible)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/productos/${f.productos.milanesa}/precios`,
      headers: auth(f.usuarios.admin.token),
      payload: { monto: 2700 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().cantidad).toBe(1);
  });

  it('cargar el precio de cantidad=2 no toca el de cantidad=1', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/productos/${comboId}/precios`,
      headers: auth(f.usuarios.admin.token),
      payload: { monto: 29000, cantidad: 1 },
    });
    await app.inject({
      method: 'POST',
      url: `/api/productos/${comboId}/precios`,
      headers: auth(f.usuarios.admin.token),
      payload: { monto: 56000, cantidad: 2 }, // no es 58000: descuento real por volumen
    });

    const vigente = await app.inject({
      method: 'GET',
      url: `/api/productos/${comboId}/precios/vigente`,
      headers: auth(f.usuarios.admin.token),
    });
    expect(vigente.statusCode).toBe(200);
    const tabla = vigente.json() as { cantidad: number; monto: string }[];
    expect(tabla).toHaveLength(2);
    expect(tabla.find((t) => t.cantidad === 1)?.monto).toBe('29000');
    expect(tabla.find((t) => t.cantidad === 2)?.monto).toBe('56000');
  });

  it('cambiar el precio de cantidad=1 de nuevo no altera la tabla de cantidad=2', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/productos/${comboId}/precios`,
      headers: auth(f.usuarios.admin.token),
      payload: { monto: 30000, cantidad: 1 },
    });

    const vigente = await app.inject({
      method: 'GET',
      url: `/api/productos/${comboId}/precios/vigente`,
      headers: auth(f.usuarios.admin.token),
    });
    const tabla = vigente.json() as { cantidad: number; monto: string }[];
    expect(tabla.find((t) => t.cantidad === 1)?.monto).toBe('30000'); // el nuevo
    expect(tabla.find((t) => t.cantidad === 2)?.monto).toBe('56000'); // sigue igual
  });
});
