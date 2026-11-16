import {
  changePasswordRequestSchema,
  loginRequestSchema,
  logoutRequestSchema,
  refreshRequestSchema,
  sessionResponseSchema,
} from '@bella-vista/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { requireAccount } from '../../plugins/auth.js';
import type { AuthService } from './auth.service.js';

// /v1/auth: login and refresh are public and rate limited per client IP (RNF-SEG-07); login
// is also limited per username, so attempts spread over many IPs (or spoofed proxy headers)
// against one account still stop. change-password and logout are the only routes an account
// with a pending password change can call.

export interface AuthRoutesOptions {
  service: AuthService;
  rateLimit: { max: number; timeWindow: number | string };
}

export const authRoutes: FastifyPluginAsyncZod<AuthRoutesOptions> = async (app, options) => {
  const { service } = options;
  const limited = { rateLimit: options.rateLimit };
  // Not app.rateLimit(): it is skipped on a request the per-IP limit already checked.
  const attemptsPerUsername = app.createRateLimit({
    ...options.rateLimit,
    keyGenerator: (request) => `login-username:${(request.body as { username: string }).username}`,
  });

  app.post(
    '/login',
    {
      config: { public: true, ...limited },
      schema: { body: loginRequestSchema, response: { 200: sessionResponseSchema } },
      // After validation: the key is the normalized username of the body.
      preHandler: async (request, reply) => {
        const limit = await attemptsPerUsername(request);
        if (!limit.isAllowed && limit.isExceeded) {
          reply.header('retry-after', limit.ttlInSeconds);
          throw errors.tooManyRequests();
        }
      },
    },
    async (request) => service.login(request.body),
  );

  app.post(
    '/refresh',
    {
      config: { public: true, ...limited },
      schema: { body: refreshRequestSchema, response: { 200: sessionResponseSchema } },
    },
    async (request) => service.refresh(request.body),
  );

  app.post(
    '/change-password',
    {
      config: { allowPendingPasswordChange: true },
      schema: { body: changePasswordRequestSchema, response: { 200: sessionResponseSchema } },
    },
    async (request) => service.changePassword(requireAccount(request), request.body),
  );

  app.post(
    '/logout',
    {
      config: { allowPendingPasswordChange: true },
      schema: { body: logoutRequestSchema, response: { 204: z.null() } },
    },
    async (request, reply) => {
      await service.logout(requireAccount(request), request.body);
      return reply.code(204).send(null);
    },
  );
};
