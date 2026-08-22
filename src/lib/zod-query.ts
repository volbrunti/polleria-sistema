import { z } from 'zod';

// Los query params siempre llegan como string. `z.coerce.boolean()` hace
// `Boolean(valor)`, y en JS **`Boolean("false") === true`**: cualquier string
// no vacío da `true`, así que el schema devolvía justo lo contrario de lo
// pedido. El caso visible: `GET /api/alertas?vista=false` — la consulta que
// alimenta el badge de alertas pendientes del sidebar — traía las alertas YA
// vistas, con lo cual el contador mostraba el número equivocado.
//
// Este schema interpreta el string como lo espera quien arma la URL, y rechaza
// (400) cualquier otro valor en vez de asumir `true` en silencio.
export const booleanoQuery = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/** Igual que `booleanoQuery`, pero opcional (param ausente → `undefined`). */
export const booleanoQueryOpcional = booleanoQuery.optional();
