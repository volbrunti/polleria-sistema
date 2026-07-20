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
  tipo: z.enum(['MATERIA_PRIMA', 'ELABORADO', 'REVENTA', 'COMBO']).optional(),
  activo: z.coerce.boolean().optional(),
});

const precioSchema = z.object({ monto: z.number().positive(), cantidad: z.number().int().positive().optional() });
const paramsId = z.object({ id: z.coerce.number().int().positive() });

const componenteSchema = z.object({
  productoComponenteId: z.number().int().positive(),
  cantidad: z.number().positive(),
});

const crearComboSchema = z.object({
  nombre: z.string().min(1),
  categoria: z.string().min(1),
  componentes: z.array(componenteSchema).min(1, 'El combo debe tener al menos un componente'),
});

const componentesSchema = z.object({
  componentes: z.array(componenteSchema).min(1, 'El combo debe tener al menos un componente'),
});

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

  // Precios: dato financiero — escritura ADMIN, lectura ADMIN/SOCIO.
  // `cantidad` (default 1): tabla de precio por volumen para COMBO.
  app.post(
    '/:id/precios',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR')] },
    async (req, reply) => {
      const { id } = paramsId.parse(req.params);
      const { monto, cantidad } = precioSchema.parse(req.body);
      const precio = await productosService.cambiarPrecio(id, monto, req.usuario.id, cantidad);
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

  // Tablas vigentes de TODOS los productos en una sola respuesta — la usa el
  // POS (módulo 2) para mostrar precios y totales en vivo. El precio de VENTA
  // no es dato ciego: el cajero se lo cobra al cliente. El historial y el
  // resto de datos financieros siguen gateados a ADMIN/SOCIO.
  app.get(
    '/precios-vigentes',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'SOCIO', 'ENCARGADO', 'CAJERO')] },
    async () => productosService.tablasPrecioVigentes(),
  );

  // Precio vigente por cada cantidad cargada (para productos normales, una
  // sola fila con cantidad=1; para un COMBO, la tabla completa de volumen).
  app.get(
    '/:id/precios/vigente',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'SOCIO')] },
    async (req) => {
      const { id } = paramsId.parse(req.params);
      return productosService.tablaPrecioVigente(id);
    },
  );

  // Combos: bundle de otros productos a un precio propio (CLAUDE.md §9).
  // Escritura solo ADMINISTRADOR, igual que el resto del catálogo.
  app.post(
    '/combos',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR')] },
    async (req, reply) => {
      const datos = crearComboSchema.parse(req.body);
      const combo = await productosService.crearCombo(datos, req.usuario.id);
      return reply.code(201).send(combo);
    },
  );

  app.patch(
    '/combos/:id/componentes',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR')] },
    async (req) => {
      const { id } = paramsId.parse(req.params);
      const { componentes } = componentesSchema.parse(req.body);
      return productosService.actualizarComponentesCombo(id, componentes, req.usuario.id);
    },
  );
}
