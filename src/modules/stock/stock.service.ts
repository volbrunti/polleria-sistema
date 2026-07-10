import { Prisma } from '@prisma/client';
import { prisma, type TxClient } from '../../lib/prisma';
import { Errores } from '../../lib/errores';

// Fuente de verdad: SUM(MovimientoStock.cantidad) por producto+sucursal (CLAUDE.md §9)
export async function obtenerStock(
  productoId: number,
  sucursalId: number,
  tx: TxClient = prisma,
): Promise<Prisma.Decimal> {
  const agregado = await tx.movimientoStock.aggregate({
    where: { productoId, sucursalId },
    _sum: { cantidad: true },
  });
  return agregado._sum.cantidad ?? new Prisma.Decimal(0);
}

// Validación bloqueante: NUNCA permitir stock negativo (CLAUDE.md §6 paso 4)
export async function validarStockSuficiente(
  productoId: number,
  sucursalId: number,
  cantidadRequerida: Prisma.Decimal | number,
  tx: TxClient = prisma,
): Promise<void> {
  const stock = await obtenerStock(productoId, sucursalId, tx);
  const requerida = new Prisma.Decimal(cantidadRequerida);
  if (stock.lessThan(requerida)) {
    const producto = await tx.producto.findUnique({ where: { id: productoId } });
    throw Errores.stockInsuficiente(
      `"${producto?.nombre ?? productoId}" — disponible ${stock.toString()}, requerido ${requerida.toString()}`,
    );
  }
}

export async function consultarStockSucursal(sucursalId: number) {
  const agrupado = await prisma.movimientoStock.groupBy({
    by: ['productoId'],
    where: { sucursalId },
    _sum: { cantidad: true },
  });
  const productos = await prisma.producto.findMany({
    where: { id: { in: agrupado.map((a) => a.productoId) } },
  });
  const porId = new Map(productos.map((p) => [p.id, p]));
  return agrupado
    .map((a) => {
      const p = porId.get(a.productoId);
      return {
        productoId: a.productoId,
        nombre: p?.nombre ?? '',
        tipo: p?.tipo,
        unidadDeMedida: p?.unidadDeMedida,
        cantidad: (a._sum.cantidad ?? new Prisma.Decimal(0)).toString(),
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function consultarMovimientos(filtros: {
  productoId?: number;
  sucursalId?: number;
  desde?: Date;
  hasta?: Date;
}) {
  return prisma.movimientoStock.findMany({
    where: {
      productoId: filtros.productoId,
      sucursalId: filtros.sucursalId,
      fechaHora: { gte: filtros.desde, lte: filtros.hasta },
    },
    include: {
      producto: { select: { nombre: true, unidadDeMedida: true } },
      usuario: { select: { username: true } },
    },
    orderBy: { fechaHora: 'desc' },
    take: 500,
  });
}
