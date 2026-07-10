import type { Rol } from '@prisma/client';

// CONTROL CIEGO en la capa de serialización (CLAUDE.md §10):
// los DTOs para rol PRODUCCION nunca incluyen unidadesEsperadas,
// desvioPct ni alertaDisparada. Whitelist explícita, no blacklist.

interface LoteConRelaciones {
  id: number;
  productoElaboradoId: number;
  productoElaborado?: { nombre: string } | null;
  fichaTecnicaVersionId: number;
  fechaHora: Date;
  usuarioOperarioId: number;
  estado: string;
  unidadesProducidasReales: unknown;
  desperdicioRealKg: unknown;
  unidadesEsperadas?: unknown;
  desvioPct?: unknown;
  alertaDisparada?: boolean;
  insumosUsados?: unknown[];
}

function base(lote: LoteConRelaciones) {
  return {
    id: lote.id,
    productoElaboradoId: lote.productoElaboradoId,
    productoElaborado: lote.productoElaborado?.nombre,
    fichaTecnicaVersionId: lote.fichaTecnicaVersionId,
    fechaHora: lote.fechaHora,
    usuarioOperarioId: lote.usuarioOperarioId,
    estado: lote.estado,
    unidadesProducidasReales: lote.unidadesProducidasReales?.toString() ?? null,
    desperdicioRealKg: lote.desperdicioRealKg?.toString() ?? null,
    insumosUsados: lote.insumosUsados,
  };
}

export function serializarLote(lote: LoteConRelaciones, rol: Rol) {
  if (rol === 'ADMINISTRADOR' || rol === 'SOCIO') {
    return {
      ...base(lote),
      unidadesEsperadas: lote.unidadesEsperadas?.toString() ?? null,
      desvioPct: lote.desvioPct?.toString() ?? null,
      alertaDisparada: lote.alertaDisparada ?? false,
    };
  }
  // PRODUCCION (y cualquier otro rol): DTO ciego
  return base(lote);
}
