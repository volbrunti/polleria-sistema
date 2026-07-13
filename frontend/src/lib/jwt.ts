import type { Rol } from '../api/types';

interface PayloadAccessToken {
  sub: string;
  username: string;
  rol: Rol;
  sucursalId: number | null;
}

// Lectura del payload público del JWT — NUNCA para autorizar nada (eso lo
// hace el backend en cada request), solo para reconstruir el usuario en
// memoria tras un refresh de página, donde no hay un endpoint "whoami".
export function decodificarAccessToken(token: string): PayloadAccessToken | null {
  try {
    const [, payload] = token.split('.');
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as PayloadAccessToken;
  } catch {
    return null;
  }
}
