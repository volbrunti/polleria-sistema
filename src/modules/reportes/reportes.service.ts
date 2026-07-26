import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { Errores } from '../../lib/errores';

const CERO = new Prisma.Decimal(0);

interface FiltroFecha {
  desde?: Date;
  hasta?: Date;
  sucursalId?: number;
}

// ── Ventas por producto ──
// Agrupa ItemDePedido de pedidos no anulados. Opcionalmente compara vs período anterior.
export async function ventasPorProducto(filtros: FiltroFecha) {
  const where = construirWherePedido(filtros);

  const items = await prisma.itemDePedido.groupBy({
    by: ['productoId'],
    where: { pedido: where, esVentaCostoCero: false },
    _sum: { cantidad: true, montoTotal: true },
    _count: true,
  });

  const productoIds = items.map((i) => i.productoId);
  const productos = await prisma.producto.findMany({
    where: { id: { in: productoIds } },
    select: { id: true, nombre: true, categoria: true, tipo: true },
  });
  const porId = new Map(productos.map((p) => [p.id, p]));

  return items
    .map((i) => {
      const p = porId.get(i.productoId);
      return {
        productoId: i.productoId,
        producto: p?.nombre ?? '',
        categoria: p?.categoria ?? '',
        tipo: p?.tipo ?? '',
        unidadesVendidas: (i._sum.cantidad ?? CERO).toString(),
        montoTotal: (i._sum.montoTotal ?? CERO).toString(),
        cantidadPedidos: i._count,
      };
    })
    .sort((a, b) => {
      const montoA = new Prisma.Decimal(a.montoTotal);
      const montoB = new Prisma.Decimal(b.montoTotal);
      return montoB.minus(montoA).toNumber();
    });
}

// ── Ventas por medio de pago ──
export async function ventasPorMedioDePago(filtros: FiltroFecha) {
  const where = construirWherePedido(filtros);

  const pagos = await prisma.pago.groupBy({
    by: ['medio'],
    where: { pedido: where },
    _sum: { monto: true },
    _count: true,
  });

  const totalGeneral = pagos.reduce((acc, p) => acc.plus(p._sum.monto ?? CERO), CERO);

  return {
    porMedio: pagos
      .map((p) => ({
        medio: p.medio,
        total: (p._sum.monto ?? CERO).toString(),
        cantidadOperaciones: p._count,
        porcentaje: totalGeneral.isZero()
          ? '0'
          : (p._sum.monto ?? CERO).div(totalGeneral).mul(100).toDecimalPlaces(1).toString(),
      }))
      .sort((a, b) => Number(b.total) - Number(a.total)),
    total: totalGeneral.toString(),
  };
}

// ── Cierres de caja (turnos cerrados con arqueos) ──
export async function cierresDeCaja(filtros: FiltroFecha) {
  const turnos = await prisma.turno.findMany({
    where: {
      estado: 'CERRADO',
      sucursalId: filtros.sucursalId,
      fechaCierre: fechaRango(filtros),
    },
    include: {
      sucursal: { select: { nombre: true } },
      usuarioCajero: { select: { username: true } },
      arqueos: { where: { momento: 'CIERRE' } },
    },
    orderBy: { fechaCierre: 'desc' },
    take: 200,
  });

  return turnos.map((t) => {
    const arqueoEfectivo = t.arqueos.find((a) => a.tipo === 'EFECTIVO');
    const arqueoPollos = t.arqueos.find((a) => a.tipo === 'POLLOS_MARCADOS');
    return {
      turnoId: t.id,
      sucursal: t.sucursal.nombre,
      cajero: t.usuarioCajero.username,
      fechaApertura: t.fechaApertura.toISOString(),
      fechaCierre: t.fechaCierre?.toISOString() ?? null,
      efectivo: arqueoEfectivo
        ? {
            valorContado: arqueoEfectivo.valorContado.toString(),
            valorEsperado: arqueoEfectivo.valorEsperado.toString(),
            diferencia: arqueoEfectivo.diferencia.toString(),
            resultado: arqueoEfectivo.resultado,
          }
        : null,
      pollos: arqueoPollos
        ? {
            valorContado: arqueoPollos.valorContado.toString(),
            valorEsperado: arqueoPollos.valorEsperado.toString(),
            diferencia: arqueoPollos.diferencia.toString(),
            resultado: arqueoPollos.resultado,
          }
        : null,
    };
  });
}

// ── Retiros por socio ──
export async function retirosPorSocio(filtros: FiltroFecha) {
  const where: Prisma.RetiroDeCajaWhereInput = {
    fechaHora: fechaRango(filtros),
    turno: filtros.sucursalId ? { sucursalId: filtros.sucursalId } : undefined,
  };

  const agrupados = await prisma.retiroDeCaja.groupBy({
    by: ['socio', 'medio'],
    where,
    _sum: { monto: true },
    _count: true,
  });

  const totalGeneral = agrupados.reduce((acc, r) => acc.plus(r._sum.monto ?? CERO), CERO);

  return {
    porSocio: agrupados
      .map((r) => ({
        socio: r.socio,
        medio: r.medio,
        total: (r._sum.monto ?? CERO).toString(),
        cantidadRetiros: r._count,
      }))
      .sort((a, b) => a.socio.localeCompare(b.socio)),
    total: totalGeneral.toString(),
  };
}

// ── Mermas / quemados por producto ──
export async function mermasPorProducto(filtros: FiltroFecha) {
  const movimientos = await prisma.movimientoStock.findMany({
    where: {
      tipo: { in: ['MERMA_QUEMADO', 'DESPERDICIO_PRODUCCION'] },
      sucursalId: filtros.sucursalId,
      fechaHora: fechaRango(filtros),
    },
    include: {
      producto: { select: { nombre: true, categoria: true } },
    },
  });

  const agrupado = new Map<number, { nombre: string; categoria: string; quemados: Prisma.Decimal; desperdicioProduccion: Prisma.Decimal }>();
  for (const m of movimientos) {
    let entry = agrupado.get(m.productoId);
    if (!entry) {
      entry = {
        nombre: m.producto.nombre,
        categoria: m.producto.categoria,
        quemados: CERO,
        desperdicioProduccion: CERO,
      };
      agrupado.set(m.productoId, entry);
    }
    const cantAbs = m.cantidad.abs();
    if (m.tipo === 'MERMA_QUEMADO') {
      entry.quemados = entry.quemados.plus(cantAbs);
    } else {
      entry.desperdicioProduccion = entry.desperdicioProduccion.plus(cantAbs);
    }
  }

  return [...agrupado.entries()]
    .map(([productoId, e]) => ({
      productoId,
      producto: e.nombre,
      categoria: e.categoria,
      quemados: e.quemados.toString(),
      desperdicioProduccion: e.desperdicioProduccion.toString(),
      total: e.quemados.plus(e.desperdicioProduccion).toString(),
    }))
    .sort((a, b) => Number(b.total) - Number(a.total));
}

// ── Rendimiento de producción ──
export async function rendimientoProduccion(filtros: FiltroFecha) {
  const lotes = await prisma.loteDeProduccion.findMany({
    where: {
      estado: 'CERRADO',
      fechaHora: fechaRango(filtros),
    },
    include: {
      productoElaborado: { select: { nombre: true } },
      usuarioOperario: { select: { username: true } },
      fichaTecnicaVersion: {
        select: { numeroVersion: true, desperdicioEsperadoPct: true },
      },
    },
    orderBy: { fechaHora: 'desc' },
    take: 500,
  });

  return lotes.map((l) => ({
    loteId: l.id,
    producto: l.productoElaborado.nombre,
    operario: l.usuarioOperario.username,
    fechaHora: l.fechaHora.toISOString(),
    versionFicha: l.fichaTecnicaVersion.numeroVersion,
    unidadesProducidas: l.unidadesProducidasReales?.toString() ?? null,
    desperdicioRealKg: l.desperdicioRealKg?.toString() ?? null,
    unidadesEsperadas: l.unidadesEsperadas?.toString() ?? null,
    desvioPct: l.desvioPct?.toString() ?? null,
    alertaDisparada: l.alertaDisparada,
  }));
}

// ── Gastos de caja por categoría ──
export async function gastosPorCategoria(filtros: FiltroFecha) {
  const where: Prisma.GastoDeCajaWhereInput = {
    fechaHora: fechaRango(filtros),
    turno: filtros.sucursalId ? { sucursalId: filtros.sucursalId } : undefined,
  };

  const agrupados = await prisma.gastoDeCaja.groupBy({
    by: ['categoria'],
    where,
    _sum: { monto: true },
    _count: true,
  });

  const total = agrupados.reduce((acc, g) => acc.plus(g._sum.monto ?? CERO), CERO);

  return {
    porCategoria: agrupados
      .map((g) => ({
        categoria: g.categoria,
        total: (g._sum.monto ?? CERO).toString(),
        cantidad: g._count,
      }))
      .sort((a, b) => Number(b.total) - Number(a.total)),
    total: total.toString(),
  };
}

// ── Atenciones/regalías ──
export async function atencionesReporte(filtros: FiltroFecha) {
  const atenciones = await prisma.atencion.findMany({
    where: {
      sucursalId: filtros.sucursalId,
      fechaHora: fechaRango(filtros),
    },
    include: {
      producto: { select: { nombre: true } },
      usuario: { select: { username: true } },
    },
    orderBy: { fechaHora: 'desc' },
    take: 500,
  });

  return atenciones.map((a) => ({
    id: a.id,
    producto: a.producto.nombre,
    cantidad: a.cantidad.toString(),
    motivoCodigo: a.motivoCodigo,
    motivoDetalle: a.motivoDetalle,
    usuario: a.usuario.username,
    fechaHora: a.fechaHora.toISOString(),
  }));
}

// ── Trazabilidad de un pedido ──
// Reconstruye la cadena Proveedor → IngresoMercaderia → LineaIngreso →
// InsumoUsado → LoteDeProduccion → Transferencia → ItemDePedido (CLAUDE.md §7).
// El schema no guarda un FK directo entre LoteDeProduccion y Transferencia
// (los envíos no reservan unidades de un lote específico), así que el lote
// de origen se infiere por proximidad temporal: el último lote CERRADO de
// ese producto anterior al envío que trajo la mercadería a la sucursal. Es
// una aproximación razonable en un sistema FIFO, no una relación exacta —
// por eso cada tramo va con `aproximado: true` para que quien lo lea sepa
// que no es una referencia dura como el resto de la cadena.
export async function trazabilidadPedido(pedidoId: number) {
  const pedido = await prisma.pedido.findUnique({
    where: { id: pedidoId },
    include: {
      sucursal: { select: { nombre: true } },
      usuarioCajero: { select: { username: true } },
      items: {
        include: {
          producto: {
            select: {
              id: true,
              nombre: true,
              tipo: true,
              componentesDelCombo: {
                include: { productoComponente: { select: { id: true, nombre: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!pedido) throw Errores.noEncontrado('Pedido');

  const items = await Promise.all(
    pedido.items.map(async (item) => {
      const base = {
        itemId: item.id,
        producto: item.producto.nombre,
        tipo: item.producto.tipo,
        cantidad: item.cantidad.toString(),
        montoTotal: item.montoTotal.toString(),
        esVentaCostoCero: item.esVentaCostoCero,
        tipoCostoCero: item.tipoCostoCero,
      };

      if (item.producto.tipo === 'COMBO') {
        const componentes = await Promise.all(
          item.producto.componentesDelCombo.map(async (c) => ({
            productoId: c.productoComponente.id,
            producto: c.productoComponente.nombre,
            origen: await origenDeProducto(c.productoComponente.id, pedido.sucursalId, pedido.fechaCreacion),
          })),
        );
        return { ...base, componentes };
      }

      return { ...base, origen: await origenDeProducto(item.producto.id, pedido.sucursalId, pedido.fechaCreacion) };
    }),
  );

  return {
    pedidoId: pedido.id,
    fechaCreacion: pedido.fechaCreacion.toISOString(),
    sucursal: pedido.sucursal.nombre,
    cajero: pedido.usuarioCajero.username,
    items,
  };
}

async function origenDeProducto(productoId: number, sucursalId: number, antesDe: Date) {
  const lineaTransferencia = await prisma.lineaDeTransferencia.findFirst({
    where: {
      productoId,
      transferencia: {
        sucursalDestinoId: sucursalId,
        estado: { in: ['CONFIRMADA', 'CONFIRMADA_CON_DISCREPANCIA'] },
        fechaHoraRecepcion: { lte: antesDe },
      },
    },
    include: {
      transferencia: {
        select: {
          id: true,
          estado: true,
          fechaHoraEnvio: true,
          fechaHoraRecepcion: true,
          sucursalOrigen: { select: { nombre: true } },
          usuarioEmisor: { select: { username: true } },
          usuarioReceptor: { select: { username: true } },
        },
      },
    },
    orderBy: { transferencia: { fechaHoraRecepcion: 'desc' } },
  });

  if (!lineaTransferencia) {
    return {
      transferencia: null,
      lote: null,
      insumos: [] as Array<Record<string, unknown>>,
      nota: 'No se encontró una transferencia de este producto hacia la sucursal antes de la venta (puede ser stock previo a la trazabilidad, un producto marcado localmente, o venta directa).',
    };
  }

  const lote = await prisma.loteDeProduccion.findFirst({
    where: {
      productoElaboradoId: productoId,
      estado: 'CERRADO',
      fechaHora: { lte: lineaTransferencia.transferencia.fechaHoraEnvio },
    },
    include: {
      usuarioOperario: { select: { username: true } },
      fichaTecnicaVersion: { select: { numeroVersion: true } },
      insumosUsados: {
        include: {
          productoInsumo: { select: { nombre: true } },
          lineaIngresoOrigen: {
            include: {
              ingresoMercaderia: { include: { proveedor: { select: { nombre: true } } } },
            },
          },
        },
      },
    },
    orderBy: { fechaHora: 'desc' },
  });

  return {
    transferencia: {
      id: lineaTransferencia.transferencia.id,
      sucursalOrigen: lineaTransferencia.transferencia.sucursalOrigen.nombre,
      fechaHoraEnvio: lineaTransferencia.transferencia.fechaHoraEnvio.toISOString(),
      fechaHoraRecepcion: lineaTransferencia.transferencia.fechaHoraRecepcion?.toISOString() ?? null,
      cantidadEnviada: lineaTransferencia.cantidadEnviada.toString(),
      cantidadRecibida: lineaTransferencia.cantidadRecibida?.toString() ?? null,
      estado: lineaTransferencia.transferencia.estado,
      usuarioEmisor: lineaTransferencia.transferencia.usuarioEmisor.username,
      usuarioReceptor: lineaTransferencia.transferencia.usuarioReceptor?.username ?? null,
    },
    lote: lote
      ? {
          id: lote.id,
          fechaHora: lote.fechaHora.toISOString(),
          operario: lote.usuarioOperario.username,
          versionFicha: lote.fichaTecnicaVersion.numeroVersion,
          unidadesProducidas: lote.unidadesProducidasReales?.toString() ?? null,
          desperdicioRealKg: lote.desperdicioRealKg?.toString() ?? null,
          unidadesEsperadas: lote.unidadesEsperadas?.toString() ?? null,
          desvioPct: lote.desvioPct?.toString() ?? null,
          aproximado: true,
        }
      : null,
    insumos: lote
      ? lote.insumosUsados.map((iu) => ({
          producto: iu.productoInsumo.nombre,
          cantidadUsada: iu.cantidadUsada.toString(),
          lineaIngresoId: iu.lineaIngresoOrigen.id,
          proveedor: iu.lineaIngresoOrigen.ingresoMercaderia.proveedor.nombre,
          fechaIngreso: iu.lineaIngresoOrigen.ingresoMercaderia.fechaHora.toISOString(),
          cantidadSegunRemito: iu.lineaIngresoOrigen.cantidadSegunRemito.toString(),
          cantidadRealPesada: iu.lineaIngresoOrigen.cantidadRealPesada.toString(),
        }))
      : [],
  };
}

// ── Helpers ──

function fechaRango(filtros: FiltroFecha): Prisma.DateTimeFilter | undefined {
  if (!filtros.desde && !filtros.hasta) return undefined;
  const rango: Prisma.DateTimeFilter = {};
  if (filtros.desde) rango.gte = filtros.desde;
  if (filtros.hasta) rango.lte = filtros.hasta;
  return rango;
}

function construirWherePedido(filtros: FiltroFecha): Prisma.PedidoWhereInput {
  return {
    estado: { not: 'ANULADO' },
    sucursalId: filtros.sucursalId,
    fechaCreacion: fechaRango(filtros),
  };
}
