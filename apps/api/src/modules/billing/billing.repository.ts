import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client.js';
import {
  approval,
  coveredPeriod,
  payment,
  paymentMonth,
  rate,
  suspension,
  unit,
  vConnection,
} from '../../db/schema/index.js';

// Data of the account statement, loaded in batch: four queries whatever the number of units
// (no N+1 in lists, details or search).

type Executor = Database | Transaction;

export function unitsForStatement(db: Executor, unitIds: number[]) {
  return db
    .select({
      id: unit.id,
      connectionId: unit.connectionId,
      billingStartPeriod: unit.billingStartPeriod,
      deactivatedOn: unit.deactivatedOn,
      blockId: vConnection.blockId,
    })
    .from(unit)
    .innerJoin(vConnection, eq(vConnection.id, unit.connectionId))
    .where(inArray(unit.id, unitIds));
}

/** Rates approved by the president (D-20); pending or rejected ones never apply. */
export function approvedRates(db: Executor) {
  return db
    .select({ id: rate.id, effectivePeriod: rate.effectivePeriod, amount: rate.amount })
    .from(rate)
    .innerJoin(approval, eq(approval.id, rate.approvalId))
    .where(eq(approval.result, 'approved'));
}

/** Suspensions of the units or of their connections (D-06). */
export function suspensionsFor(db: Executor, unitIds: number[], connectionIds: number[]) {
  return db
    .select({
      unitId: suspension.unitId,
      connectionId: suspension.connectionId,
      periodFrom: suspension.periodFrom,
      periodTo: suspension.periodTo,
    })
    .from(suspension)
    .where(
      or(
        and(isNotNull(suspension.unitId), inArray(suspension.unitId, unitIds)),
        connectionIds.length > 0 ? inArray(suspension.connectionId, connectionIds) : undefined,
      ),
    );
}

/**
 * Months covered today, with the frozen rate and surcharge and the date of their payment. A
 * cancelled payment has no covered rows left, so it never appears.
 */
export function coveredMonthsFor(db: Executor, unitIds: number[]) {
  return db
    .select({
      unitId: coveredPeriod.unitId,
      period: coveredPeriod.period,
      paymentId: coveredPeriod.paymentId,
      paidAt: payment.occurredAt,
      rateId: paymentMonth.rateId,
      baseAmount: rate.amount,
      withSurcharge: paymentMonth.withSurcharge,
    })
    .from(coveredPeriod)
    .innerJoin(payment, eq(payment.id, coveredPeriod.paymentId))
    .innerJoin(
      paymentMonth,
      and(
        eq(paymentMonth.paymentId, coveredPeriod.paymentId),
        eq(paymentMonth.period, coveredPeriod.period),
      ),
    )
    .innerJoin(rate, eq(rate.id, paymentMonth.rateId))
    .where(inArray(coveredPeriod.unitId, unitIds));
}
