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

// ─────────────────────────────────────────────────────────────────────
// AUDITORÍA DE CONCURRENCIA (2026-08-07) — Área 1
//
// carreras-y-vectores.test.ts ya cubre las carreras sobre UNA MISMA fila
// (doble click con el mismo token, doble cobro, doble anulación): todas
// esas están protegidas por `transicionarAtomico`, que condiciona el
// UPDATE al estado leído y por lo tanto toma un row lock.
//
// Lo que NO estaba cubierto es la carrera entre operaciones que NO
// comparten ninguna fila: dos pedidos DISTINTOS que compiten por el mismo
// stock. Ahí no hay fila que trabar — el stock es un SUM() sobre
// MovimientoStock — así que el patrón "leer, decidir, escribir" queda
// expuesto bajo READ COMMITTED (que es lo que usa PostgreSQL por defecto
// y lo que Prisma aplica: OPCIONES_TX no fija isolationLevel).
//
// Estos tests describen el comportamiento REAL observado, no el deseado.
// Los `expect` marcados con [BUG] documentan el defecto encontrado.
// ─────────────────────────────────────────────────────────────────────

let app: FastifyInstance;
let f: Fixtures;
let empanadaId: number;
let polloFrescoId: number;
let polloMarcadoId: number;
let cajero2: { id: number; token: string };

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

  const fresco = await prisma.producto.create({
    data: { nombre: 'Pollo a la leña (entero)', categoria: 'Pollos', tipo: 'ELABORADO', unidadDeMedida: 'UNIDAD' },
  });
  polloFrescoId = fresco.id;
  const marcado = await prisma.producto.create({
    data: {
      nombre: 'Pollo a la leña (entero) — MARCADO',
      categoria: 'Pollos',
      tipo: 'ELABORADO',
      unidadDeMedida: 'UNIDAD',
      esProductoSistema: true,
    },
  });
  polloMarcadoId = marcado.id;

  const precio = (productoId: number, monto: number, cantidad = 1) =>
    prisma.precio.create({ data: { productoId, monto, cantidad, usuarioId: admin } });
  await precio(empanadaId, 1600);
  await precio(f.productos.milanesa, 2500);
  await precio(polloFrescoId, 20000);

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
  // Stock JUSTO: 10 empanadas en Local 1. Dos pedidos de 10 no pueden
  // salir los dos.
  await ajuste(empanadaId, 10, f.sucursales.local1);
  await ajuste(f.productos.milanesa, 50, f.sucursales.local1);
  await ajuste(polloFrescoId, 4, f.sucursales.local1);
  // Local 2 con su propio stock, para probar que no se interfieren
  await ajuste(empanadaId, 10, f.sucursales.local2);

  const bcrypt = await import('bcryptjs');
  const { firmarAccessToken } = await import('../../src/plugins/auth');
  const hash = await bcrypt.default.hash('clave123', 4);
  const u = await prisma.usuario.create({
    data: { nombre: 'cajero2', username: 'cajero2', passwordHash: hash, rol: 'CAJERO', sucursalId: f.sucursales.local2 },
  });
  cajero2 = { id: u.id, token: firmarAccessToken({ id: u.id, username: u.username, rol: u.rol }) };
});

afterAll(async () => {
  await app.close();
});

const abrirTurno = (token: string) =>
  app.inject({
    method: 'POST',
    url: '/api/turnos/abrir',
    headers: auth(token),
    payload: { conteoEfectivo: 0, conteoPollosMarcados: 0 },
  });

describe('A1.1 — Dos pedidos DISTINTOS por la última unidad de stock', () => {
  it('abre los dos turnos', async () => {
    expect((await abrirTurno(f.usuarios.cajero.token)).statusCode).toBe(201);
    expect((await abrirTurno(cajero2.token)).statusCode).toBe(201);
  });

  it('dos pedidos de 10 empanadas con stock 10: ¿se permite vender 20?', async () => {
    expect(await stockDe(empanadaId, f.sucursales.local1)).toBe(10);

    // Tokens DISTINTOS: son dos pedidos genuinamente distintos, no un doble
    // click. La idempotencia no aplica — nada los serializa.
    const pedir = (token: string) =>
      app.inject({
        method: 'POST',
        url: '/api/pedidos',
        headers: auth(f.usuarios.cajero.token),
        payload: {
          tipo: 'PRESENCIAL',
          items: [{ productoId: empanadaId, cantidad: 10 }],
          tokenIdempotencia: token,
        },
      });

    const [r1, r2] = await Promise.all([pedir('carrera-stock-A'), pedir('carrera-stock-B')]);
    const stockFinal = await stockDe(empanadaId, f.sucursales.local1);

    // eslint-disable-next-line no-console
    console.log(
      `[A1.1] códigos=${r1.statusCode}/${r2.statusCode} stockFinal=${stockFinal} ` +
        `cuerpos=${JSON.stringify([r1.json(), r2.json()].map((b) => b.codigo ?? `pedido#${b.id}`))}`,
    );

    // El invariante INNEGOCIABLE de CLAUDE.md §5 Flujo 2 paso 4: NUNCA stock
    // negativo. Si esto falla, se vendió mercadería que no existía.
    expect(stockFinal).toBeGreaterThanOrEqual(0);
  });
});

describe('A1.2 — Dos aperturas de turno simultáneas en el MISMO local', () => {
  it('cierra el turno de Local 1 para poder reabrirlo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/turnos/cerrar',
      headers: auth(f.usuarios.cajero.token),
      payload: { conteoEfectivo: 0, conteoPollosMarcados: 0 },
    });
    expect(res.statusCode).toBe(200);
  });

  it('dos aperturas en paralelo: debe quedar UN solo turno activo', async () => {
    const [r1, r2] = await Promise.all([
      abrirTurno(f.usuarios.cajero.token),
      abrirTurno(f.usuarios.cajero.token),
    ]);
    const prisma = await getPrisma();
    const activos = await prisma.turno.count({
      where: { sucursalId: f.sucursales.local1, estado: { in: ['ABIERTO', 'BLOQUEADO'] } },
    });
    // eslint-disable-next-line no-console
    console.log(`[A1.2] códigos=${r1.statusCode}/${r2.statusCode} turnosActivos=${activos}`);
    expect(activos).toBe(1);
  });
});

describe('A1.3 — Dos sucursales operando en paralelo NO se interfieren', () => {
  it('20 pedidos alternados entre Local 1 y Local 2: cada stock baja solo por lo suyo', async () => {
    const prisma = await getPrisma();
    // Se reponen ambos stocks a 20 para tener margen
    const reponer = (sucursalId: number) =>
      prisma.movimientoStock.create({
        data: {
          productoId: empanadaId,
          sucursalId,
          tipo: 'AJUSTE',
          cantidad: new Prisma.Decimal(20),
          usuarioId: f.usuarios.admin.id,
          tipoOrigen: 'Ajuste',
          origenId: 0,
        },
      });
    await reponer(f.sucursales.local1);
    await reponer(f.sucursales.local2);

    const s1Antes = await stockDe(empanadaId, f.sucursales.local1);
    const s2Antes = await stockDe(empanadaId, f.sucursales.local2);

    const pedir = (token: string, n: number) =>
      app.inject({
        method: 'POST',
        url: '/api/pedidos',
        headers: auth(token),
        payload: {
          tipo: 'PRESENCIAL',
          items: [{ productoId: empanadaId, cantidad: 1 }],
          tokenIdempotencia: `cruzado-${n}`,
        },
      });

    const tandas = [];
    for (let i = 0; i < 5; i++) {
      tandas.push(pedir(f.usuarios.cajero.token, i * 2));
      tandas.push(pedir(cajero2.token, i * 2 + 1));
    }
    const res = await Promise.all(tandas);
    const ok = res.filter((r) => r.statusCode === 201).length;

    const s1 = await stockDe(empanadaId, f.sucursales.local1);
    const s2 = await stockDe(empanadaId, f.sucursales.local2);
    // eslint-disable-next-line no-console
    console.log(`[A1.3] ok=${ok}/10 local1: ${s1Antes}→${s1}  local2: ${s2Antes}→${s2}`);

    expect(ok).toBe(10);
    expect(s1).toBe(s1Antes - 5);
    expect(s2).toBe(s2Antes - 5);
  });
});

describe('A1.4 — Marcar pollos en paralelo con stock justo', () => {
  it('dos marcados de 4 con 4 pollos frescos: el fresco no puede quedar negativo', async () => {
    const antes = await stockDe(polloFrescoId, f.sucursales.local1);
    const marcar = () =>
      app.inject({
        method: 'POST',
        url: '/api/marcado-pollos',
        headers: auth(f.usuarios.cajero.token),
        payload: { cantidad: antes },
      });
    const [r1, r2] = await Promise.all([marcar(), marcar()]);
    const fresco = await stockDe(polloFrescoId, f.sucursales.local1);
    const marcado = await stockDe(polloMarcadoId, f.sucursales.local1);
    // eslint-disable-next-line no-console
    console.log(`[A1.4] códigos=${r1.statusCode}/${r2.statusCode} fresco=${antes}→${fresco} marcado=${marcado}`);
    expect(fresco).toBeGreaterThanOrEqual(0);
  });
});

describe('A1.5 — Modificar y cobrar el mismo pedido en paralelo', () => {
  it('el cobro no puede quedarse con el total viejo', async () => {
    const pedido = (
      await app.inject({
        method: 'POST',
        url: '/api/pedidos',
        headers: auth(f.usuarios.cajero.token),
        payload: {
          tipo: 'PRESENCIAL',
          items: [{ productoId: f.productos.milanesa, cantidad: 1 }],
          tokenIdempotencia: 'modificar-vs-cobrar',
        },
      })
    ).json();
    // total inicial: 1 milanesa = 2500

    const [rMod, rCobro] = await Promise.all([
      // pasa a 4 milanesas → total real 10000
      app.inject({
        method: 'PATCH',
        url: `/api/pedidos/${pedido.id}`,
        headers: auth(f.usuarios.cajero.token),
        payload: { items: [{ productoId: f.productos.milanesa, cantidad: 4 }] },
      }),
      // cobra 2500 (el total que el cajero tenía en pantalla)
      app.inject({
        method: 'POST',
        url: `/api/pedidos/${pedido.id}/cobrar`,
        headers: auth(f.usuarios.cajero.token),
        payload: { pagos: [{ medio: 'MERCADO_PAGO', monto: 2500 }] },
      }),
    ]);

    const prisma = await getPrisma();
    const final = await prisma.pedido.findUnique({
      where: { id: pedido.id },
      include: { items: true, pagos: true },
    });
    const totalItems = final!.items.reduce((a, i) => a + Number(i.montoTotal), 0);
    const totalPagos = final!.pagos.reduce((a, p) => a + Number(p.monto), 0);
    // eslint-disable-next-line no-console
    console.log(
      `[A1.5] mod=${rMod.statusCode} cobro=${rCobro.statusCode} estado=${final!.estado} ` +
        `totalItems=${totalItems} totalPagos=${totalPagos}`,
    );

    // Si el pedido quedó ENTREGADO, lo cobrado tiene que cubrir lo que
    // realmente se entregó. Cobrar 2500 por 10000 de mercadería es plata
    // que falta en la caja y que el arqueo ciego le va a cargar al cajero.
    if (final!.estado === 'ENTREGADO' && totalPagos > 0) {
      expect(totalPagos).toBeGreaterThanOrEqual(totalItems);
    }
  });
});

describe('A1.6 — Reintento de red en operaciones de caja', () => {
  it('dos POST idénticos de gasto con el mismo token: UN solo gasto', async () => {
    const payload = {
      monto: 5000,
      medio: 'EFECTIVO',
      categoria: 'INSUMOS',
      descripcion: 'hielo',
      tokenIdempotencia: 'gasto-reintento-0001',
    };
    const gastar = () =>
      app.inject({ method: 'POST', url: '/api/gastos-caja', headers: auth(f.usuarios.cajero.token), payload });
    const [r1, r2] = await Promise.all([gastar(), gastar()]);

    const prisma = await getPrisma();
    const n = await prisma.gastoDeCaja.count({ where: { descripcion: 'hielo' } });
    // eslint-disable-next-line no-console
    console.log(`[A1.6] códigos=${r1.statusCode}/${r2.statusCode} gastosCreados=${n} ids=${r1.json().id}/${r2.json().id}`);
    expect(n).toBe(1);
    // Las dos requests responden OK y con el MISMO registro: al cajero no le
    // aparece un error por haber reintentado algo que ya había funcionado.
    expect(r1.json().id).toBe(r2.json().id);
  });

  it('reintento secuencial del mismo retiro: no duplica la plata', async () => {
    const payload = {
      monto: 50000,
      medio: 'EFECTIVO',
      socio: 'ARIEL',
      tokenIdempotencia: 'retiro-reintento-0001',
    };
    const retirar = () =>
      app.inject({ method: 'POST', url: '/api/retiros-caja', headers: auth(f.usuarios.cajero.token), payload });
    const r1 = await retirar();
    const r2 = await retirar();
    const prisma = await getPrisma();
    const suma = await prisma.retiroDeCaja.aggregate({
      where: { socio: 'ARIEL' },
      _sum: { monto: true },
    });
    // eslint-disable-next-line no-console
    console.log(`[A1.6b] ids=${r1.json().id}/${r2.json().id} totalRetirado=${suma._sum.monto}`);
    expect(r1.json().id).toBe(r2.json().id);
    expect(Number(suma._sum.monto)).toBe(50000);
  });

  it('marcar pollos con el mismo token no infla el arqueo ciego', async () => {
    const prisma = await getPrisma();
    await prisma.movimientoStock.create({
      data: {
        productoId: polloFrescoId,
        sucursalId: f.sucursales.local1,
        tipo: 'AJUSTE',
        cantidad: new Prisma.Decimal(6),
        usuarioId: f.usuarios.admin.id,
        tipoOrigen: 'Ajuste',
        origenId: 0,
      },
    });
    const marcadoAntes = await stockDe(polloMarcadoId, f.sucursales.local1);
    const payload = { cantidad: 3, tokenIdempotencia: 'marcado-reintento-0001' };
    const marcar = () =>
      app.inject({ method: 'POST', url: '/api/marcado-pollos', headers: auth(f.usuarios.cajero.token), payload });
    const [r1, r2] = await Promise.all([marcar(), marcar()]);
    const marcadoDespues = await stockDe(polloMarcadoId, f.sucursales.local1);
    // eslint-disable-next-line no-console
    console.log(`[A1.6c] ids=${r1.json().id}/${r2.json().id} marcado=${marcadoAntes}→${marcadoDespues}`);
    expect(r1.json().id).toBe(r2.json().id);
    expect(marcadoDespues).toBe(marcadoAntes + 3);
  });
});
