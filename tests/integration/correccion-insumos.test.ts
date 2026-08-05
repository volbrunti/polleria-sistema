import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  validarDbDeTest,
  limpiarDb,
  sembrarFixtures,
  getApp,
  getPrisma,
  auth,
  stockDe,
  type Fixtures,
} from './helpers';

// Corrección de insumos al cerrar el lote (reunión 4/8). El caso que lo motivó
// lo contó Ariel: estimó 10 kg de pan rallado al abrir, pero al terminar
// zarandeó, tiró la parte húmeda y devolvió el resto a la bolsa — en realidad
// usó 6,450. "Pongo lo que usé realmente, no lo que se estimaba."
//
// Archivo aparte porque estos lotes mueven el stock compartido y correrlos
// dentro de flujo-completo desajustaba las cuentas de los tests siguientes.

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

describe('Cerrar lote corrigiendo lo realmente usado', () => {
  let lineaNalgaId: number;
  let lineaPanId: number;

  beforeAll(async () => {
    const ingreso = await app.inject({
      method: 'POST',
      url: '/api/ingresos',
      headers: auth(f.usuarios.produccion.token),
      payload: {
        proveedorId: f.proveedores.normal,
        lineas: [
          { productoId: f.productos.nalga, cantidadSegunRemito: 10, cantidadRealPesada: 10 },
          { productoId: f.productos.panRallado, cantidadSegunRemito: 5, cantidadRealPesada: 5 },
        ],
      },
    });
    expect(ingreso.statusCode).toBe(201);
    const prisma = await getPrisma();
    lineaNalgaId = (
      await prisma.lineaIngreso.findFirstOrThrow({ where: { productoId: f.productos.nalga } })
    ).id;
    lineaPanId = (
      await prisma.lineaIngreso.findFirstOrThrow({ where: { productoId: f.productos.panRallado } })
    ).id;
  });

  it('descuenta lo real, devuelve el resto a la partida y recalcula el esperado', async () => {
    const prisma = await getPrisma();

    // Estima 2 kg de pan; después va a resultar que usó 0,8
    const abierto = await app.inject({
      method: 'POST',
      url: '/api/produccion/lotes',
      headers: auth(f.usuarios.produccion.token),
      payload: {
        productoElaboradoId: f.productos.milanesa,
        insumos: [
          { productoInsumoId: f.productos.nalga, lineaIngresoOrigenId: lineaNalgaId, cantidadUsada: 1.8 },
          { productoInsumoId: f.productos.panRallado, lineaIngresoOrigenId: lineaPanId, cantidadUsada: 2 },
        ],
      },
    });
    expect(abierto.statusCode).toBe(201);
    const loteId = abierto.json().id as number;

    // Abrir NO descuenta stock: los movimientos ocurren recién al cerrar
    expect(await stockDe(f.productos.panRallado, f.sucursales.produccion)).toBe(5);

    const insumoPan = await prisma.insumoUsado.findFirstOrThrow({
      where: { loteDeProduccionId: loteId, productoInsumoId: f.productos.panRallado },
    });

    const cerrado = await app.inject({
      method: 'POST',
      url: `/api/produccion/lotes/${loteId}/cerrar`,
      headers: auth(f.usuarios.produccion.token),
      payload: {
        unidadesProducidasReales: 9,
        desperdicioRealKg: 0,
        insumosReales: [{ insumoUsadoId: insumoPan.id, cantidadUsada: 0.8 }],
      },
    });
    expect(cerrado.statusCode).toBe(200);

    // Se descontó lo REAL (0,8), no lo estimado (2)
    expect(await stockDe(f.productos.panRallado, f.sucursales.produccion)).toBeCloseTo(4.2, 3);
    const panDespues = await prisma.lineaIngreso.findUniqueOrThrow({ where: { id: lineaPanId } });
    expect(panDespues.cantidadRestanteDisponible.toNumber()).toBeCloseTo(4.2, 3);

    // La corrección queda persistida en el propio InsumoUsado
    const insumoPanDespues = await prisma.insumoUsado.findUniqueOrThrow({ where: { id: insumoPan.id } });
    expect(insumoPanDespues.cantidadUsada.toNumber()).toBeCloseTo(0.8, 3);

    // El principal no se corrigió: 1.8 / 0.18 = 10 brutas × 0.95 = 9.5 esperadas
    const loteDb = await prisma.loteDeProduccion.findUniqueOrThrow({ where: { id: loteId } });
    expect(loteDb.unidadesEsperadas?.toNumber()).toBeCloseTo(9.5, 2);
    // Y el lote queda como partida del producto terminado, lista para enviar
    expect(loteDb.cantidadRestanteDisponible?.toNumber()).toBe(9);
  });

  it('corregir el insumo principal recalcula el esperado y evita un desvío falso', async () => {
    const prisma = await getPrisma();

    // Estima 3,6 kg de nalga (→ 19 esperadas) pero en realidad usa 1,8 (→ 9,5)
    const abierto = await app.inject({
      method: 'POST',
      url: '/api/produccion/lotes',
      headers: auth(f.usuarios.produccion.token),
      payload: {
        productoElaboradoId: f.productos.milanesa,
        insumos: [
          { productoInsumoId: f.productos.nalga, lineaIngresoOrigenId: lineaNalgaId, cantidadUsada: 3.6 },
        ],
      },
    });
    const loteId = abierto.json().id as number;
    const loteAlAbrir = await prisma.loteDeProduccion.findUniqueOrThrow({ where: { id: loteId } });
    expect(loteAlAbrir.unidadesEsperadas?.toNumber()).toBeCloseTo(19, 2);

    const insumoNalga = await prisma.insumoUsado.findFirstOrThrow({
      where: { loteDeProduccionId: loteId, productoInsumoId: f.productos.nalga },
    });

    const cerrado = await app.inject({
      method: 'POST',
      url: `/api/produccion/lotes/${loteId}/cerrar`,
      headers: auth(f.usuarios.produccion.token),
      payload: {
        unidadesProducidasReales: 9,
        desperdicioRealKg: 0,
        insumosReales: [{ insumoUsadoId: insumoNalga.id, cantidadUsada: 1.8 }],
      },
    });
    expect(cerrado.statusCode).toBe(200);

    const loteDb = await prisma.loteDeProduccion.findUniqueOrThrow({ where: { id: loteId } });
    // El esperado se recalcula con lo real: 9,5 y no 19
    expect(loteDb.unidadesEsperadas?.toNumber()).toBeCloseTo(9.5, 2);
    // Contra 19 el desvío habría sido -52% y habría disparado una alerta falsa
    expect(loteDb.desvioPct?.toNumber()).toBeCloseTo(-5.26, 1);
    expect(loteDb.alertaDisparada).toBe(false);
  });

  it('rechaza corregir un insumo que no pertenece al lote', async () => {
    const prisma = await getPrisma();
    const insumoAjeno = await prisma.insumoUsado.findFirstOrThrow({ orderBy: { id: 'asc' } });

    const abierto = await app.inject({
      method: 'POST',
      url: '/api/produccion/lotes',
      headers: auth(f.usuarios.produccion.token),
      payload: {
        productoElaboradoId: f.productos.milanesa,
        insumos: [
          { productoInsumoId: f.productos.nalga, lineaIngresoOrigenId: lineaNalgaId, cantidadUsada: 0.36 },
        ],
      },
    });
    const loteId = abierto.json().id as number;

    const res = await app.inject({
      method: 'POST',
      url: `/api/produccion/lotes/${loteId}/cerrar`,
      headers: auth(f.usuarios.produccion.token),
      payload: {
        unidadesProducidasReales: 1,
        desperdicioRealKg: 0,
        insumosReales: [{ insumoUsadoId: insumoAjeno.id, cantidadUsada: 5 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rechaza corregir por encima de lo que queda en la partida', async () => {
    const prisma = await getPrisma();

    const abierto = await app.inject({
      method: 'POST',
      url: '/api/produccion/lotes',
      headers: auth(f.usuarios.produccion.token),
      payload: {
        productoElaboradoId: f.productos.milanesa,
        insumos: [
          { productoInsumoId: f.productos.nalga, lineaIngresoOrigenId: lineaNalgaId, cantidadUsada: 0.36 },
        ],
      },
    });
    const loteId = abierto.json().id as number;
    const insumo = await prisma.insumoUsado.findFirstOrThrow({
      where: { loteDeProduccionId: loteId },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/produccion/lotes/${loteId}/cerrar`,
      headers: auth(f.usuarios.produccion.token),
      payload: {
        unidadesProducidasReales: 1,
        desperdicioRealKg: 0,
        insumosReales: [{ insumoUsadoId: insumo.id, cantidadUsada: 9999 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(['STOCK_INSUFICIENTE', 'LINEA_INGRESO_INSUFICIENTE']).toContain(res.json().codigo);
  });
});
