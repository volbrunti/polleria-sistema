import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../auth/AuthContext';

// Socket.io de ALERTAS: solo ADMINISTRADOR (control ciego: los demás roles
// jamás reciben eventos de alerta financiera).
export function useAlertasSocket(onAlertaNueva: (alerta: unknown) => void) {
  const { usuario, accessToken } = useAuth();

  useEffect(() => {
    if (usuario?.rol !== 'ADMINISTRADOR' || !accessToken) return;

    const baseUrl = import.meta.env.VITE_API_URL || undefined;
    const socket = io(baseUrl, { auth: { token: accessToken }, transports: ['websocket', 'polling'] });
    socket.on('alerta:nueva', onAlertaNueva);

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.rol, accessToken]);
}

// Socket.io del POS (CAJERO/ENCARGADO): el backend suma al socket a la sala
// de SU sucursal (releída de DB en server.ts) y solo le llegan eventos
// operativos NO ciegos: turno:desbloqueado (para salir del bloqueo al
// instante, sin esperar el polling) y alerta:stock_minimo (pop-up §6.6).
// Best-effort: si el socket falla, el polling de CajaTab sigue de respaldo.
export function usePosSocket(handlers: {
  onTurnoDesbloqueado?: (payload: unknown) => void;
  onStockMinimo?: (payload: unknown) => void;
}) {
  const { usuario, accessToken } = useAuth();
  const esOperativo = usuario?.rol === 'CAJERO' || usuario?.rol === 'ENCARGADO';

  useEffect(() => {
    if (!esOperativo || !accessToken) return;

    const baseUrl = import.meta.env.VITE_API_URL || undefined;
    const socket = io(baseUrl, { auth: { token: accessToken }, transports: ['websocket', 'polling'] });
    if (handlers.onTurnoDesbloqueado) socket.on('turno:desbloqueado', handlers.onTurnoDesbloqueado);
    if (handlers.onStockMinimo) socket.on('alerta:stock_minimo', handlers.onStockMinimo);

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esOperativo, accessToken]);
}
