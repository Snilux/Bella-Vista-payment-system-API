import { pino } from 'pino';
import type { z } from 'zod';
import { envSchema } from '../../config/env.js';
import { loggerOptions } from '../../config/logger.js';

// Shared pieces of the seed command-line scripts. They only need the database and the
// business time zone, not the whole API environment (JWT secrets, ports).

const seedEnvSchema = envSchema.pick({
  NODE_ENV: true,
  LOG_LEVEL: true,
  BUSINESS_TIMEZONE: true,
  DATABASE_URL: true,
});

export type SeedEnv = z.infer<typeof seedEnvSchema>;

export function loadSeedEnv(source: Record<string, string | undefined> = process.env): SeedEnv {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = seedEnvSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(
      `Variables de entorno inválidas:\n${result.error.issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n')}`,
    );
  }
  return result.data;
}

export function createSeedLogger(env: Pick<SeedEnv, 'NODE_ENV' | 'LOG_LEVEL'>) {
  return pino(loggerOptions(env));
}

/**
 * Directory the user ran `pnpm` from: pnpm sets INIT_CWD, while the script itself runs
 * inside apps/api.
 */
export function invocationDir(): string {
  return process.env.INIT_CWD ?? process.cwd();
}
