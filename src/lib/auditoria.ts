import type { TxClient } from './prisma';

// Helper de auditoría: se llama SIEMPRE dentro de la misma transacción
// que la operación auditada (CLAUDE.md §10). Inmutable: la capa de
// servicio jamás expone UPDATE/DELETE sobre registros_auditoria.
export async function registrarAuditoria(
  tx: TxClient,
  params: {
    accion: string;
    entidad: string;
    entidadId: number;
    usuarioId: number;
    datosAnteriores?: unknown;
    datosNuevos?: unknown;
  },
): Promise<void> {
  await tx.registroAuditoria.create({
    data: {
      accion: params.accion,
      entidad: params.entidad,
      entidadId: params.entidadId,
      usuarioId: params.usuarioId,
      datosAnteriores: params.datosAnteriores as object | undefined,
      datosNuevos: params.datosNuevos as object | undefined,
    },
  });
}
