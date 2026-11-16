import type { FastifyInstance } from 'fastify';
import { reportRoutes } from './reports.routes.js';
import { createReportsService } from './reports.service.js';

/** Registers /v1/reports. */
export async function registerReportsModule(app: FastifyInstance): Promise<void> {
  const service = createReportsService({
    db: app.db,
    now: app.now,
    timeZone: app.env.BUSINESS_TIMEZONE,
  });
  await app.register(reportRoutes, { prefix: '/v1/reports', service });
}
