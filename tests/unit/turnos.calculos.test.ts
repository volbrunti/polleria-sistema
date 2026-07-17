import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  calcularArqueo,
  calcularEfectivoEsperadoCierre,
  calcularPollosEsperadosCierre,
  generarCodigoClave,
  calcularExpiracionClave,
  claveExpirada,
  claveUsable,
  MINUTOS_EXPIRACION_CLAVE,
} from '../../src/modules/turnos/turnos.calculos';

const d = (n: number | string) => new Prisma.Decimal(n);

describe('calcularArqueo', () => {
  it('COINCIDE cuando contado = esperado', () => {
    const r = calcularArqueo(d(150000), d(150000));
    expect(r.resultado).toBe('COINCIDE');
    expect(r.diferencia.isZero()).toBe(true);
  });

  it('FALTANTE cuando contado < esperado (diferencia negativa)', () => {
    const r = calcularArqueo(d(140000), d(150000));
    expect(r.resultado).toBe('FALTANTE');
    expect(r.diferencia.toString()).toBe('-10000');
  });

  it('SOBRANTE cuando contado > esperado', () => {
    const r = calcularArqueo(d(150500), d(150000));
    expect(r.resultado).toBe('SOBRANTE');
    expect(r.diferencia.toString()).toBe('500');
  });

  it('funciona con fracciones (pollos: medio vendido deja .5)', () => {
    const r = calcularArqueo(d('7.5'), d('8'));
    expect(r.resultado).toBe('FALTANTE');
    expect(r.diferencia.toString()).toBe('-0.5');
  });
});

describe('calcularEfectivoEsperadoCierre', () => {
  it('apertura + ventas efectivo − gastos − retiros', () => {
    const esperado = calcularEfectivoEsperadoCierre({
      aperturaContada: d(50000),
      ventasEfectivo: d(300000),
      gastosEfectivo: d(20000),
      retirosEfectivo: d(100000),
    });
    expect(esperado.toString()).toBe('230000');
  });

  it('sin movimientos, el esperado es la apertura', () => {
    const esperado = calcularEfectivoEsperadoCierre({
      aperturaContada: d(75000),
      ventasEfectivo: d(0),
      gastosEfectivo: d(0),
      retirosEfectivo: d(0),
    });
    expect(esperado.toString()).toBe('75000');
  });
});

describe('calcularPollosEsperadosCierre', () => {
  it('apertura + neto de movimientos del producto marcado', () => {
    // abrió con 3, marcó 10, vendió 6.5 (6 enteros + 1 medio) → neto +3.5
    const esperado = calcularPollosEsperadosCierre({
      aperturaContada: d(3),
      netoMovimientosMarcado: d('3.5'),
    });
    expect(esperado.toString()).toBe('6.5');
  });
});

describe('claves de emergencia', () => {
  it('el código tiene 8 caracteres sin ambiguos (sin 0/O/1/I/L)', () => {
    for (let i = 0; i < 50; i++) {
      const codigo = generarCodigoClave();
      expect(codigo).toHaveLength(8);
      expect(codigo).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
    }
  });

  it('dos códigos consecutivos no se repiten', () => {
    expect(generarCodigoClave()).not.toBe(generarCodigoClave());
  });

  it(`expira a los ${MINUTOS_EXPIRACION_CLAVE} minutos`, () => {
    const desde = new Date('2026-07-17T12:00:00Z');
    const expira = calcularExpiracionClave(desde);
    expect(expira.toISOString()).toBe('2026-07-17T12:10:00.000Z');
  });

  it('usable antes de expirar, inusable después', () => {
    const clave = { usada: false, expiraEn: new Date('2026-07-17T12:10:00Z'), turnoId: 5 };
    expect(claveUsable(clave, 5, new Date('2026-07-17T12:09:59Z'))).toBe(true);
    expect(claveUsable(clave, 5, new Date('2026-07-17T12:10:00Z'))).toBe(false);
    expect(claveExpirada(clave.expiraEn, new Date('2026-07-17T12:15:00Z'))).toBe(true);
  });

  it('una clave usada no puede reutilizarse', () => {
    const clave = { usada: true, expiraEn: new Date('2099-01-01'), turnoId: 5 };
    expect(claveUsable(clave, 5)).toBe(false);
  });

  it('una clave generada para un turno no sirve para otro', () => {
    const clave = { usada: false, expiraEn: new Date('2099-01-01'), turnoId: 5 };
    expect(claveUsable(clave, 6)).toBe(false);
    expect(claveUsable(clave, 5)).toBe(true);
  });

  it('una clave sin turno asignado sirve para cualquier turno', () => {
    const clave = { usada: false, expiraEn: new Date('2099-01-01'), turnoId: null };
    expect(claveUsable(clave, 123)).toBe(true);
  });
});
