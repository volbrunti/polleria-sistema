import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { Errores } from '../../lib/errores';
import { config } from '../../config';
import { firmarAccessToken, type UsuarioAutenticado } from '../../plugins/auth';

function hashearToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function login(username: string, password: string) {
  const usuario = await prisma.usuario.findUnique({ where: { username } });
  if (!usuario || !usuario.activo) throw Errores.credencialesInvalidas();

  const ok = await bcrypt.compare(password, usuario.passwordHash);
  if (!ok) throw Errores.credencialesInvalidas();

  const usuarioAuth: UsuarioAutenticado = {
    id: usuario.id,
    username: usuario.username,
    rol: usuario.rol,
  };

  const accessToken = firmarAccessToken(usuarioAuth);
  const refreshToken = crypto.randomBytes(48).toString('hex');
  const expiraEn = new Date(Date.now() + config.jwtRefreshExpiresDias * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: { tokenHash: hashearToken(refreshToken), usuarioId: usuario.id, expiraEn },
  });

  return {
    accessToken,
    refreshToken,
    usuario: { id: usuario.id, nombre: usuario.nombre, username: usuario.username, rol: usuario.rol },
  };
}

export async function renovar(refreshToken: string) {
  const registro = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashearToken(refreshToken) },
    include: { usuario: true },
  });
  if (!registro || registro.revocado || registro.expiraEn < new Date() || !registro.usuario.activo) {
    throw Errores.noAutorizado();
  }

  // Rotación: revoca el token usado y emite uno nuevo
  const nuevoRefresh = crypto.randomBytes(48).toString('hex');
  const expiraEn = new Date(Date.now() + config.jwtRefreshExpiresDias * 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.refreshToken.update({ where: { id: registro.id }, data: { revocado: true } }),
    prisma.refreshToken.create({
      data: { tokenHash: hashearToken(nuevoRefresh), usuarioId: registro.usuarioId, expiraEn },
    }),
  ]);

  const accessToken = firmarAccessToken({
    id: registro.usuario.id,
    username: registro.usuario.username,
    rol: registro.usuario.rol,
  });

  return { accessToken, refreshToken: nuevoRefresh };
}

export async function logout(refreshToken: string | undefined) {
  if (!refreshToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashearToken(refreshToken) },
    data: { revocado: true },
  });
}
