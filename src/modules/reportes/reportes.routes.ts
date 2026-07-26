import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as reportesService from './reportes.service';

const filtrosFecha = z.object({
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  sucursalId: z.coerce.number().int().positive().optional(),
});

export async function reportesRoutes(app: FastifyInstance) {
  const soloLectura = [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'SOCIO')] as const;

  app.get('/ventas-por-producto', { preHandler: [...soloLectura] }, async (req) => {
    const filtros = filtrosFecha.parse(req.query);
    return reportesService.ventasPorProducto(filtros);
  });

  app.get('/ventas-por-medio', { preHandler: [...soloLectura] }, async (req) => {
    const filtros = filtrosFecha.parse(req.query);
    return reportesService.ventasPorMedioDePago(filtros);
  });

  app.get('/cierres-caja', { preHandler: [...soloLectura] }, async (req) => {
    const filtros = filtrosFecha.parse(req.query);
    return reportesService.cierresDeCaja(filtros);
  });

  app.get('/retiros-por-socio', { preHandler: [...soloLectura] }, async (req) => {
    const filtros = filtrosFecha.parse(req.query);
    return reportesService.retirosPorSocio(filtros);
  });

  app.get('/mermas', { preHandler: [...soloLectura] }, async (req) => {
    const filtros = filtrosFecha.parse(req.query);
    return reportesService.mermasPorProducto(filtros);
  });

  app.get('/produccion', { preHandler: [...soloLectura] }, async (req) => {
    const filtros = filtrosFecha.parse(req.query);
    return reportesService.rendimientoProduccion(filtros);
  });

  app.get('/gastos', { preHandler: [...soloLectura] }, async (req) => {
    const filtros = filtrosFecha.parse(req.query);
    return reportesService.gastosPorCategoria(filtros);
  });

  app.get('/atenciones', { preHandler: [...soloLectura] }, async (req) => {
    const filtros = filtrosFecha.parse(req.query);
    return reportesService.atencionesReporte(filtros);
  });

  app.get('/trazabilidad/pedido/:id', { preHandler: [...soloLectura] }, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    return reportesService.trazabilidadPedido(id);
  });
}
