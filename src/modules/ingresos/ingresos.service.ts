import { Prisma } from '@prisma/client';
import { prisma, OPCIONES_TX } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';

export interface LineaIngresoInput {
  productoId: number;
  cantidadSegunRemito: number;
  cantidadRealPesada: number;
}

// FLUJO 1 (CLAUDE.md §5): registra ingreso de materia prima.
// - Cada línea queda como LOTE DE INGRESO trazable con cantidadRestanteDisponible.
// - El stock sube por la cantidad REAL pesada (el remito es solo referencia).
// - Todo en una transacción: ingreso + líneas + movimientos + auditoría.
export async function registrarIngreso(params: {
  proveedorId: number;
  comentarioProveedorOtro?: string;
  fotoRemitoUrl?: string;
  lineas: LineaIngresoInput[];
  usuarioId: number;
}) {
  const proveedor = await prisma.proveedor.findUnique({ where: { id: params.proveedorId } });
  if (!proveedor || !proveedor.activo) throw Errores.noEncontrado('Proveedor');

  // Proveedor "Otro" habilita comentario libre; para el resto se ignora
  if (proveedor.esOtro && !params.comentarioProveedorOtro?.trim()) {
    throw Errores.validacion('El proveedor "Otro" requiere un comentario que lo identifique');
  }

  const sucursalProduccion = await prisma.sucursal.findFirst({ where: { tipo: 'PRODUCCION' } });
  if (!sucursalProduccion) throw Errores.noEncontrado('Sucursal de producción');

  const productos = await prisma.producto.findMany({
    where: { id: { in: params.lineas.map((l) => l.productoId) }, activo: true },
  });
  const productosPorId = new Map(productos.map((p) => [p.id, p]));
  for (const linea of params.lineas) {
    if (!productosPorId.has(linea.productoId)) {
      throw Errores.validacion(`Producto ${linea.productoId} inexistente o inactivo`);
    }
  }

  return prisma.$transaction(async (tx) => {
    const ingreso = await tx.ingresoMercaderia.create({
      data: {
        proveedorId: params.proveedorId,
        comentarioProveedorOtro: proveedor.esOtro ? params.comentarioProveedorOtro : null,
        sucursalId: sucursalProduccion.id,
        usuarioId: params.usuarioId,
        fotoRemitoUrl: params.fotoRemitoUrl ?? null,
      },
    });

    for (const linea of params.lineas) {
      const real = new Prisma.Decimal(linea.cantidadRealPesada);
      const lineaCreada = await tx.lineaIngreso.create({
        data: {
          ingresoMercaderiaId: ingreso.id,
          productoId: linea.productoId,
          cantidadSegunRemito: new Prisma.Decimal(linea.cantidadSegunRemito),
          cantidadRealPesada: real,
          cantidadRestanteDisponible: real,
        },
      });

      await tx.movimientoStock.create({
        data: {
          productoId: linea.productoId,
          sucursalId: sucursalProduccion.id,
          tipo: 'INGRESO_COMPRA',
          cantidad: real, // positiva: siempre el peso REAL medido
          usuarioId: params.usuarioId,
          tipoOrigen: 'LineaIngreso',
          origenId: lineaCreada.id,
        },
      });
    }

    await registrarAuditoria(tx, {
      accion: 'REGISTRAR_INGRESO_MERCADERIA',
      entidad: 'IngresoMercaderia',
      entidadId: ingreso.id,
      usuarioId: params.usuarioId,
      datosNuevos: {
        proveedorId: params.proveedorId,
        proveedor: proveedor.nombre,
        comentarioProveedorOtro: proveedor.esOtro ? params.comentarioProveedorOtro : null,
        fotoRemitoUrl: params.fotoRemitoUrl ?? null,
        lineas: params.lineas,
      },
    });

    return tx.ingresoMercaderia.findUniqueOrThrow({
      where: { id: ingreso.id },
      include: {
        proveedor: { select: { nombre: true, esOtro: true } },
        lineas: { include: { producto: { select: { nombre: true, unidadDeMedida: true } } } },
      },
    });
  }, OPCIONES_TX);
}

export async function listar(filtros: { desde?: Date; hasta?: Date; proveedorId?: number }) {
  return prisma.ingresoMercaderia.findMany({
    where: { fechaHora: { gte: filtros.desde, lte: filtros.hasta }, proveedorId: filtros.proveedorId },
    include: {
      proveedor: { select: { nombre: true, esOtro: true } },
      usuario: { select: { username: true } },
      lineas: { include: { producto: { select: { nombre: true, unidadDeMedida: true } } } },
    },
    orderBy: { fechaHora: 'desc' },
    take: 200,
  });
}

// Líneas con stock restante de un producto — para que producción elija
// sobre qué lote de ingreso trabaja (Flujo 2 paso 2)
export async function lineasDisponibles(productoId: number) {
  return prisma.lineaIngreso.findMany({
    where: { productoId, cantidadRestanteDisponible: { gt: 0 } },
    include: {
      ingresoMercaderia: {
        select: { fechaHora: true, proveedor: { select: { nombre: true } } },
      },
      producto: { select: { nombre: true, unidadDeMedida: true } },
    },
    orderBy: { ingresoMercaderia: { fechaHora: 'asc' } }, // FIFO sugerido
  });
}
