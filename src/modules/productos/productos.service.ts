import type { TipoProducto, UnidadDeMedida } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';

const INCLUDE_COMBO = {
  componentesDelCombo: {
    include: { productoComponente: { select: { nombre: true, unidadDeMedida: true } } },
  },
} as const;

export async function listar(filtros: { tipo?: TipoProducto; activo?: boolean }) {
  return prisma.producto.findMany({
    where: { tipo: filtros.tipo, activo: filtros.activo },
    include: INCLUDE_COMBO,
    orderBy: { nombre: 'asc' },
  });
}

export async function crear(
  datos: { nombre: string; categoria: string; tipo: TipoProducto; unidadDeMedida: UnidadDeMedida },
  usuarioId: number,
) {
  return prisma.$transaction(async (tx) => {
    const producto = await tx.producto.create({ data: datos });
    await registrarAuditoria(tx, {
      accion: 'CREAR_PRODUCTO',
      entidad: 'Producto',
      entidadId: producto.id,
      usuarioId,
      datosNuevos: producto,
    });
    return producto;
  });
}

export async function actualizar(
  id: number,
  datos: { nombre?: string; categoria?: string; activo?: boolean },
  usuarioId: number,
) {
  const anterior = await prisma.producto.findUnique({ where: { id } });
  if (!anterior) throw Errores.noEncontrado('Producto');
  // Productos de sistema (ej. "Pollo a la leña (entero) — MARCADO") sostienen
  // un mecanismo interno por nombre/actividad — renombrarlos o desactivarlos
  // rompe ese mecanismo en silencio. Cambiar la categoría sigue permitido.
  if (anterior.esProductoSistema) {
    const tocaNombre = datos.nombre !== undefined && datos.nombre !== anterior.nombre;
    const tocaActivo = datos.activo === false;
    if (tocaNombre || tocaActivo) throw Errores.productoReservadoSistema(anterior.nombre);
  }
  return prisma.$transaction(async (tx) => {
    const producto = await tx.producto.update({ where: { id }, data: datos });
    await registrarAuditoria(tx, {
      accion: 'ACTUALIZAR_PRODUCTO',
      entidad: 'Producto',
      entidadId: id,
      usuarioId,
      datosAnteriores: anterior,
      datosNuevos: producto,
    });
    return producto;
  });
}

// Cambio de precio = registro NUEVO, nunca se pisa (CLAUDE.md §9).
// Auditoría reforzada: anterior + nuevo + quién + cuándo (§8 Flujo 7).
// `cantidad` (default 1): para COMBO permite una tabla de precio por volumen
// no lineal (dato real de la planilla del cliente — ver CLAUDE.md §9 Precio).
export async function cambiarPrecio(productoId: number, monto: number, usuarioId: number, cantidad = 1) {
  const producto = await prisma.producto.findUnique({ where: { id: productoId } });
  if (!producto) throw Errores.noEncontrado('Producto');

  const precioAnterior = await prisma.precio.findFirst({
    where: { productoId, cantidad },
    orderBy: { fechaDesde: 'desc' },
  });

  return prisma.$transaction(async (tx) => {
    const precio = await tx.precio.create({
      data: { productoId, monto: new Prisma.Decimal(monto), cantidad, usuarioId },
    });
    await registrarAuditoria(tx, {
      accion: 'CAMBIO_PRECIO',
      entidad: 'Precio',
      entidadId: precio.id,
      usuarioId,
      datosAnteriores: precioAnterior
        ? { monto: precioAnterior.monto.toString(), cantidad, fechaDesde: precioAnterior.fechaDesde }
        : null,
      datosNuevos: { productoId, monto: precio.monto.toString(), cantidad, fechaDesde: precio.fechaDesde },
    });
    return precio;
  });
}

// Último precio vigente para CADA cantidad que alguna vez tuvo un precio
// cargado (para un producto normal, siempre 1 sola fila con cantidad=1; para
// un COMBO, la tabla completa de precio por volumen: 1, 2, 3...).
export async function tablaPrecioVigente(productoId: number) {
  const historial = await prisma.precio.findMany({
    where: { productoId },
    orderBy: { fechaDesde: 'desc' },
  });
  const vigentePorCantidad = new Map<number, (typeof historial)[number]>();
  for (const p of historial) {
    if (!vigentePorCantidad.has(p.cantidad)) vigentePorCantidad.set(p.cantidad, p);
  }
  return [...vigentePorCantidad.values()].sort((a, b) => a.cantidad - b.cantidad);
}

// Versión bulk para el POS (una sola request en vez de una por producto):
// tabla vigente de TODOS los productos que tengan algún precio cargado.
export async function tablasPrecioVigentes() {
  const historial = await prisma.precio.findMany({ orderBy: { fechaDesde: 'desc' } });
  const vigentePorProductoYCantidad = new Map<string, (typeof historial)[number]>();
  for (const p of historial) {
    const clave = `${p.productoId}:${p.cantidad}`;
    if (!vigentePorProductoYCantidad.has(clave)) vigentePorProductoYCantidad.set(clave, p);
  }
  const porProducto = new Map<number, (typeof historial)[number][]>();
  for (const p of vigentePorProductoYCantidad.values()) {
    const lista = porProducto.get(p.productoId) ?? [];
    lista.push(p);
    porProducto.set(p.productoId, lista);
  }
  return [...porProducto.entries()].map(([productoId, precios]) => ({
    productoId,
    precios: precios.sort((a, b) => a.cantidad - b.cantidad),
  }));
}

export async function historialPrecios(productoId: number) {
  return prisma.precio.findMany({
    where: { productoId },
    include: { usuario: { select: { username: true } } },
    orderBy: { fechaDesde: 'desc' },
  });
}

export interface ComponenteComboInput {
  productoComponenteId: number;
  cantidad: number;
}

// Un combo no tiene stock propio ni receta con desperdicio (CLAUDE.md §9):
// es un bundle de otros productos a un precio propio. Sin versionado tampoco
// — a diferencia de las fichas técnicas, no hay lotes históricos que deban
// "congelar" una composición pasada (el módulo de ventas, cuando exista,
// registra qué se vendió línea por línea en su propio pedido).
async function validarComponentesCombo(componentes: ComponenteComboInput[]) {
  if (componentes.length === 0) {
    throw Errores.validacion('El combo debe tener al menos un componente');
  }
  const productos = await prisma.producto.findMany({
    where: { id: { in: componentes.map((c) => c.productoComponenteId) } },
  });
  const porId = new Map(productos.map((p) => [p.id, p]));
  for (const c of componentes) {
    const producto = porId.get(c.productoComponenteId);
    if (!producto) throw Errores.noEncontrado(`Producto ${c.productoComponenteId}`);
    if (producto.tipo === 'COMBO') {
      throw Errores.validacion(`"${producto.nombre}" es un combo — no se permiten combos anidados`);
    }
  }
}

export async function crearCombo(
  datos: { nombre: string; categoria: string; componentes: ComponenteComboInput[] },
  usuarioId: number,
) {
  await validarComponentesCombo(datos.componentes);
  return prisma.$transaction(async (tx) => {
    const combo = await tx.producto.create({
      data: {
        nombre: datos.nombre,
        categoria: datos.categoria,
        tipo: 'COMBO',
        unidadDeMedida: 'UNIDAD',
        componentesDelCombo: {
          create: datos.componentes.map((c) => ({
            productoComponenteId: c.productoComponenteId,
            cantidad: new Prisma.Decimal(c.cantidad),
          })),
        },
      },
      include: INCLUDE_COMBO,
    });
    await registrarAuditoria(tx, {
      accion: 'CREAR_COMBO',
      entidad: 'Producto',
      entidadId: combo.id,
      usuarioId,
      datosNuevos: { nombre: datos.nombre, categoria: datos.categoria, componentes: datos.componentes },
    });
    return combo;
  });
}

// Reemplaza la composición completa del combo (borra + crea de nuevo). No
// versiona: ver nota arriba sobre por qué un combo no lo necesita.
export async function actualizarComponentesCombo(
  comboId: number,
  componentes: ComponenteComboInput[],
  usuarioId: number,
) {
  const combo = await prisma.producto.findUnique({
    where: { id: comboId },
    include: INCLUDE_COMBO,
  });
  if (!combo) throw Errores.noEncontrado('Combo');
  if (combo.tipo !== 'COMBO') throw Errores.validacion(`"${combo.nombre}" no es un combo`);
  await validarComponentesCombo(componentes);

  return prisma.$transaction(async (tx) => {
    await tx.comboComponente.deleteMany({ where: { comboId } });
    await tx.comboComponente.createMany({
      data: componentes.map((c) => ({
        comboId,
        productoComponenteId: c.productoComponenteId,
        cantidad: new Prisma.Decimal(c.cantidad),
      })),
    });
    await registrarAuditoria(tx, {
      accion: 'ACTUALIZAR_COMPONENTES_COMBO',
      entidad: 'Producto',
      entidadId: comboId,
      usuarioId,
      datosAnteriores: {
        componentes: combo.componentesDelCombo.map((c) => ({
          productoComponenteId: c.productoComponenteId,
          cantidad: c.cantidad.toString(),
        })),
      },
      datosNuevos: { componentes },
    });
    return tx.producto.findUniqueOrThrow({ where: { id: comboId }, include: INCLUDE_COMBO });
  });
}
