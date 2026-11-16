import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import {
  findStoredResponse,
  type IdempotencyContext,
  type IdempotentResult,
  purgeExpiredIdempotencyKeys,
} from '../db/idempotency.js';
import { errors } from '../lib/errors.js';

// Idempotency-Key for the POSTs that move money (2.1 §6). A route opts in with
// `config: { idempotent: true }`. Before the handler this plugin validates the header and
// replays a stored response (fast path); the service then runs its operation through
// idempotentTransaction (db/idempotency.ts) with request.idempotency, which also covers two
// requests arriving at the same time.

declare module 'fastify' {
  interface FastifyRequest {
    /** Key, account and route of an idempotent route; null elsewhere. */
    idempotency: IdempotencyContext | null;
  }
}

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const REPLAYED_HEADER = 'Idempotent-Replayed';

const keySchema = z.uuid();

export function registerIdempotency(app: FastifyInstance, options: { db: Database }): void {
  app.decorateRequest('idempotency', null);

  // preHandler: after authentication and body validation.
  app.addHook('preHandler', async (request, reply) => {
    if (!request.routeOptions.config.idempotent) return;
    const account = request.account;
    if (!account) throw errors.unauthenticated();

    const header = request.headers[IDEMPOTENCY_HEADER];
    const parsed = keySchema.safeParse(typeof header === 'string' ? header.trim() : undefined);
    if (!parsed.success) throw errors.idempotencyKeyRequired();

    const ctx: IdempotencyContext = {
      key: parsed.data.toLowerCase(),
      userAccountId: account.userAccountId,
      route: `${request.method} ${request.url.split('?')[0]}`,
    };
    await purgeExpiredIdempotencyKeys(options.db);
    const stored = await findStoredResponse(options.db, ctx);
    if (stored) {
      return reply.code(stored.status).header(REPLAYED_HEADER, 'true').send(stored.body);
    }
    request.idempotency = ctx;
  });
}

/** The idempotency context of an idempotent route (set by the preHandler). */
export function requireIdempotency(request: FastifyRequest): IdempotencyContext {
  if (!request.idempotency) throw errors.idempotencyKeyRequired();
  return request.idempotency;
}

/** Sends the result of idempotentTransaction, marking replays. */
export function sendIdempotent(reply: FastifyReply, result: IdempotentResult) {
  if (result.replayed) reply.header(REPLAYED_HEADER, 'true');
  return reply.code(result.status).send(result.body);
}
