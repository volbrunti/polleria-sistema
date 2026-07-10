import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import jwt from 'jsonwebtoken';
import type { Rol } from '@prisma/client';
import { config } from '../config';
import { Errores } from '../lib/errores';

export interface UsuarioAutenticado {
  id: number;
  username: string;
  rol: Rol;
}

declare module 'fastify' {
  interface FastifyRequest {
    usuario: UsuarioAutenticado;
  }
  interface FastifyInstance {
    autenticar: preHandlerHookHandler;
    requerirRoles: (...roles: Rol[]) => preHandlerHookHandler;
  }
}

export function firmarAccessToken(usuario: UsuarioAutenticado): string {
  return jwt.sign(
    { sub: String(usuario.id), username: usuario.username, rol: usuario.rol },
    config.jwtSecret,
    { expiresIn: config.jwtAccessExpires as jwt.SignOptions['expiresIn'] },
  );
}

export function verificarAccessToken(token: string): UsuarioAutenticado {
  const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
  return {
    id: Number(payload.sub),
    username: payload.username as string,
    rol: payload.rol as Rol,
  };
}

export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('usuario');

  app.decorate('autenticar', async function (req: FastifyRequest, _reply: FastifyReply) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw Errores.noAutorizado();
    try {
      req.usuario = verificarAccessToken(header.slice(7));
    } catch {
      throw Errores.noAutorizado();
    }
  });

  app.decorate('requerirRoles', function (...roles: Rol[]): preHandlerHookHandler {
    return async function (req: FastifyRequest, _reply: FastifyReply) {
      if (!req.usuario) throw Errores.noAutorizado();
      if (!roles.includes(req.usuario.rol)) throw Errores.prohibido();
    };
  });
});
