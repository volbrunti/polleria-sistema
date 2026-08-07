import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as recargosService from './recargos.service';

const crearSchema = z.object({
  nombre: z.string().min(1),
  medio: z.enum(['DEBITO', 'CREDITO']),
  porcentaje: z.number().min(0).max(100),
});

const actualizarSchema = z.object({
  nombre: z.string().min(1).optional(),
  porcentaje: z.number().min(0).max(100).optional(),
  activo: z.boolean().optional(),
});

const paramsId = z.object({ id: z.coerce.number().int().positive() });

export async function recargosRoutes(app: FastifyInstance) {
  const soloAdmin = [app.autenticar, app.requerirRoles('ADMINISTRADOR')] as const;

  // Lo lee el POS al cobrar: el cajero necesita la lista para elegir. No es
  // dato ciego — el recargo se lo cobra al cliente y va en el ticket.
  app.get(
    '/',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'SOCIO', 'ENCARGADO', 'CAJERO')] },
    async (req) => {
      const { activo } = z.object({ activo: z.coerce.boolean().optional() }).parse(req.query);
      // El cajero solo ve los vigentes; el admin puede pedir todos para editarlos.
      const soloActivos = req.usuario.rol === 'CAJERO' || req.usuario.rol === 'ENCARGADO' ? true : activo;
      return recargosService.listar({ activo: soloActivos });
    },
  );

  app.post('/', { preHandler: [...soloAdmin] }, async (req, reply) => {
    const datos = crearSchema.parse(req.body);
    const recargo = await recargosService.crear(datos, req.usuario.id);
    return reply.code(201).send(recargo);
  });

  app.patch('/:id', { preHandler: [...soloAdmin] }, async (req) => {
    const { id } = paramsId.parse(req.params);
    const datos = actualizarSchema.parse(req.body);
    return recargosService.actualizar(id, datos, req.usuario.id);
  });
}
