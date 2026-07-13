import { apiFetch } from './client';
import type { LoteDeProduccion } from './types';

export interface InsumoInput {
  productoInsumoId: number;
  lineaIngresoOrigenId: number;
  cantidadUsada: number;
}

export function abrirLote(datos: { productoElaboradoId: number; insumos: InsumoInput[] }) {
  return apiFetch<LoteDeProduccion>('/api/produccion/lotes', { method: 'POST', body: datos });
}

export function cerrarLote(
  loteId: number,
  datos: { unidadesProducidasReales: number; desperdicioRealKg: number },
) {
  return apiFetch<LoteDeProduccion>(`/api/produccion/lotes/${loteId}/cerrar`, {
    method: 'POST',
    body: datos,
  });
}

export function listarLotes(filtros?: { estado?: 'ABIERTO' | 'CERRADO'; desde?: string; hasta?: string }) {
  const qs = new URLSearchParams();
  if (filtros?.estado) qs.set('estado', filtros.estado);
  if (filtros?.desde) qs.set('desde', filtros.desde);
  if (filtros?.hasta) qs.set('hasta', filtros.hasta);
  const query = qs.toString();
  return apiFetch<LoteDeProduccion[]>(`/api/produccion/lotes${query ? `?${query}` : ''}`);
}

export function obtenerLote(id: number) {
  return apiFetch<LoteDeProduccion>(`/api/produccion/lotes/${id}`);
}
