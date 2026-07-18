import { Prisma, type EstadoPedido } from '@prisma/client';

// Lógica PURA del POS (Flujo 4). Separada del servicio para test unitario sin DB.

const CERO = new Prisma.Decimal(0);

// ── Precio con tabla por volumen (Precio.cantidad, módulo 1) ──
//
// La tabla del cliente es no lineal (6 empanadas ≠ 6 × precio de 1) y los
// tiers grandes siempre salen más baratos por unidad. Para una cantidad sin
// tier exacto se descompone greedy de mayor a menor (12+1 para 13), que con
// esa estructura de precios es también la combinación más barata.
export interface TierPrecio {
  cantidad: number;
  monto: Prisma.Decimal;
}

export function calcularPrecioTotal(cantidad: number, tabla: TierPrecio[]): Prisma.Decimal {
  if (tabla.length === 0) throw new Error('SIN_PRECIO');
  const porCantidad = new Map(tabla.map((t) => [t.cantidad, t.monto]));

  const exacto = porCantidad.get(cantidad);
  if (exacto) return exacto;

  const cantidades = [...porCantidad.keys()].sort((a, b) => b - a); // desc
  let restante = cantidad;
  let total = CERO;
  for (const c of cantidades) {
    while (restante >= c) {
      total = total.plus(porCantidad.get(c)!);
      restante -= c;
    }
  }
  if (restante > 0) {
    // no hay tier chico que cubra el resto (ej: solo existe tier de 6 y piden 4)
    const unitario = porCantidad.get(Math.min(...porCantidad.keys()));
    throw new Error(unitario ? 'CANTIDAD_SIN_PRECIO' : 'SIN_PRECIO');
  }
  return total;
}

// Referencia informativa por unidad (el total congelado es la fuente de verdad)
export function precioUnitarioReferencia(montoTotal: Prisma.Decimal, cantidad: number): Prisma.Decimal {
  return montoTotal.div(cantidad).toDecimalPlaces(2);
}

// ── Cobro ──

// El vuelto sale SOLO del efectivo: los medios electrónicos se cobran exactos.
export function calcularCobro(params: {
  totalPedido: Prisma.Decimal;
  pagos: { medio: string; monto: Prisma.Decimal }[];
}): { vuelto: Prisma.Decimal; efectivoNeto: Prisma.Decimal } {
  const totalPagado = params.pagos.reduce((acc, p) => acc.plus(p.monto), CERO);
  if (totalPagado.lessThan(params.totalPedido)) throw new Error('PAGO_INSUFICIENTE');

  const vuelto = totalPagado.minus(params.totalPedido);
  const efectivoRecibido = params.pagos
    .filter((p) => p.medio === 'EFECTIVO')
    .reduce((acc, p) => acc.plus(p.monto), CERO);

  if (vuelto.greaterThan(efectivoRecibido)) throw new Error('VUELTO_SIN_EFECTIVO');
  return { vuelto, efectivoNeto: efectivoRecibido.minus(vuelto) };
}

// ── Ciclo de vida del pedido (CLAUDE-MODULO-2.md §4.4) ──

const TRANSICIONES: Record<EstadoPedido, EstadoPedido[]> = {
  // PRESENCIAL puede cobrarse en el momento (→ ENTREGADO sin pasar por LISTO)
  EN_PREPARACION: ['LISTO', 'ENTREGADO', 'ANULADO'],
  LISTO: ['ENTREGADO', 'LISTO_NO_RETIRADO', 'ANULADO'],
  LISTO_NO_RETIRADO: ['REASIGNADO', 'PERDIDO', 'ANULADO'],
  ENTREGADO: [],
  REASIGNADO: [],
  PERDIDO: [],
  ANULADO: [],
};

export function transicionValida(desde: EstadoPedido, hacia: EstadoPedido): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

// Modificable mientras la cocina todavía puede reaccionar (§4.6)
export function esModificable(estado: EstadoPedido): boolean {
  return estado === 'EN_PREPARACION' || estado === 'LISTO';
}
