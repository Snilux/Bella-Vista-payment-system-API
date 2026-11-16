import {
  blockReportQuerySchema,
  blockReportResponseSchema,
  communityReportResponseSchema,
  reportQuerySchema,
} from '@bella-vista/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAccount } from '../../plugins/auth.js';
import type { ReportsService } from './reports.service.js';

// /v1/reports/block and /v1/reports/community (2.3 /reportes/padron-manzana, /comunitario):
// JSON data; the app builds the PDF.

export const reportRoutes: FastifyPluginAsyncZod<{ service: ReportsService }> = async (
  app,
  { service },
) => {
  app.get(
    '/block',
    {
      config: { permission: 'reports.block' },
      schema: { querystring: blockReportQuerySchema, response: { 200: blockReportResponseSchema } },
    },
    async (request) => service.block(requireAccount(request), request.query),
  );

  app.get(
    '/community',
    {
      config: { permission: 'reports.community' },
      schema: { querystring: reportQuerySchema, response: { 200: communityReportResponseSchema } },
    },
    async (request) => service.community(request.query),
  );
};
