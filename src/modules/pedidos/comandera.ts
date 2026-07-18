import type { TipoTicket } from '@prisma/client';
import type { TxClient } from '../../lib/prisma';

// Comandera (CLAUDE-MODULO-2.md §4.11). El cliente aún no compró las
// impresoras: la interfaz queda definida y hoy imprime a consola. Cuando
// llegue el hardware (Epson TM-T20, ESC/POS por red), se agrega una
// implementación real y se cambia UNA línea (la instancia exportada).
//
// Regla crítica: el fallo de impresión JAMÁS bloquea la operación — el
// pedido se confirma igual y el error queda en TicketCocina.errorImpresion.

export interface ContenidoTicket {
  pedidoId: number;
  tipo: TipoTicket;
  sucursalId: number;
  items: { producto: string; cantidad: string; aclaraciones?: string | null }[];
}

export interface Comandera {
  imprimir(contenido: ContenidoTicket): Promise<void>;
}

class ComanderaConsola implements Comandera {
  async imprimir(contenido: ContenidoTicket): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(
      `[COMANDERA mock] Ticket ${contenido.tipo} — pedido ${contenido.pedidoId} (sucursal ${contenido.sucursalId}):`,
      contenido.items.map((i) => `${i.cantidad}× ${i.producto}${i.aclaraciones ? ` (${i.aclaraciones})` : ''}`).join(' | '),
    );
  }
}

export const comandera: Comandera = new ComanderaConsola();

// Registra el ticket (snapshot para historial/reimpresión) e intenta imprimir.
// Se llama DENTRO de la transacción del pedido; la impresión en sí es
// best-effort y su error no aborta nada.
export async function emitirTicket(tx: TxClient, contenido: ContenidoTicket) {
  const ticket = await tx.ticketCocina.create({
    data: {
      pedidoId: contenido.pedidoId,
      tipo: contenido.tipo,
      contenido: { sucursalId: contenido.sucursalId, items: contenido.items },
    },
  });
  try {
    await comandera.imprimir(contenido);
    await tx.ticketCocina.update({ where: { id: ticket.id }, data: { impreso: true } });
  } catch (error) {
    await tx.ticketCocina.update({
      where: { id: ticket.id },
      data: { impreso: false, errorImpresion: error instanceof Error ? error.message : 'Error de impresión' },
    });
  }
  return ticket;
}
