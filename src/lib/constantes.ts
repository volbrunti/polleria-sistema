// Nombres de productos con rol especial en el circuito del pollo (Módulo 2,
// CLAUDE-MODULO-2.md §4.10). Son productos del seed — si el cliente los
// renombra desde el catálogo, actualizar acá.
export const NOMBRE_POLLO_ENTERO = 'Pollo a la leña (entero)';
export const NOMBRE_POLLO_MEDIO = 'Pollo a la leña (medio)';
// Bucket de stock intermedio fresco → marcado (en la parrilla) → vendido
export const NOMBRE_POLLO_MARCADO = 'Pollo a la leña (entero) — MARCADO';

// Timer de "pedido no retirado" (CLAUDE-MODULO-2.md §9 y Fase 9): minutos
// desde que un pedido entra en LISTO_NO_RETIRADO hasta que se avisa al admin
// por WebSocket. Default sugerido en la spec — PENDIENTE confirmar con Pablo,
// no hardcodear en producción sin su respuesta.
export const MINUTOS_PEDIDO_NO_RETIRADO_ALERTA = 30;
// Cada cuánto corre el job que revisa pedidos vencidos. No necesita ser fino:
// el aviso llega con hasta este margen de atraso sobre el umbral de arriba.
export const INTERVALO_CHEQUEO_NO_RETIRADO_MS = 2 * 60 * 1000;
