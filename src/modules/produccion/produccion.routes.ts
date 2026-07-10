import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as produccionService from './produccion.service';
import { serializarLote } from './produccion.serializers';

const abrirSchema = z.object({
  productoElaboradoId: z.number().int().positive(),
  insumos: z
    .array(
      z.object({
        productoInsumoId: z.number().int().positive(),
        lineaIngresoOrigenId: z.number().int().positive(),
        cantidadUsada: z.number().positive(),
      }),
    )
    .min(1, 'El lote debe incluir al menos un insumo'),
});

const cerrarSchema = z.object({
  unidadesProducidasReales: z.number().positive(),
  desperdicioRealKg: z.number().min(0),
});

const listarQuery = z.object({
  estado: z.enum(['ABIERTO', 'CERRADO']).optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
});

const paramsId = z.object({ id: z.coerce.number().int().positive() });

export async function produccionRoutes(app: FastifyInstance) {
  // Abrir lote: PRODUCCION y ADMIN. La respuesta se serializa SIEMPRE según
  // rol: PRODUCCION jamás recibe unidadesEsperadas/desvioPct/alertaDisparada.
  app.post(
    '/lotes',
    { preHandler: [app.autenticar, app.requerirRoles('PRODUCCION', 'ADMINISTRADOR')] },
    async (req, reply) => {
      const datos = abrirSchema.parse(req.body);
      const lote = await produccionService.abrirLote({ ...datos, usuarioId: req.usuario.id });
      return reply.code(201).send(serializarLote(lote, req.usuario.rol));
    },
  );

  app.post(
    '/lotes/:id/cerrar',
    { preHandler: [app.autenticar, app.requerirRoles('PRODUCCION', 'ADMINISTRADOR')] },
    async (req) => {
      const { id } = paramsId.parse(req.params);
      const datos = cerrarSchema.parse(req.body);
      const lote = await produccionService.cerrarLote({
        loteId: id,
        unidadesProducidasReales: datos.unidadesProducidasReales,
        desperdicioRealKg: datos.desperdicioRealKg,
        usuarioId: req.usuario.id,
      });
      return serializarLote(lote, req.usuario.rol);
    },
  );

  app.get(
    '/lotes',
    { preHandler: [app.autenticar, app.requerirRoles('PRODUCCION', 'ADMINISTRADOR', 'SOCIO')] },
    async (req) => {
      const filtros = listarQuery.parse(req.query);
      const lotes = await produccionService.listarLotes(filtros);
      return lotes.map((l) => serializarLote(l, req.usuario.rol));
    },
  );

  app.get(
    '/lotes/:id',
    { preHandler: [app.autenticar, app.requerirRoles('PRODUCCION', 'ADMINISTRADOR', 'SOCIO')] },
    async (req) => {
      const { id } = paramsId.parse(req.params);
      const lote = await produccionService.obtenerLote(id);
      return serializarLote(lote, req.usuario.rol);
    },
  );
}
