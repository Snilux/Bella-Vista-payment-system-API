import type { Approval, ApprovalListQuery, ResolveApprovalRequest } from '@bella-vista/shared';
import { type Actor, writeAudit } from '../../db/audit.js';
import type { Database, Transaction } from '../../db/client.js';
import { businessDate } from '../../lib/dates.js';
import { AppError, errors } from '../../lib/errors.js';
import type { AuthenticatedAccount } from '../../plugins/auth.js';
import type { ApprovalRegistry, ApprovalSummary } from './approval-registry.js';
import {
  type ApprovalRow,
  findApproval,
  listApprovals,
  lockApproval,
  recordResolution,
} from './approvals.repository.js';

// Approvals inbox and resolution (transversal). Only the president resolves; the module that
// owns each approval type decides what approving or rejecting does (approval-registry.ts).

export interface ApprovalsServiceDeps {
  db: Database;
  now: () => Date;
  timeZone: string;
  registry: ApprovalRegistry;
}

export const approvalErrors = {
  alreadyResolved: (result: string) =>
    new AppError('APPROVAL_ALREADY_RESOLVED', 409, 'Esta solicitud ya fue resuelta.', {
      result,
    }),
  notFound: () => new AppError('NOT_FOUND', 404, 'No existe esa solicitud.'),
};

const fullName = (who: {
  givenNames: string | null;
  paternalSurname: string | null;
  maternalSurname: string | null;
}) => [who.givenNames, who.paternalSurname, who.maternalSurname].filter(Boolean).join(' ');

export function createApprovalsService(deps: ApprovalsServiceDeps) {
  const { db, registry } = deps;

  /** Inbox items with the description and subject written by each type's handler. */
  async function toApprovals(executor: Database | Transaction, rows: ApprovalRow[]) {
    const summaries = new Map<number, ApprovalSummary>();
    const byType = Map.groupBy(rows, (row) => row.type);
    for (const [type, group] of byType) {
      const handler = registry.find(type);
      if (!handler) continue;
      const described = await handler.describe(
        executor,
        group.map((row) => row.id),
      );
      for (const [id, summary] of described) summaries.set(id, summary);
    }
    return rows.map(
      (row): Approval => ({
        id: row.id,
        type: row.type,
        status: row.result ?? 'pending',
        reason: row.reason,
        description: summaries.get(row.id)?.description ?? null,
        subject: summaries.get(row.id)?.subject ?? null,
        requestedBy: {
          userAccountId: row.requester.userAccountId,
          username: row.requester.username,
          role: row.requester.role,
          fullName: fullName(row.requester),
        },
        requestedAt: row.requestedAt.toISOString(),
        resolvedBy:
          row.resolver?.userAccountId != null && row.resolver.username && row.resolver.role
            ? {
                userAccountId: row.resolver.userAccountId,
                username: row.resolver.username,
                role: row.resolver.role,
                fullName: fullName(row.resolver),
              }
            : null,
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        resolutionReason: row.resolutionReason,
      }),
    );
  }

  return {
    /** The president sees every approval; any other role only the ones it requested. */
    async list(account: AuthenticatedAccount, query: ApprovalListQuery) {
      const rows = await listApprovals(db, {
        status: query.status,
        requestedBy: account.role === 'president' ? null : account.userAccountId,
      });
      return { approvals: await toApprovals(db, rows) };
    },

    /**
     * One approval with its subject (R-03). The president sees any; anyone else only the ones
     * they requested: another's answers NOT_FOUND, so it does not reveal that it exists.
     */
    async get(account: AuthenticatedAccount, id: number) {
      const row = await findApproval(db, id);
      if (!row) throw approvalErrors.notFound();
      if (account.role !== 'president' && row.requester.userAccountId !== account.userAccountId) {
        throw approvalErrors.notFound();
      }
      const [approval] = await toApprovals(db, [row]);
      if (!approval) throw errors.internal();
      return { approval };
    },

    async resolve(actor: Actor, id: number, input: ResolveApprovalRequest) {
      const now = deps.now();
      const today = businessDate(now, deps.timeZone);
      const reason = input.reason ?? null;
      return db.transaction(async (tx) => {
        const current = await lockApproval(tx, id);
        if (!current) throw approvalErrors.notFound();
        if (current.result !== null) throw approvalErrors.alreadyResolved(current.result);
        // Fails before any change when the type's module is not implemented yet.
        const handler = registry.get(current.type);

        await recordResolution(tx, id, {
          result: input.result,
          resolvedBy: actor.userAccountId,
          resolvedAt: now,
          resolutionReason: reason,
        });
        const resolution = { tx, approvalId: id, actor, now, today, reason };
        if (input.result === 'approved') await handler.onApproved(resolution);
        else await handler.onRejected(resolution);

        await writeAudit(tx, actor, {
          action: input.result === 'approved' ? 'approve' : 'reject',
          table: 'approval',
          recordId: id,
          before: { result: null },
          after: { type: current.type, result: input.result, resolutionReason: reason },
          reason,
        });

        const row = await findApproval(tx, id);
        if (!row) throw errors.internal();
        const [approval] = await toApprovals(tx, [row]);
        return { approval: approval as Approval };
      });
    },
  };
}

export type ApprovalsService = ReturnType<typeof createApprovalsService>;
