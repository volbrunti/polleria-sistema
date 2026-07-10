import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as ingresosService from './ingresos.service';

// Validación Flujo 1: proveedor obligatorio, al menos una línea, cantidades > 0
const registrarSchema = z.object({
  proveedorId: z.number().int().positive(),
  comentarioProveedorOtro: z.string().optional(),
  fotoRemitoUrl: z.string().optional(),
  lineas: z
    .array(
      z.object({
        productoId: z.number().int().positive(),
        cantidadSegunRemito: z.number().positive(),
        cantidadRealPesada: z.number().positive(),
      }),
    )
    .min(1, 'El ingreso debe tener al menos una línea'),
});

const listarQuery = z.object({
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  proveedorId: z.coerce.number().int().positive().optional(),
});

const lineasQuery = z.object({ productoId: z.coerce.number().int().positive() });

const DIR_UPLOADS = path.resolve(process.cwd(), 'uploads', 'remitos');

export async function ingresosRoutes(app: FastifyInstance) {
  // Carga de ingresos: PRODUCCION (y ADMIN)
  app.post(
    '/',
    { preHandler: [app.autenticar, app.requerirRoles('PRODUCCION', 'ADMINISTRADOR')] },
    async (req, reply) => {
      const datos = registrarSchema.parse(req.body);
      const ingreso = await ingresosService.registrarIngreso({ ...datos, usuarioId: req.usuario.id });
      return reply.code(201).send(ingreso);
    },
  );

  // Foto del remito: multipart, solo respaldo visual (el sistema NO la procesa)
  app.post(
    '/foto',
    { preHandler: [app.autenticar, app.requerirRoles('PRODUCCION', 'ADMINISTRADOR')] },
    async (req, reply) => {
      const archivo = await req.file();
      if (!archivo) return reply.code(400).send({ codigo: 'VALIDACION', mensaje: 'Falta el archivo' });
      const extension = path.extname(archivo.filename) || '.jpg';
      const nombre = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`;
      fs.mkdirSync(DIR_UPLOADS, { recursive: true });
      const destino = path.join(DIR_UPLOADS, nombre);
      await fs.promises.writeFile(destino, await archivo.toBuffer());
      return reply.code(201).send({ fotoRemitoUrl: `/uploads/remitos/${nombre}` });
    },
  );

  app.get(
    '/',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'SOCIO', 'PRODUCCION', 'ENCARGADO')] },
    async (req) => {
      const filtros = listarQuery.parse(req.query);
      return ingresosService.listar(filtros);
    },
  );

  // Líneas de ingreso con restante > 0 para un producto (selección de lote en producción)
  app.get(
    '/lineas-disponibles',
    { preHandler: [app.autenticar, app.requerirRoles('ADMINISTRADOR', 'PRODUCCION')] },
    async (req) => {
      const { productoId } = lineasQuery.parse(req.query);
      return ingresosService.lineasDisponibles(productoId);
    },
  );
}
