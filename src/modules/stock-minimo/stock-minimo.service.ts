import { Prisma } from '@prisma/client';
import { prisma, OPCIONES_TX, type TxClient } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';
import { obtenerStock } from '../stock/stock.service';
import * as alertasService from '../alertas/alertas.service';

// Alertas de stock mínimo (CLAUDE-MODULO-2.md §6.6, Flujo 6 adelantado):
// - bajo el mínimo → AVISO en el POS repetido en CADA venta (no bloquea)
// - la Alerta al admin se crea solo al CRUZAR el umbral (no en cada venta)
// - stock CERO → bloqueo real (ya lo garantiza validarStockRequerido: nunca
//   se permite stock negativo, así que lo que no hay no se puede vender)

// Configuración por producto+sucursal — solo ADMIN (upsert, auditado)
export async function configurar(params: {
  productoId: number;
  sucursalId: number;
  minimo: number;
  activa?: boolean;
  usuarioId: number;
}) {
  const producto = await prisma.producto.findUnique({ where: { id: params.productoId } });
  if (!producto) throw Errores.noEncontrado('Producto');
  const sucursal = await prisma.sucursal.findUnique({ where: { id: params.sucursalId } });
  if (!sucursal) throw Errores.noEncontrado('Sucursal');

  return prisma.$transaction(async (tx) => {
    const anterior = await tx.configuracionStockMinimo.findUnique({
      where: { productoId_sucursalId: { productoId: params.productoId, sucursalId: params.sucursalId } },
    });
    const config = await tx.configuracionStockMinimo.upsert({
      where: { productoId_sucursalId: { productoId: params.productoId, sucursalId: params.sucursalId } },
      create: {
        productoId: params.productoId,
        sucursalId: params.sucursalId,
        minimo: new Prisma.Decimal(params.minimo),
        activa: params.activa ?? true,
      },
      update: {
        minimo: new Prisma.Decimal(params.minimo),
        activa: params.activa ?? true,
      },
      include: { producto: { select: { nombre: true } }, sucursal: { select: { nombre: true } } },
    });
    await registrarAuditoria(tx, {
      accion: 'CONFIGURAR_STOCK_MINIMO',
      entidad: 'ConfiguracionStockMinimo',
      entidadId: config.id,
      usuarioId: params.usuarioId,
      datosAnteriores: anterior
        ? { minimo: anterior.minimo.toString(), activa: anterior.activa }
        : undefined,
      datosNuevos: { minimo: params.minimo, activa: params.activa ?? true },
    });
    return config;
  }, OPCIONES_TX);
}

export async function listar(filtros: { sucursalId?: number }) {
  return prisma.configuracionStockMinimo.findMany({
    where: { sucursalId: filtros.sucursalId },
    include: { producto: { select: { nombre: true } }, sucursal: { select: { nombre: true } } },
    orderBy: { id: 'asc' },
  });
}

export interface AvisoStockMinimo {
  productoId: number;
  producto: string;
  stockRestante: string;
  minimo: string;
}

// Se llama DENTRO de la transacción que descuenta stock, después de crear los
// MovimientoStock. Devuelve los avisos para el POS y crea la Alerta al admin
// solo si esta operación CRUZÓ el umbral. La emisión por socket es post-commit
// (la hace el servicio dueño de la tx con lo que devuelve esta función).
export async function evaluarTrasDescuento(
  tx: TxClient,
  params: { sucursalId: number; descontado: Map<number, Prisma.Decimal> },
): Promise<{ avisos: AvisoStockMinimo[]; alertas: { id: number; tipo: 'STOCK_MINIMO'; detalle: unknown }[] }> {
  const avisos: AvisoStockMinimo[] = [];
  const alertas: { id: number; tipo: 'STOCK_MINIMO'; detalle: unknown }[] = [];

  const configs = await tx.configuracionStockMinimo.findMany({
    where: { sucursalId: params.sucursalId, activa: true, productoId: { in: [...params.descontado.keys()] } },
    include: { producto: { select: { nombre: true } } },
  });

  for (const config of configs) {
    const descontado = params.descontado.get(config.productoId);
    if (!descontado || descontado.isZero()) continue;
    const stockNuevo = await obtenerStock(config.productoId, params.sucursalId, tx);
    const stockAntes = stockNuevo.plus(descontado);

    if (stockNuevo.lessThan(config.minimo)) {
      avisos.push({
        productoId: config.productoId,
        producto: config.producto.nombre,
        stockRestante: stockNuevo.toString(),
        minimo: config.minimo.toString(),
      });
      // Alerta solo al cruzar (antes estaba en o sobre el mínimo)
      if (stockAntes.greaterThanOrEqualTo(config.minimo)) {
        const alerta = await alertasService.crearAlerta(tx, {
          tipo: 'STOCK_MINIMO',
          tipoOrigen: 'ConfiguracionStockMinimo',
          origenId: config.id,
          detalle: {
            productoId: config.productoId,
            producto: config.producto.nombre,
            sucursalId: params.sucursalId,
            stockRestante: stockNuevo.toString(),
            minimo: config.minimo.toString(),
          },
        });
        alertas.push({ id: alerta.id, tipo: 'STOCK_MINIMO', detalle: alerta.detalle });
      }
    }
  }

  return { avisos, alertas };
}

// Post-commit: alerta clásica a la sala de admins + evento dedicado a la
// sala de la sucursal (pop-up en el POS del local, §6.6/§9). El detalle de
// la alerta trae su sucursalId (se setea en evaluarTrasDescuento).
export function emitirAlertasStockMinimo(alertas: { id: number; tipo: 'STOCK_MINIMO'; detalle: unknown }[]) {
  for (const alerta of alertas) {
    alertasService.emitirAlerta(alerta);
    alertasService.emitirAAdmins('alerta:stock_minimo', alerta.detalle);
    const sucursalId = (alerta.detalle as { sucursalId?: number } | null)?.sucursalId;
    if (sucursalId) alertasService.emitirASucursal(sucursalId, 'alerta:stock_minimo', alerta.detalle);
  }
}
