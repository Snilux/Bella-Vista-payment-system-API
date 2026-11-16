import { defineConfig } from 'vitest/config';

// Integration files each create, migrate and seed their own database (argon2 hashes, two
// pools) on the single PostgreSQL of docker-compose. Running them in parallel exhausted the
// connections (max_connections 100), saturated the CPU and the Docker DNS resolver
// (EAI_AGAIN db) and made hooks time out, so they run one file at a time; serially the suite
// is also faster. Unit tests stay parallel.

const shared = {
  resolve: {
    // Use the @bella-vista/shared source code without building it.
    conditions: ['development'],
  },
};

export default defineConfig({
  test: {
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
    projects: [
      {
        ...shared,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        ...shared,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
