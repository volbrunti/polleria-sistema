import { Prisma, type MomentoArqueo, type TipoArqueo } from '@prisma/client';
import { prisma, OPCIONES_TX, type TxClient } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';
import { NOMBRE_POLLO_MARCADO } from '../../lib/constantes';
import * as alertasService from '../alertas/alertas.service';
import {
  calcularArqueo,
  calcularEfectivoEsperadoCierre,
  calcularPollosEsperadosCierre,
} from './turnos.calculos';

const CERO = new Prisma.Decimal(0);

const INCLUDE_TURNO = {
  sucursal: { select: { nombre: true } },
  usuarioCajero: { select: { username: true } },
  arqueos: true,
} as const;

// ── Resolución de sucursal operativa ──
// CAJERO/ENCARGADO: siempre su sucursal fija, releída de la DB (nunca del
// JWT — mismo criterio que transferencias.service.ts). ADMIN: debe indicar
// explícitamente sobre qué sucursal opera.
export async function resolverSucursalOperativa(
  usuarioId: number,
  sucursalIdPedida: number | undefined,
): Promise<number> {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario || !usuario.activo) throw Errores.noAutorizado();

  if (usuario.rol === 'ADMINISTRADOR') {
    if (!sucursalIdPedida) throw Errores.validacion('Como administrador tenés que indicar la sucursal');
    return sucursalIdPedida;
  }

  if (!usuario.sucursalId) {
    throw Errores.validacion('Tu usuario no tiene sucursal asignada — pedile al administrador que la configure');
  }
  if (sucursalIdPedida !== undefined && sucursalIdPedida !== usuario.sucursalId) {
    throw Errores.sucursalNoAutorizada();
  }
  return usuario.sucursalId;
}

async function productoPolloMarcado(tx: TxClient = prisma) {
  return tx.producto.findUnique({ where: { nombre: NOMBRE_POLLO_MARCADO } });
}

// Turno activo (abierto o bloqueado) de una sucursal — a lo sumo uno.
export async function turnoActivoDeSucursal(sucursalId: number, tx: TxClient = prisma) {
  return tx.turno.findFirst({
    where: { sucursalId, estado: { in: ['ABIERTO', 'BLOQUEADO'] } },
    include: INCLUDE_TURNO,
  });
}

// Turno ABIERTO requerido para operar el POS (lo usa el módulo de pedidos).
export async function exigirTurnoAbierto(sucursalId: number, tx: TxClient = prisma) {
  const turno = await tx.turno.findFirst({ where: { sucursalId, estado: 'ABIERTO' } });
  if (!turno) throw Errores.turnoNoAbierto();
  return turno;
}

// ── FLUJO 5.1 — Apertura con arqueo doble y ciego ──
// El cajero declara sus dos conteos SIN ver referencia alguna. El sistema
// compara contra los saldos finales CONTADOS del último turno cerrado de la
// sucursal (o 0 si nunca hubo turno). Si algo no coincide: turno BLOQUEADO,
// alerta al admin con todos los números — el cajero recibe solo un mensaje
// genérico, sin monto, sin lado del error, sin saber cuál de los dos falló.
export async function abrirTurno(params: {
  usuarioId: number;
  sucursalId?: number;
  conteoEfectivo: number;
  conteoPollosMarcados: number;
}) {
  const sucursalId = await resolverSucursalOperativa(params.usuarioId, params.sucursalId);

  const sucursal = await prisma.sucursal.findUnique({ where: { id: sucursalId } });
  if (!sucursal || !sucursal.activa) throw Errores.noEncontrado('Sucursal');
  if (sucursal.tipo !== 'VENTA') throw Errores.validacion('Los turnos de caja son de los locales de venta');

  const resultado = await prisma.$transaction(async (tx) => {
    const activo = await tx.turno.findFirst({
      where: { sucursalId, estado: { in: ['ABIERTO', 'BLOQUEADO'] } },
    });
    if (activo) throw Errores.turnoYaActivo();

    // Referencia ciega: el cierre del último turno CERRADO de esta sucursal.
    // Primer turno de la historia: efectivo 0 (no hay registro previo de
    // plata) y pollos = stock ACTUAL del producto MARCADO (0 en una
    // instalación fresca; si el sistema arranca con pollos ya en la parrilla
    // cargados por ajuste/marcado, no genera un bloqueo espurio).
    const turnoAnterior = await tx.turno.findFirst({
      where: { sucursalId, estado: 'CERRADO' },
      orderBy: { fechaCierre: 'desc' },
      include: { arqueos: { where: { momento: 'CIERRE' } } },
    });
    const cierreAnterior = (tipo: TipoArqueo) =>
      turnoAnterior?.arqueos.find((a) => a.tipo === tipo)?.valorContado ?? CERO;

    const esperadoEfectivo = cierreAnterior('EFECTIVO');
    let esperadoPollos: Prisma.Decimal;
    if (turnoAnterior) {
      esperadoPollos = cierreAnterior('POLLOS_MARCADOS');
    } else {
      const marcado = await productoPolloMarcado(tx);
      if (marcado) {
        const agg = await tx.movimientoStock.aggregate({
          where: { productoId: marcado.id, sucursalId },
          _sum: { cantidad: true },
        });
        esperadoPollos = agg._sum.cantidad ?? CERO;
      } else {
        esperadoPollos = CERO;
      }
    }

    const arqueoEfectivo = calcularArqueo(new Prisma.Decimal(params.conteoEfectivo), esperadoEfectivo);
    const arqueoPollos = calcularArqueo(new Prisma.Decimal(params.conteoPollosMarcados), esperadoPollos);
    const hayDiscrepancia =
      arqueoEfectivo.resultado !== 'COINCIDE' || arqueoPollos.resultado !== 'COINCIDE';

    const turno = await tx.turno.create({
      data: {
        sucursalId,
        usuarioCajeroId: params.usuarioId,
        estado: hayDiscrepancia ? 'BLOQUEADO' : 'ABIERTO',
        arqueos: {
          create: [
            {
              momento: 'APERTURA' as MomentoArqueo,
              tipo: 'EFECTIVO' as TipoArqueo,
              valorContado: new Prisma.Decimal(params.conteoEfectivo),
              valorEsperado: esperadoEfectivo,
              diferencia: arqueoEfectivo.diferencia,
              resultado: arqueoEfectivo.resultado,
            },
            {
              momento: 'APERTURA' as MomentoArqueo,
              tipo: 'POLLOS_MARCADOS' as TipoArqueo,
              valorContado: new Prisma.Decimal(params.conteoPollosMarcados),
              valorEsperado: esperadoPollos,
              diferencia: arqueoPollos.diferencia,
              resultado: arqueoPollos.resultado,
            },
          ],
        },
      },
      include: INCLUDE_TURNO,
    });

    await registrarAuditoria(tx, {
      accion: 'ABRIR_TURNO',
      entidad: 'Turno',
      entidadId: turno.id,
      usuarioId: params.usuarioId,
      datosNuevos: {
        sucursalId,
        estado: turno.estado,
        conteoEfectivo: params.conteoEfectivo,
        conteoPollosMarcados: params.conteoPollosMarcados,
      },
    });

    let alerta = null;
    if (hayDiscrepancia) {
      const arqueoDisparador = turno.arqueos.find((a) => a.resultado !== 'COINCIDE')!;
      await tx.bloqueoDeTurno.create({
        data: {
          turnoId: turno.id,
          arqueoQueLoDisparoId: arqueoDisparador.id,
          usuarioCajeroAnteriorId: turnoAnterior?.usuarioCajeroId ?? null,
        },
      });

      const detalle = {
        turnoId: turno.id,
        sucursalId,
        sucursal: sucursal.nombre,
        usuarioCajeroActualId: params.usuarioId,
        usuarioCajeroAnteriorId: turnoAnterior?.usuarioCajeroId ?? null,
        arqueos: turno.arqueos.map((a) => ({
          tipo: a.tipo,
          valorEsperado: a.valorEsperado.toString(),
          valorContado: a.valorContado.toString(),
          diferencia: a.diferencia.toString(),
          resultado: a.resultado,
        })),
      };
      alerta = await alertasService.crearAlerta(tx, {
        tipo: 'BLOQUEO_TURNO',
        tipoOrigen: 'Turno',
        origenId: turno.id,
        detalle,
      });

      // Auditoría reforzada del bloqueo: ambos cajeros + diferencias (Flujo 7)
      await registrarAuditoria(tx, {
        accion: 'BLOQUEO_TURNO',
        entidad: 'Turno',
        entidadId: turno.id,
        usuarioId: params.usuarioId,
        datosNuevos: detalle,
      });
    }

    return { turno, alerta };
  }, OPCIONES_TX);

  if (resultado.alerta) {
    alertasService.emitirAlerta({
      id: resultado.alerta.id,
      tipo: resultado.alerta.tipo,
      detalle: resultado.alerta.detalle,
    });
    alertasService.emitirAAdmins('turno:bloqueado', { turnoId: resultado.turno.id });
  }

  return resultado.turno;
}

// ── Desbloqueo remoto (solo ADMIN, desde su panel) ──
export async function desbloquearRemoto(params: { turnoId: number; usuarioAdminId: number }) {
  const turno = await prisma.turno.findUnique({
    where: { id: params.turnoId },
    include: { bloqueo: true },
  });
  if (!turno) throw Errores.noEncontrado('Turno');
  if (turno.estado !== 'BLOQUEADO' || !turno.bloqueo) throw Errores.turnoNoBloqueado();

  const actualizado = await prisma.$transaction(async (tx) => {
    const t = await tx.turno.update({
      where: { id: turno.id },
      data: { estado: 'ABIERTO' },
      include: INCLUDE_TURNO,
    });
    await tx.bloqueoDeTurno.update({
      where: { id: turno.bloqueo!.id },
      data: {
        estado: 'DESBLOQUEADO',
        tipoDesbloqueo: 'REMOTO',
        usuarioAutorizanteId: params.usuarioAdminId,
        fechaDesbloqueo: new Date(),
      },
    });
    await registrarAuditoria(tx, {
      accion: 'DESBLOQUEO_TURNO_REMOTO',
      entidad: 'Turno',
      entidadId: turno.id,
      usuarioId: params.usuarioAdminId,
      datosNuevos: {
        turnoId: turno.id,
        usuarioCajeroActualId: turno.usuarioCajeroId,
        usuarioCajeroAnteriorId: turno.bloqueo!.usuarioCajeroAnteriorId,
      },
    });
    return t;
  }, OPCIONES_TX);

  alertasService.emitirAAdmins('turno:desbloqueado', { turnoId: turno.id });
  // Push al POS del local: el cajero bloqueado se entera al instante, sin
  // esperar el próximo ciclo de polling (§9 — sala por sucursal).
  alertasService.emitirASucursal(turno.sucursalId, 'turno:desbloqueado', { turnoId: turno.id });
  return actualizado;
}

// ── FLUJO 5.3 — Cierre con arqueo doble y ciego ──
// Mismo principio que la apertura. La discrepancia al cierre NO bloquea:
// genera alerta DISCREPANCIA_CAJA al admin y el turno cierra igual. El cajero
// recibe SOLO el resumen por unidades (sin plata) y su propio conteo.
export async function cerrarTurno(params: {
  usuarioId: number;
  sucursalId?: number;
  conteoEfectivo: number;
  conteoPollosMarcados: number;
}) {
  const sucursalId = await resolverSucursalOperativa(params.usuarioId, params.sucursalId);
  const polloMarcado = await productoPolloMarcado();

  const resultado = await prisma.$transaction(async (tx) => {
    const turno = await tx.turno.findFirst({
      where: { sucursalId, estado: 'ABIERTO' },
      include: { arqueos: true },
    });
    if (!turno) throw Errores.turnoNoAbierto();

    const aperturaDe = (tipo: TipoArqueo) =>
      turno.arqueos.find((a) => a.momento === 'APERTURA' && a.tipo === tipo)?.valorContado ?? CERO;

    // Esperado de efectivo: apertura + pagos EFECTIVO − gastos EFECTIVO − retiros EFECTIVO
    const pagosEfectivo = await tx.pago.aggregate({
      where: { medio: 'EFECTIVO', pedido: { turnoId: turno.id, estado: { not: 'ANULADO' } } },
      _sum: { monto: true },
    });
    const gastosEfectivo = await tx.gastoDeCaja.aggregate({
      where: { turnoId: turno.id, medio: 'EFECTIVO' },
      _sum: { monto: true },
    });
    const retirosEfectivo = await tx.retiroDeCaja.aggregate({
      where: { turnoId: turno.id, medio: 'EFECTIVO' },
      _sum: { monto: true },
    });
    const esperadoEfectivo = calcularEfectivoEsperadoCierre({
      aperturaContada: aperturaDe('EFECTIVO'),
      ventasEfectivo: pagosEfectivo._sum.monto ?? CERO,
      gastosEfectivo: gastosEfectivo._sum.monto ?? CERO,
      retirosEfectivo: retirosEfectivo._sum.monto ?? CERO,
    });

    // Esperado de pollos: apertura + neto de movimientos del producto MARCADO
    // en la sucursal durante el turno (marcados +, vendidos/retornos/quemados −)
    let netoMarcado = CERO;
    if (polloMarcado) {
      const agg = await tx.movimientoStock.aggregate({
        where: {
          productoId: polloMarcado.id,
          sucursalId,
          fechaHora: { gte: turno.fechaApertura },
        },
        _sum: { cantidad: true },
      });
      netoMarcado = agg._sum.cantidad ?? CERO;
    }
    const esperadoPollos = calcularPollosEsperadosCierre({
      aperturaContada: aperturaDe('POLLOS_MARCADOS'),
      netoMovimientosMarcado: netoMarcado,
    });

    const arqueoEfectivo = calcularArqueo(new Prisma.Decimal(params.conteoEfectivo), esperadoEfectivo);
    const arqueoPollos = calcularArqueo(new Prisma.Decimal(params.conteoPollosMarcados), esperadoPollos);
    const hayDiscrepancia =
      arqueoEfectivo.resultado !== 'COINCIDE' || arqueoPollos.resultado !== 'COINCIDE';

    await tx.arqueo.createMany({
      data: [
        {
          turnoId: turno.id,
          momento: 'CIERRE' as MomentoArqueo,
          tipo: 'EFECTIVO' as TipoArqueo,
          valorContado: new Prisma.Decimal(params.conteoEfectivo),
          valorEsperado: esperadoEfectivo,
          diferencia: arqueoEfectivo.diferencia,
          resultado: arqueoEfectivo.resultado,
        },
        {
          turnoId: turno.id,
          momento: 'CIERRE' as MomentoArqueo,
          tipo: 'POLLOS_MARCADOS' as TipoArqueo,
          valorContado: new Prisma.Decimal(params.conteoPollosMarcados),
          valorEsperado: esperadoPollos,
          diferencia: arqueoPollos.diferencia,
          resultado: arqueoPollos.resultado,
        },
      ],
    });

    const cerrado = await tx.turno.update({
      where: { id: turno.id },
      data: { estado: 'CERRADO', fechaCierre: new Date() },
      include: INCLUDE_TURNO,
    });

    let alerta = null;
    if (hayDiscrepancia) {
      const detalle = {
        turnoId: turno.id,
        sucursalId,
        usuarioCajeroId: turno.usuarioCajeroId,
        arqueos: cerrado.arqueos
          .filter((a) => a.momento === 'CIERRE')
          .map((a) => ({
            tipo: a.tipo,
            valorEsperado: a.valorEsperado.toString(),
            valorContado: a.valorContado.toString(),
            diferencia: a.diferencia.toString(),
            resultado: a.resultado,
          })),
      };
      alerta = await alertasService.crearAlerta(tx, {
        tipo: 'DISCREPANCIA_CAJA',
        tipoOrigen: 'Turno',
        origenId: turno.id,
        detalle,
      });
    }

    await registrarAuditoria(tx, {
      accion: 'CERRAR_TURNO',
      entidad: 'Turno',
      entidadId: turno.id,
      usuarioId: params.usuarioId,
      datosNuevos: {
        conteoEfectivo: params.conteoEfectivo,
        conteoPollosMarcados: params.conteoPollosMarcados,
        discrepancia: hayDiscrepancia,
      },
    });

    // Resumen para el CAJERO: unidades vendidas por producto, SIN plata.
    const items = await tx.itemDePedido.groupBy({
      by: ['productoId'],
      where: { pedido: { turnoId: turno.id, estado: { not: 'ANULADO' } } },
      _sum: { cantidad: true },
    });
    const productos = await tx.producto.findMany({
      where: { id: { in: items.map((i) => i.productoId) } },
      select: { id: true, nombre: true },
    });
    const nombrePorId = new Map(productos.map((p) => [p.id, p.nombre]));
    const ventasPorUnidad = items
      .map((i) => ({
        productoId: i.productoId,
        producto: nombrePorId.get(i.productoId) ?? '',
        unidades: (i._sum.cantidad ?? CERO).toString(),
      }))
      .sort((a, b) => a.producto.localeCompare(b.producto));

    return { turno: cerrado, alerta, ventasPorUnidad };
  }, OPCIONES_TX);

  if (resultado.alerta) {
    alertasService.emitirAlerta({
      id: resultado.alerta.id,
      tipo: resultado.alerta.tipo,
      detalle: resultado.alerta.detalle,
    });
  }

  return resultado;
}

// ── Consultas ──

export async function listarTurnos(filtros: { sucursalId?: number; estado?: 'ABIERTO' | 'BLOQUEADO' | 'CERRADO' }) {
  return prisma.turno.findMany({
    where: { sucursalId: filtros.sucursalId, estado: filtros.estado },
    include: INCLUDE_TURNO,
    orderBy: { fechaApertura: 'desc' },
    take: 200,
  });
}

// Resumen financiero COMPLETO — solo ADMIN/SOCIO (CLAUDE-MODULO-2.md §5.3
// paso 4). Ventas por medio de pago, gastos, retiros por socio, atenciones,
// arqueos con esperado/diferencia.
export async function resumenDeTurno(turnoId: number) {
  const turno = await prisma.turno.findUnique({
    where: { id: turnoId },
    include: {
      ...INCLUDE_TURNO,
      bloqueo: true,
      gastos: { include: { usuario: { select: { username: true } } } },
      retiros: { include: { usuarioCajero: { select: { username: true } } } },
      atenciones: { include: { producto: { select: { nombre: true } }, usuario: { select: { username: true } } } },
      eventosMarcado: true,
    },
  });
  if (!turno) throw Errores.noEncontrado('Turno');

  const ventasPorMedio = await prisma.pago.groupBy({
    by: ['medio'],
    where: { pedido: { turnoId, estado: { not: 'ANULADO' } } },
    _sum: { monto: true },
  });

  const unidadesVendidas = await prisma.itemDePedido.groupBy({
    by: ['productoId'],
    where: { pedido: { turnoId, estado: { not: 'ANULADO' } } },
    _sum: { cantidad: true },
  });
  const productos = await prisma.producto.findMany({
    where: { id: { in: unidadesVendidas.map((i) => i.productoId) } },
    select: { id: true, nombre: true },
  });
  const nombrePorId = new Map(productos.map((p) => [p.id, p.nombre]));

  return {
    turno,
    ventasPorMedio: ventasPorMedio.map((v) => ({
      medio: v.medio,
      total: (v._sum.monto ?? CERO).toString(),
    })),
    unidadesVendidas: unidadesVendidas.map((i) => ({
      productoId: i.productoId,
      producto: nombrePorId.get(i.productoId) ?? '',
      unidades: (i._sum.cantidad ?? CERO).toString(),
    })),
  };
}
