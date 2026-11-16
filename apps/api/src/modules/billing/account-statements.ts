import {
  type AccountStatement,
  type AccountStatementInput,
  computeAccountStatement,
  type DebtSummary,
} from '@bella-vista/shared';
import type { Database, Transaction } from '../../db/client.js';
import { dateToPeriod, periodOf } from '../../lib/periods.js';
import {
  approvedRates,
  coveredMonthsFor,
  suspensionsFor,
  unitsForStatement,
} from './billing.repository.js';

// Bridge between the database and the pure account statement (packages/shared): the
// repository loads, the domain function computes. Used by the account statement endpoint and
// by the person, connection and search results (debt summary).

type Executor = Database | Transaction;

export interface LoadedStatement {
  unitId: number;
  blockId: number | null;
  input: AccountStatementInput;
  statement: AccountStatement;
}

/** Statements of many units at once (four queries in total). */
export async function loadAccountStatements(
  db: Executor,
  unitIds: number[],
  now: Date,
  timeZone: string,
): Promise<Map<number, LoadedStatement>> {
  const ids = [...new Set(unitIds)];
  const result = new Map<number, LoadedStatement>();
  if (ids.length === 0) return result;

  const units = await unitsForStatement(db, ids);
  const connectionIds = [...new Set(units.map((u) => u.connectionId))];
  const [rates, suspensions, covered] = await Promise.all([
    approvedRates(db),
    suspensionsFor(db, ids, connectionIds),
    coveredMonthsFor(db, ids),
  ]);
  const rateInputs = rates.map((r) => ({
    id: r.id,
    effectivePeriod: dateToPeriod(r.effectivePeriod),
    amount: r.amount,
  }));

  for (const u of units) {
    const input: AccountStatementInput = {
      now,
      timeZone,
      billingStartPeriod: u.billingStartPeriod ? dateToPeriod(u.billingStartPeriod) : null,
      // The deactivation month is billed in full; nothing after it.
      lastBillablePeriod: u.deactivatedOn ? periodOf(u.deactivatedOn) : null,
      rates: rateInputs,
      suspensions: suspensions
        .filter((s) => s.unitId === u.id || s.connectionId === u.connectionId)
        .map((s) => ({
          from: dateToPeriod(s.periodFrom),
          to: s.periodTo ? dateToPeriod(s.periodTo) : null,
        })),
      coveredMonths: covered
        .filter((c) => c.unitId === u.id)
        .map((c) => ({
          period: dateToPeriod(c.period),
          paymentId: c.paymentId,
          paidAt: c.paidAt,
          rateId: c.rateId,
          baseAmount: c.baseAmount,
          withSurcharge: c.withSurcharge,
        })),
    };
    result.set(u.id, {
      unitId: u.id,
      blockId: u.blockId,
      input,
      statement: computeAccountStatement(input),
    });
  }
  return result;
}

export const NO_DEBT: DebtSummary = { totalDue: 0, overdueCount: 0, inDebtCycle: false };

/** Debt summary of each unit (units without statement owe nothing). */
export async function loadDebts(
  db: Executor,
  unitIds: number[],
  now: Date,
  timeZone: string,
): Promise<Map<number, DebtSummary>> {
  const statements = await loadAccountStatements(db, unitIds, now, timeZone);
  return new Map(
    [...statements].map(([id, { statement }]) => [
      id,
      {
        totalDue: statement.summary.totalDue,
        overdueCount: statement.summary.overdueCount,
        inDebtCycle: statement.summary.inDebtCycle,
      },
    ]),
  );
}
