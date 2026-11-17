import type {
  ChangePasswordRequest,
  LoginRequest,
  LogoutRequest,
  RefreshRequest,
  SessionResponse,
} from '@bella-vista/shared';
import { writeAudit } from '../../db/audit.js';
import type { Database, Transaction } from '../../db/client.js';
import type { AppError } from '../../lib/errors.js';
import { errors } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import type { AccessTokenClaims, AuthenticatedAccount } from '../../plugins/auth.js';
import { accountAccessError } from '../../plugins/auth.js';
import { authErrors } from './auth.errors.js';
import {
  type AccountAccess,
  findAccountAccess,
  findSessionProfile,
  insertRefreshToken,
  lockAccountForCredentials,
  lockRefreshToken,
  markRotated,
  revokeAllRefreshTokens,
  revokeChain,
  revokeRefreshToken,
  updateAccountCredentials,
} from './auth.repository.js';
import { generateRefreshToken, hashRefreshToken } from './tokens.js';

// Sessions (CU-01, RF-AUT-01/05/06/07, 2.1 §5.3): login with lockout after repeated failures,
// rotating refresh tokens with reuse detection, mandatory password change and logout.

export interface AuthServiceDeps {
  db: Database;
  now: () => Date;
  timeZone: string;
  maxFailedAttempts: number;
  lockoutMinutes: number;
  refreshTokenTtlDays: number;
  accessTokenTtlSeconds: number;
  signAccessToken: (claims: AccessTokenClaims) => string;
}

export const AUTO_LOCK_REASON = 'Bloqueo automático por intentos fallidos de inicio de sesión';

/**
 * Hash of a throwaway password, verified when the username does not exist so the response
 * takes as long as a real wrong password and does not reveal which usernames exist.
 */
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => {
  dummyHash ??= hashPassword('cuenta-inexistente-bella-vista');
  return dummyHash;
};

type Outcome<T> = { ok: true; value: T } | { ok: false; error: AppError };

export function createAuthService(deps: AuthServiceDeps) {
  const { db } = deps;

  /** Opens a session: stores a new refresh token and returns the pair. */
  async function startSession(tx: Transaction, account: AccountAccess, now: Date) {
    const { token, tokenHash } = generateRefreshToken();
    const tokenId = await insertRefreshToken(tx, {
      userAccountId: account.userAccountId,
      tokenHash,
      expiresAt: new Date(now.getTime() + deps.refreshTokenTtlDays * 86_400_000),
    });
    return { refreshToken: token, tokenId };
  }

  async function sessionResponse(
    exec: Database | Transaction,
    account: AccountAccess,
    refreshToken: string,
    mustChangePassword: boolean,
  ): Promise<SessionResponse> {
    const profile = await findSessionProfile(exec, account.roleAssignmentId);
    const claims: AccessTokenClaims = {
      sub: String(account.userAccountId),
      username: account.username,
      role: account.role,
      blockId: account.blockId,
    };
    return {
      accessToken: deps.signAccessToken(claims),
      accessTokenExpiresIn: deps.accessTokenTtlSeconds,
      refreshToken,
      account: {
        username: account.username,
        role: account.role,
        blockId: account.blockId,
        blockCode: profile?.blockCode ?? null,
        fullName: profile?.fullName ?? account.username,
        mustChangePassword,
      },
    };
  }

  /** Throws the error of a failed outcome after its transaction committed. */
  function unwrap<T>(outcome: Outcome<T>): T {
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }

  return {
    async login(input: LoginRequest): Promise<SessionResponse> {
      const now = deps.now();
      // Failed attempts and lockouts must be committed even though the login fails, so the
      // transaction returns the error and it is thrown after the commit.
      const outcome = await db.transaction(
        async (tx): Promise<Outcome<{ account: AccountAccess; refreshToken: string }>> => {
          const account = await lockAccountForCredentials(tx, { username: input.username });
          if (!account) {
            await verifyPassword(await getDummyHash(), input.password);
            return { ok: false, error: authErrors.invalidCredentials() };
          }
          if (account.lockedUntil && account.lockedUntil > now) {
            return { ok: false, error: errors.accountLocked(account.lockedUntil) };
          }

          if (!(await verifyPassword(account.passwordHash, input.password))) {
            const attempts = account.failedAttempts + 1;
            if (attempts < deps.maxFailedAttempts) {
              await updateAccountCredentials(tx, account.userAccountId, {
                failedAttempts: attempts,
              });
              return { ok: false, error: authErrors.invalidCredentials() };
            }
            // RF-AUT-06: locked for LOGIN_LOCKOUT_MINUTES; the counter starts over afterwards.
            const lockedUntil = new Date(now.getTime() + deps.lockoutMinutes * 60_000);
            await updateAccountCredentials(tx, account.userAccountId, {
              failedAttempts: 0,
              lockedUntil,
            });
            // Open sessions are kept: otherwise anyone could log a user out by failing on purpose.
            await writeAudit(
              tx,
              { userAccountId: account.userAccountId, role: account.role },
              {
                action: 'lock_after_failed_attempts',
                table: 'user_account',
                recordId: account.userAccountId,
                before: { lockedUntil: account.lockedUntil?.toISOString() ?? null },
                after: { lockedUntil: lockedUntil.toISOString() },
                reason: AUTO_LOCK_REASON,
                technical: true,
              },
            );
            return { ok: false, error: errors.accountLocked(lockedUntil) };
          }

          // Correct password: only now say whether the account may enter.
          const denied = accountAccessError(account, now, deps.timeZone);
          if (denied) return { ok: false, error: denied };

          if (account.failedAttempts !== 0 || account.lockedUntil !== null) {
            await updateAccountCredentials(tx, account.userAccountId, {
              failedAttempts: 0,
              lockedUntil: null,
            });
          }
          const session = await startSession(tx, account, now);
          return { ok: true, value: { account, refreshToken: session.refreshToken } };
        },
      );
      const { account, refreshToken } = unwrap(outcome);
      return sessionResponse(db, account, refreshToken, account.mustChangePassword);
    },

    async refresh(input: RefreshRequest): Promise<SessionResponse> {
      const now = deps.now();
      const outcome = await db.transaction(
        async (tx): Promise<Outcome<{ account: AccountAccess; refreshToken: string }>> => {
          const current = await lockRefreshToken(tx, hashRefreshToken(input.refreshToken));
          if (!current) return { ok: false, error: authErrors.sessionInvalid() };
          if (current.revokedAt !== null || current.replacedById !== null) {
            // Reuse of a rotated or revoked token: someone else may hold the chain.
            await revokeChain(tx, current.id, now);
            return { ok: false, error: authErrors.sessionInvalid() };
          }
          if (current.expiresAt <= now) {
            await revokeChain(tx, current.id, now);
            return { ok: false, error: authErrors.sessionInvalid() };
          }

          const account = await findAccountAccess(tx, current.userAccountId);
          if (!account) return { ok: false, error: authErrors.sessionInvalid() };
          const denied = accountAccessError(account, now, deps.timeZone);
          // A temporary lock keeps the chain usable once it expires; other denials are final
          // for the account anyway.
          if (denied) return { ok: false, error: denied };

          const session = await startSession(tx, account, now);
          await markRotated(tx, current.id, session.tokenId, now);
          return { ok: true, value: { account, refreshToken: session.refreshToken } };
        },
      );
      const { account, refreshToken } = unwrap(outcome);
      return sessionResponse(db, account, refreshToken, account.mustChangePassword);
    },

    async changePassword(
      authenticated: AuthenticatedAccount,
      input: ChangePasswordRequest,
    ): Promise<SessionResponse> {
      const now = deps.now();
      const newHash = await hashPassword(input.newPassword);
      return db.transaction(async (tx) => {
        const account = await lockAccountForCredentials(tx, {
          userAccountId: authenticated.userAccountId,
        });
        if (!account) throw errors.unauthenticated();
        if (!(await verifyPassword(account.passwordHash, input.currentPassword))) {
          throw authErrors.wrongCurrentPassword();
        }
        await updateAccountCredentials(tx, account.userAccountId, {
          passwordHash: newHash,
          mustChangePassword: false,
          failedAttempts: 0,
        });
        // Every other session ends; this one continues with a new pair.
        await revokeAllRefreshTokens(tx, account.userAccountId, now);
        await writeAudit(
          tx,
          { userAccountId: account.userAccountId, role: account.role },
          {
            action: 'change_password',
            table: 'user_account',
            recordId: account.userAccountId,
            before: { mustChangePassword: account.mustChangePassword },
            after: { mustChangePassword: false },
            technical: true,
          },
        );
        const session = await startSession(tx, account, now);
        return sessionResponse(tx, account, session.refreshToken, false);
      });
    },

    async logout(authenticated: AuthenticatedAccount, input: LogoutRequest): Promise<void> {
      const now = deps.now();
      await db.transaction((tx) =>
        revokeRefreshToken(
          tx,
          authenticated.userAccountId,
          hashRefreshToken(input.refreshToken),
          now,
        ),
      );
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
