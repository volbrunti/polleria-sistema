import { apiFetch } from './client';
import type { MovimientoStock, StockRow } from './types';

export function consultarStock(sucursalId: number) {
  return apiFetch<StockRow[]>(`/api/stock?sucursalId=${sucursalId}`);
}

export function consultarMovimientos(filtros?: {
  productoId?: number;
  sucursalId?: number;
  desde?: string;
  hasta?: string;
}) {
  const qs = new URLSearchParams();
  if (filtros?.productoId) qs.set('productoId', String(filtros.productoId));
  if (filtros?.sucursalId) qs.set('sucursalId', String(filtros.sucursalId));
  if (filtros?.desde) qs.set('desde', filtros.desde);
  if (filtros?.hasta) qs.set('hasta', filtros.hasta);
  const query = qs.toString();
  return apiFetch<MovimientoStock[]>(`/api/stock/movimientos${query ? `?${query}` : ''}`);
}
