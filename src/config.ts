export const config = {
  puerto: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
  jwtAccessExpires: process.env.JWT_ACCESS_EXPIRES ?? '15m',
  jwtRefreshExpiresDias: Number(process.env.JWT_REFRESH_EXPIRES_DIAS ?? 7),
  esProduccion: process.env.NODE_ENV === 'production',
};
