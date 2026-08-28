import { useEffect } from 'react';
import { focusManager, type QueryClient } from '@tanstack/react-query';

// ── Pausa del polling por inactividad ──
//
// El problema: la app hace polling de respaldo (turno activo cada 20 s,
// transferencias cada 15 s, pedidos y alertas cada 30 s). Una pestaña abierta
// y olvidada sigue consultando toda la noche, y cada request despierta el
// compute de Neon, que suspende recién a los 5 minutos de inactividad. Una
// sola pestaña de admin olvidada de 23:00 a 10:00 son ~71 CU-hours al mes:
// sola alcanza para sacarnos del plan Free (100 CU-hours), aunque el job del
// backend ya esté gateado (ver revisarNoRetirados en pedidos.service.ts).
//
// Cómo se apaga: React Query solo dispara un `refetchInterval` cuando
// `focusManager.isFocused()` es true — está en queryObserver.js:215, y
// `refetchIntervalInBackground` no se usa en ningún lado de este proyecto.
// O sea que marcar la app como "no enfocada" pausa TODOS los intervalos de
// una, sin tocar una sola pantalla.
//
// Qué NO se rompe: los WebSockets siguen conectados (van contra Railway, no
// contra Neon) y son el canal primario de avisos. El polling es el respaldo
// para cuando el socket se cae. Y cualquier toque de pantalla lo reanuda al
// instante, con un refetch inmediato para no mostrar datos viejos.

// 20 minutos: cubre el caso real (nadie toca el equipo en toda la noche) sin
// molestar al cajero que se quedó esperando algo mirando la pantalla.
const MINUTOS_INACTIVIDAD = 20;
const MS_INACTIVIDAD = MINUTOS_INACTIVIDAD * 60 * 1000;
const MS_CHEQUEO = 60 * 1000;

const EVENTOS = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'] as const;

let ultimaActividad = Date.now();
let pausado = false;
// Pantallas que necesitan seguir consultando aunque nadie toque nada (ver
// useMantenerPollingVivo).
let retenciones = 0;

function reanudar(queryClient: QueryClient) {
  if (!pausado) return;
  pausado = false;
  focusManager.setFocused(true);
  // Al despertar, lo que hay en pantalla puede tener horas: se refresca ya,
  // sin esperar al próximo tick del intervalo.
  void queryClient.invalidateQueries();
}

function pausar() {
  if (pausado) return;
  pausado = true;
  focusManager.setFocused(false);
}

/**
 * Se llama UNA vez al arrancar la app. Devuelve la función de limpieza.
 */
export function iniciarPausaPorInactividad(queryClient: QueryClient): () => void {
  const marcarActividad = () => {
    ultimaActividad = Date.now();
    reanudar(queryClient);
  };

  for (const evento of EVENTOS) {
    window.addEventListener(evento, marcarActividad, { passive: true });
  }

  // Volver a la pestaña cuenta como actividad; irse no pausa por sí solo
  // (React Query ya no dispara intervalos en una pestaña oculta).
  const alCambiarVisibilidad = () => {
    if (document.visibilityState === 'visible') marcarActividad();
  };
  document.addEventListener('visibilitychange', alCambiarVisibilidad);

  const timer = window.setInterval(() => {
    if (retenciones > 0) return;
    if (Date.now() - ultimaActividad >= MS_INACTIVIDAD) pausar();
  }, MS_CHEQUEO);

  return () => {
    for (const evento of EVENTOS) window.removeEventListener(evento, marcarActividad);
    document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    window.clearInterval(timer);
  };
}

/**
 * Para pantallas donde el polling NO se puede pausar aunque nadie toque nada.
 *
 * El caso es el turno bloqueado: el cajero se queda mirando la pantalla
 * esperando que el admin desbloquee, sin tocar nada. El aviso llega por
 * WebSocket, pero el polling existe justamente por si el socket está caído
 * (CLAUDE.md §8) — pausarlo ahí lo dejaría esperando para siempre.
 */
export function useMantenerPollingVivo() {
  useEffect(() => {
    retenciones += 1;
    ultimaActividad = Date.now();
    if (pausado) {
      pausado = false;
      focusManager.setFocused(true);
    }
    return () => {
      retenciones -= 1;
      ultimaActividad = Date.now();
    };
  }, []);
}
