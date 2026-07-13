import type { ErrorApi } from './types';

// Base absoluta solo en producción (VITE_API_URL). En dev, Vite proxea
// /api al backend local (ver vite.config.ts) y esto queda vacío.
const BASE_URL = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  codigo: string;
  statusCode: number;
  detalles?: ErrorApi['detalles'];

  constructor(codigo: string, message: string, statusCode: number, detalles?: ErrorApi['detalles']) {
    super(message);
    this.name = 'ApiError';
    this.codigo = codigo;
    this.statusCode = statusCode;
    this.detalles = detalles;
  }
}

// El accessToken vive en memoria (nunca en localStorage). AuthContext es la
// fuente de verdad reactiva; este módulo solo espeja el valor para que el
// wrapper de fetch pueda leerlo sin depender de React.
let accessToken: string | null = null;
let refrescando: Promise<string | null> | null = null;
let alFallarAuth: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function setOnAuthFailure(cb: () => void) {
  alFallarAuth = cb;
}

async function refrescarToken(): Promise<string | null> {
  if (!refrescando) {
    refrescando = fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = (await res.json()) as { accessToken: string };
        accessToken = data.accessToken;
        return accessToken;
      })
      .catch(() => null)
      .finally(() => {
        refrescando = null;
      });
  }
  return refrescando;
}

interface Opciones extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** No intentar refresh en 401 (usado por login/refresh mismos) */
  sinReintentoAuth?: boolean;
}

async function requestUnaVez(path: string, opciones: Opciones): Promise<Response> {
  const headers = new Headers(opciones.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let body: BodyInit | undefined;
  if (opciones.body instanceof FormData) {
    body = opciones.body;
  } else if (opciones.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(opciones.body);
  }
  return fetch(`${BASE_URL}${path}`, {
    ...opciones,
    headers,
    body,
    credentials: 'include',
  });
}

export async function apiFetch<T>(path: string, opciones: Opciones = {}): Promise<T> {
  let res = await requestUnaVez(path, opciones);

  if (res.status === 401 && !opciones.sinReintentoAuth) {
    const nuevoToken = await refrescarToken();
    if (nuevoToken) {
      res = await requestUnaVez(path, opciones);
    } else {
      alFallarAuth?.();
    }
  }

  if (!res.ok) {
    let cuerpo: ErrorApi | null = null;
    try {
      cuerpo = await res.json();
    } catch {
      // respuesta sin cuerpo JSON
    }
    throw new ApiError(
      cuerpo?.codigo ?? 'ERROR_DESCONOCIDO',
      cuerpo?.mensaje ?? 'Ocurrió un error inesperado.',
      res.status,
      cuerpo?.detalles,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export { refrescarToken };
