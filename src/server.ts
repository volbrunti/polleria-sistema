import 'dotenv/config';
import { Server as SocketServer } from 'socket.io';
import { buildApp } from './app';
import { config } from './config';
import { verificarAccessToken } from './plugins/auth';
import { prisma } from './lib/prisma';
import * as alertasService from './modules/alertas/alertas.service';
import { pedidosNoRetiradosParaAvisar } from './modules/pedidos/pedidos.service';
import { MINUTOS_PEDIDO_NO_RETIRADO_ALERTA, INTERVALO_CHEQUEO_NO_RETIRADO_MS } from './lib/constantes';

async function main() {
  const app = await buildApp();

  await app.ready();

  // Socket.io sobre el mismo server HTTP. Solo ADMINISTRADOR entra a la sala
  // de alertas (control ciego: los operarios no reciben eventos de alerta).
  const io = new SocketServer(app.server, {
    cors: { origin: true, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('NO_AUTORIZADO'));
      socket.data.usuario = verificarAccessToken(token);
      next();
    } catch {
      next(new Error('NO_AUTORIZADO'));
    }
  });

  io.on('connection', (socket) => {
    const usuario = socket.data.usuario;
    if (usuario?.rol === 'ADMINISTRADOR') {
      socket.join(alertasService.SALA_ADMIN);
      return;
    }
    // CAJERO/ENCARGADO entran a la sala de SU sucursal (para
    // turno:desbloqueado y alerta:stock_minimo). La sucursal se relee de la
    // DB — nunca se confía en el JWT (misma política que los endpoints).
    if (usuario && (usuario.rol === 'CAJERO' || usuario.rol === 'ENCARGADO')) {
      void prisma.usuario
        .findUnique({ where: { id: usuario.id } })
        .then((u) => {
          if (u?.activo && u.sucursalId != null) {
            void socket.join(alertasService.salaSucursal(u.sucursalId));
          }
        })
        .catch(() => {
          /* best-effort: sin sala, el POS sigue con polling */
        });
    }
  });

  alertasService.configurarSocket(io);

  // Timer de "pedido no retirado" (CLAUDE-MODULO-2.md §9, Fase 9): avisa a
  // los admins por WebSocket cuando un A_RETIRAR lleva más de N minutos en
  // LISTO_NO_RETIRADO. No bloquea nada — es un aviso, igual que el resto de
  // las alertas del sistema.
  const timerNoRetirado = setInterval(() => {
    void pedidosNoRetiradosParaAvisar(MINUTOS_PEDIDO_NO_RETIRADO_ALERTA)
      .then((vencidos) => {
        for (const pedido of vencidos) {
          alertasService.emitirAAdmins('pedido:listo_no_retirado', {
            pedidoId: pedido.id,
            sucursalId: pedido.sucursalId,
            minutosUmbral: MINUTOS_PEDIDO_NO_RETIRADO_ALERTA,
          });
        }
      })
      .catch((err) => app.log.error(err, 'Error chequeando pedidos no retirados'));
  }, INTERVALO_CHEQUEO_NO_RETIRADO_MS);
  timerNoRetirado.unref();

  await app.listen({ port: config.puerto, host: '0.0.0.0' });
  app.log.info(`Backend pollería escuchando en puerto ${config.puerto}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
