import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../../src/db/client.js';
import {
  agreement,
  connection,
  connectionBlock,
  connectionRequest,
  suspension,
  unit,
  unitChangeRequest,
  unitHolder,
} from '../../../src/db/schema/index.js';
import { bootstrap, folioPattern, one, testDatabaseUrl, useTestDb } from './helpers.js';

// Verifies the constraints of the "registry and connections" block (3.1, block 2).

describe.skipIf(!testDatabaseUrl)('registry and connections schema', () => {
  const { rollback, expectViolation } = useTestDb();

  /** Block 1 data plus an agreement, a person, a connection and an active unit. */
  async function setup(tx: Transaction) {
    const base = await bootstrap(tx);
    const { sa, m01 } = base;
    const newAgreement = async (result: 'approved_by_majority' | 'rejected') =>
      one(
        await tx
          .insert(agreement)
          .values({ meetingDate: '2026-02-01', topic: 'Junta', result, createdBy: sa.id })
          .returning(),
      );
    const approved = await newAgreement('approved_by_majority');
    const ana = await base.newPerson('Ana', 'López');
    const conn = one(
      await tx
        .insert(connection)
        .values({ address: 'Calle 1 #10', activatedOn: '2026-01-15', createdBy: sa.id })
        .returning(),
    );
    await tx.insert(connectionBlock).values({
      connectionId: conn.id,
      blockId: m01.id,
      validFrom: '2026-01-15',
      createdBy: sa.id,
    });
    const unit1 = one(
      await tx
        .insert(unit)
        .values({
          connectionId: conn.id,
          registeredOn: '2026-01-15',
          activatedOn: '2026-01-15',
          billingStartPeriod: '2026-01-01',
          createdBy: sa.id,
        })
        .returning(),
    );
    await tx
      .insert(unitHolder)
      .values({ unitId: unit1.id, personId: ana.id, validFrom: '2026-01-15', createdBy: sa.id });
    return { ...base, newAgreement, approved, ana, conn, unit1 };
  }

  describe('3.1 minimum tests', () => {
    it('rejects two current blocks for one connection', () =>
      rollback(async (tx) => {
        const { sa, m02, conn } = await setup(tx);
        await expectViolation(tx, 'connection_block_current_uq', (sp) =>
          sp.insert(connectionBlock).values({
            connectionId: conn.id,
            blockId: m02.id,
            validFrom: '2026-03-01',
            createdBy: sa.id,
          }),
        );
      }));

    it('rejects two current holders for one unit', () =>
      rollback(async (tx) => {
        const { sa, unit1, newPerson } = await setup(tx);
        const beto = await newPerson();
        await expectViolation(tx, 'unit_holder_current_uq', (sp) =>
          sp.insert(unitHolder).values({
            unitId: unit1.id,
            personId: beto.id,
            validFrom: '2026-03-01',
            createdBy: sa.id,
          }),
        );
      }));

    it('rejects a suspension with both a connection and a unit, or with neither', () =>
      rollback(async (tx) => {
        const { sa, conn, unit1, approved } = await setup(tx);
        const base = {
          periodFrom: '2026-03-01',
          reason: 'Fuga',
          agreementId: approved.id,
          createdBy: sa.id,
        };
        await expectViolation(tx, 'suspension_single_target', (sp) =>
          sp.insert(suspension).values({ ...base, connectionId: conn.id, unitId: unit1.id }),
        );
        await expectViolation(tx, 'suspension_single_target', (sp) =>
          sp.insert(suspension).values(base),
        );
        await tx.insert(suspension).values({ ...base, connectionId: conn.id });
        await tx.insert(suspension).values({ ...base, unitId: unit1.id });
      }));

    it('rejects an activated unit without billing_start_period', () =>
      rollback(async (tx) => {
        const { sa, conn } = await setup(tx);
        await expectViolation(tx, 'unit_billing_start_when_active', (sp) =>
          sp.insert(unit).values({
            connectionId: conn.id,
            registeredOn: '2026-02-01',
            activatedOn: '2026-02-01',
            createdBy: sa.id,
          }),
        );
        // Pending activation: no billing start yet.
        await tx
          .insert(unit)
          .values({ connectionId: conn.id, registeredOn: '2026-02-01', createdBy: sa.id });
      }));

    it('rejects periods that are not the first day of a month', () =>
      rollback(async (tx) => {
        const { sa, conn, unit1, approved } = await setup(tx);
        await expectViolation(tx, 'unit_billing_start_first_of_month', (sp) =>
          sp.insert(unit).values({
            connectionId: conn.id,
            registeredOn: '2026-02-01',
            activatedOn: '2026-02-15',
            billingStartPeriod: '2026-02-15',
            createdBy: sa.id,
          }),
        );
        const base = {
          unitId: unit1.id,
          reason: 'Fuga',
          agreementId: approved.id,
          createdBy: sa.id,
        };
        await expectViolation(tx, 'suspension_period_from_first_of_month', (sp) =>
          sp.insert(suspension).values({ ...base, periodFrom: '2026-03-02' }),
        );
        await expectViolation(tx, 'suspension_period_to_first_of_month', (sp) =>
          sp
            .insert(suspension)
            .values({ ...base, periodFrom: '2026-03-01', periodTo: '2026-04-30' }),
        );
        await expectViolation(tx, 'suspension_period_range', (sp) =>
          sp
            .insert(suspension)
            .values({ ...base, periodFrom: '2026-05-01', periodTo: '2026-04-01' }),
        );
      }));
  });

  describe('histories', () => {
    it('accepts a chained block change and rejects overlapping closed periods', () =>
      rollback(async (tx) => {
        const { sa, m01, m02, conn } = await setup(tx);
        // Move the connection to M02 on 2026-03-01: close the current row, open the next one.
        await tx
          .update(connectionBlock)
          .set({ validTo: '2026-03-01' })
          .where(eq(connectionBlock.connectionId, conn.id));
        await tx.insert(connectionBlock).values({
          connectionId: conn.id,
          blockId: m02.id,
          validFrom: '2026-03-01',
          createdBy: sa.id,
        });
        await expectViolation(tx, 'connection_block_no_overlap', (sp) =>
          sp.insert(connectionBlock).values({
            connectionId: conn.id,
            blockId: m01.id,
            validFrom: '2026-02-01',
            validTo: '2026-02-15',
            createdBy: sa.id,
          }),
        );
        await expectViolation(tx, 'connection_block_valid_range', (sp) =>
          sp.insert(connectionBlock).values({
            connectionId: conn.id,
            blockId: m01.id,
            validFrom: '2025-06-01',
            validTo: '2025-06-01',
            createdBy: sa.id,
          }),
        );
      }));

    it('rejects overlapping holders even when both periods are closed (D-11)', () =>
      rollback(async (tx) => {
        const { sa, unit1, ana, newPerson } = await setup(tx);
        const beto = await newPerson();
        await tx
          .update(unitHolder)
          .set({ validTo: '2026-04-01' })
          .where(eq(unitHolder.unitId, unit1.id));
        await tx.insert(unitHolder).values({
          unitId: unit1.id,
          personId: beto.id,
          validFrom: '2026-04-01',
          validTo: '2026-06-01',
          createdBy: sa.id,
        });
        await expectViolation(tx, 'unit_holder_no_overlap', (sp) =>
          sp.insert(unitHolder).values({
            unitId: unit1.id,
            personId: ana.id,
            validFrom: '2026-05-01',
            validTo: '2026-07-01',
            createdBy: sa.id,
          }),
        );
        // Contiguous next holder is fine.
        await tx.insert(unitHolder).values({
          unitId: unit1.id,
          personId: ana.id,
          validFrom: '2026-06-01',
          createdBy: sa.id,
        });
      }));
  });

  describe('connection requests and connections', () => {
    async function newRequest(
      tx: Transaction,
      values: Partial<typeof connectionRequest.$inferInsert> = {},
    ) {
      const { sa, m01, ana } = await setup(tx);
      return {
        sa,
        request: (extra: Partial<typeof connectionRequest.$inferInsert> = {}) => ({
          applicantId: ana.id,
          address: 'Calle 2 #5',
          blockId: m01.id,
          requestedOn: '2026-02-01',
          createdBy: sa.id,
          ...values,
          ...extra,
        }),
      };
    }

    it('assigns ST- folios', () =>
      rollback(async (tx) => {
        const { request } = await newRequest(tx);
        const row = one(await tx.insert(connectionRequest).values(request()).returning());
        expect(row.folio).toMatch(folioPattern('ST'));
      }));

    it('requires a resolution reason when the agreement rejects the request', () =>
      rollback(async (tx) => {
        const { request } = await newRequest(tx);
        const rejected = one(
          await tx
            .insert(agreement)
            .values({
              meetingDate: '2026-02-10',
              topic: 'Toma Calle 2',
              result: 'rejected',
              createdBy: request().createdBy,
            })
            .returning(),
        );
        await expectViolation(tx, 'connection_request_rejection_reason', (sp) =>
          sp.insert(connectionRequest).values(request({ agreementId: rejected.id })),
        );
        await expectViolation(tx, 'connection_request_rejection_reason', (sp) =>
          sp
            .insert(connectionRequest)
            .values(request({ agreementId: rejected.id, resolutionReason: '   ' })),
        );
        // Trigger also runs on UPDATE: link the rejection afterwards without a reason.
        const pending = one(await tx.insert(connectionRequest).values(request()).returning());
        await expectViolation(tx, 'connection_request_rejection_reason', (sp) =>
          sp
            .update(connectionRequest)
            .set({ agreementId: rejected.id })
            .where(eq(connectionRequest.id, pending.id)),
        );
        await tx
          .insert(connectionRequest)
          .values(request({ agreementId: rejected.id, resolutionReason: 'No hay presión' }));
      }));

    it('requires reasons for cancellation and only with an agreement for resolution', () =>
      rollback(async (tx) => {
        const { request } = await newRequest(tx);
        await expectViolation(tx, 'connection_request_cancellation_reason', (sp) =>
          sp.insert(connectionRequest).values(request({ cancelledOn: '2026-03-01' })),
        );
        await expectViolation(tx, 'connection_request_cancellation_reason', (sp) =>
          sp.insert(connectionRequest).values(request({ cancellationReason: 'Retirada' })),
        );
        await expectViolation(tx, 'connection_request_resolution_needs_agreement', (sp) =>
          sp.insert(connectionRequest).values(request({ resolutionReason: 'Sin acuerdo' })),
        );
        await expectViolation(tx, 'connection_request_cancelled_after_request', (sp) =>
          sp
            .insert(connectionRequest)
            .values(request({ cancelledOn: '2026-01-01', cancellationReason: 'Retirada' })),
        );
        await tx
          .insert(connectionRequest)
          .values(request({ cancelledOn: '2026-03-01', cancellationReason: 'Retirada' }));
      }));

    it('allows one connection per request and requires a reason to deactivate', () =>
      rollback(async (tx) => {
        const { sa, request } = await newRequest(tx);
        const req = one(await tx.insert(connectionRequest).values(request()).returning());
        const base = { address: 'Calle 2 #5', activatedOn: '2026-03-01', createdBy: sa.id };
        const conn = one(
          await tx
            .insert(connection)
            .values({ ...base, connectionRequestId: req.id })
            .returning(),
        );
        expect(conn.folio).toMatch(folioPattern('T'));
        await expectViolation(tx, 'connection_connection_request_id_unique', (sp) =>
          sp.insert(connection).values({ ...base, connectionRequestId: req.id }),
        );
        await expectViolation(tx, 'connection_deactivation_reason', (sp) =>
          sp.insert(connection).values({ ...base, deactivatedOn: '2026-05-01' }),
        );
        await expectViolation(tx, 'connection_deactivated_after_activation', (sp) =>
          sp
            .insert(connection)
            .values({ ...base, deactivatedOn: '2026-02-01', deactivationReason: 'Baja' }),
        );
        // Pre-existing connections (D-18) have no request.
        await tx.insert(connection).values(base);
      }));
  });

  describe('units and change requests', () => {
    it('assigns U- folios and keeps unit dates consistent', () =>
      rollback(async (tx) => {
        const { sa, conn, unit1 } = await setup(tx);
        expect(unit1.folio).toMatch(folioPattern('U'));
        const base = { connectionId: conn.id, registeredOn: '2026-03-01', createdBy: sa.id };
        await expectViolation(tx, 'unit_activated_after_registration', (sp) =>
          sp
            .insert(unit)
            .values({ ...base, activatedOn: '2026-02-01', billingStartPeriod: '2026-02-01' }),
        );
        await expectViolation(tx, 'unit_deactivated_after_registration', (sp) =>
          sp.insert(unit).values({ ...base, deactivatedOn: '2026-02-01' }),
        );
        await expectViolation(tx, 'unit_reference_not_blank', (sp) =>
          sp.insert(unit).values({ ...base, reference: ' ' }),
        );
      }));

    it('requires a new holder only for holder changes and one request per approval', () =>
      rollback(async (tx) => {
        const { sa, unit1, newPerson, newApproval } = await setup(tx);
        const beto = await newPerson();
        const base = { unitId: unit1.id, createdBy: sa.id };
        await expectViolation(tx, 'unit_change_request_new_holder', async (sp) =>
          sp.insert(unitChangeRequest).values({
            ...base,
            type: 'holder_change',
            approvalId: (await newApproval('holder_change')).id,
          }),
        );
        await expectViolation(tx, 'unit_change_request_new_holder', async (sp) =>
          sp.insert(unitChangeRequest).values({
            ...base,
            type: 'deactivation',
            newHolderId: beto.id,
            approvalId: (await newApproval('unit_deactivation')).id,
          }),
        );
        const approvalId = (await newApproval('holder_change')).id;
        await tx
          .insert(unitChangeRequest)
          .values({ ...base, type: 'holder_change', newHolderId: beto.id, approvalId });
        await expectViolation(tx, 'unit_change_request_approval_id_unique', (sp) =>
          sp
            .insert(unitChangeRequest)
            .values({ ...base, type: 'holder_change', newHolderId: beto.id, approvalId }),
        );
      }));
  });
});
