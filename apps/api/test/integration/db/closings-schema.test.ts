import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../../src/db/client.js';
import {
  adjustment,
  auditLog,
  cashbox,
  closing,
  handover,
  idempotencyKey,
} from '../../../src/db/schema/index.js';
import { bootstrap, folioPattern, one, testDatabaseUrl, useTestDb } from './helpers.js';

// Verifies the constraints of the "closings and control" block (3.1, block 6).

/**
 * Block 1-5 data (block cashboxes for M01 and M02, a confirmed handover with a shortfall from
 * M01) plus factories for closings and adjustments.
 */
async function fixture(tx: Transaction) {
  const base = await bootstrap(tx);
  const { sa, m01, m02 } = base;
  const newBlockBox = async (blockId: number) =>
    one(await tx.insert(cashbox).values({ type: 'block', blockId, createdBy: sa.id }).returning());
  const box1 = await newBlockBox(m01.id);
  const box2 = await newBlockBox(m02.id);
  const shortHandover = one(
    await tx
      .insert(handover)
      .values({
        sourceCashboxId: box1.id,
        declaredAmount: 100_000,
        date: '2026-03-31',
        receivedAmount: 90_000,
        confirmedAt: new Date('2026-04-01T16:00:00Z'),
        confirmedBy: sa.id,
        createdBy: sa.id,
      })
      .returning(),
  );

  const closingValues = (values: Partial<typeof closing.$inferInsert> = {}) => ({
    cashboxId: box1.id,
    type: 'monthly' as const,
    dateFrom: '2026-03-01',
    dateTo: '2026-03-31',
    createdBy: sa.id,
    ...values,
  });
  const newClosing = async (values: Partial<typeof closing.$inferInsert> = {}) =>
    one(await tx.insert(closing).values(closingValues(values)).returning());

  /** Inserts an adjustment with a new 'adjustment' approval. */
  const adjust = async (sp: Transaction, values: Partial<typeof adjustment.$inferInsert>) => {
    const { id: approvalId } = await base.newApproval('adjustment');
    return sp.insert(adjustment).values({
      cashboxId: box1.id,
      amount: -10_000,
      date: '2026-04-02',
      approvalId,
      createdBy: sa.id,
      ...values,
    });
  };

  return { ...base, box1, box2, shortHandover, closingValues, newClosing, adjust };
}

const reviewedAt = new Date('2026-04-03T17:00:00Z');
const closedAt = new Date('2026-04-04T17:00:00Z');

describe.skipIf(!testDatabaseUrl)('closings and control schema', () => {
  const { rollback, expectViolation } = useTestDb();

  describe('3.1 minimum tests', () => {
    it('rejects two monthly closings of the same cashbox and month', () =>
      rollback(async (tx) => {
        const { newClosing, closingValues } = await fixture(tx);
        await newClosing();
        await expectViolation(tx, 'closing_monthly_uq', (sp) =>
          sp.insert(closing).values(closingValues()),
        );
      }));

    it('rejects an adjustment linked to a handover and a closing at the same time', () =>
      rollback(async (tx) => {
        const { newClosing, shortHandover, adjust } = await fixture(tx);
        const march = await newClosing();
        await expectViolation(tx, 'adjustment_single_origin', (sp) =>
          adjust(sp, { handoverId: shortHandover.id, closingId: march.id }),
        );
        await expectViolation(tx, 'adjustment_single_origin', (sp) => adjust(sp, {}));
      }));
  });

  describe('closing', () => {
    it('generates a CO- folio and accepts monthly closings of other months and cashboxes', () =>
      rollback(async (tx) => {
        const { box2, newClosing } = await fixture(tx);
        const march = await newClosing();
        await newClosing({ dateFrom: '2026-02-01', dateTo: '2026-02-28' });
        await newClosing({ cashboxId: box2.id });
        // Leap year: February 2028 ends on the 29th.
        await newClosing({ dateFrom: '2028-02-01', dateTo: '2028-02-29' });
        expect(march.folio).toMatch(folioPattern('CO'));
      }));

    it('accepts extraordinary closings over any range, even overlapping a monthly one', () =>
      rollback(async (tx) => {
        const { newClosing } = await fixture(tx);
        await newClosing();
        await newClosing({ type: 'extraordinary', dateFrom: '2026-03-01', dateTo: '2026-03-14' });
        await newClosing({ type: 'extraordinary', dateFrom: '2026-03-01', dateTo: '2026-03-14' });
        await newClosing({ type: 'extraordinary', dateFrom: '2026-03-15', dateTo: '2026-03-15' });
      }));

    it('rejects a date range that ends before it starts', () =>
      rollback(async (tx) => {
        const { closingValues } = await fixture(tx);
        await expectViolation(tx, 'closing_date_range', (sp) =>
          sp.insert(closing).values(
            closingValues({
              type: 'extraordinary',
              dateFrom: '2026-03-10',
              dateTo: '2026-03-09',
            }),
          ),
        );
      }));

    it('rejects a monthly closing that is not a whole calendar month', () =>
      rollback(async (tx) => {
        const { closingValues } = await fixture(tx);
        const ranges = [
          { dateFrom: '2026-03-02', dateTo: '2026-03-31' },
          { dateFrom: '2026-03-01', dateTo: '2026-03-30' },
          { dateFrom: '2026-03-01', dateTo: '2026-04-30' },
          // Leap year: February 2028 does not end on the 28th.
          { dateFrom: '2028-02-01', dateTo: '2028-02-28' },
        ];
        for (const range of ranges) {
          await expectViolation(tx, 'closing_monthly_whole_month', (sp) =>
            sp.insert(closing).values(closingValues(range)),
          );
        }
      }));

    it('accepts a counted, reviewed and closed closing', () =>
      rollback(async (tx) => {
        const { sa, newClosing } = await fixture(tx);
        const row = await newClosing({
          countedCash: 0,
          reviewedBy: sa.id,
          reviewedAt,
          closedBy: sa.id,
          closedAt,
        });
        expect(row.closedAt).toEqual(closedAt);
      }));

    it('rejects closing without review and reviewing without a count', () =>
      rollback(async (tx) => {
        const { sa, closingValues } = await fixture(tx);
        await expectViolation(tx, 'closing_closed_after_review', (sp) =>
          sp
            .insert(closing)
            .values(closingValues({ countedCash: 50_000, closedBy: sa.id, closedAt })),
        );
        await expectViolation(tx, 'closing_reviewed_after_count', (sp) =>
          sp.insert(closing).values(closingValues({ reviewedBy: sa.id, reviewedAt })),
        );
      }));

    it('rejects incomplete review or close data and a negative count', () =>
      rollback(async (tx) => {
        const { sa, closingValues } = await fixture(tx);
        const counted = { countedCash: 50_000 };
        await expectViolation(tx, 'closing_review_complete', (sp) =>
          sp.insert(closing).values(closingValues({ ...counted, reviewedAt })),
        );
        await expectViolation(tx, 'closing_close_complete', (sp) =>
          sp
            .insert(closing)
            .values(closingValues({ ...counted, reviewedBy: sa.id, reviewedAt, closedBy: sa.id })),
        );
        await expectViolation(tx, 'closing_counted_cash_not_negative', (sp) =>
          sp.insert(closing).values(closingValues({ countedCash: -1 })),
        );
      }));
  });

  describe('adjustment', () => {
    it('accepts signed adjustments for a handover and for a closing', () =>
      rollback(async (tx) => {
        const { shortHandover, newClosing, adjust } = await fixture(tx);
        const march = await newClosing();
        await adjust(tx, { handoverId: shortHandover.id, amount: -10_000 });
        await adjust(tx, { closingId: march.id, amount: 2_500 });
      }));

    it('rejects an adjustment on a cashbox other than the handover or closing cashbox', () =>
      rollback(async (tx) => {
        const { box2, shortHandover, newClosing, adjust } = await fixture(tx);
        const march = await newClosing();
        await expectViolation(tx, 'adjustment_handover_cashbox_fk', (sp) =>
          adjust(sp, { cashboxId: box2.id, handoverId: shortHandover.id }),
        );
        await expectViolation(tx, 'adjustment_closing_cashbox_fk', (sp) =>
          adjust(sp, { cashboxId: box2.id, closingId: march.id }),
        );
      }));

    it('rejects an amount of 0 and a reused approval', () =>
      rollback(async (tx) => {
        const { sa, box1, shortHandover, adjust, newApproval } = await fixture(tx);
        await expectViolation(tx, 'adjustment_amount_not_zero', (sp) =>
          adjust(sp, { handoverId: shortHandover.id, amount: 0 }),
        );
        const { id: approvalId } = await newApproval('adjustment');
        const values = {
          cashboxId: box1.id,
          handoverId: shortHandover.id,
          amount: -10_000,
          date: '2026-04-02',
          approvalId,
          createdBy: sa.id,
        };
        await tx.insert(adjustment).values(values);
        await expectViolation(tx, 'adjustment_approval_id_unique', (sp) =>
          sp.insert(adjustment).values(values),
        );
      }));
  });

  describe('audit_log and idempotency_key', () => {
    it('stores an audit entry with the row before and after', () =>
      rollback(async (tx) => {
        const { sa, shortHandover } = await fixture(tx);
        const entry = one(
          await tx
            .insert(auditLog)
            .values({
              userAccountId: sa.id,
              role: 'superadmin',
              action: 'confirm',
              tableName: 'handover',
              recordId: shortHandover.id,
              before: { receivedAmount: null },
              after: { receivedAmount: 90_000 },
              isTechnical: true,
            })
            .returning(),
        );
        expect(entry.after).toEqual({ receivedAmount: 90_000 });
        expect(entry.createdAt).toBeInstanceOf(Date);
      }));

    it('rejects a blank action', () =>
      rollback(async (tx) => {
        const { sa } = await fixture(tx);
        await expectViolation(tx, 'audit_log_action_not_blank', (sp) =>
          sp.insert(auditLog).values({
            userAccountId: sa.id,
            role: 'superadmin',
            action: ' ',
            tableName: 'handover',
            recordId: 1,
          }),
        );
      }));

    it('rejects a repeated idempotency key', () =>
      rollback(async (tx) => {
        const { sa } = await fixture(tx);
        const values = {
          key: randomUUID(),
          userAccountId: sa.id,
          route: 'POST /v1/payments',
          response: { status: 201, body: { id: 1 } },
        };
        await tx.insert(idempotencyKey).values(values);
        await expectViolation(tx, 'idempotency_key_pkey', (sp) =>
          sp.insert(idempotencyKey).values(values),
        );
      }));
  });
});
