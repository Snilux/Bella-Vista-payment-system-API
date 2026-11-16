import { can, isBlockScoped } from '@bella-vista/shared';
import type { FastifyInstance } from 'fastify';
import { errors } from '../lib/errors.js';
import type { AuthenticatedAccount } from './auth.js';

// Permissions = role of the account + block + validity (3.1, API step 1). Validity is checked
// by the auth plugin on every request; this plugin checks the role against the permission
// matrix of @bella-vista/shared, and services restrict block leaders to their own block with
// blockScope / assertInScope (a block leader never receives data of another block).

export function registerPermissions(app: FastifyInstance): void {
  // Registered after the auth hook, so it runs once the account is loaded.
  app.addHook('onRequest', async (request) => {
    const permission = request.routeOptions.config.permission;
    if (permission === undefined || request.routeOptions.config.public) return;
    const account = request.account;
    if (!account) throw errors.unauthenticated();
    if (!can(account.role, permission)) throw errors.forbidden();
  });
}

/**
 * Block filter for queries: the block of a block leader, or null (all blocks) for the
 * committee.
 */
export function blockScope(account: AuthenticatedAccount): number | null {
  if (!isBlockScoped(account.role)) return null;
  if (account.blockId === null) throw errors.roleNotActive();
  return account.blockId;
}

/** Throws OUT_OF_SCOPE when a block leader reaches a record of another block. */
export function assertInScope(account: AuthenticatedAccount, blockId: number | null): void {
  const scope = blockScope(account);
  if (scope !== null && scope !== blockId) throw errors.outOfScope();
}
