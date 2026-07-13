import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// Datos de ejemplo realistas de pollería. Las fichas técnicas usan valores
// INVENTADOS razonables — el Excel real del cliente aún no llegó (CLAUDE.md §11).

async function main() {
  console.log('Sembrando base de datos...');

  // ── Sucursales (3, CLAUDE.md §3) ──
  const produccion = await prisma.sucursal.upsert({
    where: { nombre: 'Producción Central' },
    update: {},
    create: { nombre: 'Producción Central', tipo: 'PRODUCCION', direccion: 'Depósito central' },
  });
  const local1 = await prisma.sucursal.upsert({
    where: { nombre: 'Local 1' },
    update: {},
    create: { nombre: 'Local 1', tipo: 'VENTA', direccion: 'Sucursal de venta 1' },
  });
  const local2 = await prisma.sucursal.upsert({
    where: { nombre: 'Local 2' },
    update: {},
    create: { nombre: 'Local 2', tipo: 'VENTA', direccion: 'Sucursal de venta 2' },
  });

  // ── Usuarios: uno por rol ──
  // sucursalId: fija de qué local es un CAJERO/ENCARGADO — sin esto no pueden
  // recepcionar ninguna transferencia (validación agregada tras hallazgo de
  // auditoría §5.2: sin sucursal asignada, cualquiera podía recibir mercadería
  // de cualquier local).
  const hash = (pw: string) => bcrypt.hash(pw, 10);
  const usuarios: {
    nombre: string;
    username: string;
    password: string;
    rol: Prisma.UsuarioCreateInput['rol'];
    sucursalId?: number;
  }[] = [
    { nombre: 'Pablo (Admin)', username: 'admin', password: 'admin123', rol: 'ADMINISTRADOR' },
    { nombre: 'Ariel (Socio)', username: 'ariel', password: 'socio123', rol: 'SOCIO' },
    { nombre: 'Eliana (Socia)', username: 'eliana', password: 'socio123', rol: 'SOCIO' },
    { nombre: 'Ema (Socia)', username: 'ema', password: 'socio123', rol: 'SOCIO' },
    { nombre: 'Encargado Local 1', username: 'encargado', password: 'encargado123', rol: 'ENCARGADO', sucursalId: local1.id },
    { nombre: 'Cajero Local 1', username: 'cajero', password: 'cajero123', rol: 'CAJERO', sucursalId: local1.id },
    { nombre: 'Operario Producción', username: 'produccion', password: 'produccion123', rol: 'PRODUCCION' },
  ];
  for (const u of usuarios) {
    await prisma.usuario.upsert({
      where: { username: u.username },
      update: { sucursalId: u.sucursalId ?? null },
      create: {
        nombre: u.nombre,
        username: u.username,
        passwordHash: await hash(u.password),
        rol: u.rol,
        sucursalId: u.sucursalId ?? null,
      },
    });
  }

  // ── Proveedores (~10 + "Otro") ──
  const proveedores = [
    'Distribuidora Avícola del Centro',
    'Granja San José',
    'Frigorífico La Nalga',
    'Huevos Doña Rosa',
    'Panificadora El Molino',
    'Almacén Mayorista Córdoba',
    'Verdulería La Huerta',
    'Aceites y Condimentos SRL',
    'Papas del Sur',
    'Carnes Premium SA',
  ];
  for (const nombre of proveedores) {
    await prisma.proveedor.upsert({ where: { nombre }, update: {}, create: { nombre } });
  }
  await prisma.proveedor.upsert({
    where: { nombre: 'Otro' },
    update: {},
    create: { nombre: 'Otro', esOtro: true },
  });

  // ── Catálogo de productos ──
  type Prod = {
    nombre: string;
    categoria: string;
    tipo: Prisma.ProductoCreateInput['tipo'];
    unidad: Prisma.ProductoCreateInput['unidadDeMedida'];
    precio?: number;
  };
  const productos: Prod[] = [
    // Materias primas
    { nombre: 'Nalga de pollo (kg)', categoria: 'Carnes', tipo: 'MATERIA_PRIMA', unidad: 'KG' },
    { nombre: 'Pechuga de pollo (kg)', categoria: 'Carnes', tipo: 'MATERIA_PRIMA', unidad: 'KG' },
    { nombre: 'Pollo entero fresco', categoria: 'Carnes', tipo: 'MATERIA_PRIMA', unidad: 'UNIDAD' },
    { nombre: 'Carne de ternera (kg)', categoria: 'Carnes', tipo: 'MATERIA_PRIMA', unidad: 'KG' },
    { nombre: 'Pan rallado (kg)', categoria: 'Secos', tipo: 'MATERIA_PRIMA', unidad: 'KG' },
    { nombre: 'Huevo', categoria: 'Frescos', tipo: 'MATERIA_PRIMA', unidad: 'UNIDAD' },
    { nombre: 'Harina (kg)', categoria: 'Secos', tipo: 'MATERIA_PRIMA', unidad: 'KG' },
    { nombre: 'Papa (kg)', categoria: 'Verduras', tipo: 'MATERIA_PRIMA', unidad: 'KG' },
    { nombre: 'Condimento milanesa (kg)', categoria: 'Condimentos', tipo: 'MATERIA_PRIMA', unidad: 'KG' },
    { nombre: 'Aceite (lt)', categoria: 'Aceites', tipo: 'MATERIA_PRIMA', unidad: 'KG' },
    { nombre: 'Pan de lomito', categoria: 'Panificados', tipo: 'MATERIA_PRIMA', unidad: 'UNIDAD' },
    // Elaborados
    { nombre: 'Milanesa de nalga', categoria: 'Milanesas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 2500 },
    { nombre: 'Milanesa de ternera', categoria: 'Milanesas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 3200 },
    { nombre: 'Empanada de pollo', categoria: 'Empanadas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 900 },
    { nombre: 'Pollo a la leña (entero)', categoria: 'Pollos', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 21000 },
    // Reventa
    { nombre: 'Gaseosa 500ml', categoria: 'Bebidas', tipo: 'REVENTA', unidad: 'UNIDAD', precio: 1500 },
  ];

  const adminUser = await prisma.usuario.findUniqueOrThrow({ where: { username: 'admin' } });
  const productosPorNombre = new Map<string, number>();
  for (const p of productos) {
    const creado = await prisma.producto.upsert({
      where: { nombre: p.nombre },
      update: {},
      create: { nombre: p.nombre, categoria: p.categoria, tipo: p.tipo, unidadDeMedida: p.unidad },
    });
    productosPorNombre.set(p.nombre, creado.id);
    if (p.precio !== undefined) {
      const yaTiene = await prisma.precio.findFirst({ where: { productoId: creado.id } });
      if (!yaTiene) {
        await prisma.precio.create({
          data: { productoId: creado.id, monto: new Prisma.Decimal(p.precio), usuarioId: adminUser.id },
        });
      }
    }
  }

  // ── Fichas técnicas de ejemplo (versión 1 activa) ──
  const id = (n: string) => productosPorNombre.get(n)!;

  async function crearFichaSiNoExiste(
    productoElaborado: string,
    version: {
      rendimientoEsperado: number;
      desperdicioEsperadoPct: number;
      umbralDesvioAlertaPct: number;
      ingredientes: { insumo: string; cantidad: number; esPrincipal: boolean }[];
    },
  ) {
    const productoId = id(productoElaborado);
    const existe = await prisma.fichaTecnica.findUnique({ where: { productoElaboradoId: productoId } });
    if (existe) return;
    await prisma.fichaTecnica.create({
      data: {
        productoElaboradoId: productoId,
        versiones: {
          create: {
            numeroVersion: 1,
            activa: true,
            rendimientoEsperado: new Prisma.Decimal(version.rendimientoEsperado),
            desperdicioEsperadoPct: new Prisma.Decimal(version.desperdicioEsperadoPct),
            umbralDesvioAlertaPct: new Prisma.Decimal(version.umbralDesvioAlertaPct),
            ingredientes: {
              create: version.ingredientes.map((ing) => ({
                productoInsumoId: id(ing.insumo),
                cantidadPorUnidadProducida: new Prisma.Decimal(ing.cantidad),
                esPrincipal: ing.esPrincipal,
              })),
            },
          },
        },
      },
    });
  }

  // Milanesa de nalga: ~180g nalga + 50g pan rallado + 0.5 huevo por unidad
  await crearFichaSiNoExiste('Milanesa de nalga', {
    rendimientoEsperado: 5.55, // ~5.55 milanesas por kg de nalga
    desperdicioEsperadoPct: 5,
    umbralDesvioAlertaPct: 10,
    ingredientes: [
      { insumo: 'Nalga de pollo (kg)', cantidad: 0.18, esPrincipal: true },
      { insumo: 'Pan rallado (kg)', cantidad: 0.05, esPrincipal: false },
      { insumo: 'Huevo', cantidad: 0.5, esPrincipal: false },
      { insumo: 'Condimento milanesa (kg)', cantidad: 0.005, esPrincipal: false },
    ],
  });

  // Milanesa de ternera: ~200g ternera + 60g pan rallado + 0.5 huevo
  await crearFichaSiNoExiste('Milanesa de ternera', {
    rendimientoEsperado: 5.0,
    desperdicioEsperadoPct: 6,
    umbralDesvioAlertaPct: 10,
    ingredientes: [
      { insumo: 'Carne de ternera (kg)', cantidad: 0.2, esPrincipal: true },
      { insumo: 'Pan rallado (kg)', cantidad: 0.06, esPrincipal: false },
      { insumo: 'Huevo', cantidad: 0.5, esPrincipal: false },
    ],
  });

  // Empanada de pollo: ~60g pechuga por empanada
  await crearFichaSiNoExiste('Empanada de pollo', {
    rendimientoEsperado: 16.6, // ~16-17 empanadas por kg de pechuga
    desperdicioEsperadoPct: 8,
    umbralDesvioAlertaPct: 12,
    ingredientes: [
      { insumo: 'Pechuga de pollo (kg)', cantidad: 0.06, esPrincipal: true },
      { insumo: 'Harina (kg)', cantidad: 0.04, esPrincipal: false },
      { insumo: 'Huevo', cantidad: 0.1, esPrincipal: false },
    ],
  });

  // Pollo a la leña (entero): 1 pollo entero fresco → 1 pollo a la leña
  // entero (corregido 2026-07-13 al ver la carta real — se vende ENTERO o
  // MEDIO, no "por porción". Producción solo cocina enteros; partir a la
  // mitad es un evento de VENTA, no de producción, y pertenece al circuito
  // especial del pollo del módulo 2 — CLAUDE.md §8 Flujo 4 — no modelado acá)
  await crearFichaSiNoExiste('Pollo a la leña (entero)', {
    rendimientoEsperado: 1, // 1 pollo a la leña entero por pollo entero fresco
    desperdicioEsperadoPct: 8, // pérdida de peso en la cocción
    umbralDesvioAlertaPct: 10,
    ingredientes: [
      { insumo: 'Pollo entero fresco', cantidad: 1, esPrincipal: true },
      { insumo: 'Aceite (lt)', cantidad: 0.02, esPrincipal: false },
    ],
  });

  console.log('Seed completado.');
  console.log('Sucursales:', { produccion: produccion.id, local1: local1.id, local2: local2.id });
  console.log('Usuarios: admin/admin123, produccion/produccion123, cajero/cajero123, ...');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
