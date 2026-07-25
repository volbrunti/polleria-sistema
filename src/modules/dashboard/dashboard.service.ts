import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

const CERO = new Prisma.Decimal(0);

export async function resumenDashboard(filtros: { sucursalId?: number; desde?: Date; hasta?: Date }) {
  const fechaRango = construirRangoFecha(filtros);
  const wherePedido: Prisma.PedidoWhereInput = {
    estado: { not: 'ANULADO' },
    sucursalId: filtros.sucursalId,
    fechaCreacion: fechaRango,
  };

  const [
    ventasAgg,
    pagosAgg,
    pedidosCount,
    mermasAgg,
    gastosAgg,
    retirosAgg,
    alertasPendientes,
    lotesConDesvio,
    atencionesAgg,
  ] = await Promise.all([
    // Total vendido (sumando montoTotal de items, excluye costo cero)
    prisma.itemDePedido.aggregate({
      where: { pedido: wherePedido, esVentaCostoCero: false },
      _sum: { montoTotal: true },
    }),
    // Ventas por medio de pago
    prisma.pago.groupBy({
      by: ['medio'],
      where: { pedido: wherePedido },
      _sum: { monto: true },
    }),
    // Cantidad de pedidos
    prisma.pedido.count({ where: wherePedido }),
    // Mermas (quemados)
    prisma.movimientoStock.aggregate({
      where: {
        tipo: 'MERMA_QUEMADO',
        sucursalId: filtros.sucursalId,
        fechaHora: fechaRango,
      },
      _sum: { cantidad: true },
      _count: true,
    }),
    // Gastos de caja
    prisma.gastoDeCaja.aggregate({
      where: {
        fechaHora: fechaRango,
        turno: filtros.sucursalId ? { sucursalId: filtros.sucursalId } : undefined,
      },
      _sum: { monto: true },
    }),
    // Retiros de caja
    prisma.retiroDeCaja.aggregate({
      where: {
        fechaHora: fechaRango,
        turno: filtros.sucursalId ? { sucursalId: filtros.sucursalId } : undefined,
      },
      _sum: { monto: true },
    }),
    // Alertas no vistas
    prisma.alerta.count({ where: { vista: false } }),
    // Lotes con alerta disparada
    prisma.loteDeProduccion.count({
      where: {
        estado: 'CERRADO',
        alertaDisparada: true,
        fechaHora: fechaRango,
      },
    }),
    // Atenciones (regalías)
    prisma.atencion.aggregate({
      where: {
        sucursalId: filtros.sucursalId,
        fechaHora: fechaRango,
      },
      _count: true,
    }),
  ]);

  const totalVentas = ventasAgg._sum.montoTotal ?? CERO;
  const ticketPromedio = pedidosCount > 0 ? totalVentas.div(pedidosCount).toDecimalPlaces(2) : CERO;

  return {
    totalVentas: totalVentas.toString(),
    cantidadPedidos: pedidosCount,
    ticketPromedio: ticketPromedio.toString(),
    ventasPorMedio: pagosAgg.map((p) => ({
      medio: p.medio,
      total: (p._sum.monto ?? CERO).toString(),
    })),
    totalGastos: (gastosAgg._sum.monto ?? CERO).toString(),
    totalRetiros: (retirosAgg._sum.monto ?? CERO).toString(),
    mermas: {
      cantidadEventos: mermasAgg._count,
      totalUnidades: (mermasAgg._sum.cantidad ?? CERO).abs().toString(),
    },
    alertasPendientes,
    lotesConDesvio,
    cantidadAtenciones: atencionesAgg._count,
  };
}

function construirRangoFecha(filtros: { desde?: Date; hasta?: Date }): Prisma.DateTimeFilter | undefined {
  if (!filtros.desde && !filtros.hasta) return undefined;
  const rango: Prisma.DateTimeFilter = {};
  if (filtros.desde) rango.gte = filtros.desde;
  if (filtros.hasta) rango.lte = filtros.hasta;
  return rango;
}
