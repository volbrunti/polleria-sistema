import { randomBytes } from 'node:crypto';
import { Prisma, type ResultadoArqueo } from '@prisma/client';

// Lógica PURA del arqueo ciego y las claves de emergencia (Flujo 5).
// Separada del servicio para test unitario sin DB.
//
// CONTROL CIEGO: la diferencia y el resultado se persisten en el Arqueo pero
// JAMÁS se serializan para CAJERO/ENCARGADO (ver turnos.serializers.ts).

// Diferencia = contado - esperado. Negativa = faltante.
export function calcularArqueo(
  valorContado: Prisma.Decimal,
  valorEsperado: Prisma.Decimal,
): { diferencia: Prisma.Decimal; resultado: ResultadoArqueo } {
  const diferencia = valorContado.minus(valorEsperado);
  if (diferencia.isZero()) return { diferencia, resultado: 'COINCIDE' };
  return { diferencia, resultado: diferencia.isNegative() ? 'FALTANTE' : 'SOBRANTE' };
}

// Saldo final esperado de efectivo al cierre (CLAUDE-MODULO-2.md §5.3):
//   apertura contada + ventas cobradas en EFECTIVO − gastos en EFECTIVO − retiros en EFECTIVO
// (las atenciones son costo cero: no mueven caja, no entran acá)
export function calcularEfectivoEsperadoCierre(params: {
  aperturaContada: Prisma.Decimal;
  ventasEfectivo: Prisma.Decimal;
  gastosEfectivo: Prisma.Decimal;
  retirosEfectivo: Prisma.Decimal;
}): Prisma.Decimal {
  return params.aperturaContada
    .plus(params.ventasEfectivo)
    .minus(params.gastosEfectivo)
    .minus(params.retirosEfectivo);
}

// Pollos marcados esperados al cierre: apertura contada + el neto de TODOS los
// movimientos de stock del producto "Pollo … MARCADO" durante el turno
// (marcados +, vendidos −, retornados −, quemados −). El stock es la única
// fuente de verdad — no se recuentan eventos por separado.
export function calcularPollosEsperadosCierre(params: {
  aperturaContada: Prisma.Decimal;
  netoMovimientosMarcado: Prisma.Decimal;
}): Prisma.Decimal {
  return params.aperturaContada.plus(params.netoMovimientosMarcado);
}

// ── Claves de emergencia ──

export const MINUTOS_EXPIRACION_CLAVE = 10;

// Sin 0/O ni 1/I/L: la clave se dicta por teléfono (CLAUDE-MODULO-2.md §5.1)
const ALFABETO_CLAVE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LARGO_CLAVE = 8;

export function generarCodigoClave(): string {
  const bytes = randomBytes(LARGO_CLAVE);
  let codigo = '';
  for (let i = 0; i < LARGO_CLAVE; i++) {
    codigo += ALFABETO_CLAVE[bytes[i]! % ALFABETO_CLAVE.length];
  }
  return codigo;
}

export function calcularExpiracionClave(desde: Date = new Date()): Date {
  return new Date(desde.getTime() + MINUTOS_EXPIRACION_CLAVE * 60 * 1000);
}

export function claveExpirada(expiraEn: Date, ahora: Date = new Date()): boolean {
  return ahora.getTime() >= expiraEn.getTime();
}

// ¿La clave puede usarse? Un solo uso, no expirada, y si fue generada para un
// turno puntual, solo sirve para ese turno.
export function claveUsable(
  clave: { usada: boolean; expiraEn: Date; turnoId: number | null },
  turnoId: number,
  ahora: Date = new Date(),
): boolean {
  if (clave.usada) return false;
  if (claveExpirada(clave.expiraEn, ahora)) return false;
  if (clave.turnoId !== null && clave.turnoId !== turnoId) return false;
  return true;
}
