import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';

const crearSchema = z.object({
  nombre: z.string().min(1),
  tipo: z.enum(['PRODUCCION', 'VENTA']),
  direccion: z.string().optional(),
});

const actualizarSchema = z.object({
  nombre: z.string().min(1).optional(),
  direccion: z.string().nullable().optional(),
  activa: z.boolean().optional(),
});

const paramsId = z.object({ id: z.coerce.number().int().positive() });

export async function sucursalesRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.autenticar] }, async () =>
    prisma.sucursal.findMany({ where: { activa: true }, orderBy: { id: 'asc' } }),
  );

  // Alta de nuevas sucursales sin refactor (multi-sucursal desde el día 1)
  app.post(
    '/',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR')] },
    async (req, reply) => {
      const datos = crearSchema.parse(req.body);
      const sucursal = await prisma.$transaction(async (tx) => {
        const creada = await tx.sucursal.create({ data: datos });
        await registrarAuditoria(tx, {
          accion: 'CREAR_SUCURSAL',
          entidad: 'Sucursal',
          entidadId: creada.id,
          usuarioId: req.usuario.id,
          datosNuevos: creada,
        });
        return creada;
      });
      return reply.code(201).send(sucursal);
    },
  );

  app.patch(
    '/:id',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR')] },
    async (req) => {
      const { id } = paramsId.parse(req.params);
      const datos = actualizarSchema.parse(req.body);
      const anterior = await prisma.sucursal.findUnique({ where: { id } });
      if (!anterior) throw Errores.noEncontrado('Sucursal');
      return prisma.$transaction(async (tx) => {
        const sucursal = await tx.sucursal.update({ where: { id }, data: datos });
        await registrarAuditoria(tx, {
          accion: 'ACTUALIZAR_SUCURSAL',
          entidad: 'Sucursal',
          entidadId: id,
          usuarioId: req.usuario.id,
          datosAnteriores: anterior,
          datosNuevos: sucursal,
        });
        return sucursal;
      });
    },
  );
}
