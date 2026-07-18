import { Prisma, type MedioPago, type SocioRetiro, type TipoCostoCero } from '@prisma/client';
import { prisma, OPCIONES_TX } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';
import { NOMBRE_POLLO_ENTERO, NOMBRE_POLLO_MARCADO } from '../../lib/constantes';
import { obtenerStock } from '../stock/stock.service';
import { resolverSucursalOperativa, exigirTurnoAbierto } from '../turnos/turnos.service';
import { resolverRequerimientosStock, validarStockRequerido } from '../pedidos/pedidos.service';

// Operaciones del turno que no son pedidos (CLAUDE-MODULO-2.md §4.8–§4.10 y
// §5.2): atenciones/regalías, gastos, retiros, marcado de pollos y ventas a
// costo cero (mermas/retornos). Todas exigen turno ABIERTO en la sucursal.

// ── §4.8 Atenciones / regalías ──
// Producto sin cargo: descuenta stock igual que una venta (tipo ATENCION),
// no genera pago. Motivo obligatorio; "OTRO" exige detalle.
export async function registrarAtencion(params: {
  usuarioId: number;
  sucursalId?: number;
  productoId: number;
  cantidad: number;
  motivoCodigo: string;
  motivoDetalle?: string;
}) {
  if (params.motivoCodigo === 'OTRO' && !params.motivoDetalle?.trim()) {
    throw Errores.validacion('El motivo "OTRO" requiere detalle');
  }
  const sucursalId = await resolverSucursalOperativa(params.usuarioId, params.sucursalId);

  const producto = await prisma.producto.findUnique({ where: { id: params.productoId } });
  if (!producto || !producto.activo) throw Errores.noEncontrado('Producto');
  if (producto.tipo === 'MATERIA_PRIMA') {
    throw Errores.validacion(`"${producto.nombre}" es materia prima, no se regala desde el POS`);
  }

  return prisma.$transaction(async (tx) => {
    const turno = await exigirTurnoAbierto(sucursalId, tx);

    // mismo resolvedor que las ventas: combos → componentes, pollo → MARCADO
    const reqs = await resolverRequerimientosStock(tx, [
      { productoId: params.productoId, cantidad: new Prisma.Decimal(params.cantidad) },
    ]);
    await validarStockRequerido(tx, sucursalId, reqs);

    const atencion = await tx.atencion.create({
      data: {
        turnoId: turno.id,
        sucursalId,
        productoId: params.productoId,
        cantidad: new Prisma.Decimal(params.cantidad),
        motivoCodigo: params.motivoCodigo,
        motivoDetalle: params.motivoDetalle,
        usuarioId: params.usuarioId,
      },
      include: { producto: { select: { nombre: true } } },
    });

    for (const [productoId, cantidad] of reqs) {
      await tx.movimientoStock.create({
        data: {
          productoId,
          sucursalId,
          tipo: 'ATENCION',
          cantidad: cantidad.negated(),
          usuarioId: params.usuarioId,
          tipoOrigen: 'Atencion',
          origenId: atencion.id,
        },
      });
    }

    await registrarAuditoria(tx, {
      accion: 'REGISTRAR_ATENCION',
      entidad: 'Atencion',
      entidadId: atencion.id,
      usuarioId: params.usuarioId,
      datosNuevos: {
        producto: producto.nombre,
        cantidad: params.cantidad,
        motivoCodigo: params.motivoCodigo,
        motivoDetalle: params.motivoDetalle ?? null,
      },
    });

    return atencion;
  }, OPCIONES_TX);
}

// ── §5.2 Gastos de caja ──
const MEDIOS_GASTO: MedioPago[] = ['EFECTIVO', 'MERCADO_PAGO'];

export async function registrarGasto(params: {
  usuarioId: number;
  sucursalId?: number;
  monto: number;
  medio: MedioPago;
  categoria: string;
  descripcion?: string;
}) {
  if (!MEDIOS_GASTO.includes(params.medio)) {
    throw Errores.validacion('Los gastos de caja solo pueden pagarse con EFECTIVO o MERCADO_PAGO');
  }
  if (params.categoria === 'OTRO' && !params.descripcion?.trim()) {
    throw Errores.validacion('La categoría "OTRO" requiere descripción');
  }
  const sucursalId = await resolverSucursalOperativa(params.usuarioId, params.sucursalId);

  return prisma.$transaction(async (tx) => {
    const turno = await exigirTurnoAbierto(sucursalId, tx);
    const gasto = await tx.gastoDeCaja.create({
      data: {
        turnoId: turno.id,
        monto: new Prisma.Decimal(params.monto),
        medio: params.medio,
        categoria: params.categoria,
        descripcion: params.descripcion,
        usuarioId: params.usuarioId,
      },
    });
    await registrarAuditoria(tx, {
      accion: 'REGISTRAR_GASTO_CAJA',
      entidad: 'GastoDeCaja',
      entidadId: gasto.id,
      usuarioId: params.usuarioId,
      datosNuevos: { monto: params.monto, medio: params.medio, categoria: params.categoria },
    });
    return gasto;
  }, OPCIONES_TX);
}

// ── §5.2 Retiros de caja ──
// El socio es un selector CERRADO (ARIEL/ELIANA/EMA). El cajero registra pero
// no ve acumulados (eso es del resumen financiero, solo admin/socio).
export async function registrarRetiro(params: {
  usuarioId: number;
  sucursalId?: number;
  monto: number;
  medio: MedioPago;
  socio: SocioRetiro;
}) {
  const sucursalId = await resolverSucursalOperativa(params.usuarioId, params.sucursalId);

  return prisma.$transaction(async (tx) => {
    const turno = await exigirTurnoAbierto(sucursalId, tx);
    const retiro = await tx.retiroDeCaja.create({
      data: {
        turnoId: turno.id,
        monto: new Prisma.Decimal(params.monto),
        medio: params.medio,
        socio: params.socio,
        usuarioCajeroId: params.usuarioId,
      },
    });
    // auditoría reforzada: con qué socio (Flujo 7)
    await registrarAuditoria(tx, {
      accion: 'REGISTRAR_RETIRO_CAJA',
      entidad: 'RetiroDeCaja',
      entidadId: retiro.id,
      usuarioId: params.usuarioId,
      datosNuevos: { monto: params.monto, medio: params.medio, socio: params.socio },
    });
    return retiro;
  }, OPCIONES_TX);
}

// ── §4.10 Marcado de pollos: fresco → parrilla ──
// "Tiré X pollos a la parrilla": descuenta del fresco y suma al producto
// MARCADO, ambos MovimientoStock MARCADO_POLLO en la misma transacción.
export async function marcarPollos(params: { usuarioId: number; sucursalId?: number; cantidad: number }) {
  const sucursalId = await resolverSucursalOperativa(params.usuarioId, params.sucursalId);

  const fresco = await prisma.producto.findUnique({ where: { nombre: NOMBRE_POLLO_ENTERO } });
  const marcado = await prisma.producto.findUnique({ where: { nombre: NOMBRE_POLLO_MARCADO } });
  if (!fresco || !marcado) {
    throw Errores.noEncontrado('Producto del circuito del pollo (fresco/marcado)');
  }

  return prisma.$transaction(async (tx) => {
    const turno = await exigirTurnoAbierto(sucursalId, tx);

    const cantidad = new Prisma.Decimal(params.cantidad);
    const stockFresco = await obtenerStock(fresco.id, sucursalId, tx);
    if (stockFresco.lessThan(cantidad)) {
      throw Errores.stockInsuficiente(
        `"${fresco.nombre}" — disponible ${stockFresco.toString()}, a marcar ${cantidad.toString()}`,
      );
    }

    const evento = await tx.eventoMarcadoPollo.create({
      data: { turnoId: turno.id, sucursalId, cantidad, usuarioId: params.usuarioId },
    });

    await tx.movimientoStock.create({
      data: {
        productoId: fresco.id,
        sucursalId,
        tipo: 'MARCADO_POLLO',
        cantidad: cantidad.negated(),
        usuarioId: params.usuarioId,
        tipoOrigen: 'EventoMarcadoPollo',
        origenId: evento.id,
      },
    });
    await tx.movimientoStock.create({
      data: {
        productoId: marcado.id,
        sucursalId,
        tipo: 'MARCADO_POLLO',
        cantidad,
        usuarioId: params.usuarioId,
        tipoOrigen: 'EventoMarcadoPollo',
        origenId: evento.id,
      },
    });

    await registrarAuditoria(tx, {
      accion: 'MARCAR_POLLOS',
      entidad: 'EventoMarcadoPollo',
      entidadId: evento.id,
      usuarioId: params.usuarioId,
      datosNuevos: { cantidad: params.cantidad, sucursalId },
    });

    return evento;
  }, OPCIONES_TX);
}

// ── §4.9 Venta a costo cero directa (mermas y retornos) ──
// Sin pedido: producto quemado (stock muere) o retorno a producción (sale del
// local y entra a la sucursal Producción como insumo). No mueve caja.
export async function registrarCostoCero(params: {
  usuarioId: number;
  sucursalId?: number;
  productoId: number;
  cantidad: number;
  tipo: TipoCostoCero;
  motivo?: string;
}) {
  const sucursalId = await resolverSucursalOperativa(params.usuarioId, params.sucursalId);

  const producto = await prisma.producto.findUnique({ where: { id: params.productoId } });
  if (!producto || !producto.activo) throw Errores.noEncontrado('Producto');
  if (producto.tipo === 'COMBO') {
    throw Errores.validacion('Las mermas se registran por producto, no por combo');
  }

  const sucursalProduccion = await prisma.sucursal.findFirst({ where: { tipo: 'PRODUCCION' } });
  if (params.tipo === 'RETORNO_A_PRODUCCION' && !sucursalProduccion) {
    throw Errores.noEncontrado('Sucursal de producción');
  }

  return prisma.$transaction(async (tx) => {
    await exigirTurnoAbierto(sucursalId, tx);

    const cantidad = new Prisma.Decimal(params.cantidad);
    const stock = await obtenerStock(params.productoId, sucursalId, tx);
    if (stock.lessThan(cantidad)) {
      throw Errores.stockInsuficiente(
        `"${producto.nombre}" — disponible ${stock.toString()}, a registrar ${cantidad.toString()}`,
      );
    }

    const tipoMovimiento = params.tipo === 'DESPERDICIO_QUEMADO' ? 'MERMA_QUEMADO' : 'RETORNO_A_PRODUCCION';

    const salida = await tx.movimientoStock.create({
      data: {
        productoId: params.productoId,
        sucursalId,
        tipo: tipoMovimiento,
        cantidad: cantidad.negated(),
        usuarioId: params.usuarioId,
        tipoOrigen: 'VentaCostoCero',
        origenId: 0,
      },
    });
    // la referencia polimórfica apunta al propio movimiento de salida
    await tx.movimientoStock.update({ where: { id: salida.id }, data: { origenId: salida.id } });

    if (params.tipo === 'RETORNO_A_PRODUCCION') {
      // entra a Producción como insumo (mismo producto — un producto puede ser
      // vendible e insumo a la vez, CLAUDE.md §9). NOTA pendiente: para que
      // producción lo consuma por partida haría falta generarle una
      // LineaIngreso — se define con el cliente (ver CLAUDE-MODULO-2.md §11).
      await tx.movimientoStock.create({
        data: {
          productoId: params.productoId,
          sucursalId: sucursalProduccion!.id,
          tipo: 'RETORNO_A_PRODUCCION',
          cantidad,
          usuarioId: params.usuarioId,
          tipoOrigen: 'VentaCostoCero',
          origenId: salida.id,
        },
      });
    }

    await registrarAuditoria(tx, {
      accion: 'VENTA_COSTO_CERO',
      entidad: 'MovimientoStock',
      entidadId: salida.id,
      usuarioId: params.usuarioId,
      datosNuevos: {
        producto: producto.nombre,
        cantidad: params.cantidad,
        tipo: params.tipo,
        motivo: params.motivo ?? null,
        sucursalId,
      },
    });

    return { id: salida.id, producto: producto.nombre, cantidad: params.cantidad, tipo: params.tipo };
  }, OPCIONES_TX);
}
