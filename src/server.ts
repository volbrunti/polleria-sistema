import 'dotenv/config';
import { Server as SocketServer } from 'socket.io';
import { buildApp } from './app';
import { config } from './config';
import { verificarAccessToken } from './plugins/auth';
import * as alertasService from './modules/alertas/alertas.service';

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
    if (socket.data.usuario?.rol === 'ADMINISTRADOR') {
      socket.join(alertasService.SALA_ADMIN);
    }
  });

  alertasService.configurarSocket(io);

  await app.listen({ port: config.puerto, host: '0.0.0.0' });
  app.log.info(`Backend pollería escuchando en puerto ${config.puerto}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
