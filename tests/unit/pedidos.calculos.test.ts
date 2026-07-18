import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  calcularPrecioTotal,
  precioUnitarioReferencia,
  calcularCobro,
  transicionValida,
  esModificable,
  type TierPrecio,
} from '../../src/modules/pedidos/pedidos.calculos';

const d = (n: number | string) => new Prisma.Decimal(n);

// Tabla real de empanadas de la planilla del cliente (recortada)
const TABLA_EMPANADAS: TierPrecio[] = [
  { cantidad: 1, monto: d(1600) },
  { cantidad: 6, monto: d(8500) },
  { cantidad: 12, monto: d(16000) },
];

describe('calcularPrecioTotal — tabla por volumen', () => {
  it('tier exacto: 6 empanadas usan el precio de la media docena, no 6 × unidad', () => {
    expect(calcularPrecioTotal(6, TABLA_EMPANADAS).toString()).toBe('8500'); // no 9600
  });

  it('sin tier exacto: descompone greedy (13 = 12 + 1)', () => {
    expect(calcularPrecioTotal(13, TABLA_EMPANADAS).toString()).toBe('17600');
  });

  it('descomposición múltiple (26 = 12 + 12 + 1 + 1)', () => {
    expect(calcularPrecioTotal(26, TABLA_EMPANADAS).toString()).toBe('35200');
  });

  it('producto con precio único: N × unitario', () => {
    const tabla: TierPrecio[] = [{ cantidad: 1, monto: d(21000) }];
    expect(calcularPrecioTotal(3, tabla).toString()).toBe('63000');
  });

  it('sin tabla → SIN_PRECIO', () => {
    expect(() => calcularPrecioTotal(1, [])).toThrow('SIN_PRECIO');
  });

  it('cantidad que ningún tier cubre → CANTIDAD_SIN_PRECIO', () => {
    const soloDocena: TierPrecio[] = [{ cantidad: 12, monto: d(16000) }];
    expect(() => calcularPrecioTotal(5, soloDocena)).toThrow('CANTIDAD_SIN_PRECIO');
  });

  it('precio unitario de referencia redondea a 2 decimales', () => {
    expect(precioUnitarioReferencia(d(8500), 6).toString()).toBe('1416.67');
  });
});

describe('calcularCobro — pagos combinados y vuelto', () => {
  it('pago exacto sin efectivo: vuelto 0', () => {
    const r = calcularCobro({
      totalPedido: d(29000),
      pagos: [{ medio: 'MERCADO_PAGO', monto: d(29000) }],
    });
    expect(r.vuelto.toString()).toBe('0');
  });

  it('efectivo de más: vuelto automático y efectivo neto en caja', () => {
    const r = calcularCobro({
      totalPedido: d(17000),
      pagos: [{ medio: 'EFECTIVO', monto: d(20000) }],
    });
    expect(r.vuelto.toString()).toBe('3000');
    expect(r.efectivoNeto.toString()).toBe('17000');
  });

  it('pago mixto: parte MP + parte efectivo con vuelto', () => {
    const r = calcularCobro({
      totalPedido: d(29000),
      pagos: [
        { medio: 'MERCADO_PAGO', monto: d(20000) },
        { medio: 'EFECTIVO', monto: d(10000) },
      ],
    });
    expect(r.vuelto.toString()).toBe('1000');
    expect(r.efectivoNeto.toString()).toBe('9000');
  });

  it('pago insuficiente → error', () => {
    expect(() =>
      calcularCobro({ totalPedido: d(29000), pagos: [{ medio: 'EFECTIVO', monto: d(20000) }] }),
    ).toThrow('PAGO_INSUFICIENTE');
  });

  it('el vuelto no puede salir de un medio electrónico', () => {
    expect(() =>
      calcularCobro({
        totalPedido: d(10000),
        pagos: [{ medio: 'MERCADO_PAGO', monto: d(12000) }],
      }),
    ).toThrow('VUELTO_SIN_EFECTIVO');
  });
});

describe('ciclo de vida del pedido', () => {
  it.each([
    ['EN_PREPARACION', 'LISTO', true],
    ['EN_PREPARACION', 'ENTREGADO', true], // presencial cobra al momento
    ['EN_PREPARACION', 'ANULADO', true],
    ['LISTO', 'ENTREGADO', true],
    ['LISTO', 'LISTO_NO_RETIRADO', true],
    ['LISTO_NO_RETIRADO', 'REASIGNADO', true],
    ['LISTO_NO_RETIRADO', 'PERDIDO', true],
    ['LISTO_NO_RETIRADO', 'ANULADO', true],
    ['ENTREGADO', 'ANULADO', false], // un pedido entregado NO se anula
    ['ANULADO', 'LISTO', false],
    ['PERDIDO', 'ENTREGADO', false],
    ['REASIGNADO', 'ENTREGADO', false],
    ['EN_PREPARACION', 'LISTO_NO_RETIRADO', false],
    ['LISTO', 'REASIGNADO', false], // reasignar requiere pasar por no-retirado
  ] as const)('%s → %s: %s', (desde, hacia, esperado) => {
    expect(transicionValida(desde, hacia)).toBe(esperado);
  });

  it('modificable solo en preparación o listo', () => {
    expect(esModificable('EN_PREPARACION')).toBe(true);
    expect(esModificable('LISTO')).toBe(true);
    expect(esModificable('ENTREGADO')).toBe(false);
    expect(esModificable('ANULADO')).toBe(false);
  });
});
