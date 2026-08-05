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
  /**
   * Lo que REALMENTE se usó de cada insumo, si difiere de lo estimado al
   * abrir. Ariel lo pidió con un caso concreto: estimó 10 kg de pan rallado,
   * pero al terminar zarandeó, tiró la parte húmeda y devolvió el resto a la
   * bolsa — usó 6,450. "Pongo lo que usé realmente, no lo que se estimaba"
   * (reunión 4/8).
   *
   * Se puede corregir sin movimientos compensatorios porque abrirLote no toca
   * el stock: los descuentos recién ocurren acá, así que alcanza con ajustar
   * las cantidades antes de descontar.
   */
  insumosReales?: { insumoUsadoId: number; cantidadUsada: number }[];
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

    // Corrección de lo realmente usado, ANTES de validar y descontar. Se
    // muta también el objeto en memoria para que todo lo que sigue (validación,
    // rendimiento esperado, movimientos de stock) trabaje con el número real.
    const huboCorrecciones = (params.insumosReales?.length ?? 0) > 0;
    if (params.insumosReales) {
      const idsDelLote = new Set(lote.insumosUsados.map((i) => i.id));
      for (const correccion of params.insumosReales) {
        if (!idsDelLote.has(correccion.insumoUsadoId)) {
          throw Errores.validacion(`El insumo ${correccion.insumoUsadoId} no pertenece a este lote`);
        }
        if (correccion.cantidadUsada < 0) {
          throw Errores.validacion('La cantidad usada no puede ser negativa');
        }
        const insumo = lote.insumosUsados.find((i) => i.id === correccion.insumoUsadoId)!;
        insumo.cantidadUsada = new Prisma.Decimal(correccion.cantidadUsada);
        await tx.insumoUsado.update({
          where: { id: insumo.id },
          data: { cantidadUsada: insumo.cantidadUsada },
        });
      }
    }

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

      // Si al corregir quedó en 0 (no se usó ese insumo), no se registra
      // movimiento: sería ruido en el historial de stock.
      if (!cantidadConsumo.isZero()) {
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

    // 4) desvío vs. esperado (interno — jamás expuesto al operario).
    //    Si se corrigieron los insumos, el esperado se recalcula con lo que
    //    realmente se usó: comparar contra la estimación de la apertura daría
    //    un desvío falso y dispararía alertas que no corresponden.
    const unidadesEsperadas = huboCorrecciones
      ? calcularUnidadesEsperadas({
          cantidadInsumoPrincipal: totalPrincipal,
          cantidadPorUnidadProducida: ingredientePrincipal.cantidadPorUnidadProducida,
          desperdicioEsperadoPct: lote.fichaTecnicaVersion.desperdicioEsperadoPct,
        })
      : (lote.unidadesEsperadas ?? new Prisma.Decimal(0));
    const desvioPct = calcularDesvioPct(unidadesReales, unidadesEsperadas);
    const alertaDisparada = superaUmbral(desvioPct, lote.fichaTecnicaVersion.umbralDesvioAlertaPct);

    const loteCerrado = await tx.loteDeProduccion.update({
      where: { id: lote.id },
      data: {
        estado: 'CERRADO',
        unidadesProducidasReales: unidadesReales,
        desperdicioRealKg: desperdicioReal,
        unidadesEsperadas,
        desvioPct,
        alertaDisparada,
        // El lote pasa a ser la partida del producto terminado: arranca con
        // todo lo producido disponible para enviar.
        cantidadRestanteDisponible: unidadesReales,
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
        // Queda registrado que el operario corrigió lo estimado: es
        // justamente el dato que el admin va a querer mirar después.
        ...(huboCorrecciones
          ? {
              insumosCorregidos: lote.insumosUsados.map((i) => ({
                insumoUsadoId: i.id,
                productoInsumoId: i.productoInsumoId,
                cantidadUsada: i.cantidadUsada.toString(),
              })),
            }
          : {}),
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

// Lotes cerrados con saldo sin enviar — las "partidas" del producto terminado.
// Con productoId, para elegir de cuál sale un envío; sin él, todo lo que hay.
// Orden FIFO (más viejo primero), igual que las partidas de materia prima:
// Pablo quiere mandar primero lo de ayer, no lo recién producido.
export async function lotesDisponibles(productoId?: number) {
  return prisma.loteDeProduccion.findMany({
    where: {
      ...(productoId != null ? { productoElaboradoId: productoId } : {}),
      estado: 'CERRADO',
      cantidadRestanteDisponible: { gt: 0 },
    },
    include: {
      productoElaborado: { select: { nombre: true, unidadDeMedida: true } },
      usuarioOperario: { select: { username: true } },
    },
    orderBy: { fechaHora: 'asc' },
  });
}

// Productos que efectivamente se producen por lote en planta: tipo ELABORADO
// CON ficha técnica cargada. Deja afuera lo que se arma en el local a la
// venta (hamburguesas completas, papas grandes, etc. — son ELABORADO pero
// nunca tienen FichaTecnica, se arman en el POS del módulo 2) y productos de
// sistema que no se producen por lote (ej. "Pollo a la leña — MARCADO", que
// se genera solo marcando pollos en caja).
export async function listarProductosProducibles() {
  return prisma.producto.findMany({
    where: { tipo: 'ELABORADO', activo: true, esProductoSistema: false, fichaTecnica: { isNot: null } },
    orderBy: { nombre: 'asc' },
  });
}

// Identidades de los insumos de la ficha activa de un producto — SIN
// cantidades ni datos de rendimiento/desvío (control ciego: PRODUCCION nunca
// ve esos números). Sirve para precargar la lista de insumos al abrir un
// lote, sin tener que buscarlos uno por uno en el catálogo completo.
export async function insumosDeFichaActiva(productoElaboradoId: number) {
  const { version } = await fichasService.obtenerVersionActiva(productoElaboradoId);
  const ingredientes = await prisma.ingredienteDeReceta.findMany({
    where: { fichaTecnicaVersionId: version.id },
    include: { productoInsumo: { select: { nombre: true, unidadDeMedida: true } } },
  });
  return ingredientes.map((i) => ({
    productoInsumoId: i.productoInsumoId,
    nombre: i.productoInsumo.nombre,
    unidadDeMedida: i.productoInsumo.unidadDeMedida,
    esPrincipal: i.esPrincipal,
  }));
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
