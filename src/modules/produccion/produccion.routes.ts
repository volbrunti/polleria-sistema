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
  // Corrección opcional de lo realmente usado (ver cerrarLote en el service)
  insumosReales: z
    .array(
      z.object({
        insumoUsadoId: z.number().int().positive(),
        cantidadUsada: z.number().min(0),
      }),
    )
    .optional(),
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
        insumosReales: datos.insumosReales,
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

  // Productos que efectivamente se producen por lote (tipo ELABORADO con
  // ficha técnica activa) — para el selector "¿qué vas a producir?".
  app.get(
    '/productos-producibles',
    { preHandler: [app.autenticar, app.requerirRoles('PRODUCCION', 'ADMINISTRADOR')] },
    async () => produccionService.listarProductosProducibles(),
  );

  // Insumos de la ficha activa de un producto — SOLO identidades, sin
  // cantidades ni datos de rendimiento/desvío (control ciego).
  app.get(
    '/productos/:id/insumos-esperados',
    { preHandler: [app.autenticar, app.requerirRoles('PRODUCCION', 'ADMINISTRADOR')] },
    async (req) => {
      const { id } = paramsId.parse(req.params);
      return produccionService.insumosDeFichaActiva(id);
    },
  );
}
