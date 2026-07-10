// Errores de negocio con códigos claros (CLAUDE.md §10)

export class AppError extends Error {
  constructor(
    public codigo: string,
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errores = {
  stockInsuficiente: (detalle: string) =>
    new AppError('STOCK_INSUFICIENTE', `Stock insuficiente: ${detalle}`, 400),
  lineaIngresoInsuficiente: (detalle: string) =>
    new AppError('LINEA_INGRESO_INSUFICIENTE', `Cantidad restante insuficiente en línea de ingreso: ${detalle}`, 400),
  fichaSinVersionActiva: (producto: string) =>
    new AppError('FICHA_SIN_VERSION_ACTIVA', `El producto "${producto}" no tiene ficha técnica con versión activa`, 400),
  transferenciaYaConfirmada: () =>
    new AppError('TRANSFERENCIA_YA_CONFIRMADA', 'La transferencia ya fue confirmada', 409),
  loteYaCerrado: () => new AppError('LOTE_YA_CERRADO', 'El lote de producción ya está cerrado', 409),
  noEncontrado: (entidad: string) => new AppError('NO_ENCONTRADO', `${entidad} no encontrado/a`, 404),
  credencialesInvalidas: () =>
    new AppError('CREDENCIALES_INVALIDAS', 'Usuario o contraseña incorrectos', 401),
  noAutorizado: () => new AppError('NO_AUTORIZADO', 'No autorizado', 401),
  prohibido: () => new AppError('PROHIBIDO', 'No tiene permisos para esta operación', 403),
  validacion: (detalle: string) => new AppError('VALIDACION', detalle, 400),
};
