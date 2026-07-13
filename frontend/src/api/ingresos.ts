import { apiFetch } from './client';
import type { IngresoMercaderia, LineaIngresoDisponible } from './types';

export interface LineaIngresoInput {
  productoId: number;
  cantidadSegunRemito: number;
  cantidadRealPesada: number;
}

export function registrarIngreso(datos: {
  proveedorId: number;
  comentarioProveedorOtro?: string;
  fotoRemitoUrl?: string;
  lineas: LineaIngresoInput[];
}) {
  return apiFetch<IngresoMercaderia>('/api/ingresos', { method: 'POST', body: datos });
}

export function subirFotoRemito(archivo: File) {
  const form = new FormData();
  form.append('file', archivo);
  return apiFetch<{ fotoRemitoUrl: string }>('/api/ingresos/foto', { method: 'POST', body: form });
}

export function listarIngresos(filtros?: { desde?: string; hasta?: string; proveedorId?: number }) {
  const qs = new URLSearchParams();
  if (filtros?.desde) qs.set('desde', filtros.desde);
  if (filtros?.hasta) qs.set('hasta', filtros.hasta);
  if (filtros?.proveedorId) qs.set('proveedorId', String(filtros.proveedorId));
  const query = qs.toString();
  return apiFetch<IngresoMercaderia[]>(`/api/ingresos${query ? `?${query}` : ''}`);
}

export function lineasDisponibles(productoId: number) {
  return apiFetch<LineaIngresoDisponible[]>(`/api/ingresos/lineas-disponibles?productoId=${productoId}`);
}
