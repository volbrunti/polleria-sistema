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
