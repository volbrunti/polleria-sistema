import crypto from 'node:crypto';
import type { Server as SocketServer } from 'socket.io';
import { prisma } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';

// Puente Railway → LAN del local (CLAUDE.md §5 Flujo 4): el backend en la nube
// no tiene ruta a las IPs privadas de las comanderas, así que un proceso chico
// corriendo en una PC del local recibe el buffer ESC/POS por Socket.io y lo
// manda por TCP crudo a la impresora. Mismo patrón de sala-por-sucursal que
// alertas.service.ts, pero para el agente, no para un usuario humano.
let io: SocketServer | null = null;

export function configurarSocket(servidor: SocketServer) {
  io = servidor;
}

export function salaAgente(sucursalId: number): string {
  return `agente-impresion:${sucursalId}`;
}

function hashearToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Admin-only: genera (o rota, si ya existía) el token de la sucursal. Se
// devuelve en texto plano UNA sola vez — de ahí en más solo se guarda el
// hash, mismo criterio que RefreshToken en auth.service.ts.
export async function generarToken(sucursalId: number, usuarioId: number): Promise<string> {
  const token = crypto.randomBytes(48).toString('hex');
  const tokenHash = hashearToken(token);

  await prisma.$transaction(async (tx) => {
    const anterior = await tx.agenteImpresion.findUnique({ where: { sucursalId } });
    const actualizado = await tx.agenteImpresion.upsert({
      where: { sucursalId },
      create: { sucursalId, tokenHash },
      update: { tokenHash },
    });
    await registrarAuditoria(tx, {
      accion: 'ROTAR_TOKEN_AGENTE_IMPRESION',
      entidad: 'AgenteImpresion',
      entidadId: actualizado.id,
      usuarioId,
      datosAnteriores: anterior ? { existiaDesde: anterior.creadoEn } : null,
      datosNuevos: { sucursalId, rotadoEn: new Date() },
    });
  });

  return token;
}

// La usa el middleware de Socket.io (server.ts) para autenticar al agente en
// el handshake, en vez del JWT que usan los usuarios humanos.
export async function verificarToken(token: string): Promise<number | null> {
  const registro = await prisma.agenteImpresion.findUnique({
    where: { tokenHash: hashearToken(token) },
    select: { sucursalId: true },
  });
  return registro?.sucursalId ?? null;
}

export async function marcarConexion(sucursalId: number): Promise<void> {
  await prisma.agenteImpresion.updateMany({ where: { sucursalId }, data: { ultimaConexion: new Date() } });
}

export async function agenteConectado(sucursalId: number): Promise<boolean> {
  if (!io) return false;
  const sockets = await io.in(salaAgente(sucursalId)).fetchSockets();
  return sockets.length > 0;
}

export async function tieneAgenteConfigurado(sucursalId: number): Promise<boolean> {
  const registro = await prisma.agenteImpresion.findUnique({ where: { sucursalId }, select: { id: true } });
  return registro != null;
}

export interface EstadoAgente {
  sucursalId: number;
  configurado: boolean;
  ultimaConexion: Date | null;
  conectadoAhora: boolean;
}

// Estado por sucursal de venta, para el panel (Catálogo → Agente de impresión).
// Sale de Sucursal (no de AgenteImpresion) para que las que todavía no tienen
// token generado igual aparezcan en la lista, con "configurado: false".
export async function listarEstado(filtro: { sucursalId?: number } = {}): Promise<EstadoAgente[]> {
  const sucursales = await prisma.sucursal.findMany({
    where: { tipo: 'VENTA', ...(filtro.sucursalId ? { id: filtro.sucursalId } : {}) },
    include: { agenteImpresion: true },
    orderBy: { id: 'asc' },
  });

  return Promise.all(
    sucursales.map(async (s) => ({
      sucursalId: s.id,
      configurado: s.agenteImpresion != null,
      ultimaConexion: s.agenteImpresion?.ultimaConexion ?? null,
      conectadoAhora: await agenteConectado(s.id),
    })),
  );
}

interface AckAgente {
  ok: boolean;
  error?: string;
}

// Le pasa el ticket al agente conectado de la sucursal y espera su ack. El
// llamador (comanderas.service.ts) ya validó que hay un agente conectado
// antes de llamar esto — igual se cubre la carrera de que se desconecte justo
// entre medio.
export async function enviarViaAgente(
  sucursalId: number,
  ip: string,
  puerto: number,
  datos: Buffer,
  timeoutMs: number,
): Promise<void> {
  if (!io) throw Errores.agenteImpresionNoConectado();

  let respuestas: AckAgente[];
  try {
    respuestas = (await io
      .timeout(timeoutMs)
      .to(salaAgente(sucursalId))
      .emitWithAck('comandera:imprimir', { ip, puerto, datos: datos.toString('base64') })) as AckAgente[];
  } catch {
    throw new Error(`El agente de impresión no respondió en ${timeoutMs} ms`);
  }

  const resultado = respuestas[0];
  if (!resultado) {
    throw new Error('El agente de impresión se desconectó justo antes de imprimir');
  }
  if (!resultado.ok) {
    throw new Error(resultado.error ?? 'El agente no pudo imprimir');
  }
}
