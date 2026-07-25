import { apiFetch } from './client';

export interface ResumenDashboard {
  totalVentas: string;
  cantidadPedidos: number;
  ticketPromedio: string;
  ventasPorMedio: { medio: string; total: string }[];
  totalGastos: string;
  totalRetiros: string;
  mermas: { cantidadEventos: number; totalUnidades: string };
  alertasPendientes: number;
  lotesConDesvio: number;
  cantidadAtenciones: number;
}

export interface FiltrosFecha {
  desde?: string;
  hasta?: string;
  sucursalId?: number;
}

function buildQuery(filtros?: FiltrosFecha): string {
  if (!filtros) return '';
  const qs = new URLSearchParams();
  if (filtros.desde) qs.set('desde', filtros.desde);
  if (filtros.hasta) qs.set('hasta', filtros.hasta);
  if (filtros.sucursalId) qs.set('sucursalId', String(filtros.sucursalId));
  const q = qs.toString();
  return q ? `?${q}` : '';
}

export function obtenerDashboard(filtros?: FiltrosFecha) {
  return apiFetch<ResumenDashboard>(`/api/dashboard${buildQuery(filtros)}`);
}
