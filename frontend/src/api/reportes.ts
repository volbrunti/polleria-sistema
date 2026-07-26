import { apiFetch } from './client';

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

export interface VentaProducto {
  productoId: number;
  producto: string;
  categoria: string;
  tipo: string;
  unidadesVendidas: string;
  montoTotal: string;
  cantidadPedidos: number;
}

export interface VentasPorMedio {
  porMedio: { medio: string; total: string; cantidadOperaciones: number; porcentaje: string }[];
  total: string;
}

export interface CierreCaja {
  turnoId: number;
  sucursal: string;
  cajero: string;
  fechaApertura: string;
  fechaCierre: string | null;
  efectivo: {
    valorContado: string;
    valorEsperado: string;
    diferencia: string;
    resultado: 'COINCIDE' | 'FALTANTE' | 'SOBRANTE';
  } | null;
  pollos: {
    valorContado: string;
    valorEsperado: string;
    diferencia: string;
    resultado: 'COINCIDE' | 'FALTANTE' | 'SOBRANTE';
  } | null;
}

export interface RetirosPorSocio {
  porSocio: { socio: string; medio: string; total: string; cantidadRetiros: number }[];
  total: string;
}

export interface MermaProducto {
  productoId: number;
  producto: string;
  categoria: string;
  quemados: string;
  desperdicioProduccion: string;
  total: string;
}

export interface LoteProduccion {
  loteId: number;
  producto: string;
  operario: string;
  fechaHora: string;
  versionFicha: number;
  unidadesProducidas: string | null;
  desperdicioRealKg: string | null;
  unidadesEsperadas: string | null;
  desvioPct: string | null;
  alertaDisparada: boolean;
}

export interface GastosPorCategoria {
  porCategoria: { categoria: string; total: string; cantidad: number }[];
  total: string;
}

export interface AtencionReporte {
  id: number;
  producto: string;
  cantidad: string;
  motivoCodigo: string;
  motivoDetalle: string | null;
  usuario: string;
  fechaHora: string;
}

export function ventasPorProducto(f?: FiltrosFecha) {
  return apiFetch<VentaProducto[]>(`/api/reportes/ventas-por-producto${buildQuery(f)}`);
}

export function ventasPorMedio(f?: FiltrosFecha) {
  return apiFetch<VentasPorMedio>(`/api/reportes/ventas-por-medio${buildQuery(f)}`);
}

export function cierresDeCaja(f?: FiltrosFecha) {
  return apiFetch<CierreCaja[]>(`/api/reportes/cierres-caja${buildQuery(f)}`);
}

export function retirosPorSocio(f?: FiltrosFecha) {
  return apiFetch<RetirosPorSocio>(`/api/reportes/retiros-por-socio${buildQuery(f)}`);
}

export function mermasPorProducto(f?: FiltrosFecha) {
  return apiFetch<MermaProducto[]>(`/api/reportes/mermas${buildQuery(f)}`);
}

export function rendimientoProduccion(f?: FiltrosFecha) {
  return apiFetch<LoteProduccion[]>(`/api/reportes/produccion${buildQuery(f)}`);
}

export function gastosPorCategoria(f?: FiltrosFecha) {
  return apiFetch<GastosPorCategoria>(`/api/reportes/gastos${buildQuery(f)}`);
}

export function atencionesReporte(f?: FiltrosFecha) {
  return apiFetch<AtencionReporte[]>(`/api/reportes/atenciones${buildQuery(f)}`);
}

export interface OrigenProducto {
  transferencia: {
    id: number;
    sucursalOrigen: string;
    fechaHoraEnvio: string;
    fechaHoraRecepcion: string | null;
    cantidadEnviada: string;
    cantidadRecibida: string | null;
    estado: string;
    usuarioEmisor: string;
    usuarioReceptor: string | null;
  } | null;
  lote: {
    id: number;
    fechaHora: string;
    operario: string;
    versionFicha: number;
    unidadesProducidas: string | null;
    desperdicioRealKg: string | null;
    unidadesEsperadas: string | null;
    desvioPct: string | null;
    aproximado: boolean;
  } | null;
  insumos: {
    producto: string;
    cantidadUsada: string;
    lineaIngresoId: number;
    proveedor: string;
    fechaIngreso: string;
    cantidadSegunRemito: string;
    cantidadRealPesada: string;
  }[];
  nota?: string;
}

export interface ItemTrazabilidad {
  itemId: number;
  producto: string;
  tipo: string;
  cantidad: string;
  montoTotal: string;
  esVentaCostoCero: boolean;
  tipoCostoCero: string | null;
  origen?: OrigenProducto;
  componentes?: { productoId: number; producto: string; origen: OrigenProducto }[];
}

export interface TrazabilidadPedido {
  pedidoId: number;
  fechaCreacion: string;
  sucursal: string;
  cajero: string;
  items: ItemTrazabilidad[];
}

export function trazabilidadPedido(pedidoId: number) {
  return apiFetch<TrazabilidadPedido>(`/api/reportes/trazabilidad/pedido/${pedidoId}`);
}
