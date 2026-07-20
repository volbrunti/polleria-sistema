import type { Prisma, TipoAlerta } from '@prisma/client';
import type { Server as SocketServer } from 'socket.io';
import { prisma, type TxClient } from '../../lib/prisma';

// Referencia al servidor Socket.io, seteada al arrancar la app.
// Las alertas se emiten SOLO a la sala de administradores (control ciego:
// el operario jamás se entera de que se disparó una alerta).
let io: SocketServer | null = null;

export function configurarSocket(servidor: SocketServer) {
  io = servidor;
}

export const SALA_ADMIN = 'administradores';

// Crea la alerta dentro de la transacción del flujo que la dispara.
// La emisión por socket es best-effort post-commit (la llama el servicio dueño de la tx).
export async function crearAlerta(
  tx: TxClient,
  params: { tipo: TipoAlerta; tipoOrigen: string; origenId: number; detalle: Record<string, unknown> },
) {
  return tx.alerta.create({
    data: {
      tipo: params.tipo,
      tipoOrigen: params.tipoOrigen,
      origenId: params.origenId,
      detalle: params.detalle as Prisma.InputJsonValue,
    },
  });
}

export function emitirAlerta(alerta: { id: number; tipo: TipoAlerta; detalle: unknown }) {
  io?.to(SALA_ADMIN).emit('alerta:nueva', alerta);
}

// Eventos del módulo 2 dirigidos a los administradores (turno:bloqueado,
// turno:desbloqueado, etc.).
export function emitirAAdmins(evento: string, payload: unknown) {
  io?.to(SALA_ADMIN).emit(evento, payload);
}

// Sala por sucursal: la escuchan los POS de CAJERO/ENCARGADO de ese local
// (server.ts los suma al conectar, releyendo la sucursal de la DB). Solo
// para eventos operativos NO ciegos: turno:desbloqueado (el cajero ya sabe
// que estaba bloqueado) y alerta:stock_minimo (el pop-up del POS es parte
// de la spec §6.6 — no revela nada financiero).
export function salaSucursal(sucursalId: number) {
  return `sucursal:${sucursalId}`;
}

export function emitirASucursal(sucursalId: number, evento: string, payload: unknown) {
  io?.to(salaSucursal(sucursalId)).emit(evento, payload);
}

export async function listar(filtros: { vista?: boolean; tipo?: TipoAlerta }) {
  return prisma.alerta.findMany({
    where: { vista: filtros.vista, tipo: filtros.tipo },
    orderBy: { fechaHora: 'desc' },
    take: 200,
  });
}

export async function marcarVista(id: number) {
  return prisma.alerta.update({ where: { id }, data: { vista: true } });
}
