import { eq } from 'drizzle-orm';
import { describe, it } from 'vitest';
import type { Transaction } from '../../../src/db/client.js';
import {
  agreement,
  connection,
  connectionRequest,
  extraCharge,
  fee,
  feeAmount,
  rate,
  unit,
} from '../../../src/db/schema/index.js';
import { bootstrap, one, testDatabaseUrl, useTestDb } from './helpers.js';

// Verifies the constraints of the "rates and fees" block (3.1, block 3).

describe.skipIf(!testDatabaseUrl)('rates and fees schema', () => {
  const { rollback, expectViolation } = useTestDb();

  /**
   * Block 1 and 2 data (agreement, connection request, connection, unit) plus an opening
   * fee and a repair fee, both priced from 2026-01-01.
   */
  async function setup(tx: Transaction) {
    const base = await bootstrap(tx);
    const { sa, m01 } = base;
    const approvedAgreement = one(
      await tx
        .insert(agreement)
        .values({
          meetingDate: '2026-02-01',
          topic: 'Tarifas',
          result: 'approved_by_majority',
          createdBy: sa.id,
        })
        .returning(),
    );
    const applicant = await base.newPerson('Ana', 'López');
    const request = one(
      await tx
        .insert(connectionRequest)
        .values({
          applicantId: applicant.id,
          address: 'Calle 2 #5',
          blockId: m01.id,
          requestedOn: '2026-02-01',
          agreementId: approvedAgreement.id,
          createdBy: sa.id,
        })
        .returning(),
    );
    const conn = one(
      await tx
        .insert(connection)
        .values({ address: 'Calle 1 #10', activatedOn: '2026-01-15', createdBy: sa.id })
        .returning(),
    );
    const unit1 = one(
      await tx
        .insert(unit)
        .values({ connectionId: conn.id, registeredOn: '2026-01-15', createdBy: sa.id })
        .returning(),
    );
    const newFee = async (type: 'opening' | 'repair', name: string) =>
      one(await tx.insert(fee).values({ type, name, createdBy: sa.id }).returning());
    const opening = await newFee('opening', 'Apertura de toma');
    const repair = await newFee('repair', 'Reparación a usuario');
    await tx.insert(feeAmount).values([
      { feeId: opening.id, effectiveFrom: '2026-01-01', amount: 150_000, createdBy: sa.id },
      { feeId: repair.id, effectiveFrom: '2026-01-01', amount: 30_000, createdBy: sa.id },
    ]);
    const rateValues = async (overrides: Partial<typeof rate.$inferInsert> = {}) => {
      const { id: approvalId } = await base.newApproval('rate');
      return {
        effectivePeriod: '2026-03-01',
        amount: 10_000,
        approvedOn: '2026-02-01',
        agreementId: approvedAgreement.id,
        approvalId,
        createdBy: sa.id,
        ...overrides,
      };
    };
    return { ...base, approvedAgreement, request, conn, unit1, opening, repair, rateValues };
  }

  describe('3.1 minimum tests', () => {
    it('rejects an extra charge with more than one target', () =>
      rollback(async (tx) => {
        const { sa, repair, conn, unit1 } = await setup(tx);
        await expectViolation(tx, 'extra_charge_single_target', (sp) =>
          sp.insert(extraCharge).values({
            feeId: repair.id,
            connectionId: conn.id,
            unitId: unit1.id,
            chargedOn: '2026-03-10',
            createdBy: sa.id,
          }),
        );
      }));

    it('rejects an extra charge without a target', () =>
      rollback(async (tx) => {
        const { sa, repair } = await setup(tx);
        await expectViolation(tx, 'extra_charge_single_target', (sp) =>
          sp
            .insert(extraCharge)
            .values({ feeId: repair.id, chargedOn: '2026-03-10', createdBy: sa.id }),
        );
      }));

    it('rejects two current openings for the same request', () =>
      rollback(async (tx) => {
        const { sa, opening, request } = await setup(tx);
        const values = {
          feeId: opening.id,
          connectionRequestId: request.id,
          chargedOn: '2026-02-02',
          createdBy: sa.id,
        };
        const first = one(await tx.insert(extraCharge).values(values).returning());
        await expectViolation(tx, 'extra_charge_request_current_uq', (sp) =>
          sp.insert(extraCharge).values(values),
        );
        // Once the first one is cancelled, a new opening can be charged.
        await tx
          .update(extraCharge)
          .set({ cancelledOn: '2026-02-20' })
          .where(eq(extraCharge.id, first.id));
        await tx.insert(extraCharge).values({ ...values, chargedOn: '2026-02-21' });
      }));

    it('rejects a rate with amount 0', () =>
      rollback(async (tx) => {
        const { rateValues } = await setup(tx);
        const values = await rateValues({ amount: 0 });
        await expectViolation(tx, 'rate_amount_positive', (sp) => sp.insert(rate).values(values));
      }));
  });

  describe('rate', () => {
    it('accepts a valid rate', () =>
      rollback(async (tx) => {
        const { rateValues } = await setup(tx);
        await tx.insert(rate).values(await rateValues());
      }));

    it('rejects an effective period that is not day 1', () =>
      rollback(async (tx) => {
        const { rateValues } = await setup(tx);
        const values = await rateValues({ effectivePeriod: '2026-03-15' });
        await expectViolation(tx, 'rate_effective_period_first_of_month', (sp) =>
          sp.insert(rate).values(values),
        );
      }));

    it('rejects a negative amount', () =>
      rollback(async (tx) => {
        const { rateValues } = await setup(tx);
        const values = await rateValues({ amount: -100 });
        await expectViolation(tx, 'rate_amount_positive', (sp) => sp.insert(rate).values(values));
      }));

    it('rejects two rates for the same approval', () =>
      rollback(async (tx) => {
        const { rateValues } = await setup(tx);
        const values = await rateValues();
        await tx.insert(rate).values(values);
        await expectViolation(tx, 'rate_approval_id_unique', (sp) =>
          sp.insert(rate).values({ ...values, effectivePeriod: '2026-04-01' }),
        );
      }));
  });

  describe('fee and fee_amount', () => {
    it('rejects a repeated fee name', () =>
      rollback(async (tx) => {
        const { sa } = await setup(tx);
        await expectViolation(tx, 'fee_name_unique', (sp) =>
          sp.insert(fee).values({ type: 'other', name: 'Apertura de toma', createdBy: sa.id }),
        );
      }));

    it('rejects a blank fee name', () =>
      rollback(async (tx) => {
        const { sa } = await setup(tx);
        await expectViolation(tx, 'fee_name_not_blank', (sp) =>
          sp.insert(fee).values({ type: 'other', name: '  ', createdBy: sa.id }),
        );
      }));

    it('rejects two amounts for a fee on the same date', () =>
      rollback(async (tx) => {
        const { sa, repair } = await setup(tx);
        await expectViolation(tx, 'fee_amount_pk', (sp) =>
          sp.insert(feeAmount).values({
            feeId: repair.id,
            effectiveFrom: '2026-01-01',
            amount: 40_000,
            createdBy: sa.id,
          }),
        );
      }));

    it('rejects a fee amount of 0', () =>
      rollback(async (tx) => {
        const { sa, repair } = await setup(tx);
        await expectViolation(tx, 'fee_amount_amount_positive', (sp) =>
          sp.insert(feeAmount).values({
            feeId: repair.id,
            effectiveFrom: '2026-06-01',
            amount: 0,
            createdBy: sa.id,
          }),
        );
      }));

    it('rejects changing the type of a fee that has charges', () =>
      rollback(async (tx) => {
        const { sa, repair, unit1 } = await setup(tx);
        await tx.insert(extraCharge).values({
          feeId: repair.id,
          unitId: unit1.id,
          chargedOn: '2026-03-10',
          createdBy: sa.id,
        });
        await expectViolation(tx, 'fee_type_locked', (sp) =>
          sp.update(fee).set({ type: 'other' }).where(eq(fee.id, repair.id)),
        );
      }));
  });

  describe('extra_charge', () => {
    it('accepts charges to a connection and to a unit', () =>
      rollback(async (tx) => {
        const { sa, repair, conn, unit1 } = await setup(tx);
        await tx.insert(extraCharge).values([
          { feeId: repair.id, connectionId: conn.id, chargedOn: '2026-03-10', createdBy: sa.id },
          { feeId: repair.id, unitId: unit1.id, chargedOn: '2026-03-10', createdBy: sa.id },
        ]);
      }));

    it('rejects a charge with no fee amount in force on charged_on', () =>
      rollback(async (tx) => {
        const { sa, repair, unit1 } = await setup(tx);
        await expectViolation(tx, 'extra_charge_amount_in_force', (sp) =>
          sp.insert(extraCharge).values({
            feeId: repair.id,
            unitId: unit1.id,
            chargedOn: '2025-12-31',
            createdBy: sa.id,
          }),
        );
      }));

    it('rejects an opening charged to a unit', () =>
      rollback(async (tx) => {
        const { sa, opening, unit1 } = await setup(tx);
        await expectViolation(tx, 'extra_charge_opening_target', (sp) =>
          sp.insert(extraCharge).values({
            feeId: opening.id,
            unitId: unit1.id,
            chargedOn: '2026-03-10',
            createdBy: sa.id,
          }),
        );
      }));

    it('rejects a non-opening fee charged to a connection request', () =>
      rollback(async (tx) => {
        const { sa, repair, request } = await setup(tx);
        await expectViolation(tx, 'extra_charge_opening_target', (sp) =>
          sp.insert(extraCharge).values({
            feeId: repair.id,
            connectionRequestId: request.id,
            chargedOn: '2026-03-10',
            createdBy: sa.id,
          }),
        );
      }));

    it('rejects a cancellation before the charge date', () =>
      rollback(async (tx) => {
        const { sa, repair, unit1 } = await setup(tx);
        await expectViolation(tx, 'extra_charge_cancelled_after_charge', (sp) =>
          sp.insert(extraCharge).values({
            feeId: repair.id,
            unitId: unit1.id,
            chargedOn: '2026-03-10',
            cancelledOn: '2026-03-09',
            createdBy: sa.id,
          }),
        );
      }));
  });
});
