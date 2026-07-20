import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as pedidosService from './pedidos.service';

const itemSchema = z.object({
  productoId: z.number().int().positive(),
  cantidad: z.number().int().positive(),
  aclaraciones: z.string().max(300).optional(),
});

const confirmarSchema = z.object({
  sucursalId: z.number().int().positive().optional(),
  tipo: z.enum(['PRESENCIAL', 'A_RETIRAR']),
  items: z.array(itemSchema).min(1),
});

const modificarSchema = z.object({ items: z.array(itemSchema).min(1) });

const cobrarSchema = z.object({
  pagos: z
    .array(
      z.object({
        medio: z.enum(['EFECTIVO', 'DEBITO', 'CREDITO', 'MERCADO_PAGO', 'TRANSFERENCIA']),
        monto: z.number().positive(),
      }),
    )
    .min(1),
});

const paramsId = z.object({ id: z.coerce.number().int().positive() });

export async function pedidosRoutes(app: FastifyInstance) {
  // Matriz RBAC de CLAUDE-MODULO-2.md §7: opera ADMIN/ENCARGADO/CAJERO
  const operativos = [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'ENCARGADO', 'CAJERO')] as const;

  // Confirmar = crear: descuenta stock y manda ticket a cocina (§4.5)
  app.post('/', { preHandler: [...operativos] }, async (req, reply) => {
    const datos = confirmarSchema.parse(req.body);
    const pedido = await pedidosService.confirmarPedido({ usuarioId: req.usuario.id, ...datos });
    return reply.code(201).send(pedido);
  });

  app.get('/pendientes', { preHandler: [...operativos] }, async (req) => {
    const query = z.object({ sucursalId: z.coerce.number().int().positive().optional() }).parse(req.query);
    return pedidosService.listarPendientes({ usuarioId: req.usuario.id, sucursalId: query.sucursalId });
  });

  // Ranking para ordenar la grilla del POS (§4.1: más vendidos primero)
  app.get('/mas-vendidos', { preHandler: [...operativos] }, async (req) => {
    const query = z.object({ sucursalId: z.coerce.number().int().positive().optional() }).parse(req.query);
    return pedidosService.masVendidos({ usuarioId: req.usuario.id, sucursalId: query.sucursalId });
  });

  app.get('/:id', { preHandler: [...operativos] }, async (req) => {
    const { id } = paramsId.parse(req.params);
    return pedidosService.obtener(id, req.usuario.id);
  });

  app.patch('/:id', { preHandler: [...operativos] }, async (req) => {
    const { id } = paramsId.parse(req.params);
    const datos = modificarSchema.parse(req.body);
    return pedidosService.modificarPedido({ pedidoId: id, items: datos.items, usuarioId: req.usuario.id });
  });

  app.post('/:id/cobrar', { preHandler: [...operativos] }, async (req) => {
    const { id } = paramsId.parse(req.params);
    const datos = cobrarSchema.parse(req.body);
    return pedidosService.cobrarPedido({ pedidoId: id, pagos: datos.pagos, usuarioId: req.usuario.id });
  });

  app.post('/:id/marcar-listo', { preHandler: [...operativos] }, async (req) => {
    const { id } = paramsId.parse(req.params);
    return pedidosService.marcarListo(id, req.usuario.id);
  });

  app.post('/:id/no-retirado', { preHandler: [...operativos] }, async (req) => {
    const { id } = paramsId.parse(req.params);
    return pedidosService.marcarNoRetirado(id, req.usuario.id);
  });

  app.post('/:id/reasignar', { preHandler: [...operativos] }, async (req, reply) => {
    const { id } = paramsId.parse(req.params);
    const nuevo = await pedidosService.reasignarPedido({ pedidoId: id, usuarioId: req.usuario.id });
    return reply.code(201).send(nuevo);
  });

  app.post('/:id/marcar-perdido', { preHandler: [...operativos] }, async (req) => {
    const { id } = paramsId.parse(req.params);
    return pedidosService.marcarPerdido({ pedidoId: id, usuarioId: req.usuario.id });
  });

  app.post('/:id/anular', { preHandler: [...operativos] }, async (req) => {
    const { id } = paramsId.parse(req.params);
    return pedidosService.anularPedido({ pedidoId: id, usuarioId: req.usuario.id });
  });
}
