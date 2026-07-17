import type { Rol } from '@prisma/client';

// CONTROL CIEGO en la capa de serialización (CLAUDE-MODULO-2.md §1 y §5):
// los DTOs para CAJERO/ENCARGADO nunca incluyen valorEsperado, diferencia ni
// resultado de un arqueo — ni siquiera si el arqueo "coincidió" (saberlo ya
// revela información). Whitelist explícita, no blacklist, mismo patrón que
// produccion.serializers.ts / transferencias.serializers.ts.

interface ArqueoDb {
  id: number;
  momento: string;
  tipo: string;
  valorContado: unknown;
  valorEsperado?: unknown;
  diferencia?: unknown;
  resultado?: string;
  fechaHora: Date;
}

interface TurnoDb {
  id: number;
  sucursalId: number;
  sucursal?: { nombre: string } | null;
  usuarioCajeroId: number;
  usuarioCajero?: { username: string } | null;
  fechaApertura: Date;
  fechaCierre: Date | null;
  estado: string;
  arqueos?: ArqueoDb[];
}

function arqueoCiego(a: ArqueoDb) {
  return {
    id: a.id,
    momento: a.momento,
    tipo: a.tipo,
    // El conteo lo cargó el propio cajero: verlo no revela nada
    valorContado: a.valorContado?.toString() ?? null,
    fechaHora: a.fechaHora,
  };
}

function arqueoCompleto(a: ArqueoDb) {
  return {
    ...arqueoCiego(a),
    valorEsperado: a.valorEsperado?.toString() ?? null,
    diferencia: a.diferencia?.toString() ?? null,
    resultado: a.resultado ?? null,
  };
}

function turnoBase(t: TurnoDb) {
  return {
    id: t.id,
    sucursalId: t.sucursalId,
    sucursal: t.sucursal?.nombre,
    usuarioCajeroId: t.usuarioCajeroId,
    usuarioCajero: t.usuarioCajero?.username,
    fechaApertura: t.fechaApertura,
    fechaCierre: t.fechaCierre,
    estado: t.estado,
  };
}

export function serializarTurno(turno: TurnoDb, rol: Rol) {
  if (rol === 'ADMINISTRADOR' || rol === 'SOCIO') {
    return { ...turnoBase(turno), arqueos: turno.arqueos?.map(arqueoCompleto) };
  }
  // CAJERO / ENCARGADO (y cualquier otro): DTO ciego
  return { ...turnoBase(turno), arqueos: turno.arqueos?.map(arqueoCiego) };
}
