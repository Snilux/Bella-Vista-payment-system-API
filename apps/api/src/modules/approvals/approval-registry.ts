import type { ApprovalSubject, ApprovalType } from '@bella-vista/shared';
import type { Actor } from '../../db/audit.js';
import type { Database, Transaction } from '../../db/client.js';

// Registry of approval handlers (transversal "autorizaciones" module). Each module that
// creates approvals of a type registers what happens when the president approves or rejects
// one, and how the inbox describes it. The approvals module only locks, records the
// resolution and calls the handler inside the same transaction.

export interface ApprovalResolution {
  tx: Transaction;
  approvalId: number;
  /** The president resolving it. */
  actor: Actor;
  now: Date;
  /** Business date of `now` (YYYY-MM-DD). */
  today: string;
  /** Resolution reason (mandatory when rejecting). */
  reason: string | null;
}

/** How the inbox shows an approval: its text and the record it is about (R-03 opens it). */
export interface ApprovalSummary {
  description: string;
  subject: ApprovalSubject;
}

export interface ApprovalHandler {
  /** Runs after the approval is marked approved, in the same transaction. */
  onApproved(resolution: ApprovalResolution): Promise<void>;
  /** Runs after the approval is marked rejected, in the same transaction. */
  onRejected(resolution: ApprovalResolution): Promise<void>;
  /** Text and record of each approval id of this type (missing ids show neither). */
  describe(
    db: Database | Transaction,
    approvalIds: number[],
  ): Promise<Map<number, ApprovalSummary>>;
}

export class ApprovalHandlerError extends Error {
  override name = 'ApprovalHandlerError';
}

export function createApprovalRegistry() {
  const handlers = new Map<ApprovalType, ApprovalHandler>();
  return {
    /** Registers the handler of `type`; a type has exactly one handler. */
    register(type: ApprovalType, handler: ApprovalHandler): void {
      if (handlers.has(type)) {
        throw new ApprovalHandlerError(`approval type ${type} already has a handler`);
      }
      handlers.set(type, handler);
    },
    /**
     * Swaps the handler of `type` (null removes it). Only for tests, which need a handler of
     * their own or a type without handler now that every module registers one.
     */
    replace(type: ApprovalType, handler: ApprovalHandler | null): void {
      if (handler) handlers.set(type, handler);
      else handlers.delete(type);
    },
    /** Handler of `type`, or undefined when no module registered it yet. */
    find(type: ApprovalType): ApprovalHandler | undefined {
      return handlers.get(type);
    },
    /** Handler of `type`; throws when missing (a programming error, answered as 500). */
    get(type: ApprovalType): ApprovalHandler {
      const handler = handlers.get(type);
      if (!handler) throw new ApprovalHandlerError(`approval type ${type} has no handler`);
      return handler;
    },
    types(): ApprovalType[] {
      return [...handlers.keys()];
    },
  };
}

export type ApprovalRegistry = ReturnType<typeof createApprovalRegistry>;
