import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as fichasService from './fichas.service';

const versionSchema = z.object({
  rendimientoEsperado: z.number().positive(),
  desperdicioEsperadoPct: z.number().min(0).max(100),
  umbralDesvioAlertaPct: z.number().min(0).max(100),
  ingredientes: z
    .array(
      z.object({
        productoInsumoId: z.number().int().positive(),
        cantidadPorUnidadProducida: z.number().positive(),
        esPrincipal: z.boolean(),
      }),
    )
    .min(1),
});

const crearFichaSchema = z.object({
  productoElaboradoId: z.number().int().positive(),
  version: versionSchema,
});

const paramsId = z.object({ id: z.coerce.number().int().positive() });

export async function fichasRoutes(app: FastifyInstance) {
  // CONTROL CIEGO: las fichas contienen rendimientoEsperado y umbrales.
  // El rol PRODUCCION NO tiene acceso a este módulo — ni lectura.
  // Escritura: solo ADMINISTRADOR. Lectura: ADMIN + SOCIO.
  app.get(
    '/',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'SOCIO')] },
    async () => fichasService.listar(),
  );

  app.post(
    '/',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR')] },
    async (req, reply) => {
      const { productoElaboradoId, version } = crearFichaSchema.parse(req.body);
      const ficha = await fichasService.crearFicha(productoElaboradoId, version, req.usuario.id);
      return reply.code(201).send(ficha);
    },
  );

  app.post(
    '/:id/versiones',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR')] },
    async (req, reply) => {
      const { id } = paramsId.parse(req.params);
      const version = versionSchema.parse(req.body);
      const creada = await fichasService.crearNuevaVersion(id, version, req.usuario.id);
      return reply.code(201).send(creada);
    },
  );
}
