import { Prisma } from '@prisma/client';
import { prisma, OPCIONES_TX } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';
import * as fichasService from '../fichas-tecnicas/fichas.service';
import * as alertasService from '../alertas/alertas.service';
import { obtenerStock } from '../stock/stock.service';
import { calcularUnidadesEsperadas, calcularDesvioPct, superaUmbral } from './produccion.calculos';

export interface InsumoInput {
  productoInsumoId: number;
  lineaIngresoOrigenId: number;
  cantidadUsada: number;
}

const INCLUDE_LOTE = {
  productoElaborado: { select: { nombre: true } },
  insumosUsados: {
    include: {
      productoInsumo: { select: { nombre: true, unidadDeMedida: true } },
      lineaIngresoOrigen: { select: { id: true, ingresoMercaderiaId: true } },
    },
  },
} as const;

// Valida insumos contra líneas de ingreso y stock. VALIDACIÓN BLOQUEANTE:
// nunca stock negativo (Flujo 2 paso 4). Usada al abrir Y al cerrar (re-chequeo
// dentro de la transacción para evitar carreras entre lotes abiertos).
async function validarInsumos(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma,
  insumos: InsumoInput[],
  sucursalProduccionId: number,
) {
  // por línea de ingreso: cantidad usada ≤ restante disponible
  for (const insumo of insumos) {
    const linea = await tx.lineaIngreso.findUnique({
      where: { id: insumo.lineaIngresoOrigenId },
      include: { producto: { select: { nombre: true } } },
    });
    if (!linea) throw Errores.noEncontrado(`Línea de ingreso ${insumo.lineaIngresoOrigenId}`);
    if (linea.productoId !== insumo.productoInsumoId) {
      throw Errores.validacion(
        `La línea de ingreso ${linea.id} no corresponde al producto ${insumo.productoInsumoId}`,
      );
    }
    const usada = new Prisma.Decimal(insumo.cantidadUsada);
    if (linea.cantidadRestanteDisponible.lessThan(usada)) {
      throw Errores.lineaIngresoInsuficiente(
        `"${linea.producto.nombre}" línea ${linea.id} — restante ${linea.cantidadRestanteDisponible.toString()}, requerido ${usada.toString()}`,
      );
    }
  }

  // por producto: total usado ≤ stock de la sucursal Producción
  const totalPorProducto = new Map<number, Prisma.Decimal>();
  for (const insumo of insumos) {
    const acumulado = totalPorProducto.get(insumo.productoInsumoId) ?? new Prisma.Decimal(0);
    totalPorProducto.set(insumo.productoInsumoId, acumulado.plus(insumo.cantidadUsada));
  }
  for (const [productoId, total] of totalPorProducto) {
    const stock = await obtenerStock(productoId, sucursalProduccionId, tx as never);
    if (stock.lessThan(total)) {
      const producto = await tx.producto.findUnique({ where: { id: productoId } });
      throw Errores.stockInsuficiente(
        `"${producto?.nombre ?? productoId}" — disponible ${stock.toString()}, requerido ${total.toString()}`,
      );
    }
  }
}

// Abre un lote: valida stock y líneas, calcula INTERNAMENTE las unidades
// esperadas según la ficha activa (control ciego: nunca se responde al operario)
// y congela la versión de ficha. Los movimientos de stock ocurren al CERRAR.
export async function abrirLote(params: {
  productoElaboradoId: number;
  insumos: InsumoInput[];
  usuarioId: number;
}) {
  const { version } = await fichasService.obtenerVersionActiva(params.productoElaboradoId);

  const sucursalProduccion = await prisma.sucursal.findFirst({ where: { tipo: 'PRODUCCION' } });
  if (!sucursalProduccion) throw Errores.noEncontrado('Sucursal de producción');

  await validarInsumos(prisma, params.insumos, sucursalProduccion.id);

  // insumo principal de la receta: base del cálculo de rendimiento
  const ingredientePrincipal = version.ingredientes.find((i) => i.esPrincipal);
  if (!ingredientePrincipal) throw Errores.validacion('La ficha activa no define insumo principal');

  const totalPrincipal = params.insumos
    .filter((i) => i.productoInsumoId === ingredientePrincipal.productoInsumoId)
    .reduce((acc, i) => acc.plus(i.cantidadUsada), new Prisma.Decimal(0));
  if (totalPrincipal.isZero()) {
    throw Errores.validacion('El lote debe incluir el insumo principal de la receta');
  }

  const unidadesEsperadas = calcularUnidadesEsperadas({
    cantidadInsumoPrincipal: totalPrincipal,
    cantidadPorUnidadProducida: ingredientePrincipal.cantidadPorUnidadProducida,
    desperdicioEsperadoPct: version.desperdicioEsperadoPct,
  });

  return prisma.$transaction(async (tx) => {
    const lote = await tx.loteDeProduccion.create({
      data: {
        productoElaboradoId: params.productoElaboradoId,
        fichaTecnicaVersionId: version.id, // versión CONGELADA
        usuarioOperarioId: params.usuarioId,
        estado: 'ABIERTO',
        unidadesEsperadas,
        insumosUsados: {
          create: params.insumos.map((i) => ({
            productoInsumoId: i.productoInsumoId,
            lineaIngresoOrigenId: i.lineaIngresoOrigenId,
            cantidadUsada: new Prisma.Decimal(i.cantidadUsada),
          })),
        },
      },
      include: INCLUDE_LOTE,
    });

    await registrarAuditoria(tx, {
      accion: 'ABRIR_LOTE_PRODUCCION',
      entidad: 'LoteDeProduccion',
      entidadId: lote.id,
      usuarioId: params.usuarioId,
      datosNuevos: {
        productoElaboradoId: params.productoElaboradoId,
        fichaTecnicaVersionId: version.id,
        insumos: params.insumos,
      },
    });

    return lote;
  }, OPCIONES_TX);
}

// Cierra el lote: descuenta insumos de sus líneas y del stock, da de alta lo
// producido, registra desperdicio, calcula desvío y dispara alerta silenciosa
// al admin si supera el umbral. TODO en una transacción (Flujo 2 paso 8).
export async function cerrarLote(params: {
  loteId: number;
  unidadesProducidasReales: number;
  desperdicioRealKg: number;
  usuarioId: number;
}) {
  const sucursalProduccion = await prisma.sucursal.findFirst({ where: { tipo: 'PRODUCCION' } });
  if (!sucursalProduccion) throw Errores.noEncontrado('Sucursal de producción');

  const resultado = await prisma.$transaction(async (tx) => {
    const lote = await tx.loteDeProduccion.findUnique({
      where: { id: params.loteId },
      include: {
        insumosUsados: true,
        fichaTecnicaVersion: { include: { ingredientes: true } },
      },
    });
    if (!lote) throw Errores.noEncontrado('Lote de producción');
    if (lote.estado === 'CERRADO') throw Errores.loteYaCerrado();

    const insumosInput: InsumoInput[] = lote.insumosUsados.map((i) => ({
      productoInsumoId: i.productoInsumoId,
      lineaIngresoOrigenId: i.lineaIngresoOrigenId,
      cantidadUsada: i.cantidadUsada.toNumber(),
    }));
    // re-validación dentro de la transacción: bloquea si otro lote consumió entre medio
    await validarInsumos(tx, insumosInput, sucursalProduccion.id);

    const desperdicioReal = new Prisma.Decimal(params.desperdicioRealKg);
    const unidadesReales = new Prisma.Decimal(params.unidadesProducidasReales);

    const ingredientePrincipal = lote.fichaTecnicaVersion.ingredientes.find((i) => i.esPrincipal);
    if (!ingredientePrincipal) throw Errores.validacion('La versión de ficha no define insumo principal');

    const totalPrincipal = lote.insumosUsados
      .filter((i) => i.productoInsumoId === ingredientePrincipal.productoInsumoId)
      .reduce((acc, i) => acc.plus(i.cantidadUsada), new Prisma.Decimal(0));

    if (desperdicioReal.greaterThan(totalPrincipal)) {
      throw Errores.validacion(
        `El desperdicio (${desperdicioReal.toString()} kg) no puede superar el insumo principal usado (${totalPrincipal.toString()} kg)`,
      );
    }

    // 1) descuenta cada insumo de su línea de ingreso (trazabilidad por partida)
    for (const insumo of lote.insumosUsados) {
      await tx.lineaIngreso.update({
        where: { id: insumo.lineaIngresoOrigenId },
        data: { cantidadRestanteDisponible: { decrement: insumo.cantidadUsada } },
      });
    }

    // 2) movimientos de stock por insumo. El insumo principal se divide en
    //    CONSUMO + DESPERDICIO para que la suma de movimientos cuadre exacta:
    //    total descontado del principal = usado (consumo productivo + desperdicio).
    for (const insumo of lote.insumosUsados) {
      const esPrincipal = insumo.productoInsumoId === ingredientePrincipal.productoInsumoId;
      let cantidadConsumo = insumo.cantidadUsada;

      if (esPrincipal && desperdicioReal.greaterThan(0)) {
        // el desperdicio se descuenta proporcionalmente de este registro de insumo
        const proporcion = insumo.cantidadUsada.div(totalPrincipal);
        const desperdicioLinea = desperdicioReal.mul(proporcion).toDecimalPlaces(3);
        cantidadConsumo = insumo.cantidadUsada.minus(desperdicioLinea);

        await tx.movimientoStock.create({
          data: {
            productoId: insumo.productoInsumoId,
            sucursalId: sucursalProduccion.id,
            tipo: 'DESPERDICIO_PRODUCCION',
            cantidad: desperdicioLinea.negated(),
            usuarioId: params.usuarioId,
            tipoOrigen: 'LoteDeProduccion',
            origenId: lote.id,
          },
        });
      }

      await tx.movimientoStock.create({
        data: {
          productoId: insumo.productoInsumoId,
          sucursalId: sucursalProduccion.id,
          tipo: 'CONSUMO_PRODUCCION',
          cantidad: cantidadConsumo.negated(),
          usuarioId: params.usuarioId,
          tipoOrigen: 'LoteDeProduccion',
          origenId: lote.id,
        },
      });
    }

    // 3) alta de las unidades producidas
    await tx.movimientoStock.create({
      data: {
        productoId: lote.productoElaboradoId,
        sucursalId: sucursalProduccion.id,
        tipo: 'PRODUCCION_ALTA',
        cantidad: unidadesReales,
        usuarioId: params.usuarioId,
        tipoOrigen: 'LoteDeProduccion',
        origenId: lote.id,
      },
    });

    // 4) desvío vs. esperado (interno — jamás expuesto al operario)
    const unidadesEsperadas = lote.unidadesEsperadas ?? new Prisma.Decimal(0);
    const desvioPct = calcularDesvioPct(unidadesReales, unidadesEsperadas);
    const alertaDisparada = superaUmbral(desvioPct, lote.fichaTecnicaVersion.umbralDesvioAlertaPct);

    const loteCerrado = await tx.loteDeProduccion.update({
      where: { id: lote.id },
      data: {
        estado: 'CERRADO',
        unidadesProducidasReales: unidadesReales,
        desperdicioRealKg: desperdicioReal,
        desvioPct,
        alertaDisparada,
      },
      include: INCLUDE_LOTE,
    });

    let alerta = null;
    if (alertaDisparada) {
      alerta = await alertasService.crearAlerta(tx, {
        tipo: 'DESVIO_PRODUCCION',
        tipoOrigen: 'LoteDeProduccion',
        origenId: lote.id,
        detalle: {
          loteId: lote.id,
          productoElaboradoId: lote.productoElaboradoId,
          operarioId: lote.usuarioOperarioId,
          unidadesEsperadas: unidadesEsperadas.toString(),
          unidadesReales: unidadesReales.toString(),
          desperdicioRealKg: desperdicioReal.toString(),
          desvioPct: desvioPct.toString(),
          umbralPct: lote.fichaTecnicaVersion.umbralDesvioAlertaPct.toString(),
        },
      });
    }

    await registrarAuditoria(tx, {
      accion: 'CERRAR_LOTE_PRODUCCION',
      entidad: 'LoteDeProduccion',
      entidadId: lote.id,
      usuarioId: params.usuarioId,
      datosNuevos: {
        unidadesProducidasReales: unidadesReales.toString(),
        desperdicioRealKg: desperdicioReal.toString(),
        desvioPct: desvioPct.toString(),
        alertaDisparada,
      },
    });

    return { lote: loteCerrado, alerta };
  }, OPCIONES_TX);

  // emisión socket post-commit, solo a la sala de administradores
  if (resultado.alerta) {
    alertasService.emitirAlerta({
      id: resultado.alerta.id,
      tipo: resultado.alerta.tipo,
      detalle: resultado.alerta.detalle,
    });
  }

  return resultado.lote;
}

export async function listarLotes(filtros: { estado?: 'ABIERTO' | 'CERRADO'; desde?: Date; hasta?: Date }) {
  return prisma.loteDeProduccion.findMany({
    where: { estado: filtros.estado, fechaHora: { gte: filtros.desde, lte: filtros.hasta } },
    include: INCLUDE_LOTE,
    orderBy: { fechaHora: 'desc' },
    take: 200,
  });
}

export async function obtenerLote(id: number) {
  const lote = await prisma.loteDeProduccion.findUnique({ where: { id }, include: INCLUDE_LOTE });
  if (!lote) throw Errores.noEncontrado('Lote de producción');
  return lote;
}
