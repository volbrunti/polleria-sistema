import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  calcularUnidadesEsperadas,
  calcularDesvioPct,
  superaUmbral,
} from '../../src/modules/produccion/produccion.calculos';

const D = (n: number | string) => new Prisma.Decimal(n);

describe('calcularUnidadesEsperadas', () => {
  it('calcula unidades esperadas descontando el desperdicio esperado', () => {
    // 10 kg nalga, 0.18 kg/unidad, 5% desperdicio → (10/0.18)*0.95 = 52.777 → 52.778
    const r = calcularUnidadesEsperadas({
      cantidadInsumoPrincipal: D(10),
      cantidadPorUnidadProducida: D(0.18),
      desperdicioEsperadoPct: D(5),
    });
    expect(r.toNumber()).toBeCloseTo(52.778, 2);
  });

  it('sin desperdicio esperado devuelve el rendimiento bruto', () => {
    const r = calcularUnidadesEsperadas({
      cantidadInsumoPrincipal: D(9),
      cantidadPorUnidadProducida: D(0.18),
      desperdicioEsperadoPct: D(0),
    });
    expect(r.toNumber()).toBe(50);
  });
});

describe('calcularDesvioPct', () => {
  it('desvío positivo cuando se produce de más', () => {
    expect(calcularDesvioPct(D(55), D(50)).toNumber()).toBe(10);
  });
  it('desvío negativo cuando faltan unidades', () => {
    expect(calcularDesvioPct(D(45), D(50)).toNumber()).toBe(-10);
  });
  it('esperado cero no divide por cero', () => {
    expect(calcularDesvioPct(D(10), D(0)).toNumber()).toBe(0);
  });
});

describe('superaUmbral', () => {
  it('dispara alerta si el desvío absoluto supera el umbral', () => {
    expect(superaUmbral(D(-12), D(10))).toBe(true);
    expect(superaUmbral(D(12), D(10))).toBe(true);
  });
  it('no dispara si está dentro del umbral', () => {
    expect(superaUmbral(D(-8), D(10))).toBe(false);
    expect(superaUmbral(D(10), D(10))).toBe(false); // igual al umbral NO dispara
  });
});
