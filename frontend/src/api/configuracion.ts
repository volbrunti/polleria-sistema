import { apiFetch } from './client';
import type { ConfiguracionGeneral } from './types';

/** Clave del % de descuento a empleados (ver configuracion.service.ts). */
export const CLAVE_DESCUENTO_EMPLEADO = 'DESCUENTO_EMPLEADO_PCT';

export function listarConfiguracion() {
  return apiFetch<ConfiguracionGeneral[]>('/api/configuracion');
}

/** Solo ADMIN. */
export function actualizarConfiguracion(clave: string, valor: string) {
  return apiFetch<ConfiguracionGeneral>(`/api/configuracion/${clave}`, {
    method: 'PATCH',
    body: { valor },
  });
}
