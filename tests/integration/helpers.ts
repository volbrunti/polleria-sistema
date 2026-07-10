import 'dotenv/config';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';

// Los tests de integración usan DATABASE_URL_TEST si existe; si no, DATABASE_URL.
// GUARDA DE SEGURIDAD: el nombre de la base debe contener "test" — evita
// truncar la base de desarrollo por accidente.
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

export function validarDbDeTest() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/test/i.test(url)) {
    throw new Error(
      'Los tests de integración requieren una DB cuyo nombre contenga "test". ' +
        'Configurá DATABASE_URL_TEST (ej: postgresql://.../polleria_test) en .env',
    );
  }
}

// Imports dinámicos: la URL de la DB ya quedó pisada antes de instanciar Prisma
export async function getPrisma() {
  const { prisma } = await import('../../src/lib/prisma');
  return prisma;
}

export async function getApp(): Promise<FastifyInstance> {
  const { buildApp } = await import('../../src/app');
  return buildApp();
}

// Limpia TODAS las tablas del schema (respetando FKs vía CASCADE)
export async function limpiarDb() {
  const prisma = await getPrisma();
  const tablas: { tablename: string }[] = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  if (tablas.length === 0) return;
  const lista = tablas.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${lista} RESTART IDENTITY CASCADE`);
}

export interface Fixtures {
  sucursales: { produccion: number; local1: number; local2: number };
  usuarios: Record<'admin' | 'socio' | 'encargado' | 'cajero' | 'produccion', { id: number; token: string }>;
  productos: { nalga: number; panRallado: number; huevo: number; milanesa: number };
  proveedores: { normal: number; otro: number };
  fichaMilanesa: { fichaId: number; versionId: number };
}

// Fixtures mínimos para los flujos del módulo 1
export async function sembrarFixtures(): Promise<Fixtures> {
  const prisma = await getPrisma();
  const { firmarAccessToken } = await import('../../src/plugins/auth');

  const produccion = await prisma.sucursal.create({
    data: { nombre: 'Producción Central', tipo: 'PRODUCCION' },
  });
  const local1 = await prisma.sucursal.create({ data: { nombre: 'Local 1', tipo: 'VENTA' } });
  const local2 = await prisma.sucursal.create({ data: { nombre: 'Local 2', tipo: 'VENTA' } });

  const passwordHash = await bcrypt.hash('clave123', 4); // costo bajo: solo tests
  const roles = [
    ['admin', 'ADMINISTRADOR'],
    ['socio', 'SOCIO'],
    ['encargado', 'ENCARGADO'],
    ['cajero', 'CAJERO'],
    ['produccion', 'PRODUCCION'],
  ] as const;

  const usuarios = {} as Fixtures['usuarios'];
  for (const [username, rol] of roles) {
    const u = await prisma.usuario.create({
      data: { nombre: username, username, passwordHash, rol },
    });
    usuarios[username] = { id: u.id, token: firmarAccessToken({ id: u.id, username, rol }) };
  }

  const nalga = await prisma.producto.create({
    data: { nombre: 'Nalga de pollo (kg)', categoria: 'Carnes', tipo: 'MATERIA_PRIMA', unidadDeMedida: 'KG' },
  });
  const panRallado = await prisma.producto.create({
    data: { nombre: 'Pan rallado (kg)', categoria: 'Secos', tipo: 'MATERIA_PRIMA', unidadDeMedida: 'KG' },
  });
  const huevo = await prisma.producto.create({
    data: { nombre: 'Huevo', categoria: 'Frescos', tipo: 'MATERIA_PRIMA', unidadDeMedida: 'UNIDAD' },
  });
  const milanesa = await prisma.producto.create({
    data: { nombre: 'Milanesa de nalga', categoria: 'Milanesas', tipo: 'ELABORADO', unidadDeMedida: 'UNIDAD' },
  });

  const proveedorNormal = await prisma.proveedor.create({ data: { nombre: 'Granja San José' } });
  const proveedorOtro = await prisma.proveedor.create({ data: { nombre: 'Otro', esOtro: true } });

  // Ficha: 0.18 kg nalga (principal) + 0.05 kg pan + 0.5 huevo por milanesa,
  // 5% desperdicio esperado, umbral de alerta 10%
  const ficha = await prisma.fichaTecnica.create({
    data: {
      productoElaboradoId: milanesa.id,
      versiones: {
        create: {
          numeroVersion: 1,
          activa: true,
          rendimientoEsperado: 5.55,
          desperdicioEsperadoPct: 5,
          umbralDesvioAlertaPct: 10,
          ingredientes: {
            create: [
              { productoInsumoId: nalga.id, cantidadPorUnidadProducida: 0.18, esPrincipal: true },
              { productoInsumoId: panRallado.id, cantidadPorUnidadProducida: 0.05, esPrincipal: false },
              { productoInsumoId: huevo.id, cantidadPorUnidadProducida: 0.5, esPrincipal: false },
            ],
          },
        },
      },
    },
    include: { versiones: true },
  });

  return {
    sucursales: { produccion: produccion.id, local1: local1.id, local2: local2.id },
    usuarios,
    productos: { nalga: nalga.id, panRallado: panRallado.id, huevo: huevo.id, milanesa: milanesa.id },
    proveedores: { normal: proveedorNormal.id, otro: proveedorOtro.id },
    fichaMilanesa: { fichaId: ficha.id, versionId: ficha.versiones[0]!.id },
  };
}

export function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

// Stock actual vía suma de movimientos (fuente de verdad)
export async function stockDe(productoId: number, sucursalId: number): Promise<number> {
  const prisma = await getPrisma();
  const agg = await prisma.movimientoStock.aggregate({
    where: { productoId, sucursalId },
    _sum: { cantidad: true },
  });
  return agg._sum.cantidad?.toNumber() ?? 0;
}
