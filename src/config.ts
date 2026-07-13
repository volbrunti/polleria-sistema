const esProduccion = process.env.NODE_ENV === 'production';

// Falla rápido en producción si falta un secreto crítico, en vez de arrancar
// silenciosamente con un valor por defecto adivinable (hallazgo de auditoría
// §0.1: el server arrancaba igual con 'dev-secret' y firmaba tokens válidos
// con un secreto público). En desarrollo/test el fallback sigue funcionando.
function requerido(valor: string | undefined, nombreVar: string, fallbackDev: string): string {
  if (valor) return valor;
  if (esProduccion) {
    // eslint-disable-next-line no-console
    console.error(`Falta la variable de entorno ${nombreVar} — es obligatoria en producción. Abortando arranque.`);
    process.exit(1);
  }
  return fallbackDev;
}

export const config = {
  puerto: Number(process.env.PORT ?? 3000),
  jwtSecret: requerido(process.env.JWT_SECRET, 'JWT_SECRET', 'dev-secret'),
  jwtRefreshSecret: requerido(process.env.JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET', 'dev-refresh-secret'),
  jwtAccessExpires: process.env.JWT_ACCESS_EXPIRES ?? '15m',
  jwtRefreshExpiresDias: Number(process.env.JWT_REFRESH_EXPIRES_DIAS ?? 7),
  esProduccion,
};
