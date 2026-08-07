// Espejo de src/modules/pedidos/pedidos.calculos.ts (backend) para mostrar
// totales en vivo en el POS. La AUTORIDAD es siempre el backend al confirmar:
// si esta cuenta divergiera, manda el montoTotal congelado del pedido.

export interface TierPrecio {
  cantidad: number;
  monto: number;
}

// Tier exacto si existe; si no, descomposición greedy de mayor a menor
// (13 empanadas = tier de 12 + tier de 1). Devuelve null si la cantidad no
// puede armarse con los tiers cargados.
export function calcularPrecioTotal(cantidad: number, tabla: TierPrecio[]): number | null {
  if (tabla.length === 0) return null;
  const porCantidad = new Map(tabla.map((t) => [t.cantidad, t.monto]));

  const exacto = porCantidad.get(cantidad);
  if (exacto !== undefined) return exacto;

  const cantidades = [...porCantidad.keys()].sort((a, b) => b - a);
  let restante = cantidad;
  let total = 0;
  for (const c of cantidades) {
    while (restante >= c) {
      total += porCantidad.get(c)!;
      restante -= c;
    }
  }
  return restante > 0 ? null : total;
}
