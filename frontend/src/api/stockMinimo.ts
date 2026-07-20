import { apiFetch } from './client';
import type { ConfigStockMinimo } from './types';

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
