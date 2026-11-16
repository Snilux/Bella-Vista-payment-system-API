import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.routes.js';
import { type AuthService, createAuthService } from './auth.service.js';
import { durationSeconds } from './tokens.js';

export interface AuthModuleOptions {
  rateLimit: { max: number; timeWindow: number | string };
}

/** Builds the auth service from the app and registers /v1/auth. */
export async function registerAuthModule(
  app: FastifyInstance,
  options: AuthModuleOptions,
): Promise<AuthService> {
  const { env } = app;
  const service = createAuthService({
    db: app.db,
    now: app.now,
    timeZone: env.BUSINESS_TIMEZONE,
    maxFailedAttempts: env.LOGIN_MAX_ATTEMPTS,
    lockoutMinutes: env.LOGIN_LOCKOUT_MINUTES,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    accessTokenTtlSeconds: durationSeconds(env.JWT_ACCESS_TTL),
    signAccessToken: (claims) => app.jwt.sign(claims),
  });
  await app.register(authRoutes, { prefix: '/v1/auth', service, rateLimit: options.rateLimit });
  return service;
}
