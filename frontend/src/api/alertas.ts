import { apiFetch } from './client';
import type { Alerta, TipoAlerta } from './types';

export function listarAlertas(filtros?: { vista?: boolean; tipo?: TipoAlerta }) {
  const qs = new URLSearchParams();
  if (filtros?.vista !== undefined) qs.set('vista', String(filtros.vista));
  if (filtros?.tipo) qs.set('tipo', filtros.tipo);
  const query = qs.toString();
  return apiFetch<Alerta[]>(`/api/alertas${query ? `?${query}` : ''}`);
}

export function marcarVista(id: number) {
  return apiFetch<Alerta>(`/api/alertas/${id}/vista`, { method: 'PATCH' });
}
