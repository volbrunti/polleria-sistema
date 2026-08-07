import { apiFetch } from './client';

export type DestinoComandera = 'COCINA' | 'MOSTRADOR';

export interface Comandera {
  id: number;
  sucursalId: number;
  sucursal?: { nombre: string };
  destino: DestinoComandera;
  nombre: string;
  ip: string;
  puerto: number;
  activa: boolean;
}

export interface ResultadoPrueba {
  ok: boolean;
  error?: string;
}

export interface ImpresionDeTicket {
  id: number;
  impreso: boolean;
  errorImpresion: string | null;
  fechaHoraIntento: string;
  configuracionComandera: { nombre: string; destino: DestinoComandera; ip: string };
}

export interface TicketDePedido {
  id: number;
  tipo: 'NUEVO' | 'ACTUALIZACION' | 'ANULACION';
  fechaHora: string;
  impresiones: ImpresionDeTicket[];
}

export function listarComanderas(sucursalId?: number) {
  const qs = sucursalId ? `?sucursalId=${sucursalId}` : '';
  return apiFetch<Comandera[]>(`/api/configuracion-comandera${qs}`);
}

export function crearComandera(datos: {
  sucursalId: number;
  destino: DestinoComandera;
  nombre: string;
  ip: string;
  puerto?: number;
}) {
  return apiFetch<Comandera>('/api/configuracion-comandera', { method: 'POST', body: datos });
}

export function actualizarComandera(
  id: number,
  cambios: { nombre?: string; ip?: string; puerto?: number; activa?: boolean },
) {
  return apiFetch<Comandera>(`/api/configuracion-comandera/${id}`, { method: 'PATCH', body: cambios });
}

export function eliminarComandera(id: number) {
  return apiFetch<Comandera>(`/api/configuracion-comandera/${id}`, { method: 'DELETE' });
}

// Manda un ticket de prueba a la impresora. Es la única forma de validar que
// la IP quedó bien cargada sin tener que simular un pedido real en el local.
export function probarComandera(id: number) {
  return apiFetch<ResultadoPrueba>(`/api/configuracion-comandera/${id}/probar`, { method: 'POST' });
}

export function ticketsDePedido(pedidoId: number) {
  return apiFetch<TicketDePedido[]>(`/api/configuracion-comandera/tickets/${pedidoId}`);
}
