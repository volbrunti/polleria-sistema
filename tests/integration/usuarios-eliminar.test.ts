import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validarDbDeTest, limpiarDb, sembrarFixtures, getApp, getPrisma, auth, type Fixtures } from './helpers';

// Eliminación de usuarios (agregado 2026-07-13, pedido del cliente para
// limpiar cuentas de prueba): DELETE real SOLO si el usuario nunca registró
// actividad — un usuario que operó es la "firma digital" de sus registros
// (CLAUDE.md §2) y solo puede desactivarse.

let app: FastifyInstance;
let f: Fixtures;

beforeAll(async () => {
  validarDbDeTest();
  await limpiarDb();
  f = await sembrarFixtures();
  app = await getApp();
});

afterAll(async () => {
  await app.close();
});

async function crearUsuarioDePrueba(username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/usuarios',
    headers: auth(f.usuarios.admin.token),
    payload: { nombre: username, username, password: 'clave123', rol: 'CAJERO', sucursalId: f.sucursales.local1 },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as number;
}

describe('DELETE /usuarios/:id', () => {
  it('elimina un usuario sin actividad y lo registra en auditoría', async () => {
    const id = await crearUsuarioDePrueba('fantasma');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/usuarios/${id}`,
      headers: auth(f.usuarios.admin.token),
    });
    expect(res.statusCode).toBe(200);

    const prisma = await getPrisma();
    expect(await prisma.usuario.findUnique({ where: { id } })).toBeNull();
    const registro = await prisma.registroAuditoria.findFirst({
      where: { accion: 'ELIMINAR_USUARIO', entidad: 'Usuario', entidadId: id },
    });
    expect(registro).not.toBeNull();
    expect(registro!.usuarioId).toBe(f.usuarios.admin.id);
  });

  it('rechaza eliminar un usuario CON actividad (409) — hay que desactivarlo', async () => {
    // Se le da actividad al cajero creándole un registro de auditoría propio:
    // el caso mínimo de "firma digital" que bloquea la eliminación.
    const prisma = await getPrisma();
    await prisma.registroAuditoria.create({
      data: {
        accion: 'ACCION_DE_PRUEBA',
        entidad: 'Prueba',
        entidadId: 1,
        usuarioId: f.usuarios.cajero.id,
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/usuarios/${f.usuarios.cajero.id}`,
      headers: auth(f.usuarios.admin.token),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().codigo).toBe('USUARIO_CON_HISTORIAL');

    // sigue existiendo y puede desactivarse por el camino normal
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/usuarios/${f.usuarios.cajero.id}`,
      headers: auth(f.usuarios.admin.token),
      payload: { activo: false },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().activo).toBe(false);
  });

  it('el admin no puede eliminarse a sí mismo', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/usuarios/${f.usuarios.admin.id}`,
      headers: auth(f.usuarios.admin.token),
    });
    expect(res.statusCode).toBe(400);
  });

  it('RBAC: SOCIO no puede eliminar usuarios', async () => {
    const id = await crearUsuarioDePrueba('fantasma2');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/usuarios/${id}`,
      headers: auth(f.usuarios.socio.token),
    });
    expect(res.statusCode).toBe(403);
  });

  it('404 si el usuario no existe', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/usuarios/999999',
      headers: auth(f.usuarios.admin.token),
    });
    expect(res.statusCode).toBe(404);
  });
});
