import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  validarDbDeTest,
  limpiarDb,
  sembrarFixtures,
  getApp,
  getPrisma,
  auth,
  type Fixtures,
} from './helpers';

// Tests de SEGURIDAD (CLAUDE.md §10 — no opcionales):
// 1) RBAC: 403 para roles indebidos en cada endpoint sensible.
// 2) No-filtración de campos ciegos en respuestas reales de la API.
// 3) Inmutabilidad de auditoría (sin rutas de modificación).

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
  const prisma = await getPrisma();
  await prisma.$disconnect();
});

describe('RBAC — 403 para roles indebidos', () => {
  const casos: { desc: string; metodo: 'GET' | 'POST'; url: string; rol: keyof Fixtures['usuarios']; payload?: object }[] = [
    { desc: 'CAJERO no crea ingresos', metodo: 'POST', url: '/api/ingresos', rol: 'cajero', payload: {} },
    { desc: 'SOCIO no crea ingresos (solo lectura)', metodo: 'POST', url: '/api/ingresos', rol: 'socio', payload: {} },
    { desc: 'PRODUCCION no lee fichas técnicas (contienen rendimiento esperado)', metodo: 'GET', url: '/api/fichas-tecnicas', rol: 'produccion' },
    { desc: 'CAJERO no lee fichas técnicas', metodo: 'GET', url: '/api/fichas-tecnicas', rol: 'cajero' },
    { desc: 'SOCIO no crea fichas (solo lectura)', metodo: 'POST', url: '/api/fichas-tecnicas', rol: 'socio', payload: {} },
    { desc: 'CAJERO no abre lotes de producción', metodo: 'POST', url: '/api/produccion/lotes', rol: 'cajero', payload: {} },
    { desc: 'CAJERO no genera transferencias', metodo: 'POST', url: '/api/transferencias', rol: 'cajero', payload: {} },
    { desc: 'PRODUCCION no recepciona transferencias', metodo: 'POST', url: '/api/transferencias/1/recepcion', rol: 'produccion', payload: {} },
    { desc: 'PRODUCCION no ve alertas', metodo: 'GET', url: '/api/alertas', rol: 'produccion' },
    { desc: 'SOCIO no ve alertas (son del admin)', metodo: 'GET', url: '/api/alertas', rol: 'socio' },
    { desc: 'CAJERO no consulta auditoría', metodo: 'GET', url: '/api/auditoria', rol: 'cajero' },
    { desc: 'PRODUCCION no consulta auditoría', metodo: 'GET', url: '/api/auditoria', rol: 'produccion' },
    { desc: 'CAJERO no lista usuarios', metodo: 'GET', url: '/api/usuarios', rol: 'cajero' },
    { desc: 'SOCIO no crea usuarios (solo lectura)', metodo: 'POST', url: '/api/usuarios', rol: 'socio', payload: {} },
    { desc: 'PRODUCCION no crea productos', metodo: 'POST', url: '/api/productos', rol: 'produccion', payload: {} },
    { desc: 'CAJERO no cambia precios', metodo: 'POST', url: '/api/productos/1/precios', rol: 'cajero', payload: {} },
    { desc: 'PRODUCCION no ve historial de precios (dato financiero)', metodo: 'GET', url: '/api/productos/1/precios', rol: 'produccion' },
    { desc: 'CAJERO no ve movimientos de stock', metodo: 'GET', url: '/api/stock/movimientos', rol: 'cajero' },
  ];

  for (const caso of casos) {
    it(caso.desc, async () => {
      const res = await app.inject({
        method: caso.metodo,
        url: caso.url,
        headers: auth(f.usuarios[caso.rol].token),
        ...(caso.payload ? { payload: caso.payload } : {}),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().codigo).toBe('PROHIBIDO');
    });
  }

  it('sin token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/productos' });
    expect(res.statusCode).toBe(401);
  });

  it('token inválido → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/productos',
      headers: { authorization: 'Bearer basura' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('No-filtración de campos ciegos (API real, end to end)', () => {
  let loteId: number;
  let transferenciaId: number;

  beforeAll(async () => {
    // preparar: ingreso + lote cerrado + transferencia pendiente
    await app.inject({
      method: 'POST',
      url: '/api/ingresos',
      headers: auth(f.usuarios.produccion.token),
      payload: {
        proveedorId: f.proveedores.normal,
        lineas: [
          { productoId: f.productos.nalga, cantidadSegunRemito: 20, cantidadRealPesada: 20 },
          { productoId: f.productos.panRallado, cantidadSegunRemito: 5, cantidadRealPesada: 5 },
          { productoId: f.productos.huevo, cantidadSegunRemito: 60, cantidadRealPesada: 60 },
        ],
      },
    });
    const lineas = async (productoId: number) =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/ingresos/lineas-disponibles?productoId=${productoId}`,
          headers: auth(f.usuarios.produccion.token),
        })
      ).json()[0].id;

    const abrir = await app.inject({
      method: 'POST',
      url: '/api/produccion/lotes',
      headers: auth(f.usuarios.produccion.token),
      payload: {
        productoElaboradoId: f.productos.milanesa,
        insumos: [
          { productoInsumoId: f.productos.nalga, lineaIngresoOrigenId: await lineas(f.productos.nalga), cantidadUsada: 10 },
          { productoInsumoId: f.productos.panRallado, lineaIngresoOrigenId: await lineas(f.productos.panRallado), cantidadUsada: 3 },
          { productoInsumoId: f.productos.huevo, lineaIngresoOrigenId: await lineas(f.productos.huevo), cantidadUsada: 30 },
        ],
      },
    });
    loteId = abrir.json().id;
    // cierre con desvío fuerte → dispara alerta interna
    await app.inject({
      method: 'POST',
      url: `/api/produccion/lotes/${loteId}/cerrar`,
      headers: auth(f.usuarios.produccion.token),
      payload: { unidadesProducidasReales: 30, desperdicioRealKg: 1 },
    });

    const gen = await app.inject({
      method: 'POST',
      url: '/api/transferencias',
      headers: auth(f.usuarios.produccion.token),
      payload: {
        sucursalDestinoId: f.sucursales.local1,
        lineas: [{ productoId: f.productos.milanesa, cantidadEnviada: 15 }],
      },
    });
    transferenciaId = gen.json().id;
  });

  it('GET lote (PRODUCCION): sin unidadesEsperadas/desvioPct/alertaDisparada en el JSON crudo', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/produccion/lotes/${loteId}`,
      headers: auth(f.usuarios.produccion.token),
    });
    const crudo = res.body;
    expect(crudo).not.toContain('unidadesEsperadas');
    expect(crudo).not.toContain('desvioPct');
    expect(crudo).not.toContain('alertaDisparada');
  });

  it('GET listado de lotes (PRODUCCION): tampoco filtra', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/produccion/lotes',
      headers: auth(f.usuarios.produccion.token),
    });
    expect(res.body).not.toContain('unidadesEsperadas');
    expect(res.body).not.toContain('desvioPct');
  });

  it('GET transferencia (CAJERO receptor): sin cantidadEnviada en el JSON crudo', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/transferencias/${transferenciaId}`,
      headers: auth(f.usuarios.cajero.token),
    });
    expect(res.body).not.toContain('cantidadEnviada');
    expect(res.body).not.toContain('diferencia');
  });

  it('listado de transferencias (CAJERO): sin cantidadEnviada', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/transferencias',
      headers: auth(f.usuarios.cajero.token),
    });
    expect(res.body).not.toContain('cantidadEnviada');
  });

  it('respuesta de recepción no coincidente: no revela nada', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/transferencias/${transferenciaId}/recepcion`,
      headers: auth(f.usuarios.cajero.token),
      payload: { lineas: [{ productoId: f.productos.milanesa, cantidadRecibida: 14 }] },
    });
    const cuerpo = res.json();
    expect(cuerpo.coincide).toBe(false);
    expect(res.body).not.toContain('cantidadEnviada');
    expect(res.body).not.toContain('15'); // la cantidad real enviada
  });
});

describe('Inmutabilidad de auditoría', () => {
  it('no existen rutas para modificar ni borrar auditoría', async () => {
    for (const metodo of ['PUT', 'PATCH', 'DELETE'] as const) {
      const res = await app.inject({
        method: metodo,
        url: '/api/auditoria/1',
        headers: auth(f.usuarios.admin.token),
      });
      expect(res.statusCode).toBe(404); // ruta inexistente
    }
  });

  it('ADMIN y SOCIO consultan auditoría con filtros', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auditoria?accion=ABRIR_LOTE_PRODUCCION',
      headers: auth(f.usuarios.socio.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThanOrEqual(1);
  });
});

describe('Versionado de fichas técnicas', () => {
  it('crear versión nueva desactiva la anterior; lote viejo apunta a versión congelada', async () => {
    const prisma = await getPrisma();

    const res = await app.inject({
      method: 'POST',
      url: `/api/fichas-tecnicas/${f.fichaMilanesa.fichaId}/versiones`,
      headers: auth(f.usuarios.admin.token),
      payload: {
        rendimientoEsperado: 6,
        desperdicioEsperadoPct: 4,
        umbralDesvioAlertaPct: 8,
        ingredientes: [
          { productoInsumoId: f.productos.nalga, cantidadPorUnidadProducida: 0.16, esPrincipal: true },
          { productoInsumoId: f.productos.panRallado, cantidadPorUnidadProducida: 0.05, esPrincipal: false },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().numeroVersion).toBe(2);
    expect(res.json().activa).toBe(true);

    // única activa por ficha
    const activas = await prisma.fichaTecnicaVersion.findMany({
      where: { fichaTecnicaId: f.fichaMilanesa.fichaId, activa: true },
    });
    expect(activas).toHaveLength(1);
    expect(activas[0]!.numeroVersion).toBe(2);

    // el lote producido antes sigue apuntando a la v1 (congelada)
    const lote = await prisma.loteDeProduccion.findFirst({
      where: { fichaTecnicaVersionId: f.fichaMilanesa.versionId },
    });
    expect(lote).not.toBeNull();
  });

  it('receta sin insumo principal → rechazada', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/fichas-tecnicas/${f.fichaMilanesa.fichaId}/versiones`,
      headers: auth(f.usuarios.admin.token),
      payload: {
        rendimientoEsperado: 6,
        desperdicioEsperadoPct: 4,
        umbralDesvioAlertaPct: 8,
        ingredientes: [
          { productoInsumoId: f.productos.nalga, cantidadPorUnidadProducida: 0.16, esPrincipal: false },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Auth', () => {
  it('login correcto devuelve access token y cookie de refresh', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'clave123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toBeDefined();
    expect(res.json().usuario.rol).toBe('ADMINISTRADOR');
    const cookie = res.cookies.find((c) => c.name === 'refresh_token');
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
  });

  it('password incorrecta → 401 sin distinguir causa', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'incorrecta' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().codigo).toBe('CREDENCIALES_INVALIDAS');
  });
});
