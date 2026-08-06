import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';

// Parámetros que el admin cambia sin tocar código. Clave-valor a propósito:
// cada número configurable nuevo no debería costar una migración.

export const CLAVES = {
  /** % que se descuenta en un pedido marcado como venta a empleado. */
  DESCUENTO_EMPLEADO_PCT: 'DESCUENTO_EMPLEADO_PCT',
} as const;

/** Si alguien borró la fila, el sistema no se cae: cae en este valor. */
const POR_DEFECTO: Record<string, string> = {
  [CLAVES.DESCUENTO_EMPLEADO_PCT]: '20',
};

export async function listar() {
  return prisma.configuracionGeneral.findMany({ orderBy: { clave: 'asc' } });
}

export async function obtener(clave: string): Promise<string> {
  const fila = await prisma.configuracionGeneral.findUnique({ where: { clave } });
  return fila?.valor ?? POR_DEFECTO[clave] ?? '';
}

/** El % de descuento a empleados, ya validado como número usable. */
export async function descuentoEmpleadoPct(): Promise<Prisma.Decimal> {
  const valor = Number(await obtener(CLAVES.DESCUENTO_EMPLEADO_PCT));
  if (!Number.isFinite(valor) || valor < 0 || valor > 100) return new Prisma.Decimal(0);
  return new Prisma.Decimal(valor);
}

export async function actualizar(clave: string, valor: string, usuarioId: number) {
  const anterior = await prisma.configuracionGeneral.findUnique({ where: { clave } });
  if (!anterior) throw Errores.noEncontrado(`Configuración ${clave}`);

  if (clave === CLAVES.DESCUENTO_EMPLEADO_PCT) {
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw Errores.validacion('El descuento a empleados tiene que estar entre 0 y 100');
    }
  }

  return prisma.$transaction(async (tx) => {
    const actualizado = await tx.configuracionGeneral.update({ where: { clave }, data: { valor } });
    await registrarAuditoria(tx, {
      accion: 'ACTUALIZAR_CONFIGURACION',
      entidad: 'ConfiguracionGeneral',
      // La PK es la clave, no un Int: se audita con 0 y el detalle dice cuál.
      entidadId: 0,
      usuarioId,
      datosAnteriores: anterior,
      datosNuevos: actualizado,
    });
    return actualizado;
  });
}
