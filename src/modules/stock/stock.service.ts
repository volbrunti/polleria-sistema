import { Prisma } from '@prisma/client';
import { prisma, OPCIONES_TX, type TxClient } from '../../lib/prisma';
import { Errores } from '../../lib/errores';
import { registrarAuditoria } from '../../lib/auditoria';

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

// ── Serialización del descuento de stock (auditoría 2026-08-07, C-1 y C-2) ──
//
// El stock es un SUM() sobre MovimientoStock, y un agregado NO toma locks. Con
// el aislamiento READ COMMITTED que usa PostgreSQL por defecto, dos ventas
// simultáneas del mismo producto leen las dos el mismo saldo, las dos deciden
// que alcanza, y las dos insertan: el stock queda negativo. La auditoría lo
// reprodujo vendiendo 20 empanadas habiendo 10, y creando 4 pollos marcados de
// la nada — esto último rompe además el arqueo ciego, porque la diferencia se
// la termina comiendo el cajero.
//
// El guard de `transicionarAtomico` (pedidos.service.ts) no sirve acá: ese
// protege carreras sobre un pedido que YA existe, tomando el row lock del
// UPDATE. Al confirmar se crea un pedido nuevo, no hay fila compartida que
// trabar, y los INSERT de movimientos no chocan entre sí.
//
// Se usa un advisory lock por (producto, sucursal) en vez de subir el
// aislamiento a Serializable: es determinístico (no hay abortos espurios que
// obliguen a reintentar), no cambia el comportamiento de las transacciones que
// no tocan stock, y se libera solo al terminar la transacción.
export async function bloquearStock(
  tx: TxClient,
  claves: { productoId: number; sucursalId: number }[],
): Promise<void> {
  if (claves.length === 0) return;

  // Orden determinístico. Si un pedido traba (A, B) y otro (B, A), cada uno se
  // queda esperando el lock que tiene el otro y no avanza ninguno. Pidiéndolos
  // siempre en el mismo orden, el segundo espera al primero y listo.
  const ordenadas = [...claves]
    .sort((a, b) => a.productoId - b.productoId || a.sucursalId - b.sucursalId)
    .filter((c, i, arr) => i === 0 || c.productoId !== arr[i - 1]!.productoId || c.sucursalId !== arr[i - 1]!.sucursalId);

  // Una sola ida a la base para todos los locks: adentro de la transacción cada
  // round-trip cuesta ~50 ms contra Neon y alarga la ventana que se quiere cerrar.
  //
  // $executeRaw y no $queryRaw: pg_advisory_xact_lock devuelve `void`, y el
  // deserializador de Prisma no sabe leer esa columna — tira un error y hace
  // rollback aunque el lock se haya tomado bien. $executeRaw solo cuenta filas.
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(t.p, t.s)
    FROM unnest(${ordenadas.map((c) => c.productoId)}::int[],
                ${ordenadas.map((c) => c.sucursalId)}::int[]) AS t(p, s)
  `;
}

// Validación bloqueante: NUNCA permitir stock negativo (CLAUDE.md §6 paso 4).
// Toma el lock ANTES de leer — si se leyera primero, el valor ya podría estar
// desactualizado para cuando se decide sobre él.
export async function validarStockSuficiente(
  productoId: number,
  sucursalId: number,
  cantidadRequerida: Prisma.Decimal | number,
  tx: TxClient = prisma,
): Promise<void> {
  await bloquearStock(tx, [{ productoId, sucursalId }]);
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

// Corrección manual de stock (admin panel — pedido tras la prueba en vivo).
// El stock nunca es un campo editable: es SUM(MovimientoStock), así que
// "editar" es insertar UN movimiento tipo AJUSTE con el delta necesario para
// que el SUM llegue a cantidadNueva. Con eso alcanza para que quede
// reflejado en todas las pantallas — no hay nada más que "propagar".
export async function crearAjuste(params: {
  productoId: number;
  sucursalId: number;
  cantidadNueva: Prisma.Decimal | number;
  motivo: string;
  usuarioId: number;
}) {
  return prisma.$transaction(async (tx) => {
    await bloquearStock(tx, [{ productoId: params.productoId, sucursalId: params.sucursalId }]);
    const producto = await tx.producto.findUnique({ where: { id: params.productoId } });
    if (!producto) throw Errores.noEncontrado('Producto');

    const stockAnterior = await obtenerStock(params.productoId, params.sucursalId, tx);
    const cantidadNueva = new Prisma.Decimal(params.cantidadNueva);
    const delta = cantidadNueva.minus(stockAnterior);
    if (delta.isZero()) throw Errores.validacion('La cantidad nueva es igual a la actual — no hay nada para ajustar');

    // Sin documento de origen real (no es un ingreso, lote ni transferencia)
    // — mismo patrón que VentaCostoCero: la referencia polimórfica apunta al
    // propio movimiento, así que se crea con un placeholder y se actualiza.
    const movimiento = await tx.movimientoStock.create({
      data: {
        productoId: params.productoId,
        sucursalId: params.sucursalId,
        tipo: 'AJUSTE',
        cantidad: delta,
        usuarioId: params.usuarioId,
        tipoOrigen: 'AjusteManual',
        origenId: 0,
      },
    });
    await tx.movimientoStock.update({ where: { id: movimiento.id }, data: { origenId: movimiento.id } });

    await registrarAuditoria(tx, {
      accion: 'AJUSTE_STOCK_MANUAL',
      entidad: 'MovimientoStock',
      entidadId: movimiento.id,
      usuarioId: params.usuarioId,
      datosAnteriores: {
        producto: producto.nombre,
        sucursalId: params.sucursalId,
        stockAnterior: stockAnterior.toString(),
      },
      datosNuevos: {
        producto: producto.nombre,
        sucursalId: params.sucursalId,
        stockNuevo: cantidadNueva.toString(),
        delta: delta.toString(),
        motivo: params.motivo,
      },
    });

    return { productoId: params.productoId, sucursalId: params.sucursalId, stockAnterior: stockAnterior.toString(), stockNuevo: cantidadNueva.toString() };
  }, OPCIONES_TX);
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
