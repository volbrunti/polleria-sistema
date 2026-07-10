import bcrypt from 'bcryptjs';
import type { Rol } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';

const SIN_PASSWORD = { id: true, nombre: true, username: true, rol: true, activo: true } as const;

export async function listar() {
  return prisma.usuario.findMany({ select: SIN_PASSWORD, orderBy: { nombre: 'asc' } });
}

export async function crear(
  datos: { nombre: string; username: string; password: string; rol: Rol },
  usuarioIdEjecutor: number,
) {
  const passwordHash = await bcrypt.hash(datos.password, 10);
  return prisma.$transaction(async (tx) => {
    const usuario = await tx.usuario.create({
      data: { nombre: datos.nombre, username: datos.username, passwordHash, rol: datos.rol },
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
  datos: { nombre?: string; rol?: Rol; activo?: boolean; password?: string },
  usuarioIdEjecutor: number,
) {
  const anterior = await prisma.usuario.findUnique({ where: { id }, select: SIN_PASSWORD });
  if (!anterior) throw Errores.noEncontrado('Usuario');

  const data: Record<string, unknown> = {};
  if (datos.nombre !== undefined) data.nombre = datos.nombre;
  if (datos.rol !== undefined) data.rol = datos.rol;
  if (datos.activo !== undefined) data.activo = datos.activo;
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
