import type { FastifyInstance } from 'fastify';
import { closingRoutes } from './closings.routes.js';
import { createClosingsService } from './closings.service.js';

/** Registers /v1/closings. */
export async function registerClosingsModule(app: FastifyInstance): Promise<void> {
  const service = createClosingsService({
    db: app.db,
    now: app.now,
    timeZone: app.env.BUSINESS_TIMEZONE,
  });
  await app.register(closingRoutes, { prefix: '/v1/closings', service });
}
