import { apiFetch } from './client';
import type { Atencion, EventoMarcadoPollo, GastoDeCaja, MedioPago, RetiroDeCaja, SocioRetiro } from './types';

// Categorías sugeridas de gasto (CLAUDE.md §5 Flujo 5). "OTRO" exige
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
  /** Ver lib/idempotencia.ts — evita duplicar si se reintenta la request. */
  tokenIdempotencia?: string;
}) {
  return apiFetch<Atencion>('/api/atenciones', { method: 'POST', body: datos });
}

export function registrarGasto(datos: {
  sucursalId?: number;
  monto: number;
  medio: 'EFECTIVO' | 'MERCADO_PAGO';
  categoria: string;
  descripcion?: string;
  /** Ver lib/idempotencia.ts */
  tokenIdempotencia?: string;
}) {
  return apiFetch<GastoDeCaja>('/api/gastos-caja', { method: 'POST', body: datos });
}

export function registrarRetiro(datos: {
  sucursalId?: number;
  monto: number;
  medio: MedioPago;
  socio: SocioRetiro;
  /** Ver lib/idempotencia.ts — acá es plata: un retiro duplicado descuadra la caja. */
  tokenIdempotencia?: string;
}) {
  return apiFetch<RetiroDeCaja>('/api/retiros-caja', { method: 'POST', body: datos });
}

export function marcarPollos(datos: {
  sucursalId?: number;
  cantidad: number;
  /** Ver lib/idempotencia.ts — un marcado duplicado descuadra el arqueo ciego de pollos. */
  tokenIdempotencia?: string;
}) {
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
