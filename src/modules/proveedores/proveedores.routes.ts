import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';

const crearSchema = z.object({
  nombre: z.string().min(1),
  contacto: z.string().optional(),
});

const actualizarSchema = z.object({
  nombre: z.string().min(1).optional(),
  contacto: z.string().nullable().optional(),
  activo: z.boolean().optional(),
});

const paramsId = z.object({ id: z.coerce.number().int().positive() });

export async function proveedoresRoutes(app: FastifyInstance) {
  // Lectura: PRODUCCION la necesita para cargar ingresos
  app.get(
    '/',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'SOCIO', 'PRODUCCION', 'ENCARGADO')] },
    async () => prisma.proveedor.findMany({ where: { activo: true }, orderBy: [{ esOtro: 'asc' }, { nombre: 'asc' }] }),
  );

  app.post(
    '/',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR')] },
    async (req, reply) => {
      const datos = crearSchema.parse(req.body);
      const proveedor = await prisma.$transaction(async (tx) => {
        const creado = await tx.proveedor.create({ data: datos });
        await registrarAuditoria(tx, {
          accion: 'CREAR_PROVEEDOR',
          entidad: 'Proveedor',
          entidadId: creado.id,
          usuarioId: req.usuario.id,
          datosNuevos: creado,
        });
        return creado;
      });
      return reply.code(201).send(proveedor);
    },
  );

  app.patch(
    '/:id',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR')] },
    async (req) => {
      const { id } = paramsId.parse(req.params);
      const datos = actualizarSchema.parse(req.body);
      const anterior = await prisma.proveedor.findUnique({ where: { id } });
      if (!anterior) throw Errores.noEncontrado('Proveedor');
      return prisma.$transaction(async (tx) => {
        const proveedor = await tx.proveedor.update({ where: { id }, data: datos });
        await registrarAuditoria(tx, {
          accion: 'ACTUALIZAR_PROVEEDOR',
          entidad: 'Proveedor',
          entidadId: id,
          usuarioId: req.usuario.id,
          datosAnteriores: anterior,
          datosNuevos: proveedor,
        });
        return proveedor;
      });
    },
  );
}
