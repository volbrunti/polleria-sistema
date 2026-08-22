import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { booleanoQuery, booleanoQueryOpcional } from '../../src/lib/zod-query';

// Regresión: los query params llegan como string y `z.coerce.boolean()` hace
// `Boolean(valor)`, con lo cual `Boolean("false") === true`. El síntoma visible
// era el badge de alertas del sidebar: `GET /api/alertas?vista=false` traía las
// alertas YA vistas, así que el contador mostraba el número equivocado.

describe('booleanoQuery', () => {
  it('interpreta "false" como false (el bug de z.coerce.boolean)', () => {
    expect(booleanoQuery.parse('false')).toBe(false);
    expect(booleanoQuery.parse('0')).toBe(false);
  });

  it('interpreta "true" como true', () => {
    expect(booleanoQuery.parse('true')).toBe(true);
    expect(booleanoQuery.parse('1')).toBe(true);
  });

  it('rechaza valores que no son booleanos, en vez de asumir true', () => {
    for (const basura of ['basura', '', 'TRUE', 'sí', '2']) {
      expect(booleanoQuery.safeParse(basura).success).toBe(false);
    }
  });

  it('NO se comporta como z.coerce.boolean() ante "false"', () => {
    // Deja constancia del bug original: si alguien vuelve a poner
    // z.coerce.boolean(), este test lo delata.
    expect(z.coerce.boolean().parse('false')).toBe(true);
    expect(booleanoQuery.parse('false')).toBe(false);
  });
});

describe('booleanoQueryOpcional', () => {
  it('deja pasar el param ausente como undefined', () => {
    const schema = z.object({ vista: booleanoQueryOpcional });
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ vista: 'false' })).toEqual({ vista: false });
    expect(schema.parse({ vista: 'true' })).toEqual({ vista: true });
  });

  it('sirve para el filtro real de alertas del sidebar', () => {
    // Lo que manda el front: qs.set('vista', String(false)) -> "false"
    const listarQuery = z.object({ vista: booleanoQueryOpcional });
    expect(listarQuery.parse({ vista: String(false) }).vista).toBe(false);
    expect(listarQuery.parse({ vista: String(true) }).vista).toBe(true);
  });
});
