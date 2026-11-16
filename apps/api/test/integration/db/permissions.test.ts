import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../../src/db/client.js';
import {
  auditLog,
  block,
  coveredPeriod,
  handover,
  income,
  payment,
  person,
  plumber,
  section,
  vCashboxBalance,
} from '../../../src/db/schema/index.js';
import { one, pgError, testDatabaseUrl, useTestDb } from './helpers.js';
import { moneyFixture, noonMx } from './money-fixture.js';

// Privileges of the API database user agua_api (2.2 §7, 3.1 §2.1). The data is created as
// the owner and then each case switches to agua_api with SET LOCAL ROLE inside the
// transaction, so nothing outlives the rollback.

const INSUFFICIENT_PRIVILEGE = '42501';

const actAsApi = (tx: Transaction) => tx.execute(sql`SET LOCAL ROLE agua_api`);
/** What the API's audit context does per transaction. */
const actingAccount = (tx: Transaction, userAccountId: number) =>
  tx.execute(sql`SELECT set_config('app.user_account_id', ${String(userAccountId)}, true)`);

describe.skipIf(!testDatabaseUrl)('permissions of agua_api', () => {
  const { rollback, attempt } = useTestDb();

  /** Expects `fn` to fail for lack of privileges (in a savepoint). */
  async function expectDenied(tx: Transaction, fn: (sp: Transaction) => Promise<unknown>) {
    const caught = await attempt(tx, fn);
    expect(caught, 'expected permission denied').toBeDefined();
    expect(pgError(caught).code).toBe(INSUFFICIENT_PRIVILEGE);
  }

  it('cannot UPDATE or DELETE a payment (mandatory test)', () =>
    rollback(async (tx) => {
      const { newPayment } = await moneyFixture(tx);
      const pay = await newPayment();
      await actAsApi(tx);
      await expectDenied(tx, (sp) =>
        sp
          .update(payment)
          .set({ occurredAt: noonMx('2026-03-06') })
          .where(eq(payment.id, pay.id)),
      );
      await expectDenied(tx, (sp) => sp.delete(payment).where(eq(payment.id, pay.id)));
    }));

  it('inserts money records (folio sequences included) and reads the views', () =>
    rollback(async (tx) => {
      const { sa, unit1, blockBox, addMonth, cover } = await moneyFixture(tx);
      await actAsApi(tx);
      const pay = one(
        await tx
          .insert(payment)
          .values({
            unitId: unit1.id,
            cashboxId: blockBox.id,
            occurredAt: noonMx('2026-03-05'),
            idempotencyKey: randomUUID(),
            createdBy: sa.id,
          })
          .returning(),
      );
      expect(pay.folio).toMatch(/^PG-\d{6}-\d{6}$/);
      await addMonth(pay.id, '2026-01-01', true);
      await cover(pay.id, '2026-01-01');
      const [balance] = await tx
        .select()
        .from(vCashboxBalance)
        .where(eq(vCashboxBalance.cashboxId, blockBox.id));
      expect(balance?.balance).toBe(10_000);
    }));

  it('cannot UPDATE or DELETE the audit log or an income', () =>
    rollback(async (tx) => {
      const { sa } = await moneyFixture(tx);
      const entry = one(
        await tx
          .insert(auditLog)
          .values({
            userAccountId: sa.id,
            role: 'superadmin',
            action: 'test',
            tableName: 'payment',
            recordId: 1,
          })
          .returning(),
      );
      const inc = one(
        await tx
          .insert(income)
          .values({ concept: 'Donativo', amount: 1_000, date: '2026-03-01', createdBy: sa.id })
          .returning(),
      );
      await actAsApi(tx);
      await expectDenied(tx, (sp) =>
        sp.update(auditLog).set({ action: 'edited' }).where(eq(auditLog.id, entry.id)),
      );
      await expectDenied(tx, (sp) => sp.delete(auditLog).where(eq(auditLog.id, entry.id)));
      await expectDenied(tx, (sp) =>
        sp.update(income).set({ amount: 1 }).where(eq(income.id, inc.id)),
      );
      await expectDenied(tx, (sp) => sp.delete(income).where(eq(income.id, inc.id)));
    }));

  it('updates only the status columns of a handover', () =>
    rollback(async (tx) => {
      const { sa, blockBox } = await moneyFixture(tx);
      const pending = one(
        await tx
          .insert(handover)
          .values({
            sourceCashboxId: blockBox.id,
            declaredAmount: 5_000,
            date: '2026-03-31',
            createdBy: sa.id,
          })
          .returning(),
      );
      await actAsApi(tx);
      // Confirmation (its closed-period trigger locks closing rows FOR SHARE as agua_api).
      await tx
        .update(handover)
        .set({ receivedAmount: 5_000, confirmedAt: noonMx('2026-04-01'), confirmedBy: sa.id })
        .where(eq(handover.id, pending.id));
      await expectDenied(tx, (sp) =>
        sp.update(handover).set({ declaredAmount: 1 }).where(eq(handover.id, pending.id)),
      );
    }));

  it('deletes covered periods (cancellation releases months)', () =>
    rollback(async (tx) => {
      const { unit1, newPayment, addMonth, cover } = await moneyFixture(tx);
      const pay = await newPayment();
      await addMonth(pay.id, '2026-01-01');
      await cover(pay.id, '2026-01-01');
      await actAsApi(tx);
      const deleted = await tx
        .delete(coveredPeriod)
        .where(and(eq(coveredPeriod.unitId, unit1.id), eq(coveredPeriod.period, '2026-01-01')))
        .returning();
      expect(deleted).toHaveLength(1);
    }));

  describe('contact data of people and the plumber', () => {
    it('updates phone and distinguishing note with an audit entry, nothing else, no DELETE', () =>
      rollback(async (tx) => {
        const { sa, holder } = await moneyFixture(tx);
        await actAsApi(tx);
        await actingAccount(tx, sa.id);
        await tx
          .update(person)
          .set({ phone: '5559998888', distinguishingNote: 'Casa azul' })
          .where(eq(person.id, holder.id));
        const [entry] = await tx
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.tableName, 'person'), eq(auditLog.recordId, holder.id)));
        expect(entry).toMatchObject({
          userAccountId: sa.id,
          role: 'superadmin',
          action: 'update_contact',
          before: { phone: null, distinguishing_note: null },
          after: { phone: '5559998888', distinguishing_note: 'Casa azul' },
        });

        await expectDenied(tx, (sp) =>
          sp.update(person).set({ givenNames: 'Otro' }).where(eq(person.id, holder.id)),
        );
        await expectDenied(tx, (sp) => sp.delete(person).where(eq(person.id, holder.id)));
      }));

    it('rejects a contact change without the acting account', () =>
      rollback(async (tx) => {
        const { holder } = await moneyFixture(tx);
        await actAsApi(tx);
        const caught = await attempt(tx, (sp) =>
          sp.update(person).set({ phone: '5551112222' }).where(eq(person.id, holder.id)),
        );
        expect(pgError(caught).constraint_name).toBe('person_contact_change_audited');
      }));

    it('updates the plumber phone with an audit entry and only the changed columns', () =>
      rollback(async (tx) => {
        const { sa } = await moneyFixture(tx);
        const plumber1 = one(
          await tx
            .insert(plumber)
            .values({ name: 'Fontanero', phone: '5550000000', createdBy: sa.id })
            .returning(),
        );
        await actAsApi(tx);
        await actingAccount(tx, sa.id);
        await tx.update(plumber).set({ phone: '5550000001' }).where(eq(plumber.id, plumber1.id));
        const entries = await tx
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.tableName, 'plumber'), eq(auditLog.recordId, plumber1.id)));
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          before: { phone: '5550000000' },
          after: { phone: '5550000001' },
        });
        await expectDenied(tx, (sp) =>
          sp.update(plumber).set({ name: 'Otro' }).where(eq(plumber.id, plumber1.id)),
        );
      }));
  });

  it('renames sections and blocks but cannot change their codes (migration 0016)', () =>
    rollback(async (tx) => {
      const { s1, m01 } = await moneyFixture(tx);
      await actAsApi(tx);
      await tx.update(section).set({ name: 'Sección Norte' }).where(eq(section.id, s1.id));
      await tx.update(block).set({ name: 'Manzana del pozo' }).where(eq(block.id, m01.id));
      await expectDenied(tx, (sp) =>
        sp.update(section).set({ code: 'S9' }).where(eq(section.id, s1.id)),
      );
      await expectDenied(tx, (sp) =>
        sp.update(block).set({ code: 'M99' }).where(eq(block.id, m01.id)),
      );
    }));
});
