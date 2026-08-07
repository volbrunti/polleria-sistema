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

// Orígenes que pueden hablarle a la API. En producción es OBLIGATORIO
// enumerarlos: con `credentials: true`, reflejar cualquier origen deja que
// cualquier sitio haga requests autenticadas con la cookie de refresh del
// usuario — y en producción esa cookie es sameSite:'none', o sea que el
// navegador la manda cross-site. En dev se refleja todo, para no pelear con
// el puerto de Vite ni con el celular probando por IP de la red local.
function origenesPermitidos(): string[] | true {
  const crudo = process.env.ORIGENES_PERMITIDOS?.trim();
  if (!crudo) {
    if (esProduccion) {
      // eslint-disable-next-line no-console
      console.error(
        'Falta ORIGENES_PERMITIDOS — en producción hay que enumerar los dominios del frontend, ' +
          'separados por coma. Abortando arranque.',
      );
      process.exit(1);
    }
    return true;
  }
  return crudo
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, '')) // el header Origin nunca trae barra final
    .filter(Boolean);
}

// Fotos de remito: en producción van a Cloudflare R2 (bucket público, mismo
// nivel de protección que hoy tiene el disco local servido sin auth por
// /uploads/ — el nombre de archivo lleva bytes aleatorios, no es adivinable).
// Si falta alguna variable en producción, aborta: es preferible que el
// server no levante a que levante perdiendo fotos en cada redeploy (el
// disco del contenedor es efímero, ver DEPLOY.md).
function configuracionR2() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const urlPublicaCruda = process.env.R2_URL_PUBLICA;
  const completo = accountId && accessKeyId && secretAccessKey && bucket && urlPublicaCruda;

  if (!completo) {
    if (esProduccion) {
      // eslint-disable-next-line no-console
      console.error(
        'Faltan variables de R2 (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, ' +
          'R2_URL_PUBLICA) — son obligatorias en producción. Abortando arranque.',
      );
      process.exit(1);
    }
    return {
      configurado: false as const,
      accountId: '',
      accessKeyId: '',
      secretAccessKey: '',
      bucket: '',
      urlPublica: '',
    };
  }

  return {
    configurado: true as const,
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    urlPublica: urlPublicaCruda.replace(/\/+$/, ''), // sin barra final
  };
}

export const config = {
  puerto: Number(process.env.PORT ?? 3000),
  origenesPermitidos: origenesPermitidos(),
  // Fallback de desarrollo cuando R2 no está configurado (ver r2 abajo). En
  // la nube el disco del contenedor es efímero, así que en producción R2 es
  // obligatorio y esto no se usa.
  dirUploads: process.env.DIR_UPLOADS ?? 'uploads',
  r2: configuracionR2(),
  jwtSecret: requerido(process.env.JWT_SECRET, 'JWT_SECRET', 'dev-secret'),
  jwtRefreshSecret: requerido(process.env.JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET', 'dev-refresh-secret'),
  jwtAccessExpires: process.env.JWT_ACCESS_EXPIRES ?? '15m',
  jwtRefreshExpiresDias: Number(process.env.JWT_REFRESH_EXPIRES_DIAS ?? 7),
  esProduccion,
};
