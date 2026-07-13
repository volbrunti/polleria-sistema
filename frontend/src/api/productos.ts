import { apiFetch } from './client';
import type { Precio, Producto, TipoProducto } from './types';

export function listarProductos(filtros?: { tipo?: TipoProducto; activo?: boolean }) {
  const qs = new URLSearchParams();
  if (filtros?.tipo) qs.set('tipo', filtros.tipo);
  if (filtros?.activo !== undefined) qs.set('activo', String(filtros.activo));
  const query = qs.toString();
  return apiFetch<Producto[]>(`/api/productos${query ? `?${query}` : ''}`);
}

export function crearProducto(datos: {
  nombre: string;
  categoria: string;
  tipo: TipoProducto;
  unidadDeMedida: 'KG' | 'UNIDAD';
}) {
  return apiFetch<Producto>('/api/productos', { method: 'POST', body: datos });
}

export function actualizarProducto(
  id: number,
  datos: Partial<{ nombre: string; categoria: string; activo: boolean }>,
) {
  return apiFetch<Producto>(`/api/productos/${id}`, { method: 'PATCH', body: datos });
}

export function cambiarPrecio(productoId: number, monto: number) {
  return apiFetch<Precio>(`/api/productos/${productoId}/precios`, { method: 'POST', body: { monto } });
}

export function historialPrecios(productoId: number) {
  return apiFetch<Precio[]>(`/api/productos/${productoId}/precios`);
}
