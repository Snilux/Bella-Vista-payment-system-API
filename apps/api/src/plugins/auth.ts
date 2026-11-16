import type { Action, Role } from '@bella-vista/shared';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Actor } from '../db/audit.js';
import type { Database } from '../db/client.js';
import { businessDate } from '../lib/dates.js';
import { type AppError, errors } from '../lib/errors.js';
import { type AccountAccess, findAccountAccess } from '../modules/auth/auth.repository.js';

// Authentication of /v1 (2.1 §5.3). Secure by default: every /v1 route needs a valid access
// token unless it declares `config: { public: true }` (login and refresh, API step 2). The
// token only says who the account is; on every request the account is loaded from the
// database and rejected if it is disabled, locked or its role assignment is not current, so
// a lock or deactivation applies immediately instead of when the token expires.

/** Claims of the access token: the account (sub), its username, role and block. */
export interface AccessTokenClaims {
  sub: string;
  username: string;
  role: Role;
  blockId: number | null;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenClaims;
    user: AccessTokenClaims;
  }
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Route reachable without an access token. */
    public?: boolean;
    /** Allowed while the account must change its password (change password, logout). */
    allowPendingPasswordChange?: boolean;
    /** Action of the permission matrix the account's role must be allowed (permissions.ts). */
    permission?: Action;
    /** Money-moving POST: requires Idempotency-Key (idempotency.ts). */
    idempotent?: boolean;
  }

  interface FastifyRequest {
    /** Authenticated account; null on public routes and outside /v1. */
    account: AuthenticatedAccount | null;
    /** Who acts in the audit log (audit-context.ts); null when there is no account. */
    actor: Actor | null;
  }
}

export interface AuthenticatedAccount {
  userAccountId: number;
  username: string;
  role: Role;
  personId: number;
  roleAssignmentId: number;
  /** Block of a block leader; null for every other role. */
  blockId: number | null;
  mustChangePassword: boolean;
}

export const API_PREFIX = '/v1';

/**
 * Why the account cannot use the API right now (null = it can). The assignment is current
 * with the same rule as the views of migration 0013: approved (or superadmin), started, and
 * not ended before today in the business time zone.
 */
export function accountAccessError(
  account: AccountAccess,
  now: Date,
  timeZone: string,
): AppError | null {
  if (account.deactivatedAt && account.deactivatedAt <= now) return errors.accountDisabled();
  if (account.lockedUntil && account.lockedUntil > now) {
    return errors.accountLocked(account.lockedUntil);
  }
  const today = businessDate(now, timeZone);
  const approved = account.role === 'superadmin' || account.approvalResult === 'approved';
  const started = account.startDate <= today;
  const notEnded = account.endDate === null || account.endDate >= today;
  if (!approved || !started || !notEnded) return errors.roleNotActive();
  return null;
}

export interface AuthOptions {
  db: Database;
  jwtSecret: string;
  accessTokenTtl: string;
  timeZone: string;
  now: () => Date;
}

export async function registerAuth(app: FastifyInstance, options: AuthOptions): Promise<void> {
  await app.register(fastifyJwt, {
    secret: options.jwtSecret,
    sign: { expiresIn: options.accessTokenTtl },
  });
  app.decorateRequest('account', null);
  app.decorateRequest('actor', null);

  app.addHook('onRequest', async (request) => {
    if (!requiresAuthentication(request)) return;

    const userAccountId = await verifyAccessToken(request);
    const account = await findAccountAccess(options.db, userAccountId);
    if (!account || account.role !== request.user.role) throw errors.unauthenticated();
    const denied = accountAccessError(account, options.now(), options.timeZone);
    if (denied) throw denied;

    request.account = {
      userAccountId: account.userAccountId,
      username: account.username,
      role: account.role,
      personId: account.personId,
      roleAssignmentId: account.roleAssignmentId,
      blockId: account.blockId,
      mustChangePassword: account.mustChangePassword,
    };
    request.actor = { userAccountId: account.userAccountId, role: account.role };

    if (account.mustChangePassword && !request.routeOptions.config.allowPendingPasswordChange) {
      throw errors.passwordChangeRequired();
    }
  });
}

/** Only matched /v1 routes that are not public. Unknown routes fall through to the 404. */
function requiresAuthentication(request: FastifyRequest): boolean {
  const url = request.routeOptions.url;
  if (url === undefined) return false;
  if (url !== API_PREFIX && !url.startsWith(`${API_PREFIX}/`)) return false;
  return request.routeOptions.config.public !== true;
}

async function verifyAccessToken(request: FastifyRequest): Promise<number> {
  try {
    await request.jwtVerify();
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED'
      ? errors.tokenExpired()
      : errors.unauthenticated();
  }
  const userAccountId = Number(request.user.sub);
  if (!Number.isSafeInteger(userAccountId) || userAccountId <= 0) throw errors.unauthenticated();
  return userAccountId;
}

/** The authenticated account of a /v1 route (throws if the route is public). */
export function requireAccount(request: FastifyRequest): AuthenticatedAccount {
  if (!request.account) throw errors.unauthenticated();
  return request.account;
}
