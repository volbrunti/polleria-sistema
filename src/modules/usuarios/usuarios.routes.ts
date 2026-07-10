import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as usuariosService from './usuarios.service';

const ROLES = ['ADMINISTRADOR', 'SOCIO', 'ENCARGADO', 'CAJERO', 'PRODUCCION'] as const;

const crearSchema = z.object({
  nombre: z.string().min(1),
  username: z.string().min(3),
  password: z.string().min(6),
  rol: z.enum(ROLES),
});

const actualizarSchema = z.object({
  nombre: z.string().min(1).optional(),
  rol: z.enum(ROLES).optional(),
  activo: z.boolean().optional(),
  password: z.string().min(6).optional(),
});

const paramsId = z.object({ id: z.coerce.number().int().positive() });

export async function usuariosRoutes(app: FastifyInstance) {
  // CRUD de usuarios: SOLO ADMINISTRADOR (CLAUDE.md §2)
  const soloAdmin = [app.autenticar, app.requerirRoles('ADMINISTRADOR')] as const;

  app.get('/', { preHandler: [...soloAdmin] }, async () => usuariosService.listar());

  app.post('/', { preHandler: [...soloAdmin] }, async (req, reply) => {
    const datos = crearSchema.parse(req.body);
    const usuario = await usuariosService.crear(datos, req.usuario.id);
    return reply.code(201).send(usuario);
  });

  app.patch('/:id', { preHandler: [...soloAdmin] }, async (req) => {
    const { id } = paramsId.parse(req.params);
    const datos = actualizarSchema.parse(req.body);
    return usuariosService.actualizar(id, datos, req.usuario.id);
  });
}
