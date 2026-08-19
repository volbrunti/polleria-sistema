import { apiFetch } from './client';
import type {
  BeneficiarioPedido,
  CobroResultado,
  MasVendido,
  MedioPago,
  Pedido,
  SocioRetiro,
  TipoPedido,
} from './types';

export interface ItemPedidoInput {
  productoId: number;
  cantidad: number;
  aclaraciones?: string;
}

// Confirmar = crear: el carrito vive en el frontend; este POST descuenta
// stock, congela precios y emite el ticket a cocina (CLAUDE.md §5 Flujo 4).
// tokenIdempotencia: UUID por pedido armado — el backend deduplica doble
// click y retries de red.
export function confirmarPedido(datos: {
  sucursalId?: number;
  tipo: TipoPedido;
  items: ItemPedidoInput[];
  tokenIdempotencia?: string;
  /** Retiro de socio (costo cero) o venta a empleado (con descuento). */
  beneficiario?: BeneficiarioPedido;
  socioBeneficiario?: SocioRetiro;
  /** Para identificar el pedido en la comandera y en Pedidos Activos. */
  nombreCliente?: string;
  /** "HH:MM" — hora puntual prometida al cliente. */
  horaEntregaSolicitada?: string;
}) {
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

export function cobrarPedido(
  pedidoId: number,
  /** `monto` cubre el pedido; `recargoPct` es el extra de tarjeta (DEBITO/CREDITO). */
  pagos: { medio: MedioPago; monto: number; recargoPct?: number }[],
  /** Descuento de empleado/encargado elegido al cobrar, uno solo por cobro. */
  descuentoPct?: number,
) {
  return apiFetch<CobroResultado>(`/api/pedidos/${pedidoId}/cobrar`, {
    method: 'POST',
    body: { pagos, ...(descuentoPct ? { descuentoPct } : {}) },
  });
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
