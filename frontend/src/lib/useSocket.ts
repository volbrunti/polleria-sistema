import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../auth/AuthContext';

// Socket.io solo se conecta para ADMINISTRADOR (control ciego: los demás
// roles jamás reciben eventos de alerta, ni por WebSocket).
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
