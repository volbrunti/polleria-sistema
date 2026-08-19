import { apiFetch } from './client';
import type { TipoBeneficiarioDescuento, TipoDescuento } from './types';

/** El POS pide solo los vigentes; el admin puede pedir todos para editarlos. */
export function listarTiposDescuento(filtros?: { activo?: boolean }) {
  const qs = filtros?.activo !== undefined ? `?activo=${filtros.activo}` : '';
  return apiFetch<TipoDescuento[]>(`/api/tipos-descuento${qs}`);
}

export function crearTipoDescuento(datos: {
  nombre: string;
  tipo: TipoBeneficiarioDescuento;
  porcentaje: number;
}) {
  return apiFetch<TipoDescuento>('/api/tipos-descuento', { method: 'POST', body: datos });
}

export function actualizarTipoDescuento(
  id: number,
  datos: Partial<{ nombre: string; porcentaje: number; activo: boolean }>,
) {
  return apiFetch<TipoDescuento>(`/api/tipos-descuento/${id}`, { method: 'PATCH', body: datos });
}
