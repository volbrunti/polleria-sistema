import { Prisma, type MedioPago } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';

// Recargos de tarjeta (reunión 4/8). El admin deja cargados los porcentajes
// que cobra cada tarjeta y el cajero los elige de una lista al cobrar, en vez
// de tipearlos a mano y equivocarse.

/** Solo tiene sentido recargar plásticos: el efectivo y el QR no tienen arancel. */
export const MEDIOS_CON_RECARGO: MedioPago[] = ['DEBITO', 'CREDITO'];

export function admiteRecargo(medio: MedioPago): boolean {
  return MEDIOS_CON_RECARGO.includes(medio);
}

export async function listar(filtros: { activo?: boolean } = {}) {
  return prisma.recargoTarjeta.findMany({
    where: { activo: filtros.activo },
    orderBy: [{ medio: 'asc' }, { porcentaje: 'asc' }],
  });
}

export async function crear(
  datos: { nombre: string; medio: MedioPago; porcentaje: number },
  usuarioId: number,
) {
  if (!admiteRecargo(datos.medio)) throw Errores.medioSinRecargo(datos.medio);

  const existente = await prisma.recargoTarjeta.findUnique({
    where: { medio_nombre: { medio: datos.medio, nombre: datos.nombre } },
  });
  if (existente) throw Errores.validacion(`Ya existe un recargo "${datos.nombre}" para ese medio`);

  return prisma.$transaction(async (tx) => {
    const recargo = await tx.recargoTarjeta.create({
      data: {
        nombre: datos.nombre,
        medio: datos.medio,
        porcentaje: new Prisma.Decimal(datos.porcentaje),
      },
    });
    await registrarAuditoria(tx, {
      accion: 'CREAR_RECARGO_TARJETA',
      entidad: 'RecargoTarjeta',
      entidadId: recargo.id,
      usuarioId,
      datosNuevos: recargo,
    });
    return recargo;
  });
}

export async function actualizar(
  id: number,
  datos: { nombre?: string; porcentaje?: number; activo?: boolean },
  usuarioId: number,
) {
  const anterior = await prisma.recargoTarjeta.findUnique({ where: { id } });
  if (!anterior) throw Errores.noEncontrado('Recargo de tarjeta');

  return prisma.$transaction(async (tx) => {
    const recargo = await tx.recargoTarjeta.update({
      where: { id },
      data: {
        nombre: datos.nombre,
        porcentaje: datos.porcentaje != null ? new Prisma.Decimal(datos.porcentaje) : undefined,
        activo: datos.activo,
      },
    });
    await registrarAuditoria(tx, {
      accion: 'ACTUALIZAR_RECARGO_TARJETA',
      entidad: 'RecargoTarjeta',
      entidadId: id,
      usuarioId,
      datosAnteriores: anterior,
      datosNuevos: recargo,
    });
    return recargo;
  });
}
