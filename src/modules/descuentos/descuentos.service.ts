import { Prisma, type TipoBeneficiarioDescuento } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';

// Descuento de empleado/encargado, elegido al cobrar (post-prueba en vivo).
// Mismo patrón que recargos.service.ts, mirado al revés: el admin deja
// cargados los tipos con su % y el cajero los elige de una lista, en vez de
// depender de un único porcentaje global de configuración.

export async function listar(filtros: { activo?: boolean } = {}) {
  return prisma.tipoDescuento.findMany({
    where: { activo: filtros.activo },
    orderBy: [{ tipo: 'asc' }, { porcentaje: 'asc' }],
  });
}

export async function crear(
  datos: { nombre: string; tipo: TipoBeneficiarioDescuento; porcentaje: number },
  usuarioId: number,
) {
  const existente = await prisma.tipoDescuento.findUnique({
    where: { tipo_nombre: { tipo: datos.tipo, nombre: datos.nombre } },
  });
  if (existente) throw Errores.validacion(`Ya existe un descuento "${datos.nombre}" para ese tipo`);

  return prisma.$transaction(async (tx) => {
    const descuento = await tx.tipoDescuento.create({
      data: {
        nombre: datos.nombre,
        tipo: datos.tipo,
        porcentaje: new Prisma.Decimal(datos.porcentaje),
      },
    });
    await registrarAuditoria(tx, {
      accion: 'CREAR_TIPO_DESCUENTO',
      entidad: 'TipoDescuento',
      entidadId: descuento.id,
      usuarioId,
      datosNuevos: descuento,
    });
    return descuento;
  });
}

export async function actualizar(
  id: number,
  datos: { nombre?: string; porcentaje?: number; activo?: boolean },
  usuarioId: number,
) {
  const anterior = await prisma.tipoDescuento.findUnique({ where: { id } });
  if (!anterior) throw Errores.noEncontrado('Tipo de descuento');

  return prisma.$transaction(async (tx) => {
    const descuento = await tx.tipoDescuento.update({
      where: { id },
      data: {
        nombre: datos.nombre,
        porcentaje: datos.porcentaje != null ? new Prisma.Decimal(datos.porcentaje) : undefined,
        activo: datos.activo,
      },
    });
    await registrarAuditoria(tx, {
      accion: 'ACTUALIZAR_TIPO_DESCUENTO',
      entidad: 'TipoDescuento',
      entidadId: id,
      usuarioId,
      datosAnteriores: anterior,
      datosNuevos: descuento,
    });
    return descuento;
  });
}
