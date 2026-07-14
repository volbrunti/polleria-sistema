import bcrypt from 'bcryptjs';
import type { Rol } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';

const SIN_PASSWORD = { id: true, nombre: true, username: true, rol: true, activo: true, sucursalId: true } as const;

export async function listar() {
  return prisma.usuario.findMany({ select: SIN_PASSWORD, orderBy: { nombre: 'asc' } });
}

export async function crear(
  datos: { nombre: string; username: string; password: string; rol: Rol; sucursalId?: number | null },
  usuarioIdEjecutor: number,
) {
  const passwordHash = await bcrypt.hash(datos.password, 10);
  return prisma.$transaction(async (tx) => {
    const usuario = await tx.usuario.create({
      data: {
        nombre: datos.nombre,
        username: datos.username,
        passwordHash,
        rol: datos.rol,
        sucursalId: datos.sucursalId ?? null,
      },
      select: SIN_PASSWORD,
    });
    await registrarAuditoria(tx, {
      accion: 'CREAR_USUARIO',
      entidad: 'Usuario',
      entidadId: usuario.id,
      usuarioId: usuarioIdEjecutor,
      datosNuevos: usuario,
    });
    return usuario;
  });
}

export async function actualizar(
  id: number,
  datos: { nombre?: string; rol?: Rol; activo?: boolean; password?: string; sucursalId?: number | null },
  usuarioIdEjecutor: number,
) {
  const anterior = await prisma.usuario.findUnique({ where: { id }, select: SIN_PASSWORD });
  if (!anterior) throw Errores.noEncontrado('Usuario');

  const data: Record<string, unknown> = {};
  if (datos.nombre !== undefined) data.nombre = datos.nombre;
  if (datos.rol !== undefined) data.rol = datos.rol;
  if (datos.activo !== undefined) data.activo = datos.activo;
  if (datos.sucursalId !== undefined) data.sucursalId = datos.sucursalId;
  if (datos.password !== undefined) data.passwordHash = await bcrypt.hash(datos.password, 10);

  return prisma.$transaction(async (tx) => {
    const usuario = await tx.usuario.update({ where: { id }, data, select: SIN_PASSWORD });
    await registrarAuditoria(tx, {
      accion: 'ACTUALIZAR_USUARIO',
      entidad: 'Usuario',
      entidadId: id,
      usuarioId: usuarioIdEjecutor,
      datosAnteriores: anterior,
      datosNuevos: usuario,
    });
    return usuario;
  });
}

// Eliminación REAL solo para usuarios sin actividad (limpiar cuentas de
// prueba). Un usuario que ya operó es "firma digital" de sus registros
// (CLAUDE.md §2): no se borra nunca, se desactiva con PATCH { activo: false }.
export async function eliminar(id: number, usuarioIdEjecutor: number) {
  if (id === usuarioIdEjecutor)
    throw Errores.validacion('No podés eliminar tu propio usuario');

  const usuario = await prisma.usuario.findUnique({
    where: { id },
    select: {
      ...SIN_PASSWORD,
      _count: {
        select: {
          movimientosStock: true,
          registrosAuditoria: true,
          preciosCreados: true,
          ingresosMercaderia: true,
          lotesProduccion: true,
          transferenciasEmitidas: true,
          transferenciasRecibidas: true,
        },
      },
    },
  });
  if (!usuario) throw Errores.noEncontrado('Usuario');

  const { _count, ...datosUsuario } = usuario;
  if (Object.values(_count).some((n) => n > 0)) throw Errores.usuarioConHistorial();

  await prisma.$transaction(async (tx) => {
    // Los refresh tokens son sesiones, no historial: se borran con el usuario.
    await tx.refreshToken.deleteMany({ where: { usuarioId: id } });
    await tx.usuario.delete({ where: { id } });
    await registrarAuditoria(tx, {
      accion: 'ELIMINAR_USUARIO',
      entidad: 'Usuario',
      entidadId: id,
      usuarioId: usuarioIdEjecutor,
      datosAnteriores: datosUsuario,
    });
  });
  return datosUsuario;
}
