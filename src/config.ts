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

export const config = {
  puerto: Number(process.env.PORT ?? 3000),
  origenesPermitidos: origenesPermitidos(),
  // Dónde viven las fotos de remito. En la nube el disco del contenedor es
  // efímero (se borra en cada deploy), así que esto tiene que apuntar a un
  // volumen montado. Ver DEPLOY.md.
  dirUploads: process.env.DIR_UPLOADS ?? 'uploads',
  jwtSecret: requerido(process.env.JWT_SECRET, 'JWT_SECRET', 'dev-secret'),
  jwtRefreshSecret: requerido(process.env.JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET', 'dev-refresh-secret'),
  jwtAccessExpires: process.env.JWT_ACCESS_EXPIRES ?? '15m',
  jwtRefreshExpiresDias: Number(process.env.JWT_REFRESH_EXPIRES_DIAS ?? 7),
  esProduccion,
};
