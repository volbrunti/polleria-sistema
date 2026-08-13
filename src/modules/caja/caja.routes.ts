import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as cajaService from './caja.service';

// Categorías sugeridas de gasto (CLAUDE.md §5 Flujo 5) — el frontend las
// ofrece como lista; el backend acepta cualquiera pero "OTRO" exige detalle.
export const CATEGORIAS_GASTO = [
  'PAPAS',
  'LEÑA/CARBON',
  'LIMPIEZA',
  'BEBIDAS',
  'VERDULERIA',
  'CONDIMENTOS',
  'OTRO',
] as const;

const base = { sucursalId: z.number().int().positive().optional() };

// UUID que el POS genera por operación. Permite reintentar sin duplicar cuando
// la red se cuelga a mitad de camino (auditoría 2026-08-07, C-4). No se aplica
// a /costo-cero: esa operación no crea una fila propia sino MovimientoStock, y
// darle idempotencia pide una columna en esa tabla — queda pendiente.
const idempotente = { tokenIdempotencia: z.string().min(8).max(64).optional() };

export async function cajaRoutes(app: FastifyInstance) {
  const operativos = [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'ENCARGADO', 'CAJERO')] as const;

  app.post('/atenciones', { preHandler: [...operativos] }, async (req, reply) => {
    const datos = z
      .object({
        ...base,
        ...idempotente,
        productoId: z.number().int().positive(),
        cantidad: z.number().int().positive(),
        motivoCodigo: z.string().min(1).max(50),
        motivoDetalle: z.string().max(300).optional(),
      })
      .parse(req.body);
    const atencion = await cajaService.registrarAtencion({ usuarioId: req.usuario.id, ...datos });
    return reply.code(201).send(atencion);
  });

  app.post('/gastos-caja', { preHandler: [...operativos] }, async (req, reply) => {
    const datos = z
      .object({
        ...base,
        ...idempotente,
        monto: z.number().positive(),
        medio: z.enum(['EFECTIVO', 'MERCADO_PAGO']),
        categoria: z.string().min(1).max(50),
        descripcion: z.string().max(300).optional(),
      })
      .parse(req.body);
    const gasto = await cajaService.registrarGasto({ usuarioId: req.usuario.id, ...datos });
    return reply.code(201).send(gasto);
  });

  app.post('/retiros-caja', { preHandler: [...operativos] }, async (req, reply) => {
    const datos = z
      .object({
        ...base,
        ...idempotente,
        monto: z.number().positive(),
        medio: z.enum(['EFECTIVO', 'DEBITO', 'CREDITO', 'MERCADO_PAGO', 'TRANSFERENCIA']),
        // Selector CERRADO — no hay cuarta opción (regla del cliente)
        socio: z.enum(['ARIEL', 'ELIANA', 'EMA']),
      })
      .parse(req.body);
    const retiro = await cajaService.registrarRetiro({ usuarioId: req.usuario.id, ...datos });
    return reply.code(201).send(retiro);
  });

  app.post('/marcado-pollos', { preHandler: [...operativos] }, async (req, reply) => {
    const datos = z
      .object({ ...base, ...idempotente, cantidad: z.number().int().positive() })
      .parse(req.body);
    const evento = await cajaService.marcarPollos({ usuarioId: req.usuario.id, ...datos });
    return reply.code(201).send(evento);
  });

  app.post('/costo-cero', { preHandler: [...operativos] }, async (req, reply) => {
    const datos = z
      .object({
        ...base,
        productoId: z.number().int().positive(),
        cantidad: z.number().positive(), // acepta 0.5 (medio pollo marcado quemado)
        tipo: z.enum(['DESPERDICIO_QUEMADO', 'RETORNO_A_PRODUCCION']),
        motivo: z.string().max(300).optional(),
      })
      .parse(req.body);
    const registro = await cajaService.registrarCostoCero({ usuarioId: req.usuario.id, ...datos });
    return reply.code(201).send(registro);
  });
}
