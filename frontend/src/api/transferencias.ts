import { apiFetch } from './client';
import type { RecepcionResultado, Transferencia } from './types';

export function generarTransferencia(datos: {
  sucursalDestinoId: number;
  lineas: { productoId: number; cantidadEnviada: number }[];
}) {
  return apiFetch<Transferencia>('/api/transferencias', { method: 'POST', body: datos });
}

export function intentarRecepcion(
  id: number,
  lineas: { productoId: number; cantidadRecibida: number }[],
) {
  return apiFetch<RecepcionResultado>(`/api/transferencias/${id}/recepcion`, {
    method: 'POST',
    body: { lineas },
  });
}

export function confirmarConDiscrepancia(
  id: number,
  lineas: { productoId: number; cantidadRecibida: number }[],
) {
  return apiFetch<Transferencia>(`/api/transferencias/${id}/confirmar-con-discrepancia`, {
    method: 'POST',
    body: { lineas },
  });
}

export function listarTransferencias(filtros?: {
  estado?: 'PENDIENTE_RECEPCION' | 'CONFIRMADA' | 'CONFIRMADA_CON_DISCREPANCIA';
  sucursalDestinoId?: number;
}) {
  const qs = new URLSearchParams();
  if (filtros?.estado) qs.set('estado', filtros.estado);
  if (filtros?.sucursalDestinoId) qs.set('sucursalDestinoId', String(filtros.sucursalDestinoId));
  const query = qs.toString();
  return apiFetch<Transferencia[]>(`/api/transferencias${query ? `?${query}` : ''}`);
}

export function obtenerTransferencia(id: number) {
  return apiFetch<Transferencia>(`/api/transferencias/${id}`);
}
