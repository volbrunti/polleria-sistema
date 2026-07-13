import { apiFetch } from './client';
import type { Sucursal } from './types';

export function listarSucursales() {
  return apiFetch<Sucursal[]>('/api/sucursales');
}

export function crearSucursal(datos: { nombre: string; tipo: 'PRODUCCION' | 'VENTA'; direccion?: string }) {
  return apiFetch<Sucursal>('/api/sucursales', { method: 'POST', body: datos });
}

export function actualizarSucursal(
  id: number,
  datos: Partial<{ nombre: string; direccion: string | null; activa: boolean }>,
) {
  return apiFetch<Sucursal>(`/api/sucursales/${id}`, { method: 'PATCH', body: datos });
}
