import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validarDbDeTest, limpiarDb, sembrarFixtures, getApp, getPrisma, auth, type Fixtures } from './helpers';

// Módulo 2 — Turnos y arqueo doble ciego (CLAUDE-MODULO-2.md §5).
// El archivo corre en orden: el estado de la caja se encadena entre tests
// (el cierre de un turno es la referencia ciega de la apertura del siguiente).

let app: FastifyInstance;
let f: Fixtures;

// Se buscan como CLAVES del JSON (con comillas) para no confundirlas con
// palabras del mensaje genérico ("Hay una diferencia en el conteo…").
const CAMPOS_CIEGOS = ['"valorEsperado"', '"diferencia"', '"resultado"', 'FALTANTE', 'SOBRANTE'];

function sinCamposCiegos(json: string) {
  return CAMPOS_CIEGOS.every((campo) => !json.includes(campo));
}

beforeAll(async () => {
  validarDbDeTest();
  await limpiarDb();
  f = await sembrarFixtures();
  app = await getApp();
});

afterAll(async () => {
  await app.close();
});

describe('Apertura de turno — arqueo doble ciego', () => {
  it('primer turno de la sucursal: conteos en 0 coinciden (esperado 0) → ABIERTO', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/turnos/abrir',
      headers: auth(f.usuarios.cajero.token),
      payload: { conteoEfectivo: 0, conteoPollosMarcados: 0 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.bloqueado).toBe(false);
    expect(body.turno.estado).toBe('ABIERTO');
    // CONTROL CIEGO: el JSON crudo para el cajero no trae esperado/diferencia/resultado
    expect(sinCamposCiegos(res.body)).toBe(true);
  });

  it('no se puede abrir un segundo turno con uno activo en la sucursal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/turnos/abrir',
      headers: auth(f.usuarios.encargado.token),
      payload: { conteoEfectivo: 0, conteoPollosMarcados: 0 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().codigo).toBe('TURNO_YA_ACTIVO');
  });

  it('GET /turnos/activo para el cajero tampoco filtra campos ciegos', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/turnos/activo',
      headers: auth(f.usuarios.cajero.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().turno.estado).toBe('ABIERTO');
    expect(sinCamposCiegos(res.body)).toBe(true);
  });

  it('cierre declarando más efectivo del esperado: cierra igual + alerta DISCREPANCIA_CAJA solo al admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/turnos/cerrar',
      headers: auth(f.usuarios.cajero.token),
      // esperado: 0 (sin ventas todavía) — el cajero declara 500 (sobrante)
      payload: { conteoEfectivo: 500, conteoPollosMarcados: 2 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.turno.estado).toBe('CERRADO');
    expect(body.ventasPorUnidad).toEqual([]);
    expect(body.pollosMarcadosContados).toBe(2);
    // El cajero no ve NADA financiero del cruce
    expect(sinCamposCiegos(res.body)).toBe(true);

    const prisma = await getPrisma();
    const alerta = await prisma.alerta.findFirst({ where: { tipo: 'DISCREPANCIA_CAJA' } });
    expect(alerta).not.toBeNull();
  });

  it('la reapertura usa como referencia ciega lo CONTADO en el cierre anterior', async () => {
    // El cierre declaró 500 / 2 → abrir contando exactamente eso coincide
    const res = await app.inject({
      method: 'POST',
      url: '/api/turnos/abrir',
      headers: auth(f.usuarios.cajero.token),
      payload: { conteoEfectivo: 500, conteoPollosMarcados: 2 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().bloqueado).toBe(false);
    expect(res.json().turno.estado).toBe('ABIERTO');

    // cerrar de nuevo con los mismos números para dejar la caja consistente
    const cierre = await app.inject({
      method: 'POST',
      url: '/api/turnos/cerrar',
      headers: auth(f.usuarios.cajero.token),
      payload: { conteoEfectivo: 500, conteoPollosMarcados: 2 },
    });
    expect(cierre.statusCode).toBe(200);
  });
});

describe('Bloqueo por discrepancia en la apertura', () => {
  let turnoBloqueadoId: number;

  it('conteo distinto al cierre anterior → turno BLOQUEADO con mensaje genérico sin números', async () => {
    // referencia ciega actual: 500 / 2 — el cajero cuenta mal el efectivo
    const res = await app.inject({
      method: 'POST',
      url: '/api/turnos/abrir',
      headers: auth(f.usuarios.cajero.token),
      payload: { conteoEfectivo: 400, conteoPollosMarcados: 2 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.bloqueado).toBe(true);
    expect(body.turno.estado).toBe('BLOQUEADO');
    expect(body.mensaje).toContain('Se notificó al administrador');
    // Ni esperado, ni diferencia, ni de qué lado está el error, ni CUÁL arqueo falló
    expect(sinCamposCiegos(res.body)).toBe(true);
    expect(res.body).not.toContain('500');
    turnoBloqueadoId = body.turno.id;
  });

  it('la alerta BLOQUEO_TURNO al admin sí tiene todos los números y ambos cajeros', async () => {
    const prisma = await getPrisma();
    const alerta = await prisma.alerta.findFirst({
      where: { tipo: 'BLOQUEO_TURNO', origenId: turnoBloqueadoId },
    });
    expect(alerta).not.toBeNull();
    const detalle = alerta!.detalle as {
      usuarioCajeroActualId: number;
      usuarioCajeroAnteriorId: number;
      arqueos: { tipo: string; valorEsperado: string; valorContado: string; resultado: string }[];
    };
    expect(detalle.usuarioCajeroActualId).toBe(f.usuarios.cajero.id);
    expect(detalle.usuarioCajeroAnteriorId).toBe(f.usuarios.cajero.id); // cerró el mismo cajero
    const efectivo = detalle.arqueos.find((a) => a.tipo === 'EFECTIVO')!;
    expect(efectivo.valorEsperado).toBe('500');
    expect(efectivo.valorContado).toBe('400');
    expect(efectivo.resultado).toBe('FALTANTE');
  });

  it('con el turno BLOQUEADO no se puede operar (aparece como activo, no abierto)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/turnos/activo',
      headers: auth(f.usuarios.cajero.token),
    });
    expect(res.json().turno.estado).toBe('BLOQUEADO');
  });

  it('el CAJERO no puede desbloquear (403); el ADMIN sí, y queda auditado', async () => {
    const intento = await app.inject({
      method: 'POST',
      url: `/api/turnos/${turnoBloqueadoId}/desbloquear`,
      headers: auth(f.usuarios.cajero.token),
    });
    expect(intento.statusCode).toBe(403);

    const res = await app.inject({
      method: 'POST',
      url: `/api/turnos/${turnoBloqueadoId}/desbloquear`,
      headers: auth(f.usuarios.admin.token),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().estado).toBe('ABIERTO');

    const prisma = await getPrisma();
    const bloqueo = await prisma.bloqueoDeTurno.findUnique({ where: { turnoId: turnoBloqueadoId } });
    expect(bloqueo!.estado).toBe('DESBLOQUEADO');
    expect(bloqueo!.tipoDesbloqueo).toBe('REMOTO');
    expect(bloqueo!.usuarioAutorizanteId).toBe(f.usuarios.admin.id);
    const registro = await prisma.registroAuditoria.findFirst({
      where: { accion: 'DESBLOQUEO_TURNO_REMOTO', entidadId: turnoBloqueadoId },
    });
    expect(registro).not.toBeNull();
  });

  it('cerrar el turno desbloqueado (consistente con lo que declaró: 400/2)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/turnos/cerrar',
      headers: auth(f.usuarios.cajero.token),
      // la apertura contó 400/2 y no hubo movimientos → esperado 400/2
      payload: { conteoEfectivo: 400, conteoPollosMarcados: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().turno.estado).toBe('CERRADO');
  });
});

describe('Clave de emergencia', () => {
  let turnoBloqueadoId: number;
  let codigo: string;

  it('apertura con discrepancia en POLLOS también bloquea', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/turnos/abrir',
      headers: auth(f.usuarios.cajero.token),
      // referencia: 400/2 — efectivo bien, pollos mal
      payload: { conteoEfectivo: 400, conteoPollosMarcados: 1 },
    });
    expect(res.json().bloqueado).toBe(true);
    turnoBloqueadoId = res.json().turno.id;
  });

  it('el CAJERO no puede generar claves (403); el ADMIN sí y ve el código una sola vez', async () => {
    const intento = await app.inject({
      method: 'POST',
      url: '/api/claves-emergencia',
      headers: auth(f.usuarios.cajero.token),
      payload: { turnoId: turnoBloqueadoId },
    });
    expect(intento.statusCode).toBe(403);

    const res = await app.inject({
      method: 'POST',
      url: '/api/claves-emergencia',
      headers: auth(f.usuarios.admin.token),
      payload: { turnoId: turnoBloqueadoId },
    });
    expect(res.statusCode).toBe(201);
    codigo = res.json().codigo;
    expect(codigo).toMatch(/^[A-Z2-9]{8}$/);
  });

  it('generar una clave nueva invalida la anterior', async () => {
    const nueva = await app.inject({
      method: 'POST',
      url: '/api/claves-emergencia',
      headers: auth(f.usuarios.admin.token),
      payload: { turnoId: turnoBloqueadoId },
    });
    const codigoNuevo = nueva.json().codigo as string;

    // la primera ya no sirve
    const conVieja = await app.inject({
      method: 'POST',
      url: '/api/claves-emergencia/usar',
      headers: auth(f.usuarios.cajero.token),
      payload: { codigo, turnoId: turnoBloqueadoId },
    });
    expect(conVieja.statusCode).toBe(400);
    expect(conVieja.json().codigo).toBe('CLAVE_INVALIDA');

    codigo = codigoNuevo;
  });

  it('el cajero desbloquea con la clave vigente; queda auditado con el admin como autorizante', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/claves-emergencia/usar',
      headers: auth(f.usuarios.cajero.token),
      payload: { codigo, turnoId: turnoBloqueadoId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().turno.estado).toBe('ABIERTO');

    const prisma = await getPrisma();
    const bloqueo = await prisma.bloqueoDeTurno.findUnique({ where: { turnoId: turnoBloqueadoId } });
    expect(bloqueo!.tipoDesbloqueo).toBe('CLAVE_EMERGENCIA');
    expect(bloqueo!.usuarioAutorizanteId).toBe(f.usuarios.admin.id);
    const registro = await prisma.registroAuditoria.findFirst({
      where: { accion: 'DESBLOQUEO_TURNO_CLAVE', entidadId: turnoBloqueadoId },
    });
    expect(registro).not.toBeNull();
  });

  it('una clave usada no puede reutilizarse; una expirada tampoco', async () => {
    // cerrar y volver a bloquear para tener otro escenario
    await app.inject({
      method: 'POST',
      url: '/api/turnos/cerrar',
      headers: auth(f.usuarios.cajero.token),
      payload: { conteoEfectivo: 400, conteoPollosMarcados: 1 },
    });
    const bloqueada = await app.inject({
      method: 'POST',
      url: '/api/turnos/abrir',
      headers: auth(f.usuarios.cajero.token),
      payload: { conteoEfectivo: 999, conteoPollosMarcados: 1 },
    });
    const nuevoTurnoId = bloqueada.json().turno.id as number;

    // reutilizar la clave ya usada
    const reuso = await app.inject({
      method: 'POST',
      url: '/api/claves-emergencia/usar',
      headers: auth(f.usuarios.cajero.token),
      payload: { codigo, turnoId: nuevoTurnoId },
    });
    expect(reuso.statusCode).toBe(400);

    // clave nueva pero vencida (expiración simulada en DB)
    const generada = await app.inject({
      method: 'POST',
      url: '/api/claves-emergencia',
      headers: auth(f.usuarios.admin.token),
      payload: { turnoId: nuevoTurnoId },
    });
    const prisma = await getPrisma();
    await prisma.claveDeEmergencia.update({
      where: { id: generada.json().id },
      data: { expiraEn: new Date(Date.now() - 1000) },
    });
    const vencida = await app.inject({
      method: 'POST',
      url: '/api/claves-emergencia/usar',
      headers: auth(f.usuarios.cajero.token),
      payload: { codigo: generada.json().codigo, turnoId: nuevoTurnoId },
    });
    expect(vencida.statusCode).toBe(400);
    expect(vencida.json().codigo).toBe('CLAVE_INVALIDA');

    // el admin lo desbloquea remoto para dejar el estado limpio
    await app.inject({
      method: 'POST',
      url: `/api/turnos/${nuevoTurnoId}/desbloquear`,
      headers: auth(f.usuarios.admin.token),
    });
  });
});

describe('RBAC y aislamiento de sucursal', () => {
  it('SOCIO y PRODUCCION no pueden abrir turno (403)', async () => {
    for (const usuario of [f.usuarios.socio, f.usuarios.produccion]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/turnos/abrir',
        headers: auth(usuario.token),
        payload: { conteoEfectivo: 0, conteoPollosMarcados: 0 },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('ADMIN sin indicar sucursal recibe 400 con mensaje claro', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/turnos/abrir',
      headers: auth(f.usuarios.admin.token),
      payload: { conteoEfectivo: 0, conteoPollosMarcados: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().mensaje).toContain('sucursal');
  });

  it('el CAJERO de Local 1 no puede abrir turno en Local 2 (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/turnos/abrir',
      headers: auth(f.usuarios.cajero.token),
      payload: { sucursalId: f.sucursales.local2, conteoEfectivo: 0, conteoPollosMarcados: 0 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().codigo).toBe('SUCURSAL_NO_AUTORIZADA');
  });

  it('no se abre un turno en la sucursal de Producción', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/turnos/abrir',
      headers: auth(f.usuarios.admin.token),
      payload: { sucursalId: f.sucursales.produccion, conteoEfectivo: 0, conteoPollosMarcados: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('el historial y el resumen financiero son solo de admin/socio', async () => {
    const paraCajero = await app.inject({
      method: 'GET',
      url: '/api/turnos',
      headers: auth(f.usuarios.cajero.token),
    });
    expect(paraCajero.statusCode).toBe(403);

    const paraSocio = await app.inject({
      method: 'GET',
      url: '/api/turnos',
      headers: auth(f.usuarios.socio.token),
    });
    expect(paraSocio.statusCode).toBe(200);
    // El socio SÍ ve los campos del arqueo completo (es información financiera suya)
    expect(paraSocio.body).toContain('valorEsperado');
  });
});
