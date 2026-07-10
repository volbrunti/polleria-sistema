import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as productosService from './productos.service';

const crearSchema = z.object({
  nombre: z.string().min(1),
  categoria: z.string().min(1),
  tipo: z.enum(['MATERIA_PRIMA', 'ELABORADO', 'REVENTA']),
  unidadDeMedida: z.enum(['KG', 'UNIDAD']),
});

const actualizarSchema = z.object({
  nombre: z.string().min(1).optional(),
  categoria: z.string().min(1).optional(),
  activo: z.boolean().optional(),
});

const listarQuery = z.object({
  tipo: z.enum(['MATERIA_PRIMA', 'ELABORADO', 'REVENTA']).optional(),
  activo: z.coerce.boolean().optional(),
});

const precioSchema = z.object({ monto: z.number().positive() });
const paramsId = z.object({ id: z.coerce.number().int().positive() });

export async function productosRoutes(app: FastifyInstance) {
  // Catálogo: lo leen todos los roles autenticados (lo necesitan para operar)
  app.get('/', { preHandler: [app.autenticar] }, async (req) => {
    const filtros = listarQuery.parse(req.query);
    return productosService.listar(filtros);
  });

  // Escritura: solo ADMINISTRADOR
  app.post(
    '/',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR')] },
    async (req, reply) => {
      const datos = crearSchema.parse(req.body);
      const producto = await productosService.crear(datos, req.usuario.id);
      return reply.code(201).send(producto);
    },
  );

  app.patch(
    '/:id',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR')] },
    async (req) => {
      const { id } = paramsId.parse(req.params);
      const datos = actualizarSchema.parse(req.body);
      return productosService.actualizar(id, datos, req.usuario.id);
    },
  );

  // Precios: dato financiero — escritura ADMIN, lectura ADMIN/SOCIO
  app.post(
    '/:id/precios',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR')] },
    async (req, reply) => {
      const { id } = paramsId.parse(req.params);
      const { monto } = precioSchema.parse(req.body);
      const precio = await productosService.cambiarPrecio(id, monto, req.usuario.id);
      return reply.code(201).send(precio);
    },
  );

  app.get(
    '/:id/precios',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'SOCIO')] },
    async (req) => {
      const { id } = paramsId.parse(req.params);
      return productosService.historialPrecios(id);
    },
  );
}
