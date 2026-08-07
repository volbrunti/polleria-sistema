import { apiFetch } from './client';
import type { RecargoTarjeta } from './types';

/** El POS pide solo los vigentes; el admin puede pedir todos para editarlos. */
export function listarRecargos(filtros?: { activo?: boolean }) {
  const qs = filtros?.activo !== undefined ? `?activo=${filtros.activo}` : '';
  return apiFetch<RecargoTarjeta[]>(`/api/recargos-tarjeta${qs}`);
}

export function crearRecargo(datos: {
  nombre: string;
  medio: 'DEBITO' | 'CREDITO';
  porcentaje: number;
}) {
  return apiFetch<RecargoTarjeta>('/api/recargos-tarjeta', { method: 'POST', body: datos });
}

export function actualizarRecargo(
  id: number,
  datos: Partial<{ nombre: string; porcentaje: number; activo: boolean }>,
) {
  return apiFetch<RecargoTarjeta>(`/api/recargos-tarjeta/${id}`, { method: 'PATCH', body: datos });
}
