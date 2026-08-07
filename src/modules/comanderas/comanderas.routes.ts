import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as comanderasService from './comanderas.service';

// La IP de una impresora es infraestructura, no un dato de negocio: toda esta
// sección es solo ADMINISTRADOR (CLAUDE.md §7). Ni siquiera los SOCIOS entran
// — no tienen nada que hacer con la configuración de red del local.

const ipValida = z
  .string()
  .trim()
  .min(1)
  .refine(
    (v) => /^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split('.').every((o) => Number(o) <= 255),
    'La IP tiene que ser una IPv4 válida (ej: 192.168.1.50)',
  );

const destino = z.enum(['COCINA', 'MOSTRADOR']);

export async function comanderasRoutes(app: FastifyInstance) {
  const soloAdmin = [app.autenticar, app.requerirRoles('ADMINISTRADOR')] as const;

  app.get('/', { preHandler: [...soloAdmin] }, async (req) => {
    const query = z.object({ sucursalId: z.coerce.number().int().positive().optional() }).parse(req.query);
    return comanderasService.listar(query);
  });

  app.post('/', { preHandler: [...soloAdmin] }, async (req, reply) => {
    const datos = z
      .object({
        sucursalId: z.number().int().positive(),
        destino,
        nombre: z.string().trim().min(1),
        ip: ipValida,
        puerto: z.number().int().min(1).max(65535).optional(),
        activa: z.boolean().optional(),
      })
      .parse(req.body);
    const creada = await comanderasService.crear(datos, req.usuario.id);
    return reply.code(201).send(creada);
  });

  app.patch('/:id', { preHandler: [...soloAdmin] }, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const cambios = z
      .object({
        nombre: z.string().trim().min(1).optional(),
        ip: ipValida.optional(),
        puerto: z.number().int().min(1).max(65535).optional(),
        activa: z.boolean().optional(),
      })
      .parse(req.body);
    return comanderasService.actualizar(id, cambios, req.usuario.id);
  });

  app.delete('/:id', { preHandler: [...soloAdmin] }, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    return comanderasService.eliminar(id, req.usuario.id);
  });

  // Impresión de prueba: única forma de validar que la IP quedó bien cargada
  // sin tener que simular un pedido real en el local.
  app.post('/:id/probar', { preHandler: [...soloAdmin] }, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    return comanderasService.probar(id);
  });

  // Soporte: ver los tickets de un pedido y cómo le fue a cada comandera.
  app.get('/tickets/:pedidoId', { preHandler: [...soloAdmin] }, async (req) => {
    const { pedidoId } = z.object({ pedidoId: z.coerce.number().int().positive() }).parse(req.params);
    return comanderasService.ticketsDePedido(pedidoId);
  });
}
