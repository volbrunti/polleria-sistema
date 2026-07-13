import { apiFetch } from './client';
import type { RegistroAuditoria } from './types';

export function listarAuditoria(filtros?: {
  desde?: string;
  hasta?: string;
  usuarioId?: number;
  accion?: string;
  entidad?: string;
}) {
  const qs = new URLSearchParams();
  if (filtros?.desde) qs.set('desde', filtros.desde);
  if (filtros?.hasta) qs.set('hasta', filtros.hasta);
  if (filtros?.usuarioId) qs.set('usuarioId', String(filtros.usuarioId));
  if (filtros?.accion) qs.set('accion', filtros.accion);
  if (filtros?.entidad) qs.set('entidad', filtros.entidad);
  const query = qs.toString();
  return apiFetch<RegistroAuditoria[]>(`/api/auditoria${query ? `?${query}` : ''}`);
}
