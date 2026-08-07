import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as configuracionService from './configuracion.service';

const paramsClave = z.object({ clave: z.string().min(1) });
const actualizarSchema = z.object({ valor: z.string().min(1) });

export async function configuracionRoutes(app: FastifyInstance) {
  // Lectura: la necesita el POS para mostrar el descuento antes de confirmar.
  // No hay nada ciego acá — el empleado ve el descuento en su ticket.
  app.get(
    '/',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'SOCIO', 'ENCARGADO', 'CAJERO')] },
    async () => configuracionService.listar(),
  );

  app.patch(
    '/:clave',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR')] },
    async (req) => {
      const { clave } = paramsClave.parse(req.params);
      const { valor } = actualizarSchema.parse(req.body);
      return configuracionService.actualizar(clave, valor, req.usuario.id);
    },
  );
}
