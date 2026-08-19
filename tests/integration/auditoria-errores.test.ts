import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { validarDbDeTest, limpiarDb, sembrarFixtures, getApp, getPrisma, auth, type Fixtures } from './helpers';

// ─────────────────────────────────────────────────────────────────────
// AUDITORÍA DE MANEJO DE ERRORES (2026-08-07) — Área 2
// Cada endpoint de escritura contra entradas basura, IDs inexistentes,
// IDs de otra sucursal y estados imposibles. Lo que se busca no es que
// rechace (eso ya se sabe), sino CÓMO: 400/404/409 con código de
// errores.ts, o 500 genérico que al frontend no le sirve.
// ─────────────────────────────────────────────────────────────────────

let app: FastifyInstance;
let f: Fixtures;
const resultados: { caso: string; status: number; codigo: string }[] = [];

beforeAll(async () => {
  validarDbDeTest();
  await limpiarDb();
  f = await sembrarFixtures();
  app = await getApp();
  const prisma = await getPrisma();
  await prisma.producto.create({
    data: { nombre: 'Pollo a la leña (entero) — MARCADO', categoria: 'Pollos', tipo: 'ELABORADO', unidadDeMedida: 'UNIDAD' },
  });
  await prisma.precio.create({
    data: { productoId: f.productos.milanesa, monto: 2500, cantidad: 1, usuarioId: f.usuarios.admin.id },
  });
  await prisma.movimientoStock.create({
    data: {
      productoId: f.productos.milanesa, sucursalId: f.sucursales.local1, tipo: 'AJUSTE',
      cantidad: new Prisma.Decimal(50), usuarioId: f.usuarios.admin.id, tipoOrigen: 'Ajuste', origenId: 0,
    },
  });
  await app.inject({
    method: 'POST', url: '/api/turnos/abrir', headers: auth(f.usuarios.cajero.token),
    payload: { conteoEfectivo: 0, conteoPollosMarcados: 0 },
  });
});

afterAll(async () => {
  // eslint-disable-next-line no-console
  console.log('\n╔══ RESPUESTAS A ENTRADAS INVÁLIDAS ' + '═'.repeat(40));
  for (const r of resultados) {
    const marca = r.status === 500 ? '  ✗ 500' : `  ✓ ${r.status}`;
    // eslint-disable-next-line no-console
    console.log(`${marca}  ${r.codigo.padEnd(28)} ${r.caso}`);
  }
  // eslint-disable-next-line no-console
  console.log('╚' + '═'.repeat(74) + '\n');
  await app.close();
});

async function probar(caso: string, opciones: Parameters<FastifyInstance['inject']>[0]) {
  const res = await app.inject(opciones);
  let codigo = '—';
  try {
    codigo = (res.json() as { codigo?: string }).codigo ?? '(sin código)';
  } catch {
    codigo = '(cuerpo no-JSON)';
  }
  resultados.push({ caso, status: res.statusCode, codigo });
  return res;
}

const comoCajero = { authorization: `Bearer ${f?.usuarios?.cajero?.token ?? ''}` };

describe('A2.1 — Entradas inválidas en endpoints de escritura', () => {
  it('body vacío en POST /pedidos', async () => {
    const r = await probar('POST /pedidos — body vacío', {
      method: 'POST', url: '/api/pedidos', headers: auth(f.usuarios.cajero.token), payload: {},
    });
    expect(r.statusCode).toBe(400);
  });

  it('cantidad negativa', async () => {
    const r = await probar('POST /pedidos — cantidad -5', {
      method: 'POST', url: '/api/pedidos', headers: auth(f.usuarios.cajero.token),
      payload: { tipo: 'PRESENCIAL', items: [{ productoId: f.productos.milanesa, cantidad: -5 }] },
    });
    expect(r.statusCode).toBe(400);
  });

  it('cantidad 0', async () => {
    const r = await probar('POST /pedidos — cantidad 0', {
      method: 'POST', url: '/api/pedidos', headers: auth(f.usuarios.cajero.token),
      payload: { tipo: 'PRESENCIAL', items: [{ productoId: f.productos.milanesa, cantidad: 0 }] },
    });
    expect(r.statusCode).toBe(400);
  });

  it('cantidad fraccionaria donde se esperan unidades', async () => {
    const r = await probar('POST /pedidos — cantidad 1.5', {
      method: 'POST', url: '/api/pedidos', headers: auth(f.usuarios.cajero.token),
      payload: { tipo: 'PRESENCIAL', items: [{ productoId: f.productos.milanesa, cantidad: 1.5 }] },
    });
    expect(r.statusCode).toBe(400);
  });

  it('tipo de dato incorrecto (string donde va número)', async () => {
    const r = await probar('POST /pedidos — productoId "abc"', {
      method: 'POST', url: '/api/pedidos', headers: auth(f.usuarios.cajero.token),
      payload: { tipo: 'PRESENCIAL', items: [{ productoId: 'abc', cantidad: 1 }] },
    });
    expect(r.statusCode).toBe(400);
  });

  it('producto que no existe', async () => {
    const r = await probar('POST /pedidos — productoId 999999', {
      method: 'POST', url: '/api/pedidos', headers: auth(f.usuarios.cajero.token),
      payload: { tipo: 'PRESENCIAL', items: [{ productoId: 999999, cantidad: 1 }] },
    });
    expect(r.statusCode).toBe(404);
  });

  it('pedido que no existe (cobrar)', async () => {
    const r = await probar('POST /pedidos/999999/cobrar', {
      method: 'POST', url: '/api/pedidos/999999/cobrar', headers: auth(f.usuarios.cajero.token),
      payload: { pagos: [{ medio: 'EFECTIVO', monto: 100 }] },
    });
    expect(r.statusCode).toBe(404);
  });

  it('monto de gasto negativo', async () => {
    const r = await probar('POST /gastos-caja — monto -1000', {
      method: 'POST', url: '/api/gastos-caja', headers: auth(f.usuarios.cajero.token),
      payload: { monto: -1000, medio: 'EFECTIVO', categoria: 'INSUMOS' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('medio de pago inexistente', async () => {
    const r = await probar('POST /gastos-caja — medio BITCOIN', {
      method: 'POST', url: '/api/gastos-caja', headers: auth(f.usuarios.cajero.token),
      payload: { monto: 100, medio: 'BITCOIN', categoria: 'INSUMOS' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('socio fuera del selector cerrado', async () => {
    const r = await probar('POST /retiros-caja — socio JUAN', {
      method: 'POST', url: '/api/retiros-caja', headers: auth(f.usuarios.cajero.token),
      payload: { monto: 100, medio: 'EFECTIVO', socio: 'JUAN' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('string vacío en campo obligatorio (nombre de producto)', async () => {
    const r = await probar('POST /productos — nombre ""', {
      method: 'POST', url: '/api/productos', headers: auth(f.usuarios.admin.token),
      payload: { nombre: '', categoria: 'Test', tipo: 'ELABORADO', unidadDeMedida: 'UNIDAD' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('conteo de arqueo negativo', async () => {
    const r = await probar('POST /turnos/abrir — conteo -500', {
      method: 'POST', url: '/api/turnos/abrir', headers: auth(f.usuarios.cajero.token),
      payload: { conteoEfectivo: -500, conteoPollosMarcados: 0 },
    });
    expect(r.statusCode).toBe(400);
  });

  it('marcar pollos con cantidad no numérica', async () => {
    const r = await probar('POST /marcado-pollos — cantidad null', {
      method: 'POST', url: '/api/marcado-pollos', headers: auth(f.usuarios.cajero.token),
      payload: { cantidad: null },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('A2.2 — Colisión de unique: ¿400 claro o 500 genérico?', () => {
  it('crear un producto con un nombre que ya existe', async () => {
    const r = await probar('POST /productos — nombre duplicado', {
      method: 'POST', url: '/api/productos', headers: auth(f.usuarios.admin.token),
      payload: { nombre: 'Milanesa de nalga', categoria: 'Test', tipo: 'ELABORADO', unidadDeMedida: 'UNIDAD' },
    });
    // Un P2002 de Prisma sin mapear cae al catch genérico del app.setErrorHandler
    expect(r.statusCode).not.toBe(500);
  });

  it('crear un proveedor con un nombre que ya existe', async () => {
    const r = await probar('POST /proveedores — nombre duplicado', {
      method: 'POST', url: '/api/proveedores', headers: auth(f.usuarios.admin.token),
      payload: { nombre: 'Granja San José' },
    });
    expect(r.statusCode).not.toBe(500);
  });

  it('crear un usuario con un username que ya existe', async () => {
    const r = await probar('POST /usuarios — username duplicado', {
      method: 'POST', url: '/api/usuarios', headers: auth(f.usuarios.admin.token),
      payload: { nombre: 'Otro', username: 'cajero', password: 'clave12345', rol: 'CAJERO', sucursalId: f.sucursales.local1 },
    });
    expect(r.statusCode).not.toBe(500);
  });
});

describe('A2.3 — Aislamiento de sucursal en escritura', () => {
  it('cajero de Local 1 intentando operar sobre Local 2', async () => {
    const r = await probar('POST /pedidos — sucursalId de otro local', {
      method: 'POST', url: '/api/pedidos', headers: auth(f.usuarios.cajero.token),
      payload: { tipo: 'PRESENCIAL', sucursalId: f.sucursales.local2, items: [{ productoId: f.productos.milanesa, cantidad: 1 }] },
    });
    expect(r.statusCode).toBe(403);
  });

  it('SOCIO no puede escribir nada', async () => {
    const r = await probar('POST /pedidos — como SOCIO', {
      method: 'POST', url: '/api/pedidos', headers: auth(f.usuarios.socio.token),
      payload: { tipo: 'PRESENCIAL', items: [{ productoId: f.productos.milanesa, cantidad: 1 }] },
    });
    expect(r.statusCode).toBe(403);
  });

  it('PRODUCCION no puede vender', async () => {
    const r = await probar('POST /pedidos — como PRODUCCION', {
      method: 'POST', url: '/api/pedidos', headers: auth(f.usuarios.produccion.token),
      payload: { tipo: 'PRESENCIAL', items: [{ productoId: f.productos.milanesa, cantidad: 1 }] },
    });
    expect(r.statusCode).toBe(403);
  });

  it('token inválido', async () => {
    const r = await probar('POST /pedidos — token basura', {
      method: 'POST', url: '/api/pedidos', headers: { authorization: 'Bearer no-es-un-token' },
      payload: { tipo: 'PRESENCIAL', items: [{ productoId: f.productos.milanesa, cantidad: 1 }] },
    });
    expect(r.statusCode).toBe(401);
  });
});

describe('A2.4 — Transiciones de estado imposibles atacadas desde la API', () => {
  it('un pedido ENTREGADO no se puede anular ni desde la API directa', async () => {
    const pedido = (
      await app.inject({
        method: 'POST', url: '/api/pedidos', headers: auth(f.usuarios.cajero.token),
        payload: { tipo: 'PRESENCIAL', items: [{ productoId: f.productos.milanesa, cantidad: 1 }] },
      })
    ).json();
    await app.inject({
      method: 'POST', url: `/api/pedidos/${pedido.id}/cobrar`, headers: auth(f.usuarios.cajero.token),
      payload: { pagos: [{ medio: 'MERCADO_PAGO', monto: 2500 }] },
    });
    // Cobrar desde EN_PREPARACION ya no cierra el pedido (§6, cobro
    // temprano) — se queda pagado esperando a cocina. Marcar Listo ahí lo
    // cierra directo a ENTREGADO (ya no queda nada pendiente), que es lo
    // que este test necesita para probar que un ENTREGADO no se anula.
    await app.inject({
      method: 'POST', url: `/api/pedidos/${pedido.id}/marcar-listo`, headers: auth(f.usuarios.cajero.token),
    });
    const r = await probar('POST /pedidos/:id/anular — sobre ENTREGADO', {
      method: 'POST', url: `/api/pedidos/${pedido.id}/anular`, headers: auth(f.usuarios.cajero.token),
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('ESTADO_PEDIDO_INVALIDO');
  });

  it('modificar un pedido ya cobrado', async () => {
    const pedido = (
      await app.inject({
        method: 'POST', url: '/api/pedidos', headers: auth(f.usuarios.cajero.token),
        payload: { tipo: 'PRESENCIAL', items: [{ productoId: f.productos.milanesa, cantidad: 1 }] },
      })
    ).json();
    await app.inject({
      method: 'POST', url: `/api/pedidos/${pedido.id}/cobrar`, headers: auth(f.usuarios.cajero.token),
      payload: { pagos: [{ medio: 'MERCADO_PAGO', monto: 2500 }] },
    });
    const r = await probar('PATCH /pedidos/:id — sobre ENTREGADO', {
      method: 'PATCH', url: `/api/pedidos/${pedido.id}`, headers: auth(f.usuarios.cajero.token),
      payload: { items: [{ productoId: f.productos.milanesa, cantidad: 9 }] },
    });
    expect(r.statusCode).toBe(409);
  });
});
