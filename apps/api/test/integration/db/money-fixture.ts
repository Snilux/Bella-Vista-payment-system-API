import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../src/db/client.js';
import {
  agreement,
  cashbox,
  closing,
  connection,
  connectionBlock,
  coveredPeriod,
  payment,
  paymentMonth,
  rate,
  unit,
  unitHolder,
} from '../../../src/db/schema/index.js';
import { bootstrap, one } from './helpers.js';

// Shared data for the block 7 tests (views, triggers and permissions): blocks 1-6 rows a
// payment needs, with known amounts. Rate: $50.00 (5,000 cents) from 2026-01.

export const RATE = 5_000;

/** A timestamp at 12:00 in Mexico City (18:00 UTC) on `day` (YYYY-MM-DD). */
export const noonMx = (day: string) => new Date(`${day}T18:00:00Z`);

export async function moneyFixture(tx: Transaction) {
  const base = await bootstrap(tx);
  const { sa, m01, newPerson, newApproval, assign, resolve } = base;

  const approvedAgreement = one(
    await tx
      .insert(agreement)
      .values({
        meetingDate: '2025-12-01',
        topic: 'Acuerdos de prueba',
        result: 'approved_by_majority',
        createdBy: sa.id,
      })
      .returning(),
  );

  const newRate = async (effectivePeriod: string, amount = RATE) => {
    const { id: approvalId } = await newApproval('rate');
    return one(
      await tx
        .insert(rate)
        .values({
          effectivePeriod,
          amount,
          approvedOn: '2025-12-01',
          agreementId: approvedAgreement.id,
          approvalId,
          createdBy: sa.id,
        })
        .returning(),
    );
  };
  const rate2026 = await newRate('2026-01-01');
  await resolve(rate2026.approvalId);

  // Block leader of M01, approved: custodian of the M01 cashbox.
  const leader = await newPerson('Laura', 'Jefa');
  const leaderAssignment = await assign({
    personId: leader.id,
    role: 'block_leader',
    blockId: m01.id,
    contactPhone: '5550001111',
  });
  if (leaderAssignment.approvalId === null) throw new Error('leader approval missing');
  await resolve(leaderAssignment.approvalId);

  const conn = one(
    await tx
      .insert(connection)
      .values({ address: 'Calle 1 #10', activatedOn: '2026-01-01', createdBy: sa.id })
      .returning(),
  );
  await tx
    .insert(connectionBlock)
    .values({ connectionId: conn.id, blockId: m01.id, validFrom: '2026-01-01', createdBy: sa.id });
  const unit1 = one(
    await tx
      .insert(unit)
      .values({
        connectionId: conn.id,
        registeredOn: '2026-01-01',
        activatedOn: '2026-01-01',
        billingStartPeriod: '2026-01-01',
        createdBy: sa.id,
      })
      .returning(),
  );
  const holder = await newPerson('Hugo', 'Titular');
  await tx
    .insert(unitHolder)
    .values({ unitId: unit1.id, personId: holder.id, validFrom: '2026-01-01', createdBy: sa.id });

  const blockBox = one(
    await tx
      .insert(cashbox)
      .values({ type: 'block', blockId: m01.id, createdBy: sa.id })
      .returning(),
  );
  const committeeBox = one(
    await tx.insert(cashbox).values({ type: 'committee', createdBy: sa.id }).returning(),
  );

  const newPayment = async (
    values: { occurredAt?: Date; cashboxId?: number; unitId?: number | null } = {},
  ) =>
    one(
      await tx
        .insert(payment)
        .values({
          unitId: values.unitId === undefined ? unit1.id : values.unitId,
          cashboxId: values.cashboxId ?? blockBox.id,
          occurredAt: values.occurredAt ?? noonMx('2026-03-05'),
          idempotencyKey: randomUUID(),
          createdBy: sa.id,
        })
        .returning(),
    );
  const addMonth = (paymentId: number, period: string, withSurcharge = false) =>
    tx
      .insert(paymentMonth)
      .values({ paymentId, period, rateId: rate2026.id, withSurcharge, createdBy: sa.id });
  const cover = (paymentId: number, period: string) =>
    tx.insert(coveredPeriod).values({ paymentId, period, unitId: unit1.id, createdBy: sa.id });

  /** A monthly closing of `month` (YYYY-MM) for a cashbox, optionally counted and closed. */
  const monthlyClosing = async (
    cashboxId: number,
    month: string,
    values: { countedCash?: number; closed?: boolean } = {},
  ) => {
    const from = `${month}-01`;
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
    const to = last.toISOString().slice(0, 10);
    const reviewed = values.closed ? { reviewedBy: sa.id, reviewedAt: noonMx(to) } : {};
    const closed = values.closed ? { closedBy: sa.id, closedAt: noonMx(to) } : {};
    return one(
      await tx
        .insert(closing)
        .values({
          cashboxId,
          type: 'monthly',
          dateFrom: from,
          dateTo: to,
          countedCash: values.countedCash ?? (values.closed ? 0 : undefined),
          ...reviewed,
          ...closed,
          createdBy: sa.id,
        })
        .returning(),
    );
  };

  return {
    ...base,
    approvedAgreement,
    newRate,
    rate2026,
    leader,
    conn,
    unit1,
    holder,
    blockBox,
    committeeBox,
    newPayment,
    addMonth,
    cover,
    monthlyClosing,
  };
}
