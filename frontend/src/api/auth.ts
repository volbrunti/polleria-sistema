import { apiFetch } from './client';
import type { Usuario } from './types';

export function login(username: string, password: string) {
  return apiFetch<{ accessToken: string; usuario: Usuario }>('/api/auth/login', {
    method: 'POST',
    body: { username, password },
    sinReintentoAuth: true,
  });
}

export function logout() {
  return apiFetch<{ ok: true }>('/api/auth/logout', { method: 'POST', sinReintentoAuth: true });
}
