import { Prisma } from '@prisma/client';
import { prisma, OPCIONES_TX } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';
import { obtenerStock } from '../stock/stock.service';
import * as alertasService from '../alertas/alertas.service';

export interface LineaTransferenciaInput {
  productoId: number;
  cantidadEnviada: number;
  /**
   * De qué lote de producción salen estas unidades. Opcional: hay stock sin
   * lote (reventa, ajustes, retornos, y todo lo producido antes de que el lote
   * llevara saldo). Pablo lo pidió para poder mandar "las de ayer, no las que
   * produjeron hoy a la mañana" (reunión 4/8).
   */
  loteOrigenId?: number;
}

export interface LineaRecepcionInput {
  productoId: number;
  cantidadRecibida: number;
}

const INCLUDE_TRANSFERENCIA = {
  sucursalOrigen: { select: { nombre: true } },
  sucursalDestino: { select: { nombre: true } },
  usuarioEmisor: { select: { username: true } },
  usuarioReceptor: { select: { username: true } },
  lineas: { include: { producto: { select: { nombre: true, unidadDeMedida: true } } } },
} as const;

// FLUJO 3 paso 1: producción genera el remito virtual. Valida stock (si no
// alcanza NO deja generar), descuenta stock de origen y firma con el emisor.
export async function generarTransferencia(params: {
  sucursalDestinoId: number;
  lineas: LineaTransferenciaInput[];
  usuarioId: number;
}) {
  const sucursalOrigen = await prisma.sucursal.findFirst({ where: { tipo: 'PRODUCCION' } });
  if (!sucursalOrigen) throw Errores.noEncontrado('Sucursal de producción');

  const destino = await prisma.sucursal.findUnique({ where: { id: params.sucursalDestinoId } });
  if (!destino || !destino.activa) throw Errores.noEncontrado('Sucursal destino');
  if (destino.tipo !== 'VENTA') {
    throw Errores.validacion('La sucursal destino debe ser un local de venta');
  }

  return prisma.$transaction(async (tx) => {
    // validación bloqueante de stock dentro de la transacción. Se agrupa por
    // producto porque un mismo envío puede llevarlo desde varios lotes.
    const totalPorProducto = new Map<number, Prisma.Decimal>();
    for (const linea of params.lineas) {
      const acumulado = totalPorProducto.get(linea.productoId) ?? new Prisma.Decimal(0);
      totalPorProducto.set(linea.productoId, acumulado.plus(linea.cantidadEnviada));
    }
    for (const [productoId, total] of totalPorProducto) {
      const stock = await obtenerStock(productoId, sucursalOrigen.id, tx);
      if (stock.lessThan(total)) {
        const producto = await tx.producto.findUnique({ where: { id: productoId } });
        throw Errores.stockInsuficiente(
          `"${producto?.nombre ?? productoId}" — disponible ${stock.toString()}, a enviar ${total.toString()}`,
        );
      }
    }

    // Saldo por lote: mismo control que las partidas de materia prima, para
    // que dos envíos no vacíen dos veces el mismo lote.
    for (const linea of params.lineas) {
      if (linea.loteOrigenId == null) continue;
      const lote = await tx.loteDeProduccion.findUnique({
        where: { id: linea.loteOrigenId },
        include: { productoElaborado: { select: { nombre: true } } },
      });
      if (!lote) throw Errores.noEncontrado(`Lote ${linea.loteOrigenId}`);
      if (lote.productoElaboradoId !== linea.productoId) {
        throw Errores.validacion(`El lote ${lote.id} no corresponde al producto ${linea.productoId}`);
      }
      const restante = lote.cantidadRestanteDisponible ?? new Prisma.Decimal(0);
      const enviada = new Prisma.Decimal(linea.cantidadEnviada);
      if (restante.lessThan(enviada)) {
        throw Errores.stockInsuficiente(
          `"${lote.productoElaborado.nombre}" lote ${lote.id} — quedan ${restante.toString()}, a enviar ${enviada.toString()}`,
        );
      }
    }

    const transferencia = await tx.transferencia.create({
      data: {
        sucursalOrigenId: sucursalOrigen.id,
        sucursalDestinoId: params.sucursalDestinoId,
        usuarioEmisorId: params.usuarioId,
        estado: 'PENDIENTE_RECEPCION',
        lineas: {
          create: params.lineas.map((l) => ({
            productoId: l.productoId,
            cantidadEnviada: new Prisma.Decimal(l.cantidadEnviada),
            loteOrigenId: l.loteOrigenId,
          })),
        },
      },
      include: INCLUDE_TRANSFERENCIA,
    });

    // Se descuenta el saldo del lote: deja de estar disponible para enviar.
    for (const linea of params.lineas) {
      if (linea.loteOrigenId == null) continue;
      await tx.loteDeProduccion.update({
        where: { id: linea.loteOrigenId },
        data: { cantidadRestanteDisponible: { decrement: new Prisma.Decimal(linea.cantidadEnviada) } },
      });
    }

    for (const linea of params.lineas) {
      await tx.movimientoStock.create({
        data: {
          productoId: linea.productoId,
          sucursalId: sucursalOrigen.id,
          tipo: 'TRANSFERENCIA_SALIDA',
          cantidad: new Prisma.Decimal(linea.cantidadEnviada).negated(),
          usuarioId: params.usuarioId,
          tipoOrigen: 'Transferencia',
          origenId: transferencia.id,
        },
      });
    }

    await registrarAuditoria(tx, {
      accion: 'GENERAR_TRANSFERENCIA',
      entidad: 'Transferencia',
      entidadId: transferencia.id,
      usuarioId: params.usuarioId,
      datosNuevos: { sucursalDestinoId: params.sucursalDestinoId, lineas: params.lineas },
    });

    return transferencia;
  }, OPCIONES_TX);
}

// Un CAJERO/ENCARGADO solo puede recepcionar transferencias dirigidas a SU
// propia sucursal — sin esto, cualquier receptor válido podía confirmar la
// entrega de cualquier local, ajeno al suyo (hallazgo de auditoría §5.2/§9.1).
// ADMINISTRADOR queda exento (acceso total, CLAUDE.md §2). Se revalida
// siempre contra la DB, nunca contra el JWT (que puede tener hasta 15 min
// de desfasaje si un admin reasigna la sucursal de alguien a mitad de turno).
async function validarUsuarioDeLaSucursal(usuarioId: number, sucursalDestinoId: number): Promise<void> {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario) throw Errores.noAutorizado();
  if (usuario.rol === 'ADMINISTRADOR') return;
  if (usuario.sucursalId !== sucursalDestinoId) throw Errores.sucursalNoAutorizada();
}

function validarLineasRecepcion(
  transferencia: { lineas: { productoId: number }[] },
  lineasRecibidas: LineaRecepcionInput[],
) {
  const productosEsperados = new Set(transferencia.lineas.map((l) => l.productoId));
  const productosDeclarados = new Set(lineasRecibidas.map((l) => l.productoId));
  if (
    productosEsperados.size !== productosDeclarados.size ||
    [...productosEsperados].some((p) => !productosDeclarados.has(p))
  ) {
    throw Errores.validacion('Debe declarar la cantidad recibida de cada producto de la transferencia');
  }
}

// FLUJO 3 paso 3-4: RECEPCIÓN CIEGA. El receptor carga su conteo; el sistema
// compara internamente. Si todo coincide → CONFIRMADA + entrada de stock.
// Si no → responde SOLO "no coincide" (sin diferencia, sin lado del error) y
// el receptor puede recontar sin límite. Ya NO puede "confirmar igual": eso
// pasó a ser exclusivo del administrador (reunión 4/8, Pablo: "el confirmar
// igual no existiría; en todo caso lo usaría el administrador, pero el cajero
// no"). Deroga lo que decía CLAUDE.md §7.
//
// Como el cajero ya no puede cerrar el circuito, el admin tiene que enterarse
// solo: el primer conteo que no cierra dispara la alerta con ambos números.
// Los intentos siguientes se registran en auditoría pero no duplican la
// alerta, y cuando finalmente coincide también queda asentado — así el admin
// ve la secuencia completa y sabe si se resolvió sin intervenir.
export async function intentarRecepcion(params: {
  transferenciaId: number;
  lineasRecibidas: LineaRecepcionInput[];
  usuarioId: number;
}) {
  const transferencia = await prisma.transferencia.findUnique({
    where: { id: params.transferenciaId },
    include: { lineas: true },
  });
  if (!transferencia) throw Errores.noEncontrado('Transferencia');
  if (transferencia.estado !== 'PENDIENTE_RECEPCION') throw Errores.transferenciaYaConfirmada();

  await validarUsuarioDeLaSucursal(params.usuarioId, transferencia.sucursalDestinoId);
  validarLineasRecepcion(transferencia, params.lineasRecibidas);

  const recibidasPorProducto = new Map(
    params.lineasRecibidas.map((l) => [l.productoId, new Prisma.Decimal(l.cantidadRecibida)]),
  );

  const coincide = transferencia.lineas.every((linea) =>
    linea.cantidadEnviada.equals(recibidasPorProducto.get(linea.productoId) ?? new Prisma.Decimal(-1)),
  );

  // Snapshot del intento: ambos números, para auditoría y alerta. Nunca sale
  // hacia el receptor — la respuesta sigue siendo un simple "no coincide".
  const detalleIntento = {
    transferenciaId: transferencia.id,
    sucursalDestinoId: transferencia.sucursalDestinoId,
    usuarioEmisorId: transferencia.usuarioEmisorId,
    usuarioReceptorId: params.usuarioId,
    lineas: transferencia.lineas.map((l) => {
      const contada = recibidasPorProducto.get(l.productoId) ?? new Prisma.Decimal(0);
      return {
        productoId: l.productoId,
        cantidadEnviada: l.cantidadEnviada.toString(),
        cantidadContada: contada.toString(),
        diferencia: contada.minus(l.cantidadEnviada).toString(),
      };
    }),
  };

  if (!coincide) {
    const alerta = await prisma.$transaction(async (tx) => {
      await registrarAuditoria(tx, {
        accion: 'CONTEO_RECEPCION_NO_COINCIDE',
        entidad: 'Transferencia',
        entidadId: transferencia.id,
        usuarioId: params.usuarioId,
        datosNuevos: detalleIntento,
      });
      // Una sola alerta por transferencia, por más veces que recuente
      const yaAlertada = await tx.alerta.findFirst({
        where: {
          tipo: 'DISCREPANCIA_TRANSFERENCIA',
          tipoOrigen: 'Transferencia',
          origenId: transferencia.id,
        },
      });
      if (yaAlertada) return null;
      return alertasService.crearAlerta(tx, {
        tipo: 'DISCREPANCIA_TRANSFERENCIA',
        tipoOrigen: 'Transferencia',
        origenId: transferencia.id,
        detalle: detalleIntento,
      });
    }, OPCIONES_TX);

    if (alerta) {
      alertasService.emitirAlerta({ id: alerta.id, tipo: alerta.tipo, detalle: alerta.detalle });
    }
    // comparación ciega: la respuesta no revela diferencia ni lado del error
    return { coincide: false as const };
  }

  // Coincidió. Si antes hubo intentos fallidos, se deja asentado para que el
  // admin vea que se resolvió recontando y no tenga que investigar la alerta.
  const intentosPrevios = await prisma.registroAuditoria.count({
    where: {
      accion: 'CONTEO_RECEPCION_NO_COINCIDE',
      entidad: 'Transferencia',
      entidadId: transferencia.id,
    },
  });

  const confirmada = await confirmarEnTransaccion({
    transferencia,
    lineasRecibidas: params.lineasRecibidas,
    usuarioId: params.usuarioId,
    conDiscrepancia: false,
  });

  if (intentosPrevios > 0) {
    await registrarAuditoria(prisma, {
      accion: 'RECEPCION_RESUELTA_RECONTANDO',
      entidad: 'Transferencia',
      entidadId: transferencia.id,
      usuarioId: params.usuarioId,
      datosNuevos: { intentosQueNoCoincidieron: intentosPrevios, ...detalleIntento },
    });
  }

  return { coincide: true as const, transferencia: confirmada };
}

// FLUJO 3 paso 4b: "confirmar igual" tras conteos que no coinciden.
// El stock del local se actualiza con LA CANTIDAD DECLARADA POR EL RECEPTOR
// y se dispara alerta al Administrador con ambos números y ambas firmas.
export async function confirmarConDiscrepancia(params: {
  transferenciaId: number;
  lineasRecibidas: LineaRecepcionInput[];
  usuarioId: number;
}) {
  const transferencia = await prisma.transferencia.findUnique({
    where: { id: params.transferenciaId },
    include: { lineas: true },
  });
  if (!transferencia) throw Errores.noEncontrado('Transferencia');
  if (transferencia.estado !== 'PENDIENTE_RECEPCION') throw Errores.transferenciaYaConfirmada();

  await validarUsuarioDeLaSucursal(params.usuarioId, transferencia.sucursalDestinoId);
  validarLineasRecepcion(transferencia, params.lineasRecibidas);

  return confirmarEnTransaccion({
    transferencia,
    lineasRecibidas: params.lineasRecibidas,
    usuarioId: params.usuarioId,
    conDiscrepancia: true,
  });
}

async function confirmarEnTransaccion(params: {
  transferencia: {
    id: number;
    sucursalDestinoId: number;
    usuarioEmisorId: number;
    lineas: { id: number; productoId: number; cantidadEnviada: Prisma.Decimal }[];
  };
  lineasRecibidas: LineaRecepcionInput[];
  usuarioId: number;
  conDiscrepancia: boolean;
}) {
  const { transferencia, lineasRecibidas, usuarioId, conDiscrepancia } = params;
  const recibidasPorProducto = new Map(
    lineasRecibidas.map((l) => [l.productoId, new Prisma.Decimal(l.cantidadRecibida)]),
  );

  const resultado = await prisma.$transaction(async (tx) => {
    for (const linea of transferencia.lineas) {
      const recibida = recibidasPorProducto.get(linea.productoId)!;
      await tx.lineaDeTransferencia.update({
        where: { id: linea.id },
        data: {
          cantidadRecibida: recibida,
          diferencia: recibida.minus(linea.cantidadEnviada),
        },
      });
      // entrada al local por la cantidad declarada por el receptor
      if (recibida.greaterThan(0)) {
        await tx.movimientoStock.create({
          data: {
            productoId: linea.productoId,
            sucursalId: transferencia.sucursalDestinoId,
            tipo: 'TRANSFERENCIA_ENTRADA',
            cantidad: recibida,
            usuarioId,
            tipoOrigen: 'Transferencia',
            origenId: transferencia.id,
          },
        });
      }
    }

    const actualizada = await tx.transferencia.update({
      where: { id: transferencia.id },
      data: {
        estado: conDiscrepancia ? 'CONFIRMADA_CON_DISCREPANCIA' : 'CONFIRMADA',
        usuarioReceptorId: usuarioId,
        fechaHoraRecepcion: new Date(),
      },
      include: INCLUDE_TRANSFERENCIA,
    });

    let alerta = null;
    if (conDiscrepancia) {
      alerta = await alertasService.crearAlerta(tx, {
        tipo: 'DISCREPANCIA_TRANSFERENCIA',
        tipoOrigen: 'Transferencia',
        origenId: transferencia.id,
        detalle: {
          transferenciaId: transferencia.id,
          usuarioEmisorId: transferencia.usuarioEmisorId,
          usuarioReceptorId: usuarioId,
          lineas: transferencia.lineas.map((l) => {
            const recibida = recibidasPorProducto.get(l.productoId)!;
            return {
              productoId: l.productoId,
              cantidadEnviada: l.cantidadEnviada.toString(),
              cantidadRecibida: recibida.toString(),
              diferencia: recibida.minus(l.cantidadEnviada).toString(),
            };
          }),
        },
      });
    }

    // auditoría reforzada: ambos números + ambos usuarios (Flujo 7)
    await registrarAuditoria(tx, {
      accion: conDiscrepancia ? 'CONFIRMAR_TRANSFERENCIA_CON_DISCREPANCIA' : 'CONFIRMAR_TRANSFERENCIA',
      entidad: 'Transferencia',
      entidadId: transferencia.id,
      usuarioId,
      datosNuevos: {
        usuarioEmisorId: transferencia.usuarioEmisorId,
        usuarioReceptorId: usuarioId,
        lineas: transferencia.lineas.map((l) => ({
          productoId: l.productoId,
          cantidadEnviada: l.cantidadEnviada.toString(),
          cantidadRecibida: recibidasPorProducto.get(l.productoId)!.toString(),
        })),
      },
    });

    return { transferencia: actualizada, alerta };
  }, OPCIONES_TX);

  if (resultado.alerta) {
    alertasService.emitirAlerta({
      id: resultado.alerta.id,
      tipo: resultado.alerta.tipo,
      detalle: resultado.alerta.detalle,
    });
  }

  return resultado.transferencia;
}

export async function listar(filtros: {
  estado?: 'PENDIENTE_RECEPCION' | 'CONFIRMADA' | 'CONFIRMADA_CON_DISCREPANCIA';
  sucursalDestinoId?: number;
}) {
  return prisma.transferencia.findMany({
    where: { estado: filtros.estado, sucursalDestinoId: filtros.sucursalDestinoId },
    include: INCLUDE_TRANSFERENCIA,
    orderBy: { fechaHoraEnvio: 'desc' },
    take: 200,
  });
}

export async function obtener(id: number) {
  const transferencia = await prisma.transferencia.findUnique({
    where: { id },
    include: INCLUDE_TRANSFERENCIA,
  });
  if (!transferencia) throw Errores.noEncontrado('Transferencia');
  return transferencia;
}

interface LineaIntento {
  productoId: number;
  cantidadEnviada: string;
  cantidadContada: string;
  diferencia: string;
}

/**
 * Historial de conteos de una recepción trabada, para que el admin la resuelva
 * sabiendo qué pasó: cuántas veces se contó, qué cargó el cajero cada vez y
 * cuánto difiere del remito. SOLO ADMIN — es justamente lo que el control
 * ciego le esconde al receptor.
 */
export async function intentosDeRecepcion(transferenciaId: number) {
  const registros = await prisma.registroAuditoria.findMany({
    where: {
      accion: { in: ['CONTEO_RECEPCION_NO_COINCIDE', 'RECEPCION_RESUELTA_RECONTANDO'] },
      entidad: 'Transferencia',
      entidadId: transferenciaId,
    },
    include: { usuario: { select: { username: true } } },
    orderBy: { fechaHora: 'asc' },
  });

  const productos = await prisma.producto.findMany({
    where: { lineasTransferencia: { some: { transferenciaId } } },
    select: { id: true, nombre: true, unidadDeMedida: true },
  });
  const nombrePorProducto = new Map(productos.map((p) => [p.id, p]));

  return registros.map((r, i) => {
    const datos = (r.datosNuevos ?? {}) as { lineas?: LineaIntento[] };
    return {
      numero: i + 1,
      fechaHora: r.fechaHora,
      usuario: r.usuario?.username ?? null,
      coincidio: r.accion === 'RECEPCION_RESUELTA_RECONTANDO',
      lineas: (datos.lineas ?? []).map((l) => ({
        productoId: l.productoId,
        producto: nombrePorProducto.get(l.productoId)?.nombre ?? `#${l.productoId}`,
        unidadDeMedida: nombrePorProducto.get(l.productoId)?.unidadDeMedida ?? null,
        cantidadEnviada: l.cantidadEnviada,
        cantidadContada: l.cantidadContada,
        diferencia: l.diferencia,
      })),
    };
  });
}
