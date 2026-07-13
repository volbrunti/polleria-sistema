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
    { nombre: 'Empanada de pollo', categoria: 'Empanadas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 1600 },
    { nombre: 'Empanada de carne', categoria: 'Empanadas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 1600 },
    { nombre: 'Pollo a la leña (entero)', categoria: 'Pollos', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 21000 },
    // Pollo a la leña (medio): SIN ficha técnica — partir un pollo entero
    // cocido es un evento de VENTA (circuito especial del pollo, módulo 2),
    // no de producción. Existe como producto solo para poder facturarlo.
    { nombre: 'Pollo a la leña (medio)', categoria: 'Pollos', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 12000 },
    // Papas, ensaladas, milas de plato, lomitos, hamburguesas, adicionales:
    // cargados desde la planilla real del cliente (2026-07-13) — sin ficha
    // técnica, son platos armados en el local, no producidos centralmente.
    { nombre: 'Papas fritas grande', categoria: 'Papas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 9000 },
    { nombre: 'Papas fritas mediana', categoria: 'Papas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 7000 },
    { nombre: 'Papas fritas conito', categoria: 'Papas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 3000 },
    { nombre: 'Ensalada Especial', categoria: 'Ensaladas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 5000 },
    { nombre: 'Ensalada Común', categoria: 'Ensaladas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 5000 },
    { nombre: 'Ensalada Rusa', categoria: 'Ensaladas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 5000 },
    { nombre: 'Sandwich mila simple', categoria: 'Milanesas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 14000 },
    { nombre: 'Sandwich mila completo', categoria: 'Milanesas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 16000 },
    { nombre: 'Milanesa con papas fritas', categoria: 'Milanesas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 13500 },
    { nombre: 'Milanesa napolitana', categoria: 'Milanesas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 14000 },
    { nombre: 'Bife de Lomo', categoria: 'Lomitos', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 17000 },
    { nombre: 'Bife de Pollo', categoria: 'Lomitos', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 14500 },
    { nombre: 'Hamburlomo', categoria: 'Lomitos', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 14500 },
    // Burgers: la planilla no distingue Classic/Intense/Luxury en su tabla de
    // precios (una sola columna Simple/Doble/Triple) — se aplicó el mismo
    // precio a las 3 líneas por igual. Supuesto a confirmar con el cliente
    // (ver CLAUDE.md §11): puede que en la práctica sí cobren distinto.
    { nombre: 'Classic Burger simple', categoria: 'Hamburguesas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 10500 },
    { nombre: 'Classic Burger doble', categoria: 'Hamburguesas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 12000 },
    { nombre: 'Classic Burger triple', categoria: 'Hamburguesas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 14000 },
    { nombre: 'Intense Burger simple', categoria: 'Hamburguesas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 10500 },
    { nombre: 'Intense Burger doble', categoria: 'Hamburguesas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 12000 },
    { nombre: 'Intense Burger triple', categoria: 'Hamburguesas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 14000 },
    { nombre: 'Luxury Burger simple', categoria: 'Hamburguesas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 10500 },
    { nombre: 'Luxury Burger doble', categoria: 'Hamburguesas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 12000 },
    { nombre: 'Luxury Burger triple', categoria: 'Hamburguesas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 14000 },
    { nombre: 'Topping extra (hamburguesa)', categoria: 'Adicionales', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 1000 },
    { nombre: 'Mayo casera (vasito)', categoria: 'Adicionales', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 500 },
    { nombre: 'Aderezo extra (vasito)', categoria: 'Adicionales', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 500 },
    { nombre: 'Pan casero', categoria: 'Panificados', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 1500 },
    { nombre: 'Escabeche de pollo', categoria: 'Escabeches', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 6000 },
    { nombre: 'Postre', categoria: 'Postres', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 1500 },
    // Sorrentinos y tartas: no están en la planilla de referencias (probable
    // incorporación posterior a la carta) — precio tomado del cartel.
    { nombre: 'Sorrentino Bondiola braseada', categoria: 'Sorrentinos', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 8000 },
    { nombre: 'Sorrentino Espinaca, mozzarella y parmesano', categoria: 'Sorrentinos', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 6000 },
    { nombre: 'Sorrentino Jamón y mozzarella', categoria: 'Sorrentinos', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 6000 },
    { nombre: 'Sorrentino Capresse', categoria: 'Sorrentinos', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 6000 },
    { nombre: 'Tarta Espinaca y mozzarella', categoria: 'Tartas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 7500 },
    { nombre: 'Tarta Jamón y mozzarella', categoria: 'Tartas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 7500 },
    { nombre: 'Tarta Pollo y calabaza', categoria: 'Tartas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 7500 },
    { nombre: 'Tarta Queso azul y cebolla caramelizada', categoria: 'Tartas', tipo: 'ELABORADO', unidad: 'UNIDAD', precio: 7500 },
    // Reventa
    { nombre: 'Gaseosa 500ml', categoria: 'Bebidas', tipo: 'REVENTA', unidad: 'UNIDAD', precio: 1500 },
  ];

  const adminUser = await prisma.usuario.findUniqueOrThrow({ where: { username: 'admin' } });

  // Corrección puntual: "Empanada de carne" había quedado creada con
  // categoría " Empanadas" (espacio inicial) en una sesión anterior.
  await prisma.producto.updateMany({
    where: { nombre: 'Empanada de carne' },
    data: { categoria: 'Empanadas' },
  });

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

  // ── Precio por cantidad (tabla de volumen real de la planilla del cliente,
  // "REFERENCIAS", 2026-07-13) — ver CLAUDE.md §9. No es lineal: pedir 2 casi
  // siempre sale menos que 2× el precio de 1. Nunca se pisa: si el monto
  // vigente para esa cantidad ya coincide, no crea un registro duplicado.
  async function asegurarPrecio(nombreProducto: string, cantidad: number, monto: number) {
    const productoId = productosPorNombre.get(nombreProducto);
    if (!productoId) throw new Error(`Producto "${nombreProducto}" no existe — ¿falta en el catálogo?`);
    const vigente = await prisma.precio.findFirst({
      where: { productoId, cantidad },
      orderBy: { fechaDesde: 'desc' },
    });
    if (vigente && vigente.monto.equals(new Prisma.Decimal(monto))) return;
    await prisma.precio.create({
      data: { productoId, cantidad, monto: new Prisma.Decimal(monto), usuarioId: adminUser.id },
    });
  }

  async function asegurarTablaPrecio(nombreProducto: string, tiers: [cantidad: number, monto: number][]) {
    for (const [cantidad, monto] of tiers) {
      await asegurarPrecio(nombreProducto, cantidad, monto);
    }
  }

  await asegurarTablaPrecio('Pollo a la leña (entero)', [
    [1, 21000], [2, 42000], [3, 63000], [4, 84000], [5, 105000],
  ]);
  await asegurarTablaPrecio('Pollo a la leña (medio)', [
    [1, 12000], [2, 24000], [3, 36000], [4, 48000], [5, 60000],
  ]);
  await asegurarTablaPrecio('Papas fritas grande', [
    [1, 9000], [2, 18000], [3, 27000], [4, 36000], [5, 45000],
  ]);
  await asegurarTablaPrecio('Papas fritas mediana', [
    [1, 7000], [2, 14000], [3, 21000], [4, 28000], [5, 35000],
  ]);
  await asegurarTablaPrecio('Papas fritas conito', [
    [1, 3000], [2, 6000], [3, 9000], [4, 12000], [5, 15000],
  ]);
  // La planilla trackea una sola categoría "ENSAL." — se aplica el mismo
  // precio a las 3 variedades del cartel (Especial/Común/Rusa).
  for (const ensalada of ['Ensalada Especial', 'Ensalada Común', 'Ensalada Rusa']) {
    await asegurarTablaPrecio(ensalada, [[1, 5000], [2, 10000], [3, 15000], [4, 20000], [5, 25000]]);
  }
  await asegurarTablaPrecio('Sandwich mila simple', [
    [1, 14000], [2, 28000], [3, 42000], [4, 56000], [5, 70000],
  ]);
  await asegurarTablaPrecio('Sandwich mila completo', [
    [1, 16000], [2, 31000], [3, 47000], [4, 62000], [5, 78000],
  ]);
  await asegurarTablaPrecio('Milanesa con papas fritas', [
    [1, 13500], [2, 27000], [3, 40500], [4, 54000], [5, 67500],
  ]);
  await asegurarTablaPrecio('Milanesa napolitana', [
    [1, 14000], [2, 28000], [3, 42000], [4, 56000], [5, 70000],
  ]);
  await asegurarTablaPrecio('Bife de Lomo', [
    [1, 17000], [2, 33000], [3, 50000], [4, 66000], [5, 83000],
  ]);
  await asegurarTablaPrecio('Bife de Pollo', [
    [1, 14500], [2, 28000], [3, 42500], [4, 56000], [5, 70500],
  ]);
  await asegurarTablaPrecio('Hamburlomo', [
    [1, 14500], [2, 28000], [3, 42500], [4, 56000], [5, 70500],
  ]);
  // Ver nota de arriba: la planilla no distingue Classic/Intense/Luxury, se
  // aplica la misma tabla a las 3 líneas de hamburguesas.
  for (const marca of ['Classic', 'Intense', 'Luxury']) {
    await asegurarTablaPrecio(`${marca} Burger simple`, [[1, 10500], [2, 20000], [3, 30500], [4, 40000], [5, 50500]]);
    await asegurarTablaPrecio(`${marca} Burger doble`, [[1, 12000], [2, 23000], [3, 35000], [4, 46000], [5, 58000]]);
    await asegurarTablaPrecio(`${marca} Burger triple`, [[1, 14000], [2, 27000], [3, 41000], [4, 54000], [5, 68000]]);
  }
  await asegurarTablaPrecio('Topping extra (hamburguesa)', [
    [1, 1000], [2, 2000], [3, 3000], [4, 4000], [5, 5000],
  ]);
  await asegurarTablaPrecio('Mayo casera (vasito)', [[1, 500], [2, 1000], [3, 1500], [4, 2000], [5, 2500]]);
  await asegurarTablaPrecio('Aderezo extra (vasito)', [[1, 500], [2, 1000], [3, 1500], [4, 2000], [5, 2500]]);
  await asegurarTablaPrecio('Pan casero', [[1, 1500], [2, 3000], [3, 4500], [4, 6000], [5, 7500]]);
  await asegurarTablaPrecio('Escabeche de pollo', [[1, 6000], [2, 12000], [3, 18000], [4, 24000], [5, 30000]]);
  await asegurarTablaPrecio('Postre', [[1, 1500], [2, 3000], [3, 4500], [4, 6000], [5, 7500]]);
  // Empanadas: 1-5 unidades es exactamente lineal (×1.600), de 6 en adelante
  // ya hay descuento por volumen — igual para ambos sabores (la planilla
  // no distingue de pollo/de carne en su tabla de precios).
  const tablaEmpanadas: [number, number][] = [
    [1, 1600], [2, 3200], [3, 4800], [4, 6400], [5, 8000], [6, 8500], [7, 10100],
    [8, 11700], [9, 13300], [10, 14900], [12, 16000], [18, 24500], [24, 32000], [30, 40500], [36, 48000],
  ];
  await asegurarTablaPrecio('Empanada de pollo', tablaEmpanadas);
  await asegurarTablaPrecio('Empanada de carne', tablaEmpanadas);

  // ── Combos de pollo (bundle real, con tabla de precio por volumen) ──
  async function asegurarCombo(
    nombre: string,
    categoria: string,
    componentes: { producto: string; cantidad: number }[],
    tiers: [cantidad: number, monto: number][],
  ) {
    let combo = await prisma.producto.findUnique({ where: { nombre } });
    if (!combo) {
      combo = await prisma.producto.create({
        data: {
          nombre,
          categoria,
          tipo: 'COMBO',
          unidadDeMedida: 'UNIDAD',
          componentesDelCombo: {
            create: componentes.map((c) => ({
              productoComponenteId: productosPorNombre.get(c.producto)!,
              cantidad: new Prisma.Decimal(c.cantidad),
            })),
          },
        },
      });
    }
    productosPorNombre.set(nombre, combo.id);
    for (const [cantidad, monto] of tiers) {
      await asegurarPrecio(nombre, cantidad, monto);
    }
  }

  await asegurarCombo(
    'Pollo c/Fritas Grandes',
    'Combos Pollo',
    [{ producto: 'Pollo a la leña (entero)', cantidad: 1 }, { producto: 'Papas fritas grande', cantidad: 1 }],
    [[1, 29000], [2, 56000], [3, 85000], [4, 112000], [5, 141000]],
  );
  await asegurarCombo(
    'Pollo c/Fritas Medianas',
    'Combos Pollo',
    [{ producto: 'Pollo a la leña (entero)', cantidad: 1 }, { producto: 'Papas fritas mediana', cantidad: 1 }],
    [[1, 27000], [2, 54000], [3, 81000], [4, 108000], [5, 135000]],
  );
  await asegurarCombo(
    '1/2 Pollo c/Fritas Medianas',
    'Combos Pollo',
    [{ producto: 'Pollo a la leña (medio)', cantidad: 1 }, { producto: 'Papas fritas mediana', cantidad: 1 }],
    [[1, 17000], [2, 34000], [3, 51000], [4, 68000], [5, 85000]],
  );
  await asegurarCombo(
    '1/2 Pollo c/Fritas Grandes',
    'Combos Pollo',
    [{ producto: 'Pollo a la leña (medio)', cantidad: 1 }, { producto: 'Papas fritas grande', cantidad: 1 }],
    [[1, 19000], [2, 38000], [3, 57000], [4, 76000], [5, 95000]],
  );

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
