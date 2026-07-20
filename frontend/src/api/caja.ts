import { apiFetch } from './client';
import type { Atencion, EventoMarcadoPollo, GastoDeCaja, MedioPago, RetiroDeCaja, SocioRetiro } from './types';

// Categorías sugeridas de gasto (CLAUDE-MODULO-2.md §5.2). "OTRO" exige
// descripción — el backend lo valida.
export const CATEGORIAS_GASTO = [
  'PAPAS',
  'LEÑA/CARBON',
  'LIMPIEZA',
  'BEBIDAS',
  'VERDULERIA',
  'CONDIMENTOS',
  'OTRO',
] as const;

export const MOTIVOS_ATENCION = [
  'CLIENTE_FRECUENTE',
  'DEMORA',
  'ERROR_DEL_LOCAL',
  'CORTESIA',
  'OTRO',
] as const;

export function registrarAtencion(datos: {
  sucursalId?: number;
  productoId: number;
  cantidad: number;
  motivoCodigo: string;
  motivoDetalle?: string;
}) {
  return apiFetch<Atencion>('/api/atenciones', { method: 'POST', body: datos });
}

export function registrarGasto(datos: {
  sucursalId?: number;
  monto: number;
  medio: 'EFECTIVO' | 'MERCADO_PAGO';
  categoria: string;
  descripcion?: string;
}) {
  return apiFetch<GastoDeCaja>('/api/gastos-caja', { method: 'POST', body: datos });
}

export function registrarRetiro(datos: {
  sucursalId?: number;
  monto: number;
  medio: MedioPago;
  socio: SocioRetiro;
}) {
  return apiFetch<RetiroDeCaja>('/api/retiros-caja', { method: 'POST', body: datos });
}

export function marcarPollos(datos: { sucursalId?: number; cantidad: number }) {
  return apiFetch<EventoMarcadoPollo>('/api/marcado-pollos', { method: 'POST', body: datos });
}

export function registrarCostoCero(datos: {
  sucursalId?: number;
  productoId: number;
  cantidad: number;
  tipo: 'DESPERDICIO_QUEMADO' | 'RETORNO_A_PRODUCCION';
  motivo?: string;
}) {
  return apiFetch<{ id: number }>('/api/costo-cero', { method: 'POST', body: datos });
}
