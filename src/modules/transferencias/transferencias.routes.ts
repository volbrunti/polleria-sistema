import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as transferenciasService from './transferencias.service';
import { serializarTransferencia } from './transferencias.serializers';

const generarSchema = z.object({
  sucursalDestinoId: z.number().int().positive(),
  lineas: z
    .array(
      z.object({
        productoId: z.number().int().positive(),
        cantidadEnviada: z.number().positive(),
      }),
    )
    .min(1, 'La transferencia debe tener al menos una línea'),
});

const recepcionSchema = z.object({
  lineas: z
    .array(
      z.object({
        productoId: z.number().int().positive(),
        cantidadRecibida: z.number().min(0), // 0 válido: "no llegó nada de esto"
      }),
    )
    .min(1),
});

const listarQuery = z.object({
  estado: z.enum(['PENDIENTE_RECEPCION', 'CONFIRMADA', 'CONFIRMADA_CON_DISCREPANCIA']).optional(),
  sucursalDestinoId: z.coerce.number().int().positive().optional(),
});

const paramsId = z.object({ id: z.coerce.number().int().positive() });

// Mensaje EXACTO de la comparación ciega: no revela diferencia ni lado del error
const MENSAJE_NO_COINCIDE =
  'Los números no coinciden. Puede recontar y volver a cargar, o confirmar igual.';

export async function transferenciasRoutes(app: FastifyInstance) {
  // Generar: PRODUCCION (emisor) y ADMIN
  app.post(
    '/',
    { preHandler: [app.autenticar, app.requerirRoles('PRODUCCION', 'ADMINISTRADOR')] },
    async (req, reply) => {
      const datos = generarSchema.parse(req.body);
      const transferencia = await transferenciasService.generarTransferencia({
        ...datos,
        usuarioId: req.usuario.id,
      });
      return reply.code(201).send(serializarTransferencia(transferencia, req.usuario.rol, req.usuario.id));
    },
  );

  // Recepción ciega: roles del local. La serialización quita cantidadEnviada
  // para todo el que no sea admin/socio/emisor.
  app.post(
    '/:id/recepcion',
    { preHandler: [app.autenticar, app.requerirRoles('CAJERO', 'ENCARGADO', 'ADMINISTRADOR')] },
    async (req) => {
      const { id } = paramsId.parse(req.params);
      const { lineas } = recepcionSchema.parse(req.body);
      const resultado = await transferenciasService.intentarRecepcion({
        transferenciaId: id,
        lineasRecibidas: lineas,
        usuarioId: req.usuario.id,
      });
      if (!resultado.coincide) {
        return { coincide: false, mensaje: MENSAJE_NO_COINCIDE };
      }
      return {
        coincide: true,
        transferencia: serializarTransferencia(resultado.transferencia, req.usuario.rol, req.usuario.id),
      };
    },
  );

  app.post(
    '/:id/confirmar-con-discrepancia',
    { preHandler: [app.autenticar, app.requerirRoles('CAJERO', 'ENCARGADO', 'ADMINISTRADOR')] },
    async (req) => {
      const { id } = paramsId.parse(req.params);
      const { lineas } = recepcionSchema.parse(req.body);
      const transferencia = await transferenciasService.confirmarConDiscrepancia({
        transferenciaId: id,
        lineasRecibidas: lineas,
        usuarioId: req.usuario.id,
      });
      return serializarTransferencia(transferencia, req.usuario.rol, req.usuario.id);
    },
  );

  // Listado: cualquier rol autenticado — la serialización por rol decide qué ve cada uno.
  // CAJERO/ENCARGADO con sucursal asignada: se fuerza su propia sucursal como
  // destino, ignorando lo que pida la query — no pueden ni siquiera LISTAR
  // las pendientes de otro local (§5.2 de la auditoría).
  app.get('/', { preHandler: [app.autenticar] }, async (req) => {
    const filtros = listarQuery.parse(req.query);
    if ((req.usuario.rol === 'CAJERO' || req.usuario.rol === 'ENCARGADO') && req.usuario.sucursalId != null) {
      filtros.sucursalDestinoId = req.usuario.sucursalId;
    }
    const transferencias = await transferenciasService.listar(filtros);
    return transferencias.map((t) => serializarTransferencia(t, req.usuario.rol, req.usuario.id));
  });

  app.get('/:id', { preHandler: [app.autenticar] }, async (req) => {
    const { id } = paramsId.parse(req.params);
    const transferencia = await transferenciasService.obtener(id);
    return serializarTransferencia(transferencia, req.usuario.rol, req.usuario.id);
  });
}
