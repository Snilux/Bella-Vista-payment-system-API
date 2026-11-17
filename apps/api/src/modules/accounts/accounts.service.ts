import type {
  AccountListResponse,
  AccountStatus,
  AccountSummary,
  CreateAccountRequest,
} from '@bella-vista/shared';
import { type Actor, writeAudit } from '../../db/audit.js';
import type { Database, Transaction } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { businessDate } from '../../lib/dates.js';
import { generateTemporaryPassword, hashPassword } from '../../lib/password.js';
import { revokeAllRefreshTokens } from '../auth/auth.repository.js';
import { accountErrors } from './accounts.errors.js';
import {
  type AccountRow,
  findAccount,
  insertAccount,
  type LockedAccount,
  listAccounts,
  listAssignmentsWithoutAccount,
  lockAccount,
  lockAssignment,
  updateAccount,
  usernameExists,
} from './accounts.repository.js';

// Accounts (CU-02, RF-AUT-03 to 05, D-19, D-22): only the superadmin manages them. Every
// change runs in a transaction with a technical audit entry (the actor is the superadmin)
// that never contains a password hash or the temporary password.

/** A manual lock by the superadmin lasts until it is lifted. */
export const MANUAL_LOCK_UNTIL = new Date('9999-12-31T00:00:00.000Z');

export interface AccountsServiceDeps {
  db: Database;
  now: () => Date;
  timeZone: string;
  generatePassword?: () => string;
}

interface CurrentAssignment {
  role: string;
  startDate: string;
  endDate: string | null;
  approvalResult: string | null;
}

/** Same rule as the auth plugin and the views: approved, started and not ended. */
function isCurrent(assignment: CurrentAssignment, today: string): boolean {
  const approved = assignment.role === 'superadmin' || assignment.approvalResult === 'approved';
  return (
    approved &&
    assignment.startDate <= today &&
    (assignment.endDate === null || assignment.endDate >= today)
  );
}

function statusOf(row: AccountRow, now: Date, today: string): AccountStatus {
  if (row.deactivatedAt && row.deactivatedAt <= now) return 'disabled';
  if (
    !isCurrent(
      { ...row, startDate: row.assignmentStartDate, endDate: row.assignmentEndDate },
      today,
    )
  ) {
    return 'role_not_active';
  }
  if (row.lockedUntil && row.lockedUntil > now) return 'locked';
  if (row.mustChangePassword) return 'must_change_password';
  return 'active';
}

const personSummary = (row: {
  personId: number;
  personFolio: string;
  givenNames: string;
  paternalSurname: string;
  maternalSurname: string | null;
  distinguishingNote: string | null;
}) => ({
  id: row.personId,
  folio: row.personFolio,
  fullName: [row.givenNames, row.paternalSurname, row.maternalSurname].filter(Boolean).join(' '),
  distinguishingNote: row.distinguishingNote,
});

function toSummary(row: AccountRow, now: Date, today: string): AccountSummary {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: statusOf(row, now, today),
    mustChangePassword: row.mustChangePassword,
    failedAttempts: row.failedAttempts,
    lockedUntil: row.lockedUntil?.toISOString() ?? null,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    roleAssignmentId: row.roleAssignmentId,
    assignmentStartDate: row.assignmentStartDate,
    assignmentEndDate: row.assignmentEndDate,
    blockCode: row.blockCode,
    person: personSummary(row),
  };
}

/** Audit snapshot of an account: state columns only, never secrets. */
const snapshot = (
  account: Pick<
    LockedAccount,
    'mustChangePassword' | 'failedAttempts' | 'lockedUntil' | 'deactivatedAt'
  >,
) => ({
  mustChangePassword: account.mustChangePassword,
  failedAttempts: account.failedAttempts,
  lockedUntil: account.lockedUntil?.toISOString() ?? null,
  deactivatedAt: account.deactivatedAt?.toISOString() ?? null,
});

export function createAccountsService(deps: AccountsServiceDeps) {
  const { db } = deps;
  const newPassword = deps.generatePassword ?? generateTemporaryPassword;

  async function summary(executor: Database | Transaction, id: number, now: Date) {
    const row = await findAccount(executor, id);
    if (!row) throw accountErrors.accountNotFound();
    return toSummary(row, now, businessDate(now, deps.timeZone));
  }

  /**
   * Locks the account, applies `change` and writes the audit entry with the before/after
   * state. Returns the summary after the change.
   */
  async function changeAccount(
    actor: Actor,
    id: number,
    action: string,
    reason: string | null,
    change: (tx: Transaction, account: LockedAccount, now: Date) => Promise<void>,
  ): Promise<AccountSummary> {
    const now = deps.now();
    return db.transaction(async (tx) => {
      const account = await lockAccount(tx, id);
      if (!account) throw accountErrors.accountNotFound();
      await change(tx, account, now);
      const after = await lockAccount(tx, id);
      await writeAudit(tx, actor, {
        action,
        table: 'user_account',
        recordId: id,
        before: snapshot(account),
        after: after ? snapshot(after) : null,
        reason,
        technical: true,
      });
      return summary(tx, id, now);
    });
  }

  return {
    async list(): Promise<AccountListResponse> {
      const now = deps.now();
      const today = businessDate(now, deps.timeZone);
      const [accounts, assignments] = await Promise.all([
        listAccounts(db),
        listAssignmentsWithoutAccount(db, today),
      ]);
      return {
        accounts: accounts.map((row) => toSummary(row, now, today)),
        assignmentsWithoutAccount: assignments.map((row) => ({
          roleAssignmentId: row.roleAssignmentId,
          role: row.role,
          startDate: row.startDate,
          blockCode: row.blockCode,
          person: personSummary(row),
        })),
      };
    },

    async create(actor: Actor, input: CreateAccountRequest) {
      const now = deps.now();
      const today = businessDate(now, deps.timeZone);
      const temporaryPassword = newPassword();
      const passwordHash = await hashPassword(temporaryPassword);
      try {
        const account = await db.transaction(async (tx) => {
          const assignment = await lockAssignment(tx, input.roleAssignmentId);
          if (!assignment) throw accountErrors.assignmentNotFound();
          if (assignment.accountId !== null) throw accountErrors.assignmentHasAccount();
          if (assignment.role === 'superadmin' || !isCurrent(assignment, today)) {
            throw accountErrors.assignmentNotActive();
          }
          if (await usernameExists(tx, input.username)) {
            throw accountErrors.usernameTaken(input.username);
          }
          const id = await insertAccount(tx, {
            roleAssignmentId: assignment.id,
            username: input.username,
            passwordHash,
            createdBy: actor.userAccountId,
          });
          const created = await summary(tx, id, now);
          await writeAudit(tx, actor, {
            action: 'create',
            table: 'user_account',
            recordId: id,
            after: {
              username: created.username,
              roleAssignmentId: created.roleAssignmentId,
              role: created.role,
              mustChangePassword: true,
            },
            technical: true,
          });
          return created;
        });
        return { account, temporaryPassword };
      } catch (error) {
        // Concurrent creations: the unique indexes decide.
        if (isUniqueViolation(error, 'user_account_username_unique')) {
          throw accountErrors.usernameTaken(input.username);
        }
        if (isUniqueViolation(error, 'user_account_role_assignment_id_unique')) {
          throw accountErrors.assignmentHasAccount();
        }
        throw error;
      }
    },

    /**
     * New temporary password (RF-AUT-05): must be changed on login; every session ends. The
     * optional reason goes to the audit entry.
     */
    async resetPassword(actor: Actor, id: number, reason?: string) {
      const temporaryPassword = newPassword();
      const passwordHash = await hashPassword(temporaryPassword);
      const account = await changeAccount(
        actor,
        id,
        'reset_password',
        reason ?? null,
        async (tx, current, now) => {
          await updateAccount(tx, id, {
            passwordHash,
            mustChangePassword: true,
            failedAttempts: 0,
            // A temporary lockout ends; a manual lock by the superadmin stays.
            lockedUntil:
              current.lockedUntil && current.lockedUntil >= MANUAL_LOCK_UNTIL
                ? current.lockedUntil
                : null,
          });
          await revokeAllRefreshTokens(tx, id, now);
        },
      );
      return { account, temporaryPassword };
    },

    async lock(actor: Actor, id: number, reason: string) {
      if (id === actor.userAccountId) throw accountErrors.ownAccount();
      return changeAccount(actor, id, 'lock', reason, async (tx, _current, now) => {
        await updateAccount(tx, id, { lockedUntil: MANUAL_LOCK_UNTIL });
        await revokeAllRefreshTokens(tx, id, now);
      });
    },

    async unlock(actor: Actor, id: number, reason: string) {
      return changeAccount(actor, id, 'unlock', reason, async (tx) => {
        await updateAccount(tx, id, { lockedUntil: null, failedAttempts: 0 });
      });
    },

    /** Final: there is no reactivation (D-22 closes accounts with their assignment). */
    async deactivate(actor: Actor, id: number, reason: string) {
      if (id === actor.userAccountId) throw accountErrors.ownAccount();
      return changeAccount(actor, id, 'deactivate', reason, async (tx, current, now) => {
        if (!current.deactivatedAt) await updateAccount(tx, id, { deactivatedAt: now });
        await revokeAllRefreshTokens(tx, id, now);
      });
    },
  };
}

export type AccountsService = ReturnType<typeof createAccountsService>;
