import { useEffect, useState } from 'react';

// CLAUDE.md: no hay offline real en v1 — solo este banner + cache de
// catálogo vía Service Worker (ver vite-plugin-pwa en vite.config.ts).
export function BannerSinConexion() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const marcarOnline = () => setOnline(true);
    const marcarOffline = () => setOnline(false);
    window.addEventListener('online', marcarOnline);
    window.addEventListener('offline', marcarOffline);
    return () => {
      window.removeEventListener('online', marcarOnline);
      window.removeEventListener('offline', marcarOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 bg-error px-3 py-3 text-center text-base font-bold text-white">
      Sin conexión — los datos no se están guardando
    </div>
  );
}
