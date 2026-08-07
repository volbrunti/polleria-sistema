import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as ingresosService from './ingresos.service';
import { config } from '../../config';
import { subirAR2 } from '../../lib/almacenamiento';

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

// Sin productoId devuelve toda la materia prima con saldo (panel de Producción)
const lineasQuery = z.object({ productoId: z.coerce.number().int().positive().optional() });

const DIR_UPLOADS = path.resolve(process.cwd(), config.dirUploads, 'remitos');

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

  // Foto del remito: multipart, solo respaldo visual (el sistema NO la procesa).
  // Va a R2 si está configurado (obligatorio en producción, ver config.ts);
  // si no, cae a disco local — fallback solo para desarrollar sin credenciales.
  app.post(
    '/foto',
    { preHandler: [app.autenticar, app.requerirRoles('PRODUCCION', 'ADMINISTRADOR')] },
    async (req, reply) => {
      const archivo = await req.file();
      if (!archivo) return reply.code(400).send({ codigo: 'VALIDACION', mensaje: 'Falta el archivo' });
      const extension = path.extname(archivo.filename) || '.jpg';
      const nombre = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`;
      const buffer = await archivo.toBuffer();

      if (config.r2.configurado) {
        const url = await subirAR2({
          buffer,
          nombreArchivo: nombre,
          contentType: archivo.mimetype || 'application/octet-stream',
        });
        return reply.code(201).send({ fotoRemitoUrl: url });
      }

      fs.mkdirSync(DIR_UPLOADS, { recursive: true });
      const destino = path.join(DIR_UPLOADS, nombre);
      await fs.promises.writeFile(destino, buffer);
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
