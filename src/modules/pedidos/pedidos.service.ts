import {
  Prisma,
  type BeneficiarioPedido,
  type EstadoPedido,
  type MedioPago,
  type Producto,
  type SocioRetiro,
  type TipoPedido,
} from '@prisma/client';
import { prisma, OPCIONES_TX, type TxClient } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';
import { NOMBRE_POLLO_ENTERO, NOMBRE_POLLO_MEDIO, NOMBRE_POLLO_MARCADO } from '../../lib/constantes';
import { obtenerStock, bloquearStock } from '../stock/stock.service';
import { tablasPrecioVigentesDe } from '../productos/productos.service';
import { resolverSucursalOperativa, exigirTurnoAbierto } from '../turnos/turnos.service';
import {
  calcularPrecioTotal,
  precioUnitarioReferencia,
  calcularCobro,
  calcularRecargo,
  aplicarDescuentoEmpleado,
  transicionValida,
  esModificable,
} from './pedidos.calculos';
import { admiteRecargo } from '../recargos/recargos.service';
import * as configuracionService from '../configuracion/configuracion.service';
import { registrarTicket, despacharEnSegundoPlano } from '../comanderas/comanderas.service';
import { calcularCambios, type ItemTicket } from '../comanderas/escpos';
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

// ── Resolución de descuento de stock (CLAUDE.md §5 Flujo 4) ──
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

  // Una sola query para todos los productos del pedido: antes era un
  // findUnique por ítem, y cada uno dentro de la transacción son ~52 ms de
  // locks sostenidos de más (auditoría 2026-08-07, C-6).
  const productos = await tx.producto.findMany({
    where: { id: { in: [...new Set(items.map((i) => i.productoId))] } },
    include: { componentesDelCombo: { include: { productoComponente: true } } },
  });
  const porId = new Map(productos.map((p) => [p.id, p]));

  for (const item of items) {
    const producto = porId.get(item.productoId);
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
  // Traba todos los productos del pedido antes de mirar ningún saldo: leer sin
  // el lock deja la puerta abierta a que otra venta descuente en el medio y el
  // stock termine negativo (auditoría 2026-08-07, C-1).
  await bloquearStock(tx, [...reqs.keys()].map((productoId) => ({ productoId, sucursalId })));
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
  // createMany y no un create por producto: era un round-trip por línea
  // ADENTRO de la transacción, o sea locks sostenidos de más (C-6).
  const filas = [...params.reqs]
    .filter(([, cantidad]) => !cantidad.isZero())
    .map(([productoId, cantidad]) => ({
      productoId,
      sucursalId: params.sucursalId,
      tipo: params.tipo,
      cantidad: params.tipo === 'VENTA' ? cantidad.negated() : cantidad,
      usuarioId: params.usuarioId,
      tipoOrigen: 'Pedido',
      origenId: params.pedidoId,
    }));
  if (filas.length === 0) return;
  await tx.movimientoStock.createMany({ data: filas });
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

// Lo que va al papel de cocina: producto, cantidad y aclaración. Nada de
// precios ni totales — el ticket de mostrador lo ve el cajero, que por el
// Control Ciego (CLAUDE.md §2) no puede ver importes.
function itemsDeTicket(
  items: { producto: { nombre: string }; cantidad: Prisma.Decimal; aclaraciones?: string | null }[],
): ItemTicket[] {
  return items.map((i) => ({
    producto: i.producto.nombre,
    cantidad: i.cantidad.toString(),
    aclaraciones: i.aclaraciones ?? null,
  }));
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
  /**
   * Retiro de socio / venta a empleado (reunión 4/8). El SOCIO se lleva la
   * mercadería a costo cero (el retiro de PLATA sigue en Operaciones de caja);
   * al EMPLEADO se le aplica el descuento configurado por el admin.
   */
  beneficiario?: BeneficiarioPedido;
  socioBeneficiario?: SocioRetiro;
  nombreCliente?: string;
  horaEntregaSolicitada?: string;
}) {
  if (params.items.length === 0) throw Errores.validacion('El pedido no tiene ítems');
  if (params.beneficiario === 'SOCIO' && !params.socioBeneficiario) {
    throw Errores.validacion('Indicá qué socio retira la mercadería');
  }
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

  // % congelado al confirmar: si el admin lo cambia mañana, este pedido
  // conserva el que se le aplicó hoy.
  const descuentoPct =
    params.beneficiario === 'EMPLEADO' ? await configuracionService.descuentoEmpleadoPct() : null;

  // Precios: fuera de la tx (no cambian en el medio y ahorra round-trips)
  const lineas: {
    productoId: number;
    cantidad: number;
    aclaraciones?: string;
    montoTotal: Prisma.Decimal;
    precioUnitario: Prisma.Decimal;
  }[] = [];
  // Dos queries para todo el pedido en vez de dos por ítem (C-6).
  const idsPedidos = params.items.map((i) => i.productoId);
  const productos = await prisma.producto.findMany({ where: { id: { in: idsPedidos } } });
  const productoPorId = new Map(productos.map((p) => [p.id, p]));
  const tablasPorProducto = await tablasPrecioVigentesDe(idsPedidos);

  for (const item of params.items) {
    const producto = productoPorId.get(item.productoId);
    if (!producto || !producto.activo) throw Errores.noEncontrado('Producto');
    if (producto.tipo === 'MATERIA_PRIMA') {
      throw Errores.validacion(`"${producto.nombre}" es materia prima, no se vende en el POS`);
    }
    const tabla = tablasPorProducto.get(item.productoId) ?? [];
    if (tabla.length === 0) throw Errores.productoSinPrecio(producto.nombre);
    let montoTotal: Prisma.Decimal;
    try {
      montoTotal = calcularPrecioTotal(item.cantidad, tabla);
    } catch {
      throw Errores.productoSinPrecio(producto.nombre, item.cantidad);
    }
    // Socio: se lo lleva sin pagar. Empleado: paga con descuento.
    if (params.beneficiario === 'SOCIO') montoTotal = CERO;
    else if (descuentoPct) montoTotal = aplicarDescuentoEmpleado(montoTotal, descuentoPct);

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
        beneficiario: params.beneficiario,
        socioBeneficiario: params.socioBeneficiario,
        descuentoPct,
        nombreCliente: params.nombreCliente,
        horaEntregaSolicitada: params.horaEntregaSolicitada,
        items: {
          create: lineas.map((l) => ({
            productoId: l.productoId,
            cantidad: new Prisma.Decimal(l.cantidad),
            montoTotal: l.montoTotal,
            precioUnitario: l.precioUnitario,
            aclaraciones: l.aclaraciones,
            // El retiro del socio sale del stock pero NO es venta: queda
            // fuera de todos los totales de facturación.
            esVentaCostoCero: params.beneficiario === 'SOCIO',
            tipoCostoCero: params.beneficiario === 'SOCIO' ? ('RETIRO_SOCIO' as const) : undefined,
          })),
        },
      },
      include: INCLUDE_PEDIDO,
    });

    await crearMovimientos(tx, { reqs, sucursalId, usuarioId: params.usuarioId, pedidoId: pedido.id, tipo: 'VENTA' });

    // avisos repetidos en cada venta + alerta al admin solo al cruzar el umbral
    const stockMinimo = await stockMinimoService.evaluarTrasDescuento(tx, { sucursalId, descontado: reqs });

    const ticket = await registrarTicket(tx, {
      pedidoId: pedido.id,
      tipo: 'NUEVO',
      sucursalId,
      sucursal: pedido.sucursal.nombre,
      tipoPedido: pedido.tipo,
      fechaHora: pedido.fechaCreacion.toISOString(),
      items: itemsDeTicket(pedido.items),
      nombreCliente: pedido.nombreCliente ?? undefined,
      horaEntregaSolicitada: pedido.horaEntregaSolicitada ?? undefined,
    });

    await registrarAuditoria(tx, {
      accion: 'CONFIRMAR_PEDIDO',
      entidad: 'Pedido',
      entidadId: pedido.id,
      usuarioId: params.usuarioId,
      datosNuevos: snapshotPedido(pedido),
    });

    return { pedido, stockMinimo, ticketId: ticket.id };
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
      // Retry de un pedido ya creado: no se reimprime (la comanda salió con
      // el pedido original) ni se devuelve ticketId nuevo.
      if (previo) return { pedido: previo, stockMinimo: { avisos: [], alertas: [] }, ticketId: null };
    }
    throw e;
  });

  stockMinimoService.emitirAlertasStockMinimo(resultado.stockMinimo.alertas);
  alertasService.emitirAAdmins('ticket:nuevo', { pedidoId: resultado.pedido.id });
  // Recién acá, con la transacción ya commiteada: el pedido está a salvo pase
  // lo que pase con las impresoras (ver comanderas.service.ts::registrarTicket).
  if (resultado.ticketId) despacharEnSegundoPlano(resultado.ticketId);

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
  const idsModificados = params.items.map((i) => i.productoId);
  const productosMod = await prisma.producto.findMany({ where: { id: { in: idsModificados } } });
  const productoModPorId = new Map(productosMod.map((p) => [p.id, p]));
  const tablasMod = await tablasPrecioVigentesDe(idsModificados);

  for (const item of params.items) {
    const producto = productoModPorId.get(item.productoId);
    if (!producto || !producto.activo) throw Errores.noEncontrado('Producto');
    if (producto.tipo === 'MATERIA_PRIMA') {
      throw Errores.validacion(`"${producto.nombre}" es materia prima, no se vende en el POS`);
    }
    const tabla = tablasMod.get(item.productoId) ?? [];
    let montoTotal: Prisma.Decimal;
    try {
      montoTotal = calcularPrecioTotal(item.cantidad, tabla);
    } catch {
      throw Errores.productoSinPrecio(producto.nombre, item.cantidad);
    }
    // Se respeta el beneficiario con el que nació el pedido: si era retiro de
    // socio sigue en cero, y si era de empleado se reaplica el MISMO % que se
    // le congeló al confirmar, no el que esté configurado hoy.
    if (existente.beneficiario === 'SOCIO') montoTotal = CERO;
    else if (existente.descuentoPct) {
      montoTotal = aplicarDescuentoEmpleado(montoTotal, existente.descuentoPct);
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
            esVentaCostoCero: existente.beneficiario === 'SOCIO',
            tipoCostoCero: existente.beneficiario === 'SOCIO' ? ('RETIRO_SOCIO' as const) : undefined,
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

    const ticket = await registrarTicket(tx, {
      pedidoId: existente.id,
      tipo: 'ACTUALIZACION',
      sucursalId: existente.sucursalId,
      sucursal: actualizado.sucursal.nombre,
      tipoPedido: actualizado.tipo,
      fechaHora: new Date().toISOString(),
      items: itemsDeTicket(actualizado.items),
      // CLAUDE.md §5: un ACTUALIZACION tiene que dejar ver QUÉ cambió, no
      // repetir el pedido entero — si no, el cocinero compara dos tickets a
      // mano en plena cocina y se le pasa algo.
      cambios: calcularCambios(itemsDeTicket(existente.items), itemsDeTicket(actualizado.items)),
      nombreCliente: actualizado.nombreCliente ?? undefined,
      horaEntregaSolicitada: actualizado.horaEntregaSolicitada ?? undefined,
    });

    await registrarAuditoria(tx, {
      accion: 'MODIFICAR_PEDIDO',
      entidad: 'Pedido',
      entidadId: existente.id,
      usuarioId: params.usuarioId,
      datosAnteriores: snapshotPedido(existente),
      datosNuevos: snapshotPedido(actualizado),
    });

    return { pedido: actualizado, stockMinimo, ticketId: ticket.id };
  }, OPCIONES_TX);

  stockMinimoService.emitirAlertasStockMinimo(resultado.stockMinimo.alertas);
  alertasService.emitirAAdmins('ticket:actualizacion', { pedidoId: existente.id });
  despacharEnSegundoPlano(resultado.ticketId);

  return { ...resultado.pedido, avisosStockMinimo: resultado.stockMinimo.avisos };
}

// ── FLUJO 4.7 — Cobro (pagos combinables + vuelto automático) ──
// El vuelto sale solo del efectivo; el Pago EFECTIVO se registra NETO de
// vuelto (lo que efectivamente queda en la caja — así el arqueo cuadra).
export async function cobrarPedido(params: {
  pedidoId: number;
  /**
   * `monto` es lo que cubre el pedido; `recargoPct` (solo DEBITO/CREDITO) es
   * el extra que el cliente paga por usar la tarjeta y se guarda aparte para
   * que el total del pedido siga cerrando (reunión 4/8).
   */
  pagos: { medio: MedioPago; monto: number; recargoPct?: number }[];
  /**
   * Descuento de empleado/encargado elegido AL COBRAR (post-prueba en vivo),
   * uno solo por cobro — no confundir con Pedido.descuentoPct, que es el
   * descuento de empleado congelado AL CONFIRMAR (Flujo 4 original). Este se
   * resta del total antes de calcular falta/vuelto; no toca
   * ItemDePedido.montoTotal, que sigue siendo precio de lista.
   */
  descuentoPct?: number;
  usuarioId: number;
}) {
  const pedido = await prisma.pedido.findUnique({ where: { id: params.pedidoId }, include: INCLUDE_PEDIDO });
  if (!pedido) throw Errores.noEncontrado('Pedido');
  await validarUsuarioDeLaSucursal(params.usuarioId, pedido.sucursalId);
  if (!transicionValida(pedido.estado, 'ENTREGADO')) {
    throw Errores.estadoPedidoInvalido(pedido.estado, 'ENTREGADO');
  }

  const total = totalDelPedido(pedido.items);
  // Retiro de socio: el total es 0 y no hay nada que cobrar — se cierra sin pagos.
  if (total.isZero() && params.pagos.length === 0) {
    return { pedido: await cerrarSinCobro(pedido, params.usuarioId), vuelto: '0' };
  }
  if (params.pagos.length === 0) throw Errores.pagoInsuficiente();

  const descuentoPct =
    params.descuentoPct != null && params.descuentoPct > 0 ? new Prisma.Decimal(params.descuentoPct) : null;
  const totalConDescuento = descuentoPct ? aplicarDescuentoEmpleado(total, descuentoPct) : total;
  const montoDescuento = total.minus(totalConDescuento);

  let cobro: { vuelto: Prisma.Decimal; efectivoNeto: Prisma.Decimal };
  try {
    cobro = calcularCobro({
      totalPedido: totalConDescuento,
      pagos: params.pagos.map((p) => ({ medio: p.medio, monto: new Prisma.Decimal(p.monto) })),
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'PAGO_INSUFICIENTE') throw Errores.pagoInsuficiente();
    if (e instanceof Error && e.message === 'VUELTO_SIN_EFECTIVO') throw Errores.vueltoSinEfectivo();
    throw e;
  }

  for (const p of params.pagos) {
    if (p.recargoPct != null && p.recargoPct > 0 && !admiteRecargo(p.medio)) {
      throw Errores.medioSinRecargo(p.medio);
    }
  }

  const actualizado = await prisma.$transaction(async (tx) => {
    const pagosAPersistir = params.pagos
      .map((p, idx) => {
        // El vuelto se descuenta del efectivo, así que ese pago se persiste
        // neteado; los electrónicos entran exactos.
        const monto = p.medio === 'EFECTIVO' ? cobro.efectivoNeto : new Prisma.Decimal(p.monto);
        const pct = p.recargoPct != null && p.recargoPct > 0 ? new Prisma.Decimal(p.recargoPct) : null;
        return {
          medio: p.medio,
          monto,
          recargoPct: pct,
          montoRecargo: pct ? calcularRecargo(monto, pct) : null,
          // El descuento no se reparte entre pagos — queda en el primero
          // (mixto o no, el detalle completo también vive en la auditoría).
          descuentoPct: idx === 0 ? descuentoPct : null,
          montoDescuento: idx === 0 && descuentoPct ? montoDescuento : null,
        };
      })
      .filter((p) => p.monto.greaterThan(0));

    // Cobrar un PRESENCIAL que paga al momento pero sigue EN_PREPARACION
    // (cocina todavía no lo marcó Listo) NO cierra el pedido — se adjuntan
    // los pagos y se queda visible en Pedidos Activos como "ya pagado,
    // esperando cocina" (pedido post-prueba en vivo: antes desaparecía de
    // la lista aunque la comida siguiera cocinándose). `pagos.length > 0` es
    // la señal de "ya cobrado", no hace falta un campo aparte. Cobrar desde
    // LISTO sigue cerrando de una — ahí no queda nada más pendiente.
    const cierraAhora = pedido.estado === 'LISTO';
    if (cierraAhora) {
      await transicionarAtomico(tx, pedido.id, pedido.estado, { estado: 'ENTREGADO', fechaCierre: new Date() });
    } else {
      // Acá el guard de transicionarAtomico no sirve: el estado NO cambia
      // (sigue EN_PREPARACION), así que dos cobros concurrentes verían el
      // mismo WHERE {estado: desde} matcheado los dos y duplicarían el pago
      // — es exactamente lo que reveló el test de carreras. El guard real es
      // "todavía no tiene ningún Pago": la segunda llamada, tras esperar el
      // row lock de la primera, encuentra el Pago ya creado y no matchea.
      const r = await tx.pedido.updateMany({
        where: { id: pedido.id, estado: pedido.estado, pagos: { none: {} } },
        data: { estado: pedido.estado }, // mismo valor: solo hace falta un SET real (ver nota de arriba)
      });
      if (r.count === 0) throw Errores.estadoPedidoInvalido(pedido.estado, pedido.estado);
    }
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
        descuentoPct: descuentoPct?.toString() ?? null,
        montoDescuento: descuentoPct ? montoDescuento.toString() : null,
        totalConDescuento: totalConDescuento.toString(),
        pagos: pagosAPersistir.map((p) => ({
          medio: p.medio,
          monto: p.monto.toString(),
          recargoPct: p.recargoPct?.toString() ?? null,
          montoRecargo: p.montoRecargo?.toString() ?? null,
        })),
        vuelto: cobro.vuelto.toString(),
        cierraAhora,
      },
    });

    return cobrado;
  }, OPCIONES_TX);

  return { pedido: actualizado, vuelto: cobro.vuelto.toString() };
}

// Retiro de socio: el pedido salió a costo cero, no hay plata que contar. Se
// cierra igual que un cobro (ENTREGADO + auditoría) pero sin ningún Pago, así
// no ensucia el arqueo de caja ni las ventas por medio de pago.
async function cerrarSinCobro(
  pedido: {
    id: number;
    estado: EstadoPedido;
    beneficiario: BeneficiarioPedido | null;
    socioBeneficiario: SocioRetiro | null;
  },
  usuarioId: number,
) {
  return prisma.$transaction(async (tx) => {
    await transicionarAtomico(tx, pedido.id, pedido.estado, {
      estado: 'ENTREGADO',
      fechaCierre: new Date(),
    });
    await registrarAuditoria(tx, {
      accion: 'ENTREGAR_SIN_COBRO',
      entidad: 'Pedido',
      entidadId: pedido.id,
      usuarioId,
      datosNuevos: {
        motivo: pedido.beneficiario ?? 'TOTAL_CERO',
        socio: pedido.socioBeneficiario ?? null,
      },
    });
    return tx.pedido.findUniqueOrThrow({ where: { id: pedido.id }, include: INCLUDE_PEDIDO });
  }, OPCIONES_TX);
}

// ── Cambios de estado simples ──

async function cambiarEstado(params: {
  pedidoId: number;
  hacia: EstadoPedido;
  usuarioId: number;
  accion: string;
  datosExtra?: Prisma.PedidoUpdateManyMutationInput;
}) {
  const pedido = await prisma.pedido.findUnique({ where: { id: params.pedidoId }, include: INCLUDE_PEDIDO });
  if (!pedido) throw Errores.noEncontrado('Pedido');
  await validarUsuarioDeLaSucursal(params.usuarioId, pedido.sucursalId);
  if (!transicionValida(pedido.estado, params.hacia)) {
    throw Errores.estadoPedidoInvalido(pedido.estado, params.hacia);
  }

  return prisma.$transaction(async (tx) => {
    await transicionarAtomico(tx, pedido.id, pedido.estado, { estado: params.hacia, ...params.datosExtra });
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

// Si el pedido ya tiene pagos adjuntos (cobro temprano desde EN_PREPARACION
// — ver cobrarPedido), marcar Listo cierra DIRECTO a ENTREGADO: pagar era
// lo único que faltaba, no hace falta un tercer paso. Si no está pagado
// todavía, es el flujo normal: pasa a LISTO y espera el cobro.
export async function marcarListo(pedidoId: number, usuarioId: number) {
  const pedido = await prisma.pedido.findUnique({ where: { id: pedidoId }, include: INCLUDE_PEDIDO });
  if (!pedido) throw Errores.noEncontrado('Pedido');
  await validarUsuarioDeLaSucursal(usuarioId, pedido.sucursalId);

  const yaPagado = pedido.pagos.length > 0;
  const hacia: EstadoPedido = yaPagado ? 'ENTREGADO' : 'LISTO';
  if (!transicionValida(pedido.estado, hacia)) {
    throw Errores.estadoPedidoInvalido(pedido.estado, hacia);
  }

  return prisma.$transaction(async (tx) => {
    await transicionarAtomico(tx, pedido.id, pedido.estado, {
      estado: hacia,
      ...(yaPagado ? { fechaCierre: new Date() } : {}),
    });
    const actualizado = await tx.pedido.findUniqueOrThrow({ where: { id: pedido.id }, include: INCLUDE_PEDIDO });
    await registrarAuditoria(tx, {
      accion: 'MARCAR_PEDIDO_LISTO',
      entidad: 'Pedido',
      entidadId: pedido.id,
      usuarioId,
      datosAnteriores: { estado: pedido.estado },
      datosNuevos: { estado: hacia },
    });
    return actualizado;
  }, OPCIONES_TX);
}

export const marcarNoRetirado = async (pedidoId: number, usuarioId: number) => {
  const pedido = await cambiarEstado({
    pedidoId,
    hacia: 'LISTO_NO_RETIRADO',
    usuarioId,
    accion: 'PEDIDO_NO_RETIRADO',
    // Arranca el reloj del timer de aviso al admin (ver pedidosNoRetiradosParaAvisar).
    datosExtra: { fechaListoNoRetirado: new Date() },
  });
  // Arma el gate del job: hasta acá no había nada que revisar.
  if (pedido.fechaListoNoRetirado) registrarNoRetiradoPendiente(pedido.fechaListoNoRetirado);
  return pedido;
};

// ── Gate del timer de no retirados ──
//
// El job de server.ts corría un findMany cada 2 minutos, siempre, sin importar
// si había algo que revisar. Neon suspende el compute recién a los 5 minutos de
// inactividad, así que esa query sola alcanzaba para mantener la base prendida
// las 24 horas — incluidos los lunes y las 15 h diarias que el local está
// cerrado. Medido contra el plan Free (100 CU-hours/mes): 24/7 al piso de
// 0,25 CU son ~182 CU-hours, o sea que la cuota se agotaba cerca del día 17.
//
// Este gate guarda en memoria la fecha del `fechaListoNoRetirado` más viejo que
// todavía no generó aviso. Si no hay ninguno, el job no toca la base y el
// compute se suspende solo. **El momento en que llega el aviso no cambia**: el
// gate solo evita las corridas en que la query iba a volver vacía igual.
//
// Ojo si algún día se corre más de una instancia del backend: el estado es
// por proceso, así que cada instancia solo se arma con los pedidos que atendió
// ella. Con una sola instancia (lo actual) no hay problema, y un reinicio se
// resuelve con hidratarRevisionNoRetirado() al arrancar.
let proximoNoRetiradoSinAvisar: number | null = null;

export function registrarNoRetiradoPendiente(fechaListo: Date) {
  const t = fechaListo.getTime();
  if (proximoNoRetiradoSinAvisar === null || t < proximoNoRetiradoSinAvisar) {
    proximoNoRetiradoSinAvisar = t;
  }
}

// Relee de la base cuál es el próximo pendiente. Se llama solo cuando el job ya
// decidió consultar, así que no agrega despertadas: o hay trabajo, o deja el
// gate en null y el job se calla hasta el próximo marcarNoRetirado.
async function reprogramarDesdeDb() {
  const proximo = await prisma.pedido.findFirst({
    where: { estado: 'LISTO_NO_RETIRADO', avisoNoRetiradoEmitido: false },
    orderBy: { fechaListoNoRetirado: 'asc' },
    select: { fechaListoNoRetirado: true },
  });
  proximoNoRetiradoSinAvisar = proximo?.fechaListoNoRetirado?.getTime() ?? null;
}

/** Al arrancar: recupera el estado del gate por si quedaron pendientes de antes. */
export async function hidratarRevisionNoRetirado() {
  await reprogramarDesdeDb();
}

/**
 * Lo que llama el job. Si no hay nada que pueda haber vencido, devuelve vacío
 * SIN tocar la base — que es el punto de todo esto.
 */
export async function revisarNoRetirados(umbralMinutos: number) {
  if (proximoNoRetiradoSinAvisar === null) return [];
  if (Date.now() < proximoNoRetiradoSinAvisar + umbralMinutos * 60 * 1000) return [];
  const vencidos = await pedidosNoRetiradosParaAvisar(umbralMinutos);
  // Reprograma con lo que haya quedado: puede ser otro pendiente todavía no
  // vencido, o nada (si el pedido se reasignó, se perdió o se anuló antes de
  // que el aviso llegara a dispararse, la query no lo trajo y acá se limpia).
  await reprogramarDesdeDb();
  return vencidos;
}

// ── Timer de pedido no retirado (CLAUDE.md §5 Flujo 4) ──
// Devuelve los pedidos que llevan más de MINUTOS_PEDIDO_NO_RETIRADO_ALERTA en
// LISTO_NO_RETIRADO y todavía no generaron el aviso, y los marca como avisados
// en la misma pasada (evita reemitir el evento en cada corrida del job).
// El job NO llama a esta función directamente: pasa por revisarNoRetirados(),
// que es la que evita despertar la base al pedo. Los tests sí la usan directo.
export async function pedidosNoRetiradosParaAvisar(umbralMinutos: number) {
  const limite = new Date(Date.now() - umbralMinutos * 60 * 1000);
  const vencidos = await prisma.pedido.findMany({
    where: {
      estado: 'LISTO_NO_RETIRADO',
      avisoNoRetiradoEmitido: false,
      fechaListoNoRetirado: { lte: limite },
    },
    select: { id: true, sucursalId: true, fechaListoNoRetirado: true },
  });
  if (vencidos.length === 0) return [];
  await prisma.pedido.updateMany({
    where: { id: { in: vencidos.map((p) => p.id) } },
    data: { avisoNoRetiradoEmitido: true },
  });
  return vencidos;
}

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
  // Cobro temprano (§6): un PRESENCIAL puede quedar EN_PREPARACION/LISTO con
  // Pago ya adjuntos, esperando a cocina. Anularlo dejaría ese Pago
  // huérfano — qué hacer con la plata en ese caso es una decisión de
  // negocio todavía sin resolver (ver plan), así que por ahora se bloquea
  // en vez de decidir en silencio. Mismo criterio que ya usa
  // modificarPedido para la misma situación.
  if (pedido.pagos.length > 0) throw Errores.pedidoNoModificable('con pagos registrados');

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

    // El cliente pidió explícitamente que la anulación salga EN PAPEL: la
    // alerta en pantalla del POS no alcanza, cocina tiene que enterarse de
    // que deje de preparar algo que ya está en la parrilla (CLAUDE.md §5).
    const ticket = await registrarTicket(tx, {
      pedidoId: pedido.id,
      tipo: 'ANULACION',
      sucursalId: pedido.sucursalId,
      sucursal: pedido.sucursal.nombre,
      tipoPedido: pedido.tipo,
      fechaHora: new Date().toISOString(),
      items: itemsDeTicket(pedido.items),
      nombreCliente: pedido.nombreCliente ?? undefined,
      horaEntregaSolicitada: pedido.horaEntregaSolicitada ?? undefined,
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

    return { actualizado, ticketId: ticket.id };
  }, OPCIONES_TX);

  alertasService.emitirAAdmins('ticket:anulacion', { pedidoId: pedido.id });
  despacharEnSegundoPlano(anulado.ticketId);
  return anulado.actualizado;
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

// Ranking de más vendidos de la sucursal (CLAUDE.md §5 Flujo 4): el POS
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
