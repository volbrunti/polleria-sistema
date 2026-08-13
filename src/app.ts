import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import authPlugin from './plugins/auth';
import { config } from './config';
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
import { turnosRoutes, clavesEmergenciaRoutes } from './modules/turnos/turnos.routes';
import { pedidosRoutes } from './modules/pedidos/pedidos.routes';
import { cajaRoutes } from './modules/caja/caja.routes';
import { stockMinimoRoutes } from './modules/stock-minimo/stock-minimo.routes';
import { recargosRoutes } from './modules/recargos/recargos.routes';
import { configuracionRoutes } from './modules/configuracion/configuracion.routes';
import { comanderasRoutes } from './modules/comanderas/comanderas.routes';
import { reportesRoutes } from './modules/reportes/reportes.routes';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  });

  // origin sale de config: lista blanca en producción, reflejo libre en dev.
  // Ver config.ts — con credentials:true, reflejar cualquier origen sería
  // dejar que cualquier sitio use la cookie de refresh del usuario.
  await app.register(cors, { origin: config.origenesPermitidos, credentials: true });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  // Fotos de remito: si R2 está configurado (obligatorio en producción, ver
  // config.ts) las URLs apuntan directo al bucket público y esto no hace
  // falta. Si no, es el fallback de disco local para desarrollar sin
  // credenciales — se sirven como /uploads/remitos/<archivo>.
  if (!config.r2.configurado) {
    const raizUploads = path.resolve(process.cwd(), config.dirUploads);
    // @fastify/static explota si el root no existe todavía — en un
    // contenedor recién creado la carpeta no está hasta la primera foto.
    fs.mkdirSync(raizUploads, { recursive: true });
    await app.register(fastifyStatic, { root: raizUploads, prefix: '/uploads/' });
  }
  await app.register(authPlugin);

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      // El detalle técnico se loguea pero NO se manda: el operario lee `message`.
      if (error.detalleTecnico) app.log.error({ codigo: error.codigo }, error.detalleTecnico);
      return reply.code(error.statusCode).send({ codigo: error.codigo, mensaje: error.message });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        codigo: 'VALIDACION',
        mensaje: 'Datos de entrada inválidos',
        detalles: error.issues.map((i) => ({ campo: i.path.join('.'), error: i.message })),
      });
    }
    // Errores de Prisma que son casos de negocio corrientes, no fallas del
    // sistema. Sin esto caían al 500 genérico: cargar un producto con un nombre
    // que ya existe le respondía "Error interno del servidor" al administrador,
    // que se iba a buscar un problema inexistente (auditoría 2026-08-07, E-1).
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const campos = (error.meta?.target as string[] | undefined)?.join(', ');
        return reply.code(409).send({
          codigo: 'YA_EXISTE',
          mensaje: campos ? `Ya existe un registro con ese ${campos}` : 'Ese registro ya existe',
        });
      }
      if (error.code === 'P2025') {
        return reply.code(404).send({ codigo: 'NO_ENCONTRADO', mensaje: 'No se encontró el registro' });
      }
      if (error.code === 'P2003') {
        return reply.code(409).send({
          codigo: 'EN_USO',
          mensaje: 'El registro está referenciado por otros datos y no puede modificarse ni borrarse',
        });
      }
    }
    // Neon suspende el compute cuando no hay actividad; el primer request
    // después puede no encontrar la base. Es temporal y se resuelve solo:
    // conviene decirlo así en vez de mandar un 500 que parece definitivo.
    if (
      error instanceof Prisma.PrismaClientInitializationError ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P1001')
    ) {
      app.log.error(error);
      return reply.code(503).send({
        codigo: 'BASE_NO_DISPONIBLE',
        mensaje: 'La base de datos no responde en este momento. Reintentá en unos segundos.',
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
  // Módulo 2
  await app.register(turnosRoutes, { prefix: '/api/turnos' });
  await app.register(clavesEmergenciaRoutes, { prefix: '/api/claves-emergencia' });
  await app.register(pedidosRoutes, { prefix: '/api/pedidos' });
  // atenciones, gastos-caja, retiros-caja, marcado-pollos, costo-cero
  await app.register(cajaRoutes, { prefix: '/api' });
  await app.register(stockMinimoRoutes, { prefix: '/api/config-stock-minimo' });
  await app.register(recargosRoutes, { prefix: '/api/recargos-tarjeta' });
  await app.register(configuracionRoutes, { prefix: '/api/configuracion' });
  await app.register(comanderasRoutes, { prefix: '/api/configuracion-comandera' });
  // Módulo 3
  await app.register(reportesRoutes, { prefix: '/api/reportes' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' });

  return app;
}
