import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as dashboardService from './dashboard.service';

const filtros = z.object({
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  sucursalId: z.coerce.number().int().positive().optional(),
});

export async function dashboardRoutes(app: FastifyInstance) {
  app.get(
    '/',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'SOCIO')] },
    async (req) => {
      const f = filtros.parse(req.query);
      return dashboardService.resumenDashboard(f);
    },
  );
}
