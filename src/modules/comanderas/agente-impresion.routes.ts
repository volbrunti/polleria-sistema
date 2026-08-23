import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as agenteImpresionService from './agente-impresion.service';

// El token del agente es infraestructura, igual que la IP de una comandera
// (comanderas.routes.ts): solo ADMINISTRADOR lo genera/rota.
export async function agenteImpresionRoutes(app: FastifyInstance) {
  const soloAdmin = [app.autenticar, app.requerirRoles('ADMINISTRADOR')] as const;

  app.get('/', { preHandler: [...soloAdmin] }, async (req) => {
    const query = z.object({ sucursalId: z.coerce.number().int().positive().optional() }).parse(req.query);
    return agenteImpresionService.listarEstado(query);
  });

  // Devuelve el token en texto plano — es la única vez que se puede ver.
  app.post('/', { preHandler: [...soloAdmin] }, async (req, reply) => {
    const { sucursalId } = z.object({ sucursalId: z.number().int().positive() }).parse(req.body);
    const token = await agenteImpresionService.generarToken(sucursalId, req.usuario.id);
    return reply.code(201).send({ sucursalId, token });
  });
}
