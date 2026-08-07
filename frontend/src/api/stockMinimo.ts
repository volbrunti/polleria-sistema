import { apiFetch } from './client';
import type { AvisoStockMinimo, ConfigStockMinimo } from './types';

/** Qué está hoy por debajo del mínimo configurado en esa sucursal. */
export function bajoMinimo(sucursalId: number) {
  return apiFetch<AvisoStockMinimo[]>(`/api/config-stock-minimo/bajo-minimo?sucursalId=${sucursalId}`);
}

export function listarConfigStockMinimo(sucursalId?: number) {
  const qs = sucursalId ? `?sucursalId=${sucursalId}` : '';
  return apiFetch<ConfigStockMinimo[]>(`/api/config-stock-minimo${qs}`);
}

export function configurarStockMinimo(datos: {
  productoId: number;
  sucursalId: number;
  minimo: number;
  activa?: boolean;
}) {
  return apiFetch<ConfigStockMinimo>('/api/config-stock-minimo', { method: 'POST', body: datos });
}
