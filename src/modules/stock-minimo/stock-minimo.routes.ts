import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as stockMinimoService from './stock-minimo.service';

export async function stockMinimoRoutes(app: FastifyInstance) {
  const soloAdmin = [app.autenticar, app.requerirRoles('ADMINISTRADOR')] as const;
  const adminYSocio = [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'SOCIO')] as const;

  // Upsert de la configuración por producto+sucursal (matriz §7: solo ADMIN)
  app.post('/', { preHandler: [...soloAdmin] }, async (req, reply) => {
    const datos = z
      .object({
        productoId: z.number().int().positive(),
        sucursalId: z.number().int().positive(),
        minimo: z.number().nonnegative(),
        activa: z.boolean().optional(),
      })
      .parse(req.body);
    const config = await stockMinimoService.configurar({ ...datos, usuarioId: req.usuario.id });
    return reply.code(201).send(config);
  });

  app.get('/', { preHandler: [...adminYSocio] }, async (req) => {
    const query = z.object({ sucursalId: z.coerce.number().int().positive().optional() }).parse(req.query);
    return stockMinimoService.listar(query);
  });
}
