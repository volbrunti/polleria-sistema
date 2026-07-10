import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as alertasService from './alertas.service';

const listarQuery = z.object({
  vista: z.coerce.boolean().optional(),
  tipo: z
    .enum(['DESVIO_PRODUCCION', 'DISCREPANCIA_TRANSFERENCIA', 'DISCREPANCIA_CAJA', 'BLOQUEO_TURNO', 'STOCK_MINIMO'])
    .optional(),
});

const paramsId = z.object({ id: z.coerce.number().int().positive() });

export async function alertasRoutes(app: FastifyInstance) {
  // Alertas: SOLO ADMINISTRADOR (CLAUDE.md §2)
  const soloAdmin = [app.autenticar, app.requerirRoles('ADMINISTRADOR')] as const;

  app.get('/', { preHandler: [...soloAdmin] }, async (req) => {
    const filtros = listarQuery.parse(req.query);
    return alertasService.listar(filtros);
  });

  app.patch('/:id/vista', { preHandler: [...soloAdmin] }, async (req) => {
    const { id } = paramsId.parse(req.params);
    return alertasService.marcarVista(id);
  });
}
