// Tipos mínimos a mano, basados en lo que realmente devuelven los
// serializers/servicios del backend (no se comparten tipos de Prisma).

export type Rol = 'ADMINISTRADOR' | 'SOCIO' | 'ENCARGADO' | 'CAJERO' | 'PRODUCCION';

export type TipoProducto = 'MATERIA_PRIMA' | 'ELABORADO' | 'REVENTA' | 'COMBO';
export type UnidadDeMedida = 'KG' | 'UNIDAD';
export type TipoSucursal = 'PRODUCCION' | 'VENTA';

export interface Usuario {
  id: number;
  nombre: string;
  username: string;
  rol: Rol;
  activo?: boolean;
  // Sucursal fija del usuario (CAJERO/ENCARGADO) — null si no está asignada.
  sucursalId?: number | null;
}

export interface ErrorApi {
  codigo: string;
  mensaje: string;
  detalles?: { campo: string; error: string }[];
}

export interface ComponenteCombo {
  id: number;
  productoComponenteId: number;
  productoComponente?: { nombre: string; unidadDeMedida: UnidadDeMedida };
  cantidad: string;
}

export interface Producto {
  id: number;
  nombre: string;
  categoria: string;
  tipo: TipoProducto;
  unidadDeMedida: UnidadDeMedida;
  activo: boolean;
  // Presente (posiblemente vacío) solo si tipo === 'COMBO'
  componentesDelCombo?: ComponenteCombo[];
}

export interface Precio {
  id: number;
  productoId: number;
  monto: string;
  fechaDesde: string;
  usuarioId: number;
}

export interface Proveedor {
  id: number;
  nombre: string;
  contacto: string | null;
  activo: boolean;
  esOtro: boolean;
}

export interface Sucursal {
  id: number;
  nombre: string;
  tipo: TipoSucursal;
  direccion: string | null;
  activa: boolean;
}

export interface StockRow {
  productoId: number;
  nombre: string;
  tipo?: TipoProducto;
  unidadDeMedida?: UnidadDeMedida;
  cantidad: string;
}

export interface MovimientoStock {
  id: number;
  productoId: number;
  producto?: { nombre: string; unidadDeMedida: UnidadDeMedida };
  sucursalId: number;
  tipo: string;
  cantidad: string;
  fechaHora: string;
  usuarioId: number;
  usuario?: { username: string };
}

export interface LineaIngresoDisponible {
  id: number;
  productoId: number;
  producto?: { nombre: string; unidadDeMedida: UnidadDeMedida };
  cantidadSegunRemito: string;
  cantidadRealPesada: string;
  cantidadRestanteDisponible: string;
  ingresoMercaderia?: { fechaHora: string; proveedor: { nombre: string } };
}

export interface LineaIngreso {
  id: number;
  productoId: number;
  producto?: { nombre: string; unidadDeMedida: UnidadDeMedida };
  cantidadSegunRemito: string;
  cantidadRealPesada: string;
  cantidadRestanteDisponible: string;
}

export interface IngresoMercaderia {
  id: number;
  proveedorId: number;
  proveedor?: { nombre: string; esOtro: boolean };
  comentarioProveedorOtro: string | null;
  sucursalId: number;
  fechaHora: string;
  usuarioId: number;
  usuario?: { username: string };
  fotoRemitoUrl: string | null;
  lineas: LineaIngreso[];
}

export interface InsumoUsado {
  id: number;
  productoInsumoId: number;
  productoInsumo?: { nombre: string; unidadDeMedida: UnidadDeMedida };
  lineaIngresoOrigenId: number;
  lineaIngresoOrigen?: { id: number; ingresoMercaderiaId: number };
  cantidadUsada: string;
}

// DTO de lote: ciego para PRODUCCION (sin unidadesEsperadas/desvioPct/alertaDisparada)
export interface LoteDeProduccion {
  id: number;
  productoElaboradoId: number;
  productoElaborado?: string;
  fichaTecnicaVersionId: number;
  fechaHora: string;
  usuarioOperarioId: number;
  estado: 'ABIERTO' | 'CERRADO';
  unidadesProducidasReales: string | null;
  desperdicioRealKg: string | null;
  insumosUsados?: InsumoUsado[];
  // presentes solo para ADMINISTRADOR/SOCIO
  unidadesEsperadas?: string | null;
  desvioPct?: string | null;
  alertaDisparada?: boolean;
}

export interface LineaDeTransferencia {
  id: number;
  productoId: number;
  producto?: string;
  unidadDeMedida?: UnidadDeMedida;
  cantidadRecibida: string | null;
  // presentes solo para ADMINISTRADOR/SOCIO/emisor
  cantidadEnviada?: string;
  diferencia?: string | null;
}

export interface Transferencia {
  id: number;
  sucursalOrigenId: number;
  sucursalOrigen?: string;
  sucursalDestinoId: number;
  sucursalDestino?: string;
  fechaHoraEnvio: string;
  usuarioEmisor?: string;
  usuarioReceptor: string | null;
  fechaHoraRecepcion: string | null;
  estado: 'PENDIENTE_RECEPCION' | 'CONFIRMADA' | 'CONFIRMADA_CON_DISCREPANCIA';
  lineas: LineaDeTransferencia[];
}

export interface RecepcionResultado {
  coincide: boolean;
  mensaje?: string;
  transferencia?: Transferencia;
}

export interface IngredienteDeReceta {
  id: number;
  productoInsumoId: number;
  productoInsumo?: { nombre: string; unidadDeMedida: UnidadDeMedida };
  cantidadPorUnidadProducida: string;
  esPrincipal: boolean;
}

export interface FichaTecnicaVersion {
  id: number;
  fichaTecnicaId: number;
  numeroVersion: number;
  fechaDesde: string;
  activa: boolean;
  rendimientoEsperado: string;
  desperdicioEsperadoPct: string;
  umbralDesvioAlertaPct: string;
  ingredientes: IngredienteDeReceta[];
}

export interface FichaTecnica {
  id: number;
  productoElaboradoId: number;
  productoElaborado?: { nombre: string };
  versiones: FichaTecnicaVersion[];
}

export type TipoAlerta =
  | 'DESVIO_PRODUCCION'
  | 'DISCREPANCIA_TRANSFERENCIA'
  | 'DISCREPANCIA_CAJA'
  | 'BLOQUEO_TURNO'
  | 'STOCK_MINIMO';

export interface Alerta {
  id: number;
  tipo: TipoAlerta;
  tipoOrigen: string;
  origenId: number;
  fechaHora: string;
  vista: boolean;
  detalle: Record<string, unknown>;
}

export interface RegistroAuditoria {
  id: number;
  accion: string;
  entidad: string;
  entidadId: number;
  usuarioId: number;
  usuario?: { username: string; nombre: string };
  fechaHora: string;
  datosAnteriores: unknown;
  datosNuevos: unknown;
}
