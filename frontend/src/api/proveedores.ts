import { apiFetch } from './client';
import type { Producto, Proveedor } from './types';

export function listarProveedores() {
  return apiFetch<Proveedor[]>('/api/proveedores');
}

// Productos habituales de un proveedor (sin cantidades) — configuración fija
// que carga el admin una vez, usada como acceso rápido al cargar un ingreso.
export function productosHabituales(proveedorId: number) {
  return apiFetch<Producto[]>(`/api/proveedores/${proveedorId}/productos-habituales`);
}

export function guardarProductosHabituales(proveedorId: number, productoIds: number[]) {
  return apiFetch<Producto[]>(`/api/proveedores/${proveedorId}/productos-habituales`, {
    method: 'PUT',
    body: { productoIds },
  });
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
