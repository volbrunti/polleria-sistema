import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import * as authApi from '../api/auth';
import { ApiError, refrescarToken, setAccessToken, setOnAuthFailure } from '../api/client';
import type { Usuario } from '../api/types';
import { decodificarAccessToken } from '../lib/jwt';

interface AuthContextValor {
  usuario: Usuario | null;
  accessToken: string | null;
  cargando: boolean;
  ingresar: (username: string, password: string) => Promise<void>;
  salir: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValor | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const limpiarSesion = useCallback(() => {
    setAccessToken(null);
    setToken(null);
    setUsuario(null);
  }, []);

  useEffect(() => {
    setOnAuthFailure(limpiarSesion);
  }, [limpiarSesion]);

  // Al montar: intenta recuperar sesión con el refresh token (cookie httpOnly),
  // sin pedir usuario/contraseña de nuevo.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const nuevoToken = await refrescarToken();
      if (cancelado) return;
      if (nuevoToken) {
        setAccessToken(nuevoToken);
        setToken(nuevoToken);
        // No hay endpoint "whoami": tras un refresh de página se reconstruye
        // el usuario leyendo el payload del propio JWT (nombre de pila no
        // disponible ahí, se usa el username como fallback de display).
        const payload = decodificarAccessToken(nuevoToken);
        if (payload) {
          setUsuario({
            id: Number(payload.sub),
            username: payload.username,
            rol: payload.rol,
            nombre: payload.username,
            sucursalId: payload.sucursalId,
          });
        }
      }
      setCargando(false);
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ingresar = useCallback(async (username: string, password: string) => {
    const resultado = await authApi.login(username, password);
    setAccessToken(resultado.accessToken);
    setToken(resultado.accessToken);
    setUsuario(resultado.usuario);
  }, []);

  const salir = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    } finally {
      limpiarSesion();
    }
  }, [limpiarSesion]);

  return (
    <AuthContext.Provider value={{ usuario, accessToken: token, cargando, ingresar, salir }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
