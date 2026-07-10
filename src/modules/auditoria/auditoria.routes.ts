import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';

const listarQuery = z.object({
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  usuarioId: z.coerce.number().int().positive().optional(),
  accion: z.string().optional(),
  entidad: z.string().optional(),
});

export async function auditoriaRoutes(app: FastifyInstance) {
  // Consulta de auditoría: ADMIN y SOCIOS (solo lectura — CLAUDE.md §8 Flujo 7).
  // No existen endpoints de UPDATE/DELETE: el registro es inmutable.
  app.get(
    '/',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'SOCIO')] },
    async (req) => {
      const f = listarQuery.parse(req.query);
      return prisma.registroAuditoria.findMany({
        where: {
          fechaHora: { gte: f.desde, lte: f.hasta },
          usuarioId: f.usuarioId,
          accion: f.accion,
          entidad: f.entidad,
        },
        include: { usuario: { select: { username: true, nombre: true } } },
        orderBy: { fechaHora: 'desc' },
        take: 500,
      });
    },
  );
}
