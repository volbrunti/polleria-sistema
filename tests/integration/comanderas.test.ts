import net from 'node:net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { validarDbDeTest, limpiarDb, sembrarFixtures, getApp, getPrisma, auth, type Fixtures } from './helpers';

// Comanderas (CLAUDE.md §5 Flujo 4, §7 y §11 regla 14).
//
// La regla que este archivo protege: una impresora caída NUNCA puede frenar
// la caja. El pedido se confirma igual, y el sistema tiene que saber con
// precisión CUÁL de las dos comanderas falló — no un "error de impresión"
// genérico que deje al cajero sin saber qué compensar a viva voz.
//
// En vez de mockear el socket, levantamos un servidor TCP de verdad que hace
// de impresora buena y dejamos un puerto cerrado como impresora caída: así se
// ejercita el camino real de red, timeouts incluidos.

let app: FastifyInstance;
let f: Fixtures;

let impresoraFalsa: net.Server;
let puertoCocina: number;
const PUERTO_MOSTRADOR_CAIDO = 9; // discard: cerrado en el contenedor de test

// Lo que la "impresora" recibió, para poder inspeccionar el papel.
const recibido: Buffer[] = [];

beforeAll(async () => {
  validarDbDeTest();
  await limpiarDb();
  f = await sembrarFixtures();
  app = await getApp();

  impresoraFalsa = net.createServer((socket) => {
    socket.on('data', (chunk) => recibido.push(chunk));
  });
  await new Promise<void>((resolve) => impresoraFalsa.listen(0, '127.0.0.1', resolve));
  puertoCocina = (impresoraFalsa.address() as net.AddressInfo).port;

  const prisma = await getPrisma();
  await prisma.precio.create({
    data: { productoId: f.productos.milanesa, monto: 2500, usuarioId: f.usuarios.admin.id },
  });
  await prisma.movimientoStock.create({
    data: {
      productoId: f.productos.milanesa,
      sucursalId: f.sucursales.local1,
      tipo: 'AJUSTE',
      cantidad: new Prisma.Decimal(20),
      usuarioId: f.usuarios.admin.id,
      tipoOrigen: 'Ajuste',
      origenId: 0,
    },
  });
  await app.inject({
    method: 'POST',
    url: '/api/turnos/abrir',
    headers: auth(f.usuarios.cajero.token),
    payload: { conteoEfectivo: 0, conteoPollosMarcados: 0 },
  });
});

afterAll(async () => {
  await app.close();
  await new Promise<void>((resolve) => impresoraFalsa.close(() => resolve()));
});

// El despacho a las impresoras es deliberadamente posterior al commit (para no
// sostener locks de stock esperando hardware), así que el test tiene que
// esperar a que termine antes de mirar el resultado. Un `setTimeout` fijo de
// 600ms asumía un round-trip a la DB casi instantáneo; contra Neon (sobre
// todo la región de Virginia, lejos de acá) el despacho hace 2 round-trips
// propios (leer el ticket, actualizar cada impresión) que pueden superar eso
// de sobra, así que en vez de adivinar un número esperamos a que las
// impresiones del último ticket queden todas resueltas (impresa o con error).
async function esperarImpresion(pedidoId?: number) {
  const prisma = await getPrisma();
  const desde = Date.now();
  while (Date.now() - desde < 10000) {
    const ticket = await prisma.ticketCocina.findFirst({
      where: pedidoId ? { pedidoId } : undefined,
      orderBy: { id: 'desc' },
      include: { impresiones: true },
    });
    const resuelto =
      ticket && ticket.impresiones.length > 0 && ticket.impresiones.every((i) => i.impreso || i.errorImpresion);
    if (resuelto) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function vender(cantidad = 1) {
  return app.inject({
    method: 'POST',
    url: '/api/pedidos',
    headers: auth(f.usuarios.cajero.token),
    payload: {
      tipo: 'PRESENCIAL',
      items: [{ productoId: f.productos.milanesa, cantidad, aclaraciones: 'sin sal' }],
      tokenIdempotencia: `t-${Date.now()}-${Math.random()}`,
    },
  });
}

describe('Configuración de comanderas — RBAC (solo ADMIN)', () => {
  it('el CAJERO no puede ver ni cargar comanderas: es infraestructura', async () => {
    const ver = await app.inject({
      method: 'GET',
      url: '/api/configuracion-comandera',
      headers: auth(f.usuarios.cajero.token),
    });
    expect(ver.statusCode).toBe(403);

    const cargar = await app.inject({
      method: 'POST',
      url: '/api/configuracion-comandera',
      headers: auth(f.usuarios.cajero.token),
      payload: { sucursalId: f.sucursales.local1, destino: 'COCINA', nombre: 'X', ip: '10.0.0.5' },
    });
    expect(cargar.statusCode).toBe(403);
  });

  it('el SOCIO tampoco entra, aunque tenga lectura en todo lo demás', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/configuracion-comandera',
      headers: auth(f.usuarios.socio.token),
    });
    expect(res.statusCode).toBe(403);
  });

  it('el ADMIN carga las dos comanderas del local', async () => {
    const cocina = await app.inject({
      method: 'POST',
      url: '/api/configuracion-comandera',
      headers: auth(f.usuarios.admin.token),
      payload: {
        sucursalId: f.sucursales.local1,
        destino: 'COCINA',
        nombre: 'Comandera cocina - Local 1',
        ip: '127.0.0.1',
        puerto: puertoCocina,
      },
    });
    expect(cocina.statusCode).toBe(201);

    const mostrador = await app.inject({
      method: 'POST',
      url: '/api/configuracion-comandera',
      headers: auth(f.usuarios.admin.token),
      payload: {
        sucursalId: f.sucursales.local1,
        destino: 'MOSTRADOR',
        nombre: 'Comandera mostrador - Local 1',
        ip: '127.0.0.1',
        puerto: PUERTO_MOSTRADOR_CAIDO,
      },
    });
    expect(mostrador.statusCode).toBe(201);
  });

  it('rechaza una IP que no es IPv4', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/configuracion-comandera',
      headers: auth(f.usuarios.admin.token),
      payload: { sucursalId: f.sucursales.local2, destino: 'COCINA', nombre: 'X', ip: '999.1.1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('no deja cargar dos comanderas del mismo destino en la misma sucursal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/configuracion-comandera',
      headers: auth(f.usuarios.admin.token),
      payload: {
        sucursalId: f.sucursales.local1,
        destino: 'COCINA',
        nombre: 'Duplicada',
        ip: '10.0.0.9',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('Producción no puede tener comandera: no vende', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/configuracion-comandera',
      headers: auth(f.usuarios.admin.token),
      payload: {
        sucursalId: f.sucursales.produccion,
        destino: 'COCINA',
        nombre: 'No va',
        ip: '10.0.0.10',
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Impresión con una comandera caída', () => {
  it('el pedido se confirma IGUAL aunque el mostrador no imprima', async () => {
    const res = await vender(2);
    expect(res.statusCode).toBe(201);

    // Y el stock se descontó: la venta ocurrió de verdad, no quedó a medias.
    const prisma = await getPrisma();
    const movimientos = await prisma.movimientoStock.findMany({
      where: { productoId: f.productos.milanesa, sucursalId: f.sucursales.local1, tipo: 'VENTA' },
    });
    expect(movimientos.length).toBeGreaterThan(0);
  });

  it('registra el resultado de CADA comandera por separado', async () => {
    await esperarImpresion();
    const prisma = await getPrisma();
    const ticket = await prisma.ticketCocina.findFirst({
      orderBy: { id: 'desc' },
      include: { impresiones: { include: { configuracionComandera: true } } },
    });

    expect(ticket?.impresiones).toHaveLength(2);

    const cocina = ticket!.impresiones.find((i) => i.configuracionComandera.destino === 'COCINA');
    const mostrador = ticket!.impresiones.find((i) => i.configuracionComandera.destino === 'MOSTRADOR');

    // La que anda quedó OK; la caída quedó con su error. No es todo o nada.
    expect(cocina?.impreso).toBe(true);
    expect(cocina?.errorImpresion).toBeNull();
    expect(mostrador?.impreso).toBe(false);
    expect(mostrador?.errorImpresion).toBeTruthy();
  });

  it('la impresora recibió un ticket con el pedido, y SIN montos', async () => {
    const papel = Buffer.concat(recibido).toString('latin1');
    expect(papel).toContain('PEDIDO #');
    expect(papel).toContain('Milanesa');
    expect(papel).toContain('>> SIN SAL');
    // Control Ciego (§2): el cajero no ve importes, tampoco en papel.
    expect(papel).not.toContain('$');
    expect(papel).not.toMatch(/\d+[.,]\d{2}\b/);
  });

  it('soporte puede ver qué se mandó y cómo le fue a cada impresora', async () => {
    const prisma = await getPrisma();
    const ticket = await prisma.ticketCocina.findFirst({ orderBy: { id: 'desc' } });
    const res = await app.inject({
      method: 'GET',
      url: `/api/configuracion-comandera/tickets/${ticket!.pedidoId}`,
      headers: auth(f.usuarios.admin.token),
    });
    expect(res.statusCode).toBe(200);
    const tickets = res.json() as { impresiones: { impreso: boolean }[] }[];
    expect(tickets[0].impresiones).toHaveLength(2);
  });
});

describe('Anulación: la cocina se entera en papel', () => {
  it('anular genera un ticket ANULACION con el aviso de no preparar', async () => {
    const venta = await vender(1);
    const pedidoId = venta.json().id as number;

    const anular = await app.inject({
      method: 'POST',
      url: `/api/pedidos/${pedidoId}/anular`,
      headers: auth(f.usuarios.cajero.token),
    });
    expect(anular.statusCode).toBe(200);

    await esperarImpresion();
    const prisma = await getPrisma();
    const ticket = await prisma.ticketCocina.findFirst({
      where: { pedidoId, tipo: 'ANULACION' },
      include: { impresiones: true },
    });
    expect(ticket).toBeTruthy();
    expect(ticket!.impresiones).toHaveLength(2);

    const papel = Buffer.concat(recibido).toString('latin1');
    expect(papel).toContain('NO PREPARAR');
  });
});

describe('Comandera desactivada', () => {
  it('una comandera inactiva no recibe tickets ni cuenta como fallo', async () => {
    const prisma = await getPrisma();
    const mostrador = await prisma.configuracionComandera.findFirst({
      where: { sucursalId: f.sucursales.local1, destino: 'MOSTRADOR' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/configuracion-comandera/${mostrador!.id}`,
      headers: auth(f.usuarios.admin.token),
      payload: { activa: false },
    });

    const venta = await vender(1);
    expect(venta.statusCode).toBe(201);
    await esperarImpresion();

    const ticket = await prisma.ticketCocina.findFirst({
      where: { pedidoId: venta.json().id as number },
      include: { impresiones: { include: { configuracionComandera: true } } },
    });
    expect(ticket!.impresiones).toHaveLength(1);
    expect(ticket!.impresiones[0].configuracionComandera.destino).toBe('COCINA');
    expect(ticket!.impresiones[0].impreso).toBe(true);
  });

  it('la comandera que ya imprimió se desactiva, no se borra (queda el historial)', async () => {
    const prisma = await getPrisma();
    const cocina = await prisma.configuracionComandera.findFirst({
      where: { sucursalId: f.sucursales.local1, destino: 'COCINA' },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/configuracion-comandera/${cocina!.id}`,
      headers: auth(f.usuarios.admin.token),
    });
    expect(res.statusCode).toBe(200);

    const sigueExistiendo = await prisma.configuracionComandera.findUnique({ where: { id: cocina!.id } });
    expect(sigueExistiendo).toBeTruthy();
    expect(sigueExistiendo!.activa).toBe(false);
  });
});

describe('Auditoría de la configuración', () => {
  it('cambiar la IP queda auditado con el valor anterior y el nuevo', async () => {
    const prisma = await getPrisma();
    const comandera = await prisma.configuracionComandera.findFirst({
      where: { sucursalId: f.sucursales.local1, destino: 'COCINA' },
    });

    await app.inject({
      method: 'PATCH',
      url: `/api/configuracion-comandera/${comandera!.id}`,
      headers: auth(f.usuarios.admin.token),
      payload: { ip: '192.168.1.77' },
    });

    const registro = await prisma.registroAuditoria.findFirst({
      where: { accion: 'MODIFICAR_CONFIGURACION_COMANDERA', entidadId: comandera!.id },
      orderBy: { id: 'desc' },
    });
    expect(registro).toBeTruthy();
    expect((registro!.datosAnteriores as { ip: string }).ip).toBe(comandera!.ip);
    expect((registro!.datosNuevos as { ip: string }).ip).toBe('192.168.1.77');
  });
});
