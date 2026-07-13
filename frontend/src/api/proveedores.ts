import { apiFetch } from './client';
import type { Proveedor } from './types';

export function listarProveedores() {
  return apiFetch<Proveedor[]>('/api/proveedores');
}

export function crearProveedor(datos: { nombre: string; contacto?: string }) {
  return apiFetch<Proveedor>('/api/proveedores', { method: 'POST', body: datos });
}

export function actualizarProveedor(
  id: number,
  datos: Partial<{ nombre: string; contacto: string | null; activo: boolean }>,
) {
  return apiFetch<Proveedor>(`/api/proveedores/${id}`, { method: 'PATCH', body: datos });
}
