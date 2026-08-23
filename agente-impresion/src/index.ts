// Agente de impresión — puente entre el backend (Railway, sin ruta a la LAN
// del local) y las comanderas físicas. Corre en una PC del local, se conecta
// HACIA AFUERA por Socket.io (no hace falta abrir ningún puerto en el
// router), recibe el buffer ESC/POS ya armado y lo manda por TCP crudo a la
// impresora — el mismo paso que hacía el backend directo antes de estar en
// la nube (ver ../src/modules/comanderas/comanderas.service.ts).
//
// Ver README.md para cómo instalarlo y dejarlo corriendo.
import 'dotenv/config';
import net from 'node:net';
import { io } from 'socket.io-client';

const BACKEND_URL = process.env.BACKEND_URL;
const AGENTE_TOKEN = process.env.AGENTE_TOKEN;

if (!BACKEND_URL || !AGENTE_TOKEN) {
  console.error('Faltan BACKEND_URL y/o AGENTE_TOKEN — completá el archivo .env (ver .env.example).');
  process.exit(1);
}

const TIMEOUT_IMPRESION_MS = 4000;

interface PedidoImpresion {
  ip: string;
  puerto: number;
  datos: string; // buffer ESC/POS en base64
}

interface AckImpresion {
  ok: boolean;
  error?: string;
}

function ahora(): string {
  return new Date().toLocaleTimeString('es-AR');
}

// Versión mínima, sin dependencias, de enviarBufferATcp() — el mismo camino
// que usaba el backend directo. Se duplica a propósito en vez de importarla
// del backend: este proceso no debe arrastrar Prisma ni el resto de sus
// dependencias, corre en una PC cualquiera del local.
function enviarBufferATcp(ip: string, puerto: number, datos: Buffer, timeoutMs = TIMEOUT_IMPRESION_MS): Promise<void> {
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
      socket.end(datos, () => terminar());
    });
  });
}

const socket = io(BACKEND_URL, {
  auth: { tipoAgente: 'impresion', token: AGENTE_TOKEN },
  reconnection: true,
});

socket.on('connect', () => {
  console.log(`[${ahora()}] Conectado al backend (${BACKEND_URL}).`);
});

socket.on('disconnect', (motivo) => {
  console.log(`[${ahora()}] Desconectado (${motivo}). Reintentando…`);
});

socket.on('connect_error', (error) => {
  console.error(`[${ahora()}] No se pudo conectar: ${error.message}`);
});

socket.on('comandera:imprimir', async (pedido: PedidoImpresion, ack: (respuesta: AckImpresion) => void) => {
  try {
    const datos = Buffer.from(pedido.datos, 'base64');
    await enviarBufferATcp(pedido.ip, pedido.puerto, datos);
    console.log(`[${ahora()}] Impreso en ${pedido.ip}:${pedido.puerto}.`);
    ack({ ok: true });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'Error de impresión';
    console.error(`[${ahora()}] Falló ${pedido.ip}:${pedido.puerto} — ${mensaje}`);
    ack({ ok: false, error: mensaje });
  }
});

console.log(`[${ahora()}] Agente de impresión arrancando, conectando a ${BACKEND_URL}…`);
