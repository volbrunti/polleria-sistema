import { apiFetch } from './client';
import type { AperturaResultado, CierreResultado, ClaveEmergencia, ResumenTurno, Turno } from './types';

// El arqueo es CIEGO: el frontend solo manda lo contado; la comparación vive
// en el backend y la respuesta nunca trae esperado/diferencia para el cajero.

export function abrirTurno(datos: {
  sucursalId?: number;
  conteoEfectivo: number;
  conteoPollosMarcados: number;
}) {
  return apiFetch<AperturaResultado>('/api/turnos/abrir', { method: 'POST', body: datos });
}

export function cerrarTurno(datos: {
  sucursalId?: number;
  conteoEfectivo: number;
  conteoPollosMarcados: number;
}) {
  return apiFetch<CierreResultado>('/api/turnos/cerrar', { method: 'POST', body: datos });
}

export function turnoActivo(sucursalId?: number) {
  const qs = sucursalId ? `?sucursalId=${sucursalId}` : '';
  return apiFetch<{ turno: Turno | null }>(`/api/turnos/activo${qs}`);
}

export function desbloquearTurno(turnoId: number) {
  return apiFetch<Turno>(`/api/turnos/${turnoId}/desbloquear`, { method: 'POST' });
}

export function listarTurnos(filtros?: { sucursalId?: number; estado?: Turno['estado'] }) {
  const qs = new URLSearchParams();
  if (filtros?.sucursalId) qs.set('sucursalId', String(filtros.sucursalId));
  if (filtros?.estado) qs.set('estado', filtros.estado);
  const query = qs.toString();
  return apiFetch<Turno[]>(`/api/turnos${query ? `?${query}` : ''}`);
}

export function resumenDeTurno(turnoId: number) {
  return apiFetch<ResumenTurno>(`/api/turnos/${turnoId}/resumen`);
}

// La clave se muestra UNA sola vez; generar una nueva invalida la anterior.
export function generarClaveEmergencia(turnoId?: number) {
  return apiFetch<ClaveEmergencia>('/api/claves-emergencia', {
    method: 'POST',
    body: turnoId ? { turnoId } : {},
  });
}

export function usarClaveEmergencia(datos: { codigo: string; turnoId: number }) {
  return apiFetch<{ turno: Turno; desbloqueado: boolean }>('/api/claves-emergencia/usar', {
    method: 'POST',
    body: datos,
  });
}
