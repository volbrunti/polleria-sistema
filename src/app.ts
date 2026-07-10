import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import authPlugin from './plugins/auth';
import { AppError } from './lib/errores';
import { authRoutes } from './modules/auth/auth.routes';
import { usuariosRoutes } from './modules/usuarios/usuarios.routes';
import { productosRoutes } from './modules/productos/productos.routes';
import { proveedoresRoutes } from './modules/proveedores/proveedores.routes';
import { sucursalesRoutes } from './modules/sucursales/sucursales.routes';
import { stockRoutes } from './modules/stock/stock.routes';
import { ingresosRoutes } from './modules/ingresos/ingresos.routes';
import { fichasRoutes } from './modules/fichas-tecnicas/fichas.routes';
import { produccionRoutes } from './modules/produccion/produccion.routes';
import { transferenciasRoutes } from './modules/transferencias/transferencias.routes';
import { auditoriaRoutes } from './modules/auditoria/auditoria.routes';
import { alertasRoutes } from './modules/alertas/alertas.routes';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await app.register(authPlugin);

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ codigo: error.codigo, mensaje: error.message });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        codigo: 'VALIDACION',
        mensaje: 'Datos de entrada inválidos',
        detalles: error.issues.map((i) => ({ campo: i.path.join('.'), error: i.message })),
      });
    }
    app.log.error(error);
    return reply.code(500).send({ codigo: 'ERROR_INTERNO', mensaje: 'Error interno del servidor' });
  });

  app.get('/api/salud', async () => ({ ok: true }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(usuariosRoutes, { prefix: '/api/usuarios' });
  await app.register(productosRoutes, { prefix: '/api/productos' });
  await app.register(proveedoresRoutes, { prefix: '/api/proveedores' });
  await app.register(sucursalesRoutes, { prefix: '/api/sucursales' });
  await app.register(stockRoutes, { prefix: '/api/stock' });
  await app.register(ingresosRoutes, { prefix: '/api/ingresos' });
  await app.register(fichasRoutes, { prefix: '/api/fichas-tecnicas' });
  await app.register(produccionRoutes, { prefix: '/api/produccion' });
  await app.register(transferenciasRoutes, { prefix: '/api/transferencias' });
  await app.register(auditoriaRoutes, { prefix: '/api/auditoria' });
  await app.register(alertasRoutes, { prefix: '/api/alertas' });

  return app;
}
