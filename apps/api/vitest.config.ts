import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Use the @bella-vista/shared source code without building it.
    conditions: ['development'],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
});
