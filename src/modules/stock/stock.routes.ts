import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as stockService from './stock.service';

const querySucursal = z.object({ sucursalId: z.coerce.number().int().positive() });

const queryMovimientos = z.object({
  productoId: z.coerce.number().int().positive().optional(),
  sucursalId: z.coerce.number().int().positive().optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
});

export async function stockRoutes(app: FastifyInstance) {
  // Stock por sucursal: roles operativos y de lectura. CAJERO no (lo tendrá el POS en módulo 2).
  app.get(
    '/',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'SOCIO', 'ENCARGADO', 'PRODUCCION')] },
    async (req) => {
      const { sucursalId } = querySucursal.parse(req.query);
      return stockService.consultarStockSucursal(sucursalId);
    },
  );

  // Historial de movimientos: solo lectura gerencial
  app.get(
    '/movimientos',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'SOCIO')] },
    async (req) => {
      const filtros = queryMovimientos.parse(req.query);
      return stockService.consultarMovimientos(filtros);
    },
  );
}
