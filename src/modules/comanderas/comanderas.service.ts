import net from 'node:net';
import type { DestinoComandera } from '@prisma/client';
import { prisma, type TxClient } from '../../lib/prisma';
import { registrarAuditoria } from '../../lib/auditoria';
import { Errores } from '../../lib/errores';
import { emitirASucursal } from '../alertas/alertas.service';
import { construirTicket, type ContenidoTicket } from './escpos';

// Cuánto esperamos a que la impresora acepte el trabajo antes de darla por
// caída. Una térmica de red responde en decenas de milisegundos; si a los 4
// segundos no contestó, está apagada, sin papel o con la IP cambiada.
const TIMEOUT_IMPRESION_MS = 4000;

// ── Envío crudo por TCP ──────────────────────────────────────────────
// La impresora escucha en el puerto 9100 (raw / "JetDirect"): se abre el
// socket, se escriben los bytes ESC/POS y se cierra. Sin driver ni spooler.
export function enviarBufferATcp(
  ip: string,
  puerto: number,
  datos: Buffer,
  timeoutMs = TIMEOUT_IMPRESION_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let resuelto = false;

    const terminar = (error?: Error) => {
      if (resuelto) return;
      resuelto = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => terminar(new Error(`Sin respuesta de ${ip}:${puerto} en ${timeoutMs} ms`)));
    socket.once('error', (e) => terminar(e));

    socket.connect(puerto, ip, () => {
      // El end() cierra el lado de escritura; la impresora imprime lo que
      // recibió. No hay ACK a nivel aplicación en ESC/POS crudo: que el
      // socket haya aceptado los bytes es todo lo que podemos verificar.
      socket.end(datos, () => terminar());
    });
  });
}

// ── Registro del ticket (DENTRO de la transacción del pedido) ────────
// Solo escribe en la DB: crea el ticket y una fila de impresión PENDIENTE por
// cada comandera activa de la sucursal. NO toca la red.
//
// Por qué la impresión física no va acá: mantener abierta la transacción del
// pedido mientras se espera a dos impresoras por TCP significaría sostener los
// locks de stock durante segundos, en el momento de más carga del local (pico
// de 78 pedidos en un turno de domingo). Una impresora apagada pasaría de ser
// una molestia a frenar la caja entera — justo lo que CLAUDE.md §11 regla 14
// prohíbe. Así el pedido commitea siempre y la impresión se despacha después.
export async function registrarTicket(tx: TxClient, contenido: ContenidoTicket) {
  const comanderas = await tx.configuracionComandera.findMany({
    where: { sucursalId: contenido.sucursalId, activa: true },
  });

  const ticket = await tx.ticketCocina.create({
    data: {
      pedidoId: contenido.pedidoId,
      tipo: contenido.tipo,
      contenido: contenido as unknown as object,
      impresiones: {
        create: comanderas.map((c) => ({ configuracionComanderaId: c.id, impreso: false })),
      },
    },
  });

  return ticket;
}

// ── Despacho físico (DESPUÉS del commit) ─────────────────────────────
// Recorre las impresiones pendientes del ticket, manda los bytes a cada
// comandera y guarda el resultado de cada una por separado. Nunca lanza: si
// todo falla, el pedido ya está confirmado y lo único que corresponde es
// avisarle al cajero qué comandera no respondió.
export async function despacharImpresiones(ticketId: number): Promise<void> {
  const ticket = await prisma.ticketCocina.findUnique({
    where: { id: ticketId },
    include: { impresiones: { include: { configuracionComandera: true } } },
  });
  if (!ticket) return;

  const contenido = ticket.contenido as unknown as ContenidoTicket;
  const datos = construirTicket(contenido);

  const fallaron: string[] = [];

  // En paralelo: una comandera colgada no debe demorar a la otra.
  await Promise.all(
    ticket.impresiones.map(async (impresion) => {
      const { ip, puerto, destino, nombre } = impresion.configuracionComandera;
      try {
        await enviarBufferATcp(ip, puerto, datos);
        await prisma.impresionComandera.update({
          where: { id: impresion.id },
          data: { impreso: true, errorImpresion: null },
        });
      } catch (error) {
        fallaron.push(destino);
        await prisma.impresionComandera.update({
          where: { id: impresion.id },
          data: {
            impreso: false,
            errorImpresion: error instanceof Error ? error.message : 'Error de impresión',
          },
        });
        // eslint-disable-next-line no-console
        console.error(`[COMANDERA] Falló "${nombre}" (${ip}:${puerto}) — ticket ${ticket.id}:`, error);
      }
    }),
  );

  if (fallaron.length > 0) {
    // El cajero necesita saber CUÁL no imprimió para poder avisar a viva voz;
    // un "error de impresión" genérico lo dejaría sin saber qué compensar.
    emitirASucursal(contenido.sucursalId, 'comandera:fallo', {
      pedidoId: contenido.pedidoId,
      ticketId: ticket.id,
      tipo: contenido.tipo,
      destinos: fallaron,
    });
  }
}

// Dispara el despacho sin que el llamador tenga que esperarlo ni encadenar un
// catch. Se usa desde los handlers de pedido, después de que la transacción
// commiteó: la respuesta HTTP no queda demorada por el hardware.
export function despacharEnSegundoPlano(ticketId: number): void {
  void despacharImpresiones(ticketId).catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`[COMANDERA] Error despachando el ticket ${ticketId}:`, error);
  });
}

// ── CRUD de configuración (solo ADMINISTRADOR) ───────────────────────

export async function listar(filtros: { sucursalId?: number } = {}) {
  return prisma.configuracionComandera.findMany({
    where: { sucursalId: filtros.sucursalId },
    include: { sucursal: { select: { nombre: true } } },
    orderBy: [{ sucursalId: 'asc' }, { destino: 'asc' }],
  });
}

interface DatosComandera {
  sucursalId: number;
  destino: DestinoComandera;
  nombre: string;
  ip: string;
  puerto?: number;
  activa?: boolean;
}

export async function crear(datos: DatosComandera, usuarioId: number) {
  const sucursal = await prisma.sucursal.findUnique({ where: { id: datos.sucursalId } });
  if (!sucursal) throw Errores.noEncontrado('Sucursal');
  // Producción no vende: no tiene por qué imprimir comandas de cocina.
  if (sucursal.tipo !== 'VENTA') {
    throw Errores.validacion('Solo las sucursales de venta pueden tener comanderas');
  }

  const yaExiste = await prisma.configuracionComandera.findUnique({
    where: { sucursalId_destino: { sucursalId: datos.sucursalId, destino: datos.destino } },
  });
  if (yaExiste) {
    throw Errores.validacion(`${sucursal.nombre} ya tiene una comandera de ${datos.destino}`);
  }

  return prisma.$transaction(async (tx) => {
    const creada = await tx.configuracionComandera.create({ data: datos });
    await registrarAuditoria(tx, {
      accion: 'MODIFICAR_CONFIGURACION_COMANDERA',
      entidad: 'ConfiguracionComandera',
      entidadId: creada.id,
      usuarioId,
      datosNuevos: creada,
    });
    return creada;
  });
}

export async function actualizar(
  id: number,
  cambios: Partial<Omit<DatosComandera, 'sucursalId' | 'destino'>>,
  usuarioId: number,
) {
  const actual = await prisma.configuracionComandera.findUnique({ where: { id } });
  if (!actual) throw Errores.noEncontrado('Comandera');

  return prisma.$transaction(async (tx) => {
    const actualizada = await tx.configuracionComandera.update({ where: { id }, data: cambios });
    // Auditoría reforzada: la IP anterior y la nueva quedan registradas. Si un
    // día los tickets empiezan a salir en la impresora equivocada, el historial
    // dice quién cambió qué y cuándo (CLAUDE.md §5 Flujo 7).
    await registrarAuditoria(tx, {
      accion: 'MODIFICAR_CONFIGURACION_COMANDERA',
      entidad: 'ConfiguracionComandera',
      entidadId: id,
      usuarioId,
      datosAnteriores: actual,
      datosNuevos: actualizada,
    });
    return actualizada;
  });
}

export async function eliminar(id: number, usuarioId: number) {
  const actual = await prisma.configuracionComandera.findUnique({ where: { id } });
  if (!actual) throw Errores.noEncontrado('Comandera');

  const impresiones = await prisma.impresionComandera.count({
    where: { configuracionComanderaId: id },
  });
  // Una comandera que ya imprimió es parte del historial de los tickets: se
  // desactiva, no se borra (mismo criterio que los usuarios con actividad).
  if (impresiones > 0) {
    return actualizar(id, { activa: false }, usuarioId);
  }

  return prisma.$transaction(async (tx) => {
    await tx.configuracionComandera.delete({ where: { id } });
    await registrarAuditoria(tx, {
      accion: 'MODIFICAR_CONFIGURACION_COMANDERA',
      entidad: 'ConfiguracionComandera',
      entidadId: id,
      usuarioId,
      datosAnteriores: actual,
      datosNuevos: null,
    });
    return actual;
  });
}

// Reintento manual desde el POS (auditoría 2026-08-07, E-5).
//
// Antes, cuando una comandera fallaba el cajero veía el aviso de cuál no
// imprimió y no tenía ninguna otra cosa que hacer más que cantar la comanda a
// viva voz: el despacho no reintenta solo y no había endpoint para volver a
// mandarlo. Si la impresora se destrabó dos minutos después, seguía sin salir.
//
// Se valida que el ticket sea de la sucursal del usuario: reimprimir es una
// acción operativa del local, no de infraestructura, así que la habilita el
// CAJERO/ENCARGADO — pero solo sobre lo suyo.
export async function reimprimir(ticketId: number, usuarioId: number) {
  const ticket = await prisma.ticketCocina.findUnique({
    where: { id: ticketId },
    include: { pedido: { select: { sucursalId: true } } },
  });
  if (!ticket) throw Errores.noEncontrado('Ticket');

  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario || !usuario.activo) throw Errores.noAutorizado();
  if (usuario.rol !== 'ADMINISTRADOR' && usuario.sucursalId !== ticket.pedido.sucursalId) {
    throw Errores.sucursalNoAutorizada();
  }

  // Se rearman las filas de impresión con las comanderas activas de HOY: si la
  // que falló quedó desactivada, o se agregó otra, el reintento usa la
  // configuración vigente y no la del momento del pedido.
  const comanderas = await prisma.configuracionComandera.findMany({
    where: { sucursalId: ticket.pedido.sucursalId, activa: true },
  });
  if (comanderas.length === 0) {
    throw Errores.validacion('La sucursal no tiene comanderas activas configuradas');
  }

  await prisma.$transaction(async (tx) => {
    await tx.impresionComandera.deleteMany({ where: { ticketCocinaId: ticket.id } });
    await tx.impresionComandera.createMany({
      data: comanderas.map((c) => ({
        ticketCocinaId: ticket.id,
        configuracionComanderaId: c.id,
        impreso: false,
      })),
    });
  });

  await despacharImpresiones(ticket.id);

  const impresiones = await prisma.impresionComandera.findMany({
    where: { ticketCocinaId: ticket.id },
    include: { configuracionComandera: { select: { destino: true, nombre: true } } },
  });
  return {
    ticketId: ticket.id,
    resultados: impresiones.map((i) => ({
      destino: i.configuracionComandera.destino,
      nombre: i.configuracionComandera.nombre,
      impreso: i.impreso,
      error: i.errorImpresion,
    })),
  };
}

// Soporte: qué se mandó a imprimir para un pedido y cómo le fue a cada
// comandera. Sirve para responder "el ticket no salió" sin adivinar.
export async function ticketsDePedido(pedidoId: number) {
  return prisma.ticketCocina.findMany({
    where: { pedidoId },
    include: {
      impresiones: {
        include: { configuracionComandera: { select: { nombre: true, destino: true, ip: true } } },
      },
    },
    orderBy: { fechaHora: 'asc' },
  });
}

// Impresión de prueba desde el panel: la única forma de saber si la IP quedó
// bien cargada sin tener que simular un pedido real.
export async function probar(id: number): Promise<{ ok: boolean; error?: string }> {
  const comandera = await prisma.configuracionComandera.findUnique({
    where: { id },
    include: { sucursal: { select: { nombre: true } } },
  });
  if (!comandera) throw Errores.noEncontrado('Comandera');

  const prueba = construirTicket({
    pedidoId: 0,
    tipo: 'NUEVO',
    sucursalId: comandera.sucursalId,
    sucursal: comandera.sucursal.nombre,
    tipoPedido: 'PRESENCIAL',
    fechaHora: new Date().toISOString(),
    items: [{ producto: `PRUEBA — ${comandera.nombre} (${comandera.destino})`, cantidad: '1' }],
  });

  try {
    await enviarBufferATcp(comandera.ip, comandera.puerto, prueba);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Error de impresión' };
  }
}
