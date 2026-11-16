import type { FastifyRequest } from 'fastify';
import type { Actor } from '../db/audit.js';
import { errors } from '../lib/errors.js';

// Audit context (2.1 §6): the auth plugin sets request.actor (account and role) from the
// authenticated account. Routes pass it to the services, which write the audit log with
// writeAudit and, before touching contact data, call applyAuditContext so the database
// triggers know who is acting (db/audit.ts). Superadmin entries are technical.

/** The actor of an authenticated route, for the services' audit entries. */
export function requireActor(request: FastifyRequest): Actor {
  if (!request.actor) throw errors.unauthenticated();
  return request.actor;
}
