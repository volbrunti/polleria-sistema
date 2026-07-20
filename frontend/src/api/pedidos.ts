import { apiFetch } from './client';
import type { CobroResultado, MasVendido, MedioPago, Pedido, TipoPedido } from './types';

export interface ItemPedidoInput {
  productoId: number;
  cantidad: number;
  aclaraciones?: string;
}

// Confirmar = crear: el carrito vive en el frontend; este POST descuenta
// stock, congela precios y emite el ticket a cocina (CLAUDE-MODULO-2.md §4.5).
export function confirmarPedido(datos: { sucursalId?: number; tipo: TipoPedido; items: ItemPedidoInput[] }) {
  return apiFetch<Pedido>('/api/pedidos', { method: 'POST', body: datos });
}

export function listarPendientes(sucursalId?: number) {
  const qs = sucursalId ? `?sucursalId=${sucursalId}` : '';
  return apiFetch<Pedido[]>(`/api/pedidos/pendientes${qs}`);
}

export function masVendidos(sucursalId?: number) {
  const qs = sucursalId ? `?sucursalId=${sucursalId}` : '';
  return apiFetch<MasVendido[]>(`/api/pedidos/mas-vendidos${qs}`);
}

export function modificarPedido(pedidoId: number, items: ItemPedidoInput[]) {
  return apiFetch<Pedido>(`/api/pedidos/${pedidoId}`, { method: 'PATCH', body: { items } });
}

export function cobrarPedido(pedidoId: number, pagos: { medio: MedioPago; monto: number }[]) {
  return apiFetch<CobroResultado>(`/api/pedidos/${pedidoId}/cobrar`, { method: 'POST', body: { pagos } });
}

export function marcarListo(pedidoId: number) {
  return apiFetch<Pedido>(`/api/pedidos/${pedidoId}/marcar-listo`, { method: 'POST' });
}

export function marcarNoRetirado(pedidoId: number) {
  return apiFetch<Pedido>(`/api/pedidos/${pedidoId}/no-retirado`, { method: 'POST' });
}

export function reasignarPedido(pedidoId: number) {
  return apiFetch<Pedido>(`/api/pedidos/${pedidoId}/reasignar`, { method: 'POST' });
}

export function marcarPerdido(pedidoId: number) {
  return apiFetch<Pedido>(`/api/pedidos/${pedidoId}/marcar-perdido`, { method: 'POST' });
}

export function anularPedido(pedidoId: number) {
  return apiFetch<Pedido>(`/api/pedidos/${pedidoId}/anular`, { method: 'POST' });
}
