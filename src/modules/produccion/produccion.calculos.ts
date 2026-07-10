import { Prisma } from '@prisma/client';

// Lógica PURA de cálculo de rendimiento y desvío (Flujo 2, pasos 5 y 7).
// Separada del servicio para test unitario sin DB.
//
// CONTROL CIEGO: estos resultados se persisten en el lote pero JAMÁS se
// serializan para el rol PRODUCCION (ver produccion.serializers.ts).

const CIEN = new Prisma.Decimal(100);

// Unidades esperadas = (insumo principal usado / cantidad por unidad producida) * (1 - desperdicio esperado %)
export function calcularUnidadesEsperadas(params: {
  cantidadInsumoPrincipal: Prisma.Decimal;
  cantidadPorUnidadProducida: Prisma.Decimal;
  desperdicioEsperadoPct: Prisma.Decimal;
}): Prisma.Decimal {
  const brutas = params.cantidadInsumoPrincipal.div(params.cantidadPorUnidadProducida);
  const factorAprovechamiento = CIEN.minus(params.desperdicioEsperadoPct).div(CIEN);
  return brutas.mul(factorAprovechamiento).toDecimalPlaces(3);
}

// Desvío % = ((real - esperado) / esperado) * 100. Negativo = faltaron unidades.
export function calcularDesvioPct(
  unidadesReales: Prisma.Decimal,
  unidadesEsperadas: Prisma.Decimal,
): Prisma.Decimal {
  if (unidadesEsperadas.isZero()) return new Prisma.Decimal(0);
  return unidadesReales.minus(unidadesEsperadas).div(unidadesEsperadas).mul(CIEN).toDecimalPlaces(2);
}

// Alerta si |desvío| supera el umbral configurado en la ficha técnica
export function superaUmbral(desvioPct: Prisma.Decimal, umbralPct: Prisma.Decimal): boolean {
  return desvioPct.abs().greaterThan(umbralPct);
}
