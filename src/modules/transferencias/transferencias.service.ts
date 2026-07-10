import { Prisma } from '@prisma/client';
import { prisma, OPCIONES_TX } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';
import { obtenerStock } from '../stock/stock.service';
import * as alertasService from '../alertas/alertas.service';

export interface LineaTransferenciaInput {
  productoId: number;
  cantidadEnviada: number;
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
    // validación bloqueante de stock dentro de la transacción
    for (const linea of params.lineas) {
      const stock = await obtenerStock(linea.productoId, sucursalOrigen.id, tx);
      const enviada = new Prisma.Decimal(linea.cantidadEnviada);
      if (stock.lessThan(enviada)) {
        const producto = await tx.producto.findUnique({ where: { id: linea.productoId } });
        throw Errores.stockInsuficiente(
          `"${producto?.nombre ?? linea.productoId}" — disponible ${stock.toString()}, a enviar ${enviada.toString()}`,
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
          })),
        },
      },
      include: INCLUDE_TRANSFERENCIA,
    });

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
// NO persiste nada: el receptor puede recontar sin límite o confirmar igual.
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

  validarLineasRecepcion(transferencia, params.lineasRecibidas);

  const recibidasPorProducto = new Map(
    params.lineasRecibidas.map((l) => [l.productoId, new Prisma.Decimal(l.cantidadRecibida)]),
  );

  const coincide = transferencia.lineas.every((linea) =>
    linea.cantidadEnviada.equals(recibidasPorProducto.get(linea.productoId) ?? new Prisma.Decimal(-1)),
  );

  if (!coincide) {
    // comparación ciega: nada se persiste, nada se revela
    return { coincide: false as const };
  }

  const confirmada = await confirmarEnTransaccion({
    transferencia,
    lineasRecibidas: params.lineasRecibidas,
    usuarioId: params.usuarioId,
    conDiscrepancia: false,
  });
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
