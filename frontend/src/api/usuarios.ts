import { apiFetch } from './client';
import type { Rol, Usuario } from './types';

export function listarUsuarios() {
  return apiFetch<Usuario[]>('/api/usuarios');
}

export function crearUsuario(datos: {
  nombre: string;
  username: string;
  password: string;
  rol: Rol;
  sucursalId?: number | null;
}) {
  return apiFetch<Usuario>('/api/usuarios', { method: 'POST', body: datos });
}

export function actualizarUsuario(
  id: number,
  datos: Partial<{ nombre: string; rol: Rol; activo: boolean; password: string; sucursalId: number | null }>,
) {
  return apiFetch<Usuario>(`/api/usuarios/${id}`, { method: 'PATCH', body: datos });
}

// Solo usuarios sin actividad registrada (el backend responde 409 si tienen
// historial — en ese caso corresponde desactivarlos).
export function eliminarUsuario(id: number) {
  return apiFetch<Usuario>(`/api/usuarios/${id}`, { method: 'DELETE' });
}
