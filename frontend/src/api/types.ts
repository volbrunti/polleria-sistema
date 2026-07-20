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
  // A qué cantidad pedida corresponde (default 1). Para COMBO, tabla de
  // precio por volumen no lineal (ver CLAUDE.md §9).
  cantidad: number;
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

// ── Módulo 2: turnos, POS, caja ──

export type EstadoTurno = 'ABIERTO' | 'BLOQUEADO' | 'CERRADO';
export type MomentoArqueo = 'APERTURA' | 'CIERRE';
export type TipoArqueo = 'EFECTIVO' | 'POLLOS_MARCADOS';
export type MedioPago = 'EFECTIVO' | 'DEBITO' | 'CREDITO' | 'MERCADO_PAGO' | 'TRANSFERENCIA';
export type SocioRetiro = 'ARIEL' | 'ELIANA' | 'EMA';
export type TipoPedido = 'PRESENCIAL' | 'A_RETIRAR';
export type EstadoPedido =
  | 'EN_PREPARACION'
  | 'LISTO'
  | 'ENTREGADO'
  | 'LISTO_NO_RETIRADO'
  | 'REASIGNADO'
  | 'PERDIDO'
  | 'ANULADO';

// DTO ciego para CAJERO/ENCARGADO: solo valorContado. Los campos de esperado/
// diferencia/resultado llegan únicamente a ADMINISTRADOR/SOCIO.
export interface Arqueo {
  id: number;
  momento: MomentoArqueo;
  tipo: TipoArqueo;
  valorContado: string | null;
  fechaHora: string;
  // presentes solo para ADMINISTRADOR/SOCIO
  valorEsperado?: string | null;
  diferencia?: string | null;
  resultado?: 'COINCIDE' | 'FALTANTE' | 'SOBRANTE' | null;
}

export interface Turno {
  id: number;
  sucursalId: number;
  sucursal?: string;
  usuarioCajeroId: number;
  usuarioCajero?: string;
  fechaApertura: string;
  fechaCierre: string | null;
  estado: EstadoTurno;
  arqueos?: Arqueo[];
}

export interface AperturaResultado {
  turno: Turno;
  bloqueado: boolean;
  mensaje?: string;
}

export interface CierreResultado {
  turno: Turno;
  // Resumen por unidades SIN plata — lo único financiero que ve el cajero es nada
  ventasPorUnidad: { productoId: number; producto: string; unidades: string }[];
  pollosMarcadosContados: number;
}

export interface ItemDePedido {
  id: number;
  productoId: number;
  producto?: { nombre: string; tipo: TipoProducto };
  cantidad: string;
  precioUnitario: string;
  montoTotal: string;
  aclaraciones: string | null;
  esVentaCostoCero?: boolean;
  tipoCostoCero?: 'DESPERDICIO_QUEMADO' | 'RETORNO_A_PRODUCCION' | null;
}

export interface Pago {
  id: number;
  medio: MedioPago;
  monto: string;
  fechaHora: string;
}

export interface AvisoStockMinimo {
  productoId: number;
  producto: string;
  stockRestante: string;
  minimo: string;
}

export interface Pedido {
  id: number;
  turnoId: number;
  sucursalId: number;
  sucursal?: { nombre: string };
  tipo: TipoPedido;
  estado: EstadoPedido;
  usuarioCajero?: { username: string };
  pedidoOrigenId: number | null;
  items: ItemDePedido[];
  pagos: Pago[];
  fechaCreacion: string;
  fechaCierre: string | null;
  // adjunto solo en la respuesta de confirmar/modificar
  avisosStockMinimo?: AvisoStockMinimo[];
}

export interface CobroResultado {
  pedido: Pedido;
  vuelto: string;
}

export interface MasVendido {
  productoId: number;
  unidades: string;
}

export interface ClaveEmergencia {
  id: number;
  codigo: string; // visible UNA sola vez, al generarla
  expiraEn: string;
  turnoId: number | null;
}

export interface GastoDeCaja {
  id: number;
  monto: string;
  medio: MedioPago;
  categoria: string;
  descripcion: string | null;
  fechaHora: string;
  usuario?: { username: string };
}

export interface RetiroDeCaja {
  id: number;
  monto: string;
  medio: MedioPago;
  socio: SocioRetiro;
  fechaHora: string;
  usuarioCajero?: { username: string };
}

export interface Atencion {
  id: number;
  productoId: number;
  producto?: { nombre: string };
  cantidad: string;
  motivoCodigo: string;
  motivoDetalle: string | null;
  fechaHora: string;
  usuario?: { username: string };
}

export interface EventoMarcadoPollo {
  id: number;
  cantidad: number;
  fechaHora: string;
}

export interface ResumenTurno {
  turno: Turno & {
    bloqueo?: {
      id: number;
      estado: 'BLOQUEADO' | 'DESBLOQUEADO';
      tipoDesbloqueo: 'REMOTO' | 'CLAVE_EMERGENCIA' | null;
      usuarioCajeroAnteriorId: number | null;
      usuarioAutorizanteId: number | null;
      fechaDesbloqueo: string | null;
      claveEmergenciaId: number | null;
    } | null;
    gastos?: GastoDeCaja[];
    retiros?: RetiroDeCaja[];
    atenciones?: Atencion[];
    eventosMarcado?: EventoMarcadoPollo[];
  };
  ventasPorMedio: { medio: MedioPago; total: string }[];
  unidadesVendidas: { productoId: number; producto: string; unidades: string }[];
}

export interface ConfigStockMinimo {
  id: number;
  productoId: number;
  producto?: { nombre: string };
  sucursalId: number;
  sucursal?: { nombre: string };
  minimo: string;
  activa: boolean;
}
