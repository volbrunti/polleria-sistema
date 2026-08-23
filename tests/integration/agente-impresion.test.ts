import net from 'node:net';
import { Server as SocketServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validarDbDeTest, limpiarDb, sembrarFixtures, getApp, getPrisma, auth, type Fixtures } from './helpers';

// Railway (donde corre el backend real, ver DEPLOY.md) no tiene ruta a la LAN
// del local: sin un agente conectado, "Imprimir prueba" y los tickets de
// cocina no pueden llegar a la impresora. Este archivo prueba ese camino
// completo — incluido el socket.io real (no mockeado), igual que
// comanderas.test.ts prueba el TCP real contra una impresora falsa.
//
// El servidor de sockets se arma acá con la MISMA lógica de auth/salas que
// src/server.ts (no se puede importar server.ts directo: llama app.listen()
// y arranca el timer de "no retirados").

let app: FastifyInstance;
let f: Fixtures;
let io: SocketServer;
let baseUrl: string;

let impresoraFalsa: net.Server;
let puertoImpresora: number;
const recibido: Buffer[] = [];

beforeAll(async () => {
  validarDbDeTest();
  await limpiarDb();
  f = await sembrarFixtures();
  app = await getApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as net.AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  const { verificarAccessToken } = await import('../../src/plugins/auth');
  const agenteImpresionService = await import('../../src/modules/comanderas/agente-impresion.service');

  io = new SocketServer(app.server, { cors: { origin: true } });
  io.use((socket, next) => {
    const tipoAgente = socket.handshake.auth?.tipoAgente as string | undefined;
    if (tipoAgente === 'impresion') {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('NO_AUTORIZADO'));
      agenteImpresionService
        .verificarToken(token)
        .then((sucursalId) => {
          if (sucursalId == null) return next(new Error('NO_AUTORIZADO'));
          socket.data.agenteSucursalId = sucursalId;
          next();
        })
        .catch(() => next(new Error('NO_AUTORIZADO')));
      return;
    }
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('NO_AUTORIZADO'));
      socket.data.usuario = verificarAccessToken(token);
      next();
    } catch {
      next(new Error('NO_AUTORIZADO'));
    }
  });
  io.on('connection', (socket) => {
    const agenteSucursalId = socket.data.agenteSucursalId as number | undefined;
    if (agenteSucursalId != null) {
      void socket.join(agenteImpresionService.salaAgente(agenteSucursalId));
      void agenteImpresionService.marcarConexion(agenteSucursalId);
    }
  });
  agenteImpresionService.configurarSocket(io);

  impresoraFalsa = net.createServer((socket) => {
    socket.on('data', (chunk) => recibido.push(chunk));
  });
  await new Promise<void>((resolve) => impresoraFalsa.listen(0, '127.0.0.1', resolve));
  puertoImpresora = (impresoraFalsa.address() as net.AddressInfo).port;
});

afterAll(async () => {
  io.close();
  await app.close();
  await new Promise<void>((resolve) => impresoraFalsa.close(() => resolve()));
});

function conectarAgente(token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, { auth: { tipoAgente: 'impresion', token }, reconnection: false });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

describe('Token del agente de impresión — RBAC (solo ADMIN)', () => {
  it('el CAJERO no puede generar ni ver el token: es infraestructura', async () => {
    const generar = await app.inject({
      method: 'POST',
      url: '/api/agentes-impresion',
      headers: auth(f.usuarios.cajero.token),
      payload: { sucursalId: f.sucursales.local1 },
    });
    expect(generar.statusCode).toBe(403);

    const ver = await app.inject({
      method: 'GET',
      url: '/api/agentes-impresion',
      headers: auth(f.usuarios.cajero.token),
    });
    expect(ver.statusCode).toBe(403);
  });

  it('el ADMIN genera el token y aparece en texto plano una sola vez', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agentes-impresion',
      headers: auth(f.usuarios.admin.token),
      payload: { sucursalId: f.sucursales.local1 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { sucursalId: number; token: string };
    expect(body.sucursalId).toBe(f.sucursales.local1);
    expect(body.token).toMatch(/^[0-9a-f]{96}$/);
  });
});

describe('Despacho sin agente configurado — sigue funcionando directo', () => {
  it('probar() manda el TCP directo cuando la sucursal no tiene agente', async () => {
    const comandera = await app.inject({
      method: 'POST',
      url: '/api/configuracion-comandera',
      headers: auth(f.usuarios.admin.token),
      payload: {
        sucursalId: f.sucursales.local2,
        destino: 'COCINA',
        nombre: 'Local 2 sin agente',
        ip: '127.0.0.1',
        puerto: puertoImpresora,
      },
    });
    const id = comandera.json().id as number;

    const prueba = await app.inject({
      method: 'POST',
      url: `/api/configuracion-comandera/${id}/probar`,
      headers: auth(f.usuarios.admin.token),
    });
    expect(prueba.json()).toEqual({ ok: true });
  });
});

describe('Sucursal con agente configurado pero desconectado', () => {
  it('falla rápido y claro, sin intentar un TCP directo condenado a colgar', async () => {
    const comandera = await app.inject({
      method: 'POST',
      url: '/api/configuracion-comandera',
      headers: auth(f.usuarios.admin.token),
      payload: {
        sucursalId: f.sucursales.local1,
        destino: 'COCINA',
        nombre: 'Local 1 cocina',
        ip: '192.168.1.201', // IP LAN real, inalcanzable desde este proceso
        puerto: 9100,
      },
    });
    const id = comandera.json().id as number;

    const antes = Date.now();
    const prueba = await app.inject({
      method: 'POST',
      url: `/api/configuracion-comandera/${id}/probar`,
      headers: auth(f.usuarios.admin.token),
    });
    const duracionMs = Date.now() - antes;

    const body = prueba.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/no está conectado/i);
    // Nada de esperar el timeout de red (4s): el chequeo de sala es en memoria.
    expect(duracionMs).toBeLessThan(1000);
  });
});

describe('Despacho vía agente conectado', () => {
  it('el agente recibe el ticket por socket.io y lo manda por TCP a la impresora', async () => {
    const generado = await app.inject({
      method: 'POST',
      url: '/api/agentes-impresion',
      headers: auth(f.usuarios.admin.token),
      payload: { sucursalId: f.sucursales.local1 },
    });
    const { token } = generado.json() as { token: string };

    const agente = await conectarAgente(token);
    agente.on('comandera:imprimir', (pedido: { ip: string; puerto: number; datos: string }, ack: (r: unknown) => void) => {
      // Simula al agente real (agente-impresion/src/index.ts): decodifica y
      // reenvía por TCP a la "impresora". Igual que enviarBufferATcp(), el ack
      // llega apenas termina de escribir — sin esperar a que el otro lado
      // cierre su lado (la impresora falsa nunca lo hace).
      const buffer = Buffer.from(pedido.datos, 'base64');
      const socket = net.createConnection(pedido.puerto, pedido.ip, () => {
        socket.end(buffer, () => ack({ ok: true }));
      });
      socket.on('error', (e) => ack({ ok: false, error: e.message }));
    });

    // Esperar a que el server confirme el join de sala antes de probar.
    // Margen para que el 'connection' del server (join de sala + marcarConexion,
    // que pega a la DB de test — Neon puede tardar más que un round-trip local)
    // termine antes de ejercitar el camino que depende de eso.
    await new Promise((r) => setTimeout(r, 500));

    const comandera = await app.inject({
      method: 'POST',
      url: '/api/configuracion-comandera',
      headers: auth(f.usuarios.admin.token),
      payload: {
        sucursalId: f.sucursales.local1,
        destino: 'MOSTRADOR',
        nombre: 'Local 1 mostrador (vía agente)',
        ip: '127.0.0.1',
        puerto: puertoImpresora,
      },
    });
    const id = comandera.json().id as number;

    const prueba = await app.inject({
      method: 'POST',
      url: `/api/configuracion-comandera/${id}/probar`,
      headers: auth(f.usuarios.admin.token),
    });
    expect(prueba.json()).toEqual({ ok: true });

    const papel = Buffer.concat(recibido).toString('latin1');
    expect(papel).toContain('PRUEBA');

    agente.disconnect();
  });

  it('el panel ve al agente conectado y con última conexión', async () => {
    const generado = await app.inject({
      method: 'POST',
      url: '/api/agentes-impresion',
      headers: auth(f.usuarios.admin.token),
      payload: { sucursalId: f.sucursales.local2 },
    });
    const { token } = generado.json() as { token: string };
    const agente = await conectarAgente(token);
    // Margen para que el 'connection' del server (join de sala + marcarConexion,
    // que pega a la DB de test — Neon puede tardar más que un round-trip local)
    // termine antes de ejercitar el camino que depende de eso.
    await new Promise((r) => setTimeout(r, 500));

    const estado = await app.inject({
      method: 'GET',
      url: `/api/agentes-impresion?sucursalId=${f.sucursales.local2}`,
      headers: auth(f.usuarios.admin.token),
    });
    const body = estado.json() as { conectadoAhora: boolean; ultimaConexion: string | null }[];
    expect(body[0].conectadoAhora).toBe(true);
    expect(body[0].ultimaConexion).toBeTruthy();

    agente.disconnect();
  });
});
