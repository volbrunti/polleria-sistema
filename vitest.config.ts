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
    // como colchón para ese cold-start.
    testTimeout: 45000,
    hookTimeout: 60000,
  },
});
