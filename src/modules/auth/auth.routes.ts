import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as authService from './auth.service';
import { config } from '../../config';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const COOKIE_REFRESH = 'refresh_token';

const opcionesCookie = {
  httpOnly: true,
  secure: config.esProduccion,
  sameSite: 'strict' as const,
  path: '/api/auth',
  maxAge: config.jwtRefreshExpiresDias * 24 * 60 * 60,
};

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', async (req, reply) => {
    const { username, password } = loginSchema.parse(req.body);
    const resultado = await authService.login(username, password);
    reply.setCookie(COOKIE_REFRESH, resultado.refreshToken, opcionesCookie);
    return { accessToken: resultado.accessToken, usuario: resultado.usuario };
  });

  app.post('/refresh', async (req, reply) => {
    const token = req.cookies[COOKIE_REFRESH];
    if (!token) return reply.code(401).send({ codigo: 'NO_AUTORIZADO', mensaje: 'Sin refresh token' });
    const resultado = await authService.renovar(token);
    reply.setCookie(COOKIE_REFRESH, resultado.refreshToken, opcionesCookie);
    return { accessToken: resultado.accessToken };
  });

  app.post('/logout', async (req, reply) => {
    await authService.logout(req.cookies[COOKIE_REFRESH]);
    reply.clearCookie(COOKIE_REFRESH, { path: '/api/auth' });
    return { ok: true };
  });
}
