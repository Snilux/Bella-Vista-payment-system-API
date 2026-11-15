import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, type Transaction } from '../../../src/db/client.js';
import {
  agreement,
  cashbox,
  connection,
  coveredPeriod,
  extraCharge,
  fee,
  feeAmount,
  openingBalance,
  paperReceipt,
  payment,
  paymentCancellation,
  paymentCharge,
  paymentMonth,
  rate,
  unit,
} from '../../../src/db/schema/index.js';
import {
  bootstrap,
  folioPattern,
  migrateDatabase,
  one,
  pgError,
  testDatabaseUrl,
  useTestDb,
  withFreshDatabase,
} from './helpers.js';

// Verifies the constraints of the "cashboxes and billing" block (3.1, block 4).

/**
 * Block 1-3 data (agreement, a rate from 2026-01, a connection with two active units, a
 * repair charge) plus a block cashbox for M01 and the committee cashbox, and factories for
 * payments, months and covered periods.
 */
async function fixture(tx: Transaction) {
  const base = await bootstrap(tx);
  const { sa, m01 } = base;
  const approvedAgreement = one(
    await tx
      .insert(agreement)
      .values({
        meetingDate: '2025-12-01',
        topic: 'Tarifa',
        result: 'approved_by_majority',
        createdBy: sa.id,
      })
      .returning(),
  );
  const newRate = async (effectivePeriod: string) => {
    const { id: approvalId } = await base.newApproval('rate');
    return one(
      await tx
        .insert(rate)
        .values({
          effectivePeriod,
          amount: 5_000,
          approvedOn: '2025-12-01',
          agreementId: approvedAgreement.id,
          approvalId,
          createdBy: sa.id,
        })
        .returning(),
    );
  };
  const rate2026 = await newRate('2026-01-01');
  const conn = one(
    await tx
      .insert(connection)
      .values({ address: 'Calle 1 #10', activatedOn: '2026-01-01', createdBy: sa.id })
      .returning(),
  );
  const newUnit = async () =>
    one(
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
  const unit1 = await newUnit();
  const unit2 = await newUnit();
  const blockBox = one(
    await tx
      .insert(cashbox)
      .values({ type: 'block', blockId: m01.id, createdBy: sa.id })
      .returning(),
  );
  const committeeBox = one(
    await tx.insert(cashbox).values({ type: 'committee', createdBy: sa.id }).returning(),
  );
  const repair = one(
    await tx
      .insert(fee)
      .values({ type: 'repair', name: 'Reparación a usuario', createdBy: sa.id })
      .returning(),
  );
  await tx
    .insert(feeAmount)
    .values({ feeId: repair.id, effectiveFrom: '2026-01-01', amount: 30_000, createdBy: sa.id });
  const repairCharge = one(
    await tx
      .insert(extraCharge)
      .values({ feeId: repair.id, unitId: unit1.id, chargedOn: '2026-03-01', createdBy: sa.id })
      .returning(),
  );

  const newPayment = async (
    values: { unitId?: number | null; cashboxId?: number; idempotencyKey?: string } = {},
  ) =>
    one(
      await tx
        .insert(payment)
        .values({
          unitId: values.unitId === undefined ? unit1.id : values.unitId,
          cashboxId: values.cashboxId ?? blockBox.id,
          occurredAt: new Date('2026-03-05T17:00:00Z'),
          idempotencyKey: values.idempotencyKey ?? randomUUID(),
          createdBy: sa.id,
        })
        .returning(),
    );
  const addMonth = (paymentId: number, period: string, rateId = rate2026.id) =>
    tx
      .insert(paymentMonth)
      .values({ paymentId, period, rateId, withSurcharge: false, createdBy: sa.id });
  const cover = (paymentId: number, period: string, unitId = unit1.id) =>
    tx.insert(coveredPeriod).values({ paymentId, period, unitId, createdBy: sa.id });

  return {
    ...base,
    newRate,
    rate2026,
    unit1,
    unit2,
    blockBox,
    committeeBox,
    repairCharge,
    newPayment,
    addMonth,
    cover,
  };
}

describe.skipIf(!testDatabaseUrl)('cashboxes and billing schema', () => {
  const { rollback, expectViolation } = useTestDb();

  describe('3.1 minimum tests', () => {
    it('rejects the same month paid twice for a unit', () =>
      rollback(async (tx) => {
        const { newPayment, addMonth, cover } = await fixture(tx);
        const first = await newPayment();
        await addMonth(first.id, '2026-03-01');
        await cover(first.id, '2026-03-01');
        const second = await newPayment();
        await addMonth(second.id, '2026-03-01');
        await expectViolation(tx, 'covered_period_pk', () => cover(second.id, '2026-03-01'));
      }));

    it('rejects a repeated paper folio in the same cashbox', () =>
      rollback(async (tx) => {
        const { sa, blockBox, newPayment } = await fixture(tx);
        const receipt = (paymentId: number) => ({
          paymentId,
          cashboxId: blockBox.id,
          paperFolio: '001234',
          type: 'original' as const,
          issuedAt: new Date('2026-03-05T17:00:00Z'),
          createdBy: sa.id,
        });
        const first = await newPayment();
        await tx.insert(paperReceipt).values(receipt(first.id));
        const second = await newPayment();
        await expectViolation(tx, 'paper_receipt_cashbox_folio_unique', (sp) =>
          sp.insert(paperReceipt).values(receipt(second.id)),
        );
      }));

    it('rejects two original receipts for one payment', () =>
      rollback(async (tx) => {
        const { sa, blockBox, newPayment } = await fixture(tx);
        const pay = await newPayment();
        const receipt = (paperFolio: string, type: 'original' | 'replacement') => ({
          paymentId: pay.id,
          cashboxId: blockBox.id,
          paperFolio,
          type,
          issuedAt: new Date('2026-03-05T17:00:00Z'),
          createdBy: sa.id,
        });
        await tx.insert(paperReceipt).values(receipt('001', 'original'));
        // A replacement with a new folio is allowed (D-23).
        await tx.insert(paperReceipt).values(receipt('002', 'replacement'));
        await expectViolation(tx, 'paper_receipt_original_uq', (sp) =>
          sp.insert(paperReceipt).values(receipt('003', 'original')),
        );
      }));

    it('rejects a second committee cashbox', () =>
      rollback(async (tx) => {
        const { sa } = await fixture(tx);
        await expectViolation(tx, 'cashbox_committee_uq', (sp) =>
          sp.insert(cashbox).values({ type: 'committee', createdBy: sa.id }),
        );
      }));

    it('rejects a block cashbox without block', () =>
      rollback(async (tx) => {
        const { sa } = await fixture(tx);
        await expectViolation(tx, 'cashbox_type_target', (sp) =>
          sp.insert(cashbox).values({ type: 'block', createdBy: sa.id }),
        );
      }));

    it('rejects a repeated idempotency key', () =>
      rollback(async (tx) => {
        const { newPayment } = await fixture(tx);
        const idempotencyKey = randomUUID();
        await newPayment({ idempotencyKey });
        await expectViolation(tx, 'payment_idempotency_key_unique', () =>
          newPayment({ idempotencyKey }),
        );
      }));
  });

  describe('cashbox and opening_balance', () => {
    it('accepts one support cashbox per person', () =>
      rollback(async (tx) => {
        const { sa, newPerson } = await fixture(tx);
        const helper = await newPerson();
        await tx
          .insert(cashbox)
          .values({ type: 'support', custodianPersonId: helper.id, createdBy: sa.id });
        await expectViolation(tx, 'cashbox_custodian_person_id_unique', (sp) =>
          sp
            .insert(cashbox)
            .values({ type: 'support', custodianPersonId: helper.id, createdBy: sa.id }),
        );
      }));

    it('rejects a support cashbox without custodian', () =>
      rollback(async (tx) => {
        const { sa } = await fixture(tx);
        await expectViolation(tx, 'cashbox_type_target', (sp) =>
          sp.insert(cashbox).values({ type: 'support', createdBy: sa.id }),
        );
      }));

    it('rejects a committee cashbox with a block', () =>
      rollback(async (tx) => {
        const { sa, m02 } = await fixture(tx);
        await expectViolation(tx, 'cashbox_type_target', (sp) =>
          sp.insert(cashbox).values({ type: 'committee', blockId: m02.id, createdBy: sa.id }),
        );
      }));

    it('rejects a second cashbox for the same block', () =>
      rollback(async (tx) => {
        const { sa, m01 } = await fixture(tx);
        await expectViolation(tx, 'cashbox_block_id_unique', (sp) =>
          sp.insert(cashbox).values({ type: 'block', blockId: m01.id, createdBy: sa.id }),
        );
      }));

    it('rejects an opening balance of 0 and a second one for the same cashbox', () =>
      rollback(async (tx) => {
        const { sa, blockBox, newApproval } = await fixture(tx);
        const values = async (amount: number) => ({
          cashboxId: blockBox.id,
          amount,
          date: '2026-01-01',
          approvalId: (await newApproval('opening_balance')).id,
          createdBy: sa.id,
        });
        const zero = await values(0);
        await expectViolation(tx, 'opening_balance_amount_positive', (sp) =>
          sp.insert(openingBalance).values(zero),
        );
        await tx.insert(openingBalance).values(await values(120_000));
        const second = await values(50_000);
        await expectViolation(tx, 'opening_balance_pkey', (sp) =>
          sp.insert(openingBalance).values(second),
        );
      }));
  });

  describe('payment, payment_month and covered_period', () => {
    it('generates a PG- folio', () =>
      rollback(async (tx) => {
        const { newPayment } = await fixture(tx);
        expect((await newPayment()).folio).toMatch(folioPattern('PG'));
      }));

    it('rejects covering a month for a unit other than the payment unit', () =>
      rollback(async (tx) => {
        const { unit2, newPayment, addMonth, cover } = await fixture(tx);
        const pay = await newPayment();
        await addMonth(pay.id, '2026-03-01');
        await expectViolation(tx, 'covered_period_payment_unit_fk', () =>
          cover(pay.id, '2026-03-01', unit2.id),
        );
      }));

    it('rejects covering a month that is not in the payment', () =>
      rollback(async (tx) => {
        const { newPayment, addMonth, cover } = await fixture(tx);
        const pay = await newPayment();
        await addMonth(pay.id, '2026-03-01');
        await expectViolation(tx, 'covered_period_payment_month_fk', () =>
          cover(pay.id, '2026-04-01'),
        );
      }));

    it('lets another unit pay the same month', () =>
      rollback(async (tx) => {
        const { unit2, newPayment, addMonth, cover } = await fixture(tx);
        const first = await newPayment();
        await addMonth(first.id, '2026-03-01');
        await cover(first.id, '2026-03-01');
        const second = await newPayment({ unitId: unit2.id });
        await addMonth(second.id, '2026-03-01');
        await cover(second.id, '2026-03-01', unit2.id);
      }));

    it('rejects a period that is not day 1', () =>
      rollback(async (tx) => {
        const { newPayment, addMonth } = await fixture(tx);
        const pay = await newPayment();
        await expectViolation(tx, 'payment_month_period_first_of_month', () =>
          addMonth(pay.id, '2026-03-15'),
        );
      }));

    it('rejects months in a payment without unit', () =>
      rollback(async (tx) => {
        const { newPayment, addMonth } = await fixture(tx);
        const pay = await newPayment({ unitId: null });
        await expectViolation(tx, 'payment_month_unit_required', () =>
          addMonth(pay.id, '2026-03-01'),
        );
      }));

    it('rejects a rate that starts after the period', () =>
      rollback(async (tx) => {
        const { newRate, newPayment, addMonth } = await fixture(tx);
        const july = await newRate('2026-07-01');
        const pay = await newPayment();
        await expectViolation(tx, 'payment_month_rate_in_effect', () =>
          addMonth(pay.id, '2026-06-01', july.id),
        );
        // Same rate for its own month (or later) is fine.
        await addMonth(pay.id, '2026-07-01', july.id);
      }));
  });

  describe('payment_charge, paper_receipt and payment_cancellation', () => {
    it('rejects paying the same extra charge twice', () =>
      rollback(async (tx) => {
        const { sa, repairCharge, newPayment } = await fixture(tx);
        const first = await newPayment();
        await tx
          .insert(paymentCharge)
          .values({ paymentId: first.id, extraChargeId: repairCharge.id, createdBy: sa.id });
        const second = await newPayment();
        await expectViolation(tx, 'payment_charge_extra_charge_id_unique', (sp) =>
          sp
            .insert(paymentCharge)
            .values({ paymentId: second.id, extraChargeId: repairCharge.id, createdBy: sa.id }),
        );
      }));

    it('rejects a receipt in a cashbox other than the payment cashbox', () =>
      rollback(async (tx) => {
        const { sa, committeeBox, newPayment } = await fixture(tx);
        const pay = await newPayment();
        await expectViolation(tx, 'paper_receipt_payment_cashbox_fk', (sp) =>
          sp.insert(paperReceipt).values({
            paymentId: pay.id,
            cashboxId: committeeBox.id,
            paperFolio: '001',
            type: 'original',
            issuedAt: new Date('2026-03-05T17:00:00Z'),
            createdBy: sa.id,
          }),
        );
      }));

    it('accepts the same paper folio in another cashbox', () =>
      rollback(async (tx) => {
        const { sa, blockBox, committeeBox, newPayment } = await fixture(tx);
        for (const box of [blockBox, committeeBox]) {
          const pay = await newPayment({ cashboxId: box.id });
          await tx.insert(paperReceipt).values({
            paymentId: pay.id,
            cashboxId: box.id,
            paperFolio: '001234',
            type: 'original',
            issuedAt: new Date('2026-03-05T17:00:00Z'),
            createdBy: sa.id,
          });
        }
      }));

    it('rejects a blank paper folio', () =>
      rollback(async (tx) => {
        const { sa, blockBox, newPayment } = await fixture(tx);
        const pay = await newPayment();
        await expectViolation(tx, 'paper_receipt_folio_not_blank', (sp) =>
          sp.insert(paperReceipt).values({
            paymentId: pay.id,
            cashboxId: blockBox.id,
            paperFolio: ' ',
            type: 'original',
            issuedAt: new Date('2026-03-05T17:00:00Z'),
            createdBy: sa.id,
          }),
        );
      }));

    it('rejects two cancellations with the same approval', () =>
      rollback(async (tx) => {
        const { sa, newPayment, newApproval } = await fixture(tx);
        const pay = await newPayment();
        const { id: approvalId } = await newApproval('payment_cancellation');
        await tx
          .insert(paymentCancellation)
          .values({ paymentId: pay.id, approvalId, createdBy: sa.id });
        await expectViolation(tx, 'payment_cancellation_approval_id_unique', (sp) =>
          sp
            .insert(paymentCancellation)
            .values({ paymentId: pay.id, approvalId, createdBy: sa.id }),
        );
      }));
  });

  describe('concurrency', () => {
    // Runs on its own temporary database because both transactions must really commit.
    it('lets only one of two concurrent payments cover the same month', { timeout: 60_000 }, () =>
      withFreshDatabase(async (url) => {
        await migrateDatabase(url);
        const { db, sql: client } = createDb(url, { max: 3 });
        try {
          const ids = await db.transaction(async (tx) => {
            const f = await fixture(tx);
            return {
              sa: f.sa.id,
              unit: f.unit1.id,
              box: f.blockBox.id,
              rate: f.rate2026.id,
            };
          });

          /** Inserts a payment for March 2026 and covers it, like the billing service. */
          const pay = async (tx: Transaction) => {
            const p = one(
              await tx
                .insert(payment)
                .values({
                  unitId: ids.unit,
                  cashboxId: ids.box,
                  occurredAt: new Date(),
                  idempotencyKey: randomUUID(),
                  createdBy: ids.sa,
                })
                .returning(),
            );
            await tx.insert(paymentMonth).values({
              paymentId: p.id,
              period: '2026-03-01',
              rateId: ids.rate,
              withSurcharge: false,
              createdBy: ids.sa,
            });
            await tx.insert(coveredPeriod).values({
              unitId: ids.unit,
              period: '2026-03-01',
              paymentId: p.id,
              createdBy: ids.sa,
            });
          };

          let markCovered = () => {};
          const aCovered = new Promise<void>((resolve) => {
            markCovered = resolve;
          });
          let release = () => {};
          const aReleased = new Promise<void>((resolve) => {
            release = resolve;
          });

          // A covers the month and holds its transaction open.
          const txA = db.transaction(async (tx) => {
            await pay(tx);
            markCovered();
            await aReleased;
          });
          await aCovered;

          // B tries the same month: it must wait on A's uncommitted key.
          const txB = db
            .transaction((tx) => pay(tx))
            .then(
              () => undefined,
              (error: unknown) => error,
            );
          await waitForLockWait(db);

          release();
          await txA;
          const errorB = await txB;
          expect(errorB, 'second payment must fail').toBeDefined();
          expect(pgError(errorB).code).toBe('23505');
          expect(pgError(errorB).constraint_name).toBe('covered_period_pk');

          const rows = await db.select().from(coveredPeriod);
          expect(rows).toHaveLength(1);
        } finally {
          await client.end();
        }
      }),
    );
  });
});

/** Waits until some backend of the current database is blocked on a lock. */
async function waitForLockWait(db: ReturnType<typeof createDb>['db']): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const [row] = await db.execute<{ waiting: number }>(sql`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`);
    if ((row?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('the second transaction never waited for the first one');
}
