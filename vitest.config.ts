import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // integración corre en serie: comparte una DB de test
    fileParallelism: false,
    // Free tier de Neon suspende el compute agresivamente entre queries
    // (no se puede ajustar suspend_timeout sin plan pago). Cada archivo
    // reconecta en frío una vez (aislado por vitest) — timeouts generosos
    // como colchón para ese cold-start. Contra la región Virginia (más lejos
    // que la anterior) el cold-start + limpiarDb() de un beforeAll grande
    // llegó a superar los 60s incluso corriendo un solo archivo (verificado
    // 2026-08-15) — se sube el margen.
    testTimeout: 45000,
    hookTimeout: 120000,
  },
});
