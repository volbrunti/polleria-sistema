import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Proxy en dev: todo queda same-origin contra el backend local (evita
// fricción de CORS/SameSite con la cookie de refresh). En prod se usa
// VITE_API_URL como base absoluta (ver src/api/client.ts).
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Limón & Chimi — Gestión',
        short_name: 'Limón & Chimi',
        description: 'Sistema de gestión — Módulo 1: Producción, Stock y Transferencias',
        theme_color: '#1a7f3f',
        background_color: '#e7eae1',
        display: 'standalone',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // Solo cachea catálogo de lectura (CLAUDE.md: nada de offline real,
        // solo banner + cache de catálogo).
        runtimeCaching: [
          {
            urlPattern: /\/api\/(productos|proveedores|sucursales)(\?.*)?$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'catalogo-api' },
          },
        ],
      },
    }),
  ],
  server: {
    // 127.0.0.1 y no "localhost": Node resuelve localhost a ::1 primero, así
    // que si hay OTRO server escuchando en el 3000 por IPv6 el proxy le pega a
    // ese en vez de al backend. Con la IP explícita no hay ambigüedad.
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/socket.io': { target: 'http://127.0.0.1:3000', ws: true, changeOrigin: true },
    },
  },
});
