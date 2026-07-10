import type { TipoProducto, UnidadDeMedida } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';

export async function listar(filtros: { tipo?: TipoProducto; activo?: boolean }) {
  return prisma.producto.findMany({
    where: { tipo: filtros.tipo, activo: filtros.activo },
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
export async function cambiarPrecio(productoId: number, monto: number, usuarioId: number) {
  const producto = await prisma.producto.findUnique({ where: { id: productoId } });
  if (!producto) throw Errores.noEncontrado('Producto');

  const precioAnterior = await prisma.precio.findFirst({
    where: { productoId },
    orderBy: { fechaDesde: 'desc' },
  });

  return prisma.$transaction(async (tx) => {
    const precio = await tx.precio.create({
      data: { productoId, monto: new Prisma.Decimal(monto), usuarioId },
    });
    await registrarAuditoria(tx, {
      accion: 'CAMBIO_PRECIO',
      entidad: 'Precio',
      entidadId: precio.id,
      usuarioId,
      datosAnteriores: precioAnterior
        ? { monto: precioAnterior.monto.toString(), fechaDesde: precioAnterior.fechaDesde }
        : null,
      datosNuevos: { productoId, monto: precio.monto.toString(), fechaDesde: precio.fechaDesde },
    });
    return precio;
  });
}

export async function historialPrecios(productoId: number) {
  return prisma.precio.findMany({
    where: { productoId },
    include: { usuario: { select: { username: true } } },
    orderBy: { fechaDesde: 'desc' },
  });
}
