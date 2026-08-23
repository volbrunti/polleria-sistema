import { apiFetch } from './client';

export interface EstadoAgenteImpresion {
  sucursalId: number;
  configurado: boolean;
  ultimaConexion: string | null;
  conectadoAhora: boolean;
}

export function listarEstadoAgentes(sucursalId?: number) {
  const qs = sucursalId ? `?sucursalId=${sucursalId}` : '';
  return apiFetch<EstadoAgenteImpresion[]>(`/api/agentes-impresion${qs}`);
}

// Devuelve el token en texto plano — es la única vez que se puede ver, no
// queda recuperable después (se guarda hasheado).
export function generarTokenAgente(sucursalId: number) {
  return apiFetch<{ sucursalId: number; token: string }>('/api/agentes-impresion', {
    method: 'POST',
    body: { sucursalId },
  });
}
