import { Prisma, type EstadoPedido, type MedioPago, type Producto, type TipoPedido } from '@prisma/client';
import { prisma, OPCIONES_TX, type TxClient } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';
import { NOMBRE_POLLO_ENTERO, NOMBRE_POLLO_MEDIO, NOMBRE_POLLO_MARCADO } from '../../lib/constantes';
import { obtenerStock } from '../stock/stock.service';
import { tablaPrecioVigente } from '../productos/productos.service';
import { resolverSucursalOperativa, exigirTurnoAbierto } from '../turnos/turnos.service';
import {
  calcularPrecioTotal,
  precioUnitarioReferencia,
  calcularCobro,
  transicionValida,
  esModificable,
} from './pedidos.calculos';
import { emitirTicket } from './comandera';
import * as stockMinimoService from '../stock-minimo/stock-minimo.service';
import * as alertasService from '../alertas/alertas.service';

const CERO = new Prisma.Decimal(0);
const MEDIO_POLLO = new Prisma.Decimal('0.5');

// Guard atómico contra carreras (doble click / requests en paralelo): el
// cambio de estado se condiciona al estado LEÍDO antes de la transacción.
// El UPDATE toma row lock hasta el commit, así que dos transacciones
// concurrentes se serializan; la que pierde re-evalúa el WHERE contra el
// estado nuevo, obtiene count=0 y corta acá — sin doble cobro, sin doble
// reposición de stock, sin pedido reasignado dos veces.
async function transicionarAtomico(
  tx: TxClient,
  pedidoId: number,
  desde: EstadoPedido,
  data: Prisma.PedidoUpdateManyMutationInput,
): Promise<void> {
  const r = await tx.pedido.updateMany({ where: { id: pedidoId, estado: desde }, data });
  if (r.count === 0) throw Errores.estadoPedidoInvalido(desde, (data.estado as EstadoPedido) ?? desde);
}

export interface ItemInput {
  productoId: number;
  cantidad: number;
  aclaraciones?: string;
}

const INCLUDE_PEDIDO = {
  sucursal: { select: { nombre: true } },
  usuarioCajero: { select: { username: true } },
  items: { include: { producto: { select: { nombre: true, tipo: true } } } },
  pagos: true,
} as const;

// ── Resolución de descuento de stock (CLAUDE-MODULO-2.md §4.3/§4.10/§6.3) ──
// Un combo descuenta cada componente, nunca el combo. El pollo (entero o
// medio) descuenta del producto MARCADO, nunca del fresco — también cuando
// viene adentro de un combo.
export type Requerimiento = Map<number, Prisma.Decimal>; // productoId → cantidad a descontar

function agregar(reqs: Requerimiento, productoId: number, cantidad: Prisma.Decimal) {
  reqs.set(productoId, (reqs.get(productoId) ?? CERO).plus(cantidad));
}

// Exportado: lo reutilizan atenciones y ventas a costo cero (módulo caja)
export async function resolverRequerimientosStock(
  tx: TxClient,
  items: { productoId: number; cantidad: Prisma.Decimal }[],
): Promise<Requerimiento> {
  const marcado = await tx.producto.findUnique({ where: { nombre: NOMBRE_POLLO_MARCADO } });
  const reqs: Requerimiento = new Map();

  const resolverUnidad = (producto: Pick<Producto, 'id' | 'nombre'>, cantidad: Prisma.Decimal) => {
    if (marcado && producto.nombre === NOMBRE_POLLO_ENTERO) {
      agregar(reqs, marcado.id, cantidad);
    } else if (marcado && producto.nombre === NOMBRE_POLLO_MEDIO) {
      agregar(reqs, marcado.id, cantidad.mul(MEDIO_POLLO));
    } else {
      agregar(reqs, producto.id, cantidad);
    }
  };

  for (const item of items) {
    const producto = await tx.producto.findUnique({
      where: { id: item.productoId },
      include: { componentesDelCombo: { include: { productoComponente: true } } },
    });
    if (!producto) throw Errores.noEncontrado('Producto');
    if (producto.tipo === 'COMBO') {
      for (const comp of producto.componentesDelCombo) {
        resolverUnidad(comp.productoComponente, comp.cantidad.mul(item.cantidad));
      }
    } else {
      resolverUnidad(producto, item.cantidad);
    }
  }
  return reqs;
}

export async function validarStockRequerido(tx: TxClient, sucursalId: number, reqs: Requerimiento) {
  for (const [productoId, cantidad] of reqs) {
    const stock = await obtenerStock(productoId, sucursalId, tx);
    if (stock.lessThan(cantidad)) {
      const producto = await tx.producto.findUnique({ where: { id: productoId } });
      throw Errores.stockInsuficiente(
        `"${producto?.nombre ?? productoId}" — disponible ${stock.toString()}, requerido ${cantidad.toString()}`,
      );
    }
  }
}

async function crearMovimientos(
  tx: TxClient,
  params: {
    reqs: Requerimiento;
    sucursalId: number;
    usuarioId: number;
    pedidoId: number;
    tipo: 'VENTA' | 'ANULACION_REPOSICION';
  },
) {
  for (const [productoId, cantidad] of params.reqs) {
    if (cantidad.isZero()) continue;
    await tx.movimientoStock.create({
      data: {
        productoId,
        sucursalId: params.sucursalId,
        tipo: params.tipo,
        cantidad: params.tipo === 'VENTA' ? cantidad.negated() : cantidad,
        usuarioId: params.usuarioId,
        tipoOrigen: 'Pedido',
        origenId: params.pedidoId,
      },
    });
  }
}

// Un operador solo toca pedidos de SU sucursal (releída de DB, nunca JWT).
async function validarUsuarioDeLaSucursal(usuarioId: number, sucursalId: number) {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario || !usuario.activo) throw Errores.noAutorizado();
  if (usuario.rol === 'ADMINISTRADOR') return;
  if (usuario.sucursalId !== sucursalId) throw Errores.sucursalNoAutorizada();
}

// Total a cobrar: suma de montos congelados, sin las líneas a costo cero
function totalDelPedido(items: { montoTotal: Prisma.Decimal; esVentaCostoCero: boolean }[]) {
  return items.filter((i) => !i.esVentaCostoCero).reduce((acc, i) => acc.plus(i.montoTotal), CERO);
}

function snapshotPedido(pedido: {
  id: number;
  tipo: string;
  estado: string;
  sucursalId: number;
  items: {
    productoId: number;
    producto?: { nombre: string };
    cantidad: Prisma.Decimal;
    montoTotal: Prisma.Decimal;
    precioUnitario: Prisma.Decimal;
    aclaraciones?: string | null;
  }[];
}) {
  return {
    id: pedido.id,
    tipo: pedido.tipo,
    estado: pedido.estado,
    sucursalId: pedido.sucursalId,
    items: pedido.items.map((i) => ({
      productoId: i.productoId,
      producto: i.producto?.nombre,
      cantidad: i.cantidad.toString(),
      montoTotal: i.montoTotal.toString(),
      precioUnitario: i.precioUnitario.toString(),
      aclaraciones: i.aclaraciones ?? null,
    })),
  };
}

// ── FLUJO 4.4/4.5 — Confirmar pedido ──
// El pedido nace confirmado (EN_PREPARACION): el "carrito" vive en el
// frontend. Acá se congela el precio, SE DESCUENTA EL STOCK (no al cobrar —
// decisión innegociable de Ariel) y sale el ticket a cocina.
export async function confirmarPedido(params: {
  usuarioId: number;
  sucursalId?: number;
  tipo: TipoPedido;
  items: ItemInput[];
  tokenIdempotencia?: string;
}) {
  if (params.items.length === 0) throw Errores.validacion('El pedido no tiene ítems');
  const sucursalId = await resolverSucursalOperativa(params.usuarioId, params.sucursalId);

  // Idempotencia: si este token ya creó un pedido (doble click, retry de
  // red), se devuelve ese pedido en vez de duplicar venta y stock.
  if (params.tokenIdempotencia) {
    const previo = await prisma.pedido.findUnique({
      where: { tokenIdempotencia: params.tokenIdempotencia },
      include: INCLUDE_PEDIDO,
    });
    if (previo) return { ...previo, avisosStockMinimo: [] };
  }

  // Precios: fuera de la tx (no cambian en el medio y ahorra round-trips)
  const lineas: {
    productoId: number;
    cantidad: number;
    aclaraciones?: string;
    montoTotal: Prisma.Decimal;
    precioUnitario: Prisma.Decimal;
  }[] = [];
  for (const item of params.items) {
    const producto = await prisma.producto.findUnique({ where: { id: item.productoId } });
    if (!producto || !producto.activo) throw Errores.noEncontrado('Producto');
    if (producto.tipo === 'MATERIA_PRIMA') {
      throw Errores.validacion(`"${producto.nombre}" es materia prima, no se vende en el POS`);
    }
    const tabla = await tablaPrecioVigente(item.productoId);
    if (tabla.length === 0) throw Errores.productoSinPrecio(producto.nombre);
    let montoTotal: Prisma.Decimal;
    try {
      montoTotal = calcularPrecioTotal(item.cantidad, tabla);
    } catch {
      throw Errores.productoSinPrecio(producto.nombre, item.cantidad);
    }
    lineas.push({
      ...item,
      montoTotal,
      precioUnitario: precioUnitarioReferencia(montoTotal, item.cantidad),
    });
  }

  const resultado = await prisma.$transaction(async (tx) => {
    const turno = await exigirTurnoAbierto(sucursalId, tx);

    const reqs = await resolverRequerimientosStock(
      tx,
      params.items.map((i) => ({ productoId: i.productoId, cantidad: new Prisma.Decimal(i.cantidad) })),
    );
    await validarStockRequerido(tx, sucursalId, reqs);

    const pedido = await tx.pedido.create({
      data: {
        turnoId: turno.id,
        sucursalId,
        tipo: params.tipo,
        usuarioCajeroId: params.usuarioId,
        tokenIdempotencia: params.tokenIdempotencia,
        items: {
          create: lineas.map((l) => ({
            productoId: l.productoId,
            cantidad: new Prisma.Decimal(l.cantidad),
            montoTotal: l.montoTotal,
            precioUnitario: l.precioUnitario,
            aclaraciones: l.aclaraciones,
          })),
        },
      },
      include: INCLUDE_PEDIDO,
    });

    await crearMovimientos(tx, { reqs, sucursalId, usuarioId: params.usuarioId, pedidoId: pedido.id, tipo: 'VENTA' });

    // avisos repetidos en cada venta + alerta al admin solo al cruzar el umbral
    const stockMinimo = await stockMinimoService.evaluarTrasDescuento(tx, { sucursalId, descontado: reqs });

    await emitirTicket(tx, {
      pedidoId: pedido.id,
      tipo: 'NUEVO',
      sucursalId,
      items: pedido.items.map((i) => ({
        producto: i.producto.nombre,
        cantidad: i.cantidad.toString(),
        aclaraciones: i.aclaraciones,
      })),
    });

    await registrarAuditoria(tx, {
      accion: 'CONFIRMAR_PEDIDO',
      entidad: 'Pedido',
      entidadId: pedido.id,
      usuarioId: params.usuarioId,
      datosNuevos: snapshotPedido(pedido),
    });

    return { pedido, stockMinimo };
  }, OPCIONES_TX).catch(async (e) => {
    // Carrera pura de idempotencia: dos requests con el MISMO token pasaron
    // el check inicial en paralelo; la que pierde revienta contra el unique
    // y su transacción se revierte entera (el stock NO se descontó dos
    // veces). Se le responde el pedido que ganó, como a cualquier retry.
    if (
      params.tokenIdempotencia &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      const previo = await prisma.pedido.findUnique({
        where: { tokenIdempotencia: params.tokenIdempotencia },
        include: INCLUDE_PEDIDO,
      });
      if (previo) return { pedido: previo, stockMinimo: { avisos: [], alertas: [] } };
    }
    throw e;
  });

  stockMinimoService.emitirAlertasStockMinimo(resultado.stockMinimo.alertas);
  alertasService.emitirAAdmins('ticket:nuevo', { pedidoId: resultado.pedido.id });

  return { ...resultado.pedido, avisosStockMinimo: resultado.stockMinimo.avisos };
}

// ── FLUJO 4.6 — Modificar pedido confirmado ──
// Reemplaza la lista de ítems; ajusta stock por la DIFERENCIA neta, manda
// ticket de actualización y audita antes/después.
export async function modificarPedido(params: { pedidoId: number; items: ItemInput[]; usuarioId: number }) {
  if (params.items.length === 0) throw Errores.validacion('El pedido no puede quedar sin ítems');
  const existente = await prisma.pedido.findUnique({
    where: { id: params.pedidoId },
    include: INCLUDE_PEDIDO,
  });
  if (!existente) throw Errores.noEncontrado('Pedido');
  await validarUsuarioDeLaSucursal(params.usuarioId, existente.sucursalId);
  if (!esModificable(existente.estado)) throw Errores.pedidoNoModificable(existente.estado);
  if (existente.pagos.length > 0) throw Errores.pedidoNoModificable('con pagos registrados');

  // Precios nuevos, mismo criterio que al confirmar
  const lineas: {
    productoId: number;
    cantidad: number;
    aclaraciones?: string;
    montoTotal: Prisma.Decimal;
    precioUnitario: Prisma.Decimal;
  }[] = [];
  for (const item of params.items) {
    const producto = await prisma.producto.findUnique({ where: { id: item.productoId } });
    if (!producto || !producto.activo) throw Errores.noEncontrado('Producto');
    if (producto.tipo === 'MATERIA_PRIMA') {
      throw Errores.validacion(`"${producto.nombre}" es materia prima, no se vende en el POS`);
    }
    const tabla = await tablaPrecioVigente(item.productoId);
    let montoTotal: Prisma.Decimal;
    try {
      montoTotal = calcularPrecioTotal(item.cantidad, tabla);
    } catch {
      throw Errores.productoSinPrecio(producto.nombre, item.cantidad);
    }
    lineas.push({ ...item, montoTotal, precioUnitario: precioUnitarioReferencia(montoTotal, item.cantidad) });
  }

  const resultado = await prisma.$transaction(async (tx) => {
    // Guard no-op: no cambia el estado pero toma el row lock condicionado al
    // estado leído — serializa contra un cobro/anulación concurrente (si el
    // pedido dejó de ser modificable en el medio, corta acá).
    await transicionarAtomico(tx, existente.id, existente.estado, { estado: existente.estado });

    const reqsAnteriores = await resolverRequerimientosStock(
      tx,
      existente.items.map((i) => ({ productoId: i.productoId, cantidad: i.cantidad })),
    );
    const reqsNuevos = await resolverRequerimientosStock(
      tx,
      params.items.map((i) => ({ productoId: i.productoId, cantidad: new Prisma.Decimal(i.cantidad) })),
    );

    // Diferencia neta por producto: positivo = descuento extra, negativo = reposición
    const productosAfectados = new Set([...reqsAnteriores.keys(), ...reqsNuevos.keys()]);
    const extra: Requerimiento = new Map();
    const reponer: Requerimiento = new Map();
    for (const productoId of productosAfectados) {
      const delta = (reqsNuevos.get(productoId) ?? CERO).minus(reqsAnteriores.get(productoId) ?? CERO);
      if (delta.greaterThan(0)) extra.set(productoId, delta);
      if (delta.lessThan(0)) reponer.set(productoId, delta.negated());
    }
    await validarStockRequerido(tx, existente.sucursalId, extra);

    await tx.itemDePedido.deleteMany({ where: { pedidoId: existente.id } });
    const actualizado = await tx.pedido.update({
      where: { id: existente.id },
      data: {
        items: {
          create: lineas.map((l) => ({
            productoId: l.productoId,
            cantidad: new Prisma.Decimal(l.cantidad),
            montoTotal: l.montoTotal,
            precioUnitario: l.precioUnitario,
            aclaraciones: l.aclaraciones,
          })),
        },
      },
      include: INCLUDE_PEDIDO,
    });

    await crearMovimientos(tx, { reqs: extra, sucursalId: existente.sucursalId, usuarioId: params.usuarioId, pedidoId: existente.id, tipo: 'VENTA' });
    await crearMovimientos(tx, { reqs: reponer, sucursalId: existente.sucursalId, usuarioId: params.usuarioId, pedidoId: existente.id, tipo: 'ANULACION_REPOSICION' });

    const stockMinimo = await stockMinimoService.evaluarTrasDescuento(tx, {
      sucursalId: existente.sucursalId,
      descontado: extra,
    });

    await emitirTicket(tx, {
      pedidoId: existente.id,
      tipo: 'ACTUALIZACION',
      sucursalId: existente.sucursalId,
      items: actualizado.items.map((i) => ({
        producto: i.producto.nombre,
        cantidad: i.cantidad.toString(),
        aclaraciones: i.aclaraciones,
      })),
    });

    await registrarAuditoria(tx, {
      accion: 'MODIFICAR_PEDIDO',
      entidad: 'Pedido',
      entidadId: existente.id,
      usuarioId: params.usuarioId,
      datosAnteriores: snapshotPedido(existente),
      datosNuevos: snapshotPedido(actualizado),
    });

    return { pedido: actualizado, stockMinimo };
  }, OPCIONES_TX);

  stockMinimoService.emitirAlertasStockMinimo(resultado.stockMinimo.alertas);
  alertasService.emitirAAdmins('ticket:actualizacion', { pedidoId: existente.id });

  return { ...resultado.pedido, avisosStockMinimo: resultado.stockMinimo.avisos };
}

// ── FLUJO 4.7 — Cobro (pagos combinables + vuelto automático) ──
// El vuelto sale solo del efectivo; el Pago EFECTIVO se registra NETO de
// vuelto (lo que efectivamente queda en la caja — así el arqueo cuadra).
export async function cobrarPedido(params: {
  pedidoId: number;
  pagos: { medio: MedioPago; monto: number }[];
  usuarioId: number;
}) {
  const pedido = await prisma.pedido.findUnique({ where: { id: params.pedidoId }, include: INCLUDE_PEDIDO });
  if (!pedido) throw Errores.noEncontrado('Pedido');
  await validarUsuarioDeLaSucursal(params.usuarioId, pedido.sucursalId);
  if (!transicionValida(pedido.estado, 'ENTREGADO')) {
    throw Errores.estadoPedidoInvalido(pedido.estado, 'ENTREGADO');
  }

  const total = totalDelPedido(pedido.items);
  let cobro: { vuelto: Prisma.Decimal; efectivoNeto: Prisma.Decimal };
  try {
    cobro = calcularCobro({
      totalPedido: total,
      pagos: params.pagos.map((p) => ({ medio: p.medio, monto: new Prisma.Decimal(p.monto) })),
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'PAGO_INSUFICIENTE') throw Errores.pagoInsuficiente();
    if (e instanceof Error && e.message === 'VUELTO_SIN_EFECTIVO') throw Errores.vueltoSinEfectivo();
    throw e;
  }

  const actualizado = await prisma.$transaction(async (tx) => {
    const pagosAPersistir = params.pagos
      .map((p) =>
        p.medio === 'EFECTIVO'
          ? { medio: p.medio, monto: cobro.efectivoNeto }
          : { medio: p.medio, monto: new Prisma.Decimal(p.monto) },
      )
      .filter((p) => p.monto.greaterThan(0));

    await transicionarAtomico(tx, pedido.id, pedido.estado, {
      estado: 'ENTREGADO',
      fechaCierre: new Date(),
    });
    const cobrado = await tx.pedido.update({
      where: { id: pedido.id },
      data: { pagos: { create: pagosAPersistir } },
      include: INCLUDE_PEDIDO,
    });

    await registrarAuditoria(tx, {
      accion: 'COBRAR_PEDIDO',
      entidad: 'Pedido',
      entidadId: pedido.id,
      usuarioId: params.usuarioId,
      datosNuevos: {
        total: total.toString(),
        pagos: pagosAPersistir.map((p) => ({ medio: p.medio, monto: p.monto.toString() })),
        vuelto: cobro.vuelto.toString(),
      },
    });

    return cobrado;
  }, OPCIONES_TX);

  return { pedido: actualizado, vuelto: cobro.vuelto.toString() };
}

// ── Cambios de estado simples ──

async function cambiarEstado(params: {
  pedidoId: number;
  hacia: EstadoPedido;
  usuarioId: number;
  accion: string;
}) {
  const pedido = await prisma.pedido.findUnique({ where: { id: params.pedidoId }, include: INCLUDE_PEDIDO });
  if (!pedido) throw Errores.noEncontrado('Pedido');
  await validarUsuarioDeLaSucursal(params.usuarioId, pedido.sucursalId);
  if (!transicionValida(pedido.estado, params.hacia)) {
    throw Errores.estadoPedidoInvalido(pedido.estado, params.hacia);
  }

  return prisma.$transaction(async (tx) => {
    await transicionarAtomico(tx, pedido.id, pedido.estado, { estado: params.hacia });
    const actualizado = await tx.pedido.findUniqueOrThrow({
      where: { id: pedido.id },
      include: INCLUDE_PEDIDO,
    });
    await registrarAuditoria(tx, {
      accion: params.accion,
      entidad: 'Pedido',
      entidadId: pedido.id,
      usuarioId: params.usuarioId,
      datosAnteriores: { estado: pedido.estado },
      datosNuevos: { estado: params.hacia },
    });
    return actualizado;
  }, OPCIONES_TX);
}

export const marcarListo = (pedidoId: number, usuarioId: number) =>
  cambiarEstado({ pedidoId, hacia: 'LISTO', usuarioId, accion: 'MARCAR_PEDIDO_LISTO' });

export const marcarNoRetirado = (pedidoId: number, usuarioId: number) =>
  cambiarEstado({ pedidoId, hacia: 'LISTO_NO_RETIRADO', usuarioId, accion: 'PEDIDO_NO_RETIRADO' });

// ── FLUJO 6.5 — Pedido no retirado: reasignar o perder ──

// Reasignar: otro cliente se lleva lo ya preparado. El pedido original pasa a
// REASIGNADO; se crea uno nuevo (LISTO, mismos precios congelados) vinculado
// por pedidoOrigenId. El stock NO se toca: ya se descontó en el original.
export async function reasignarPedido(params: { pedidoId: number; usuarioId: number }) {
  const original = await prisma.pedido.findUnique({ where: { id: params.pedidoId }, include: INCLUDE_PEDIDO });
  if (!original) throw Errores.noEncontrado('Pedido');
  await validarUsuarioDeLaSucursal(params.usuarioId, original.sucursalId);
  if (!transicionValida(original.estado, 'REASIGNADO')) {
    throw Errores.estadoPedidoInvalido(original.estado, 'REASIGNADO');
  }

  return prisma.$transaction(async (tx) => {
    const turno = await exigirTurnoAbierto(original.sucursalId, tx);

    await transicionarAtomico(tx, original.id, original.estado, { estado: 'REASIGNADO' });

    const nuevo = await tx.pedido.create({
      data: {
        turnoId: turno.id,
        sucursalId: original.sucursalId,
        tipo: 'PRESENCIAL',
        estado: 'LISTO',
        usuarioCajeroId: params.usuarioId,
        pedidoOrigenId: original.id,
        items: {
          create: original.items.map((i) => ({
            productoId: i.productoId,
            cantidad: i.cantidad,
            montoTotal: i.montoTotal,
            precioUnitario: i.precioUnitario,
            aclaraciones: i.aclaraciones,
          })),
        },
      },
      include: INCLUDE_PEDIDO,
    });

    await registrarAuditoria(tx, {
      accion: 'REASIGNAR_PEDIDO',
      entidad: 'Pedido',
      entidadId: original.id,
      usuarioId: params.usuarioId,
      datosAnteriores: { estado: original.estado },
      datosNuevos: { estado: 'REASIGNADO', pedidoNuevoId: nuevo.id },
    });

    return nuevo;
  }, OPCIONES_TX);
}

// Perdido: el producto se tira. El stock ya estaba descontado (no se repone);
// las líneas quedan marcadas como venta a costo cero DESPERDICIO_QUEMADO para
// el reporte de quemados por producto.
export async function marcarPerdido(params: { pedidoId: number; usuarioId: number }) {
  const pedido = await prisma.pedido.findUnique({ where: { id: params.pedidoId }, include: INCLUDE_PEDIDO });
  if (!pedido) throw Errores.noEncontrado('Pedido');
  await validarUsuarioDeLaSucursal(params.usuarioId, pedido.sucursalId);
  if (!transicionValida(pedido.estado, 'PERDIDO')) {
    throw Errores.estadoPedidoInvalido(pedido.estado, 'PERDIDO');
  }

  return prisma.$transaction(async (tx) => {
    await transicionarAtomico(tx, pedido.id, pedido.estado, {
      estado: 'PERDIDO',
      fechaCierre: new Date(),
    });
    await tx.itemDePedido.updateMany({
      where: { pedidoId: pedido.id },
      data: { esVentaCostoCero: true, tipoCostoCero: 'DESPERDICIO_QUEMADO' },
    });
    const actualizado = await tx.pedido.findUniqueOrThrow({
      where: { id: pedido.id },
      include: INCLUDE_PEDIDO,
    });
    await registrarAuditoria(tx, {
      accion: 'MARCAR_PEDIDO_PERDIDO',
      entidad: 'Pedido',
      entidadId: pedido.id,
      usuarioId: params.usuarioId,
      datosAnteriores: { estado: pedido.estado },
      datosNuevos: snapshotPedido(actualizado),
    });
    return actualizado;
  }, OPCIONES_TX);
}

// ── FLUJO 4.6 — Anulación ──
// Repone TODO el stock, ticket de anulación a cocina, y el pedido COMPLETO
// (ítems y precios) queda en datosAnteriores de la auditoría — regla
// explícita del cliente.
export async function anularPedido(params: { pedidoId: number; usuarioId: number }) {
  const pedido = await prisma.pedido.findUnique({ where: { id: params.pedidoId }, include: INCLUDE_PEDIDO });
  if (!pedido) throw Errores.noEncontrado('Pedido');
  await validarUsuarioDeLaSucursal(params.usuarioId, pedido.sucursalId);
  if (!transicionValida(pedido.estado, 'ANULADO')) {
    throw Errores.estadoPedidoInvalido(pedido.estado, 'ANULADO');
  }

  const anulado = await prisma.$transaction(async (tx) => {
    // El guard va PRIMERO: dos anulaciones en paralelo repondrían el stock
    // dos veces — la que pierde la carrera corta acá.
    await transicionarAtomico(tx, pedido.id, pedido.estado, {
      estado: 'ANULADO',
      fechaCierre: new Date(),
    });

    const reqs = await resolverRequerimientosStock(
      tx,
      pedido.items.map((i) => ({ productoId: i.productoId, cantidad: i.cantidad })),
    );

    const actualizado = await tx.pedido.findUniqueOrThrow({
      where: { id: pedido.id },
      include: INCLUDE_PEDIDO,
    });

    await crearMovimientos(tx, {
      reqs,
      sucursalId: pedido.sucursalId,
      usuarioId: params.usuarioId,
      pedidoId: pedido.id,
      tipo: 'ANULACION_REPOSICION',
    });

    await emitirTicket(tx, {
      pedidoId: pedido.id,
      tipo: 'ANULACION',
      sucursalId: pedido.sucursalId,
      items: pedido.items.map((i) => ({
        producto: i.producto.nombre,
        cantidad: i.cantidad.toString(),
        aclaraciones: i.aclaraciones,
      })),
    });

    await registrarAuditoria(tx, {
      accion: 'ANULAR_PEDIDO',
      entidad: 'Pedido',
      entidadId: pedido.id,
      usuarioId: params.usuarioId,
      // snapshot COMPLETO tal como estaba — no solo "fue anulado"
      datosAnteriores: snapshotPedido(pedido),
      datosNuevos: { estado: 'ANULADO' },
    });

    return actualizado;
  }, OPCIONES_TX);

  alertasService.emitirAAdmins('ticket:anulacion', { pedidoId: pedido.id });
  return anulado;
}

// ── Consultas ──

export async function listarPendientes(params: { usuarioId: number; sucursalId?: number }) {
  const sucursalId = await resolverSucursalOperativa(params.usuarioId, params.sucursalId);
  return prisma.pedido.findMany({
    where: { sucursalId, estado: { in: ['EN_PREPARACION', 'LISTO', 'LISTO_NO_RETIRADO'] } },
    include: INCLUDE_PEDIDO,
    orderBy: { fechaCreacion: 'asc' },
  });
}

// Ranking de más vendidos de la sucursal (CLAUDE-MODULO-2.md §4.1): el POS
// ordena su grilla con esto. Se calcula del historial completo de ItemDePedido
// (pedidos no anulados); un producto sin ventas simplemente no aparece y el
// frontend lo manda al final.
export async function masVendidos(params: { usuarioId: number; sucursalId?: number }) {
  const sucursalId = await resolverSucursalOperativa(params.usuarioId, params.sucursalId);
  const agregado = await prisma.itemDePedido.groupBy({
    by: ['productoId'],
    where: { pedido: { sucursalId, estado: { not: 'ANULADO' } } },
    _sum: { cantidad: true },
    orderBy: { _sum: { cantidad: 'desc' } },
  });
  return agregado.map((a) => ({
    productoId: a.productoId,
    unidades: (a._sum.cantidad ?? new Prisma.Decimal(0)).toString(),
  }));
}

export async function obtener(pedidoId: number, usuarioId: number) {
  const pedido = await prisma.pedido.findUnique({ where: { id: pedidoId }, include: INCLUDE_PEDIDO });
  if (!pedido) throw Errores.noEncontrado('Pedido');
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (usuario && (usuario.rol === 'ADMINISTRADOR' || usuario.rol === 'SOCIO')) return pedido;
  await validarUsuarioDeLaSucursal(usuarioId, pedido.sucursalId);
  return pedido;
}
