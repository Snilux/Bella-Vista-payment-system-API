import type { FastifyInstance } from 'fastify';
import {
  agreementRoutes,
  connectionRequestRoutes,
  connectionRoutes,
} from './connections.routes.js';
import { createConnectionsService } from './connections.service.js';

/** Registers /v1/connections, /v1/agreements and /v1/connection-requests. */
export async function registerConnectionsModule(app: FastifyInstance): Promise<void> {
  const service = createConnectionsService({
    db: app.db,
    now: app.now,
    timeZone: app.env.BUSINESS_TIMEZONE,
  });
  await app.register(connectionRoutes, { prefix: '/v1/connections', service });
  await app.register(agreementRoutes, { prefix: '/v1/agreements', service });
  await app.register(connectionRequestRoutes, { prefix: '/v1/connection-requests', service });
}
