import { randomUUID } from 'node:crypto';
import { paymentPageSchema, paymentResponseSchema } from '@bella-vista/shared';
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  cashbox,
  closing,
  connection,
  fee,
  payment,
  person,
  roleAssignment,
  unit,
  unitHolder,
  userAccount,
  vBlock,
  vCashboxBalance,
  vPaymentAmount,
} from '../../../src/db/schema/index.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// API step 6, billing: preview and registration of payments (2.3 §4, RF-PAG, D-03, D-05,
// D-07, D-25), paper receipt replacements (D-23), and cancellations approved by the president
// (D-15). The clock is fixed on 2026-10-25 12:30 in Mexico City, the date of the 2.3 example;
// the development data has rates $40.00 from 2025-01 and $50.00 from 2026-01. Units created
// here start billing on chosen months so their debts are known. Cases run in order.

const NOW = new Date('2026-10-25T18:30:00Z');
const TODAY = '2026-10-25';

describe.skipIf(!testDatabaseUrl)('payments', () => {
  const ctx = useApiTestApp();

  beforeAll(async () => {
    ctx.setNow(NOW);
    await ctx.owner
      .update(userAccount)
      .set({ mustChangePassword: false })
      .where(eq(userAccount.username, 'admin'));
  });

  const call = async (
    method: 'GET' | 'POST',
    url: string,
    username: string,
    payload?: Record<string, unknown>,
    idempotencyKey?: string,
  ) => {
    const res = await ctx.app.inject({
      method,
      url,
      headers: {
        ...(await ctx.authFor(username)),
        ...(idempotencyKey && { 'idempotency-key': idempotencyKey }),
      },
      ...(payload && { payload }),
    });
    return { status: res.statusCode, body: res.json(), headers: res.headers };
  };
  const pay = (username: string, body: Record<string, unknown>, key = randomUUID()) =>
    call('POST', '/v1/payments', username, body, key);
  const preview = (username: string, body: Record<string, unknown>) =>
    call('POST', '/v1/payments/preview', username, body);
  const resolve = (approvalId: number, result: 'approved' | 'rejected') =>
    call('POST', `/v1/approvals/${approvalId}/resolve`, 'presidente', {
      result,
      ...(result === 'rejected' && { reason: 'No procede' }),
    });
  const requestCancellation = (paymentId: number, username = 'tesorero', key = randomUUID()) =>
    call(
      'POST',
      `/v1/payments/${paymentId}/request-cancellation`,
      username,
      { reason: 'Se capturó en la unidad equivocada' },
      key,
    );

  const blockId = async (code: string) => {
    const [row] = await ctx.owner
      .select({ id: vBlock.id })
      .from(vBlock)
      .where(eq(vBlock.code, code));
    if (!row) throw new Error(`no block ${code}`);
    return row.id;
  };
  /** A unit (as the owner) in the connection at `address`, billed from `billingStart`. */
  const newUnit = async (address: string, billingStart: string, reference: string) => {
    const [conn] = await ctx.owner
      .select({ id: connection.id })
      .from(connection)
      .where(sql`${connection.address} LIKE ${`${address}%`}`);
    const [holder] = await ctx.owner.select({ id: person.id }).from(person).limit(1);
    const createdBy = await ctx.accountId('secretario');
    const [row] = await ctx.owner
      .insert(unit)
      .values({
        connectionId: conn?.id ?? 0,
        reference,
        registeredOn: '2026-01-10',
        activatedOn: '2026-01-10',
        billingStartPeriod: `${billingStart}-01`,
        createdBy,
      })
      .returning({ id: unit.id, folio: unit.folio });
    if (!row) throw new Error('unit not inserted');
    await ctx.owner
      .insert(unitHolder)
      .values({ unitId: row.id, personId: holder?.id ?? 0, validFrom: '2026-01-10', createdBy });
    return row;
  };
  const statementOf = async (unitId: number) =>
    (await call('GET', `/v1/units/${unitId}/account-statement`, 'tesorero')).body.statement;
  const monthsByStatus = (st: { months: { period: string; status: string }[] }, status: string) =>
    st.months.filter((m) => m.status === status).map((m) => m.period);
  const balanceOf = async (cashboxId: number) => {
    const [row] = await ctx.owner
      .select({ balance: vCashboxBalance.balance })
      .from(vCashboxBalance)
      .where(eq(vCashboxBalance.cashboxId, cashboxId));
    return row?.balance ?? 0;
  };

  let example: { id: number; folio: string };
  let firstPayment: { id: number; cashbox: { id: number } };
  const exampleKey = randomUUID();

  // --- Registering a payment ------------------------------------------------------------------

  it('previews the 2.3 example: June and July with surcharge = $200.00', async () => {
    // Billed from 2026-06: on 2026-10-25, June to September are overdue (4: debt cycle open)
    // and October is pending.
    example = await newUnit('Av. Hidalgo', '2026-06', 'Ejemplo 2.3');
    const res = await preview('jm.s1m01', { unitId: example.id, periods: ['2026-07', '2026-06'] });
    expect(res.status).toBe(200);
    expect(res.body.preview).toMatchObject({
      unit: { id: example.id, folio: example.folio },
      months: [
        { period: '2026-06', kind: 'overdue', baseAmount: 5_000, surcharge: 5_000, total: 10_000 },
        { period: '2026-07', kind: 'overdue', baseAmount: 5_000, surcharge: 5_000, total: 10_000 },
      ],
      charges: [],
      total: 20_000,
      cashbox: { type: 'block', label: 'S1-M01' },
    });
  });

  it('registers the payment with frozen rate and surcharge (2.3 §4)', async () => {
    const res = await pay(
      'jm.s1m01',
      {
        unitId: example.id,
        periods: ['2026-06', '2026-07'],
        extraChargeIds: [],
        paperFolio: '001234',
        expectedTotal: 20_000,
      },
      exampleKey,
    );
    expect(res.status).toBe(201);
    expect(paymentResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(res.body.payment).toMatchObject({
      folio: expect.stringMatching(/^PG-\d{6}-\d{6}$/),
      unit: { id: example.id, folio: example.folio },
      blockId: await blockId('S1-M01'),
      months: [
        { period: '2026-06', baseAmount: 5_000, surcharge: 5_000, total: 10_000 },
        { period: '2026-07', baseAmount: 5_000, surcharge: 5_000, total: 10_000 },
      ],
      total: 20_000,
      cashbox: { type: 'block', label: 'S1-M01' },
      paperFolio: '001234',
      receipts: [{ paperFolio: '001234', type: 'original' }],
      occurredAt: NOW.toISOString(),
      capturedBy: { username: 'jm.s1m01' },
      cancelled: false,
      cancellations: [],
    });
    firstPayment = res.body.payment;
    const st = await statementOf(example.id);
    expect(monthsByStatus(st, 'paid')).toEqual(['2026-06', '2026-07']);
  });

  it('returns the same payment for the same Idempotency-Key, without a second one', async () => {
    const again = await pay(
      'jm.s1m01',
      {
        unitId: example.id,
        periods: ['2026-06', '2026-07'],
        paperFolio: '001234',
        expectedTotal: 20_000,
      },
      exampleKey,
    );
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.payment.id).toBe(firstPayment.id);
    const rows = await ctx.owner.select().from(payment).where(eq(payment.unitId, example.id));
    expect(rows).toHaveLength(1);

    const otherAccount = await pay(
      'tesorero',
      { unitId: example.id, periods: ['2026-08'], paperFolio: 'X1', expectedTotal: 10_000 },
      exampleKey,
    );
    expect(otherAccount).toMatchObject({
      status: 409,
      body: { error: { code: 'IDEMPOTENCY_KEY_REUSED' } },
    });
  });

  it('refuses a total that changed (TOTAL_CHANGED) with the new summary', async () => {
    // D-02: paying June and July left two overdue months, but the cycle stays open.
    const res = await pay('jm.s1m01', {
      unitId: example.id,
      periods: ['2026-08'],
      paperFolio: '001235',
      expectedTotal: 5_000,
    });
    expect(res).toMatchObject({
      status: 409,
      body: {
        error: {
          code: 'TOTAL_CHANGED',
          message:
            'El total cambió: ahora es $100.00 (antes $50.00). Revise el resumen y confirme de nuevo.',
          details: {
            expectedTotal: 5_000,
            total: 10_000,
            months: [{ period: '2026-08', baseAmount: 5_000, surcharge: 5_000, total: 10_000 }],
          },
        },
      },
    });
  });

  it.each([
    ['skipping a month', ['2026-09']],
    ['an advance with months still unpaid', ['2026-08', '2026-11']],
  ])('refuses %s (MONTH_ORDER, D-03)', async (_, periods) => {
    const res = await pay('jm.s1m01', {
      unitId: example.id,
      periods,
      paperFolio: '001235',
      expectedTotal: 0,
    });
    expect(res).toMatchObject({ status: 422, body: { error: { code: 'MONTH_ORDER' } } });
  });

  it('refuses a month already paid (PERIOD_ALREADY_PAID)', async () => {
    const res = await pay('jm.s1m01', {
      unitId: example.id,
      periods: ['2026-06'],
      paperFolio: '001235',
      expectedTotal: 10_000,
    });
    expect(res).toMatchObject({
      status: 409,
      body: { error: { code: 'PERIOD_ALREADY_PAID', message: 'Junio 2026 ya está pagado.' } },
    });
  });

  it('refuses a paper folio already used in the cashbox (DUPLICATE_PAPER_FOLIO)', async () => {
    const res = await pay('jm.s1m01', {
      unitId: example.id,
      periods: ['2026-08'],
      paperFolio: '001234',
      expectedTotal: 10_000,
    });
    expect(res).toMatchObject({ status: 409, body: { error: { code: 'DUPLICATE_PAPER_FOLIO' } } });
  });

  it('pays the rest with advances at the rate of their own month (D-03, D-05)', async () => {
    const res = await pay('jm.s1m01', {
      unitId: example.id,
      periods: ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12'],
      paperFolio: '001236',
      expectedTotal: 2 * 10_000 + 3 * 5_000,
    });
    expect(res.status).toBe(201);
    expect(res.body.payment.months.slice(-3)).toEqual([
      { period: '2026-10', baseAmount: 5_000, surcharge: 0, total: 5_000 },
      { period: '2026-11', baseAmount: 5_000, surcharge: 0, total: 5_000 },
      { period: '2026-12', baseAmount: 5_000, surcharge: 0, total: 5_000 },
    ]);
    const st = await statementOf(example.id);
    expect(monthsByStatus(st, 'advance')).toEqual(['2026-11', '2026-12']);
    expect(st.summary.totalDue).toBe(0);
  });

  it('validates the selection', async () => {
    const empty = await pay('tesorero', { paperFolio: 'V1', expectedTotal: 0 });
    expect(empty).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_ERROR' } } });
    const noUnit = await pay('tesorero', {
      periods: ['2026-08'],
      paperFolio: 'V1',
      expectedTotal: 0,
    });
    expect(noUnit.body.error.details.issues).toContainEqual({
      path: 'body.unitId',
      message: 'Elija la unidad a la que corresponden los meses.',
    });
    const notBillable = await preview('tesorero', { unitId: example.id, periods: ['2026-05'] });
    expect(notBillable).toMatchObject({
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR' } },
    });
    const missing = await preview('tesorero', { unitId: 999_999, periods: ['2026-08'] });
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('requires an Idempotency-Key to register', async () => {
    const res = await call('POST', '/v1/payments', 'tesorero', {
      unitId: example.id,
      periods: ['2026-08'],
      paperFolio: 'K1',
      expectedTotal: 0,
    });
    expect(res).toMatchObject({
      status: 400,
      body: { error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } },
    });
  });

  it('two payments of the same month at once: one is registered, the other refused', async () => {
    const target = await newUnit('Av. Hidalgo', '2026-09', 'Concurrente');
    const body = (folio: string) => ({
      unitId: target.id,
      periods: ['2026-09'],
      paperFolio: folio,
      expectedTotal: 5_000,
    });
    const [a, b] = await Promise.all([pay('tesorero', body('C-1')), pay('tesorero', body('C-2'))]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.status === 409)?.body.error.code).toBe('PERIOD_ALREADY_PAID');
    const rows = await ctx.owner.select().from(payment).where(eq(payment.unitId, target.id));
    expect(rows).toHaveLength(1);
  });

  // --- Cashboxes (D-07) -----------------------------------------------------------------------

  it('the treasurer collects into the committee cashbox', async () => {
    const target = await newUnit('Calle Juárez', '2026-10', 'Tesorería');
    const res = await pay('tesorero', {
      unitId: target.id,
      periods: ['2026-10'],
      paperFolio: 'T-0001',
      expectedTotal: 5_000,
    });
    expect(res.body.payment).toMatchObject({
      cashbox: { type: 'committee', label: 'Comité' },
      blockId: await blockId('S1-M02'),
    });
  });

  it('the president collects in support: creates their support cashbox once (D-07)', async () => {
    const target = await newUnit('Calle Juárez', '2026-10', 'Apoyo');
    const shown = await preview('presidente', { unitId: target.id, periods: ['2026-10'] });
    expect(shown.body.preview.cashbox).toEqual({
      id: null,
      type: 'support',
      label: 'Apoyo · Ana Salinas',
    });
    const first = await pay('presidente', {
      unitId: target.id,
      periods: ['2026-10'],
      paperFolio: 'A-0001',
      expectedTotal: 5_000,
    });
    expect(first.status).toBe(201);
    expect(first.body.payment).toMatchObject({
      cashbox: { type: 'support', label: 'Apoyo · Ana Salinas' },
      blockId: await blockId('S1-M02'),
    });
    const second = await pay('presidente', {
      unitId: target.id,
      periods: ['2026-11'],
      paperFolio: 'A-0002',
      expectedTotal: 5_000,
    });
    expect(second.body.payment.cashbox.id).toBe(first.body.payment.cashbox.id);
    const [amount] = await ctx.owner
      .select()
      .from(vPaymentAmount)
      .where(eq(vPaymentAmount.id, first.body.payment.id));
    expect(amount).toMatchObject({ isSupport: true, total: 5_000 });
  });

  it('a block leader only collects in their block', async () => {
    const res = await preview('jm.s1m02', { unitId: example.id, periods: ['2027-01'] });
    expect(res).toMatchObject({ status: 403, body: { error: { code: 'OUT_OF_SCOPE' } } });
  });

  // --- Listing and detail ---------------------------------------------------------------------

  it('lists and shows payments by scope', async () => {
    const all = await call('GET', `/v1/payments?unitId=${example.id}`, 'secretario');
    expect(all.status).toBe(200);
    expect(paymentPageSchema.safeParse(all.body).success).toBe(true);
    expect(all.body.data).toHaveLength(2);

    const leader = await call('GET', '/v1/payments?limit=100', 'jm.s1m02');
    const s1m02 = await blockId('S1-M02');
    expect(leader.body.data.length).toBeGreaterThan(0);
    expect(leader.body.data.every((p: { blockId: number }) => p.blockId === s1m02)).toBe(true);

    expect(
      (await call('GET', `/v1/payments?blockId=${await blockId('S1-M01')}`, 'jm.s1m02')).body.error
        .code,
    ).toBe('OUT_OF_SCOPE');
    expect((await call('GET', `/v1/payments/${firstPayment.id}`, 'jm.s1m02')).body.error.code).toBe(
      'OUT_OF_SCOPE',
    );
    const detail = await call('GET', `/v1/payments/${firstPayment.id}`, 'jm.s1m01');
    expect(detail.body.payment.id).toBe(firstPayment.id);
    expect((await call('GET', '/v1/payments/999999', 'tesorero')).body.error.code).toBe(
      'NOT_FOUND',
    );

    const page = await call('GET', `/v1/payments?from=${TODAY}&to=${TODAY}&limit=2`, 'tesorero');
    expect(page.body.data).toHaveLength(2);
    expect(page.body.next).not.toBeNull();
  });

  // --- Paper receipt replacement (D-23) -------------------------------------------------------

  it('registers a replacement receipt without moving cash', async () => {
    const before = await balanceOf(firstPayment.cashbox.id);
    const res = await call('POST', `/v1/payments/${firstPayment.id}/replacements`, 'jm.s1m01', {
      paperFolio: '001300',
    });
    expect(res.status).toBe(201);
    expect(res.body.payment.receipts).toEqual([
      expect.objectContaining({ paperFolio: '001234', type: 'original' }),
      expect.objectContaining({ paperFolio: '001300', type: 'replacement' }),
    ]);
    expect(res.body.payment.paperFolio).toBe('001234');
    expect(await balanceOf(firstPayment.cashbox.id)).toBe(before);

    const repeated = await call(
      'POST',
      `/v1/payments/${firstPayment.id}/replacements`,
      'tesorero',
      { paperFolio: '001236' },
    );
    expect(repeated.body.error.code).toBe('DUPLICATE_PAPER_FOLIO');
    const other = await call('POST', `/v1/payments/${firstPayment.id}/replacements`, 'jm.s1m02', {
      paperFolio: '9999',
    });
    expect(other.body.error.code).toBe('OUT_OF_SCOPE');
  });

  // --- Cancellation (D-15) --------------------------------------------------------------------

  it('requests a cancellation; a rejected one changes nothing', async () => {
    const key = randomUUID();
    const res = await requestCancellation(firstPayment.id, 'jm.s1m01', key);
    expect(res.status).toBe(201);
    expect(res.body.payment.cancellations).toEqual([
      expect.objectContaining({ status: 'pending', reason: 'Se capturó en la unidad equivocada' }),
    ]);
    const replay = await requestCancellation(firstPayment.id, 'jm.s1m01', key);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const again = await requestCancellation(firstPayment.id, 'tesorero');
    expect(again).toMatchObject({ status: 409, body: { error: { code: 'INVALID_STATE' } } });

    const approvalId = res.body.payment.cancellations[0].approvalId;
    const inbox = await call('GET', '/v1/approvals?status=pending', 'presidente');
    const item = inbox.body.approvals.find((a: { id: number }) => a.id === approvalId);
    expect(item.description).toMatch(/^Cancelar el pago PG-\d{6}-\d{6} \(\$200\.00\)$/);
    // R-03 opens the payment itself (G-05).
    expect(item.subject).toEqual({ type: 'payment', id: firstPayment.id });
    const one = await call('GET', `/v1/approvals/${approvalId}`, 'presidente');
    expect(one.body.approval).toMatchObject({ id: approvalId, subject: item.subject });
    // The leader who asked follows it; the treasurer did not ask: for them it does not exist.
    expect((await call('GET', `/v1/approvals/${approvalId}`, 'jm.s1m01')).status).toBe(200);
    expect((await call('GET', `/v1/approvals/${approvalId}`, 'tesorero')).status).toBe(404);

    expect((await resolve(approvalId, 'rejected')).status).toBe(200);
    const detail = await call('GET', `/v1/payments/${firstPayment.id}`, 'tesorero');
    expect(detail.body.payment).toMatchObject({
      cancelled: false,
      cancellations: [{ status: 'rejected' }],
    });
    expect(monthsByStatus(await statementOf(example.id), 'paid')).toContain('2026-06');
  });

  it('an approved cancellation frees its months and takes the cash out of the cashbox', async () => {
    const before = await balanceOf(firstPayment.cashbox.id);
    const res = await requestCancellation(firstPayment.id);
    expect((await resolve(res.body.payment.cancellations[0].approvalId, 'approved')).status).toBe(
      200,
    );
    const detail = await call('GET', `/v1/payments/${firstPayment.id}`, 'tesorero');
    expect(detail.body.payment).toMatchObject({
      cancelled: true,
      cancellations: [{ status: 'approved' }, { status: 'rejected' }],
    });
    expect(await balanceOf(firstPayment.cashbox.id)).toBe(before - 20_000);

    // June and July are overdue again, still in the open debt cycle.
    const st = await statementOf(example.id);
    expect(monthsByStatus(st, 'overdue')).toEqual(['2026-06', '2026-07']);
    const again = await pay('jm.s1m01', {
      unitId: example.id,
      periods: ['2026-06', '2026-07'],
      paperFolio: '001237',
      expectedTotal: 20_000,
    });
    expect(again.status).toBe(201);
  });

  it('a cancelled payment cannot be cancelled again or get a replacement', async () => {
    expect((await requestCancellation(firstPayment.id)).body.error.code).toBe('INVALID_STATE');
    const replacement = await call(
      'POST',
      `/v1/payments/${firstPayment.id}/replacements`,
      'tesorero',
      { paperFolio: 'R-1' },
    );
    expect(replacement.body.error.code).toBe('INVALID_STATE');
  });

  // --- Opening fee (RF-TOM-05, D-13) ----------------------------------------------------------

  it('pays an opening fee without unit, cancels it and pays it again; installed it is final', async () => {
    const [opening] = await ctx.owner.select().from(fee).where(eq(fee.type, 'opening'));
    await call('POST', `/v1/fees/${opening?.id}/amounts`, 'tesorero', {
      effectiveFrom: TODAY,
      amount: 150_000,
    });
    const applicant = (
      await call('POST', '/v1/people', 'secretario', {
        givenNames: 'Octavio',
        paternalSurname: 'Apertura',
      })
    ).body.person.id;
    const agreementId = (
      await call('POST', '/v1/agreements', 'secretario', {
        meetingDate: '2026-10-20',
        topic: 'Nuevas tomas',
        result: 'approved_by_majority',
      })
    ).body.agreement.id;
    const created = await call('POST', '/v1/connection-requests', 'jm.s1m01', {
      applicantId: applicant,
      address: 'Calle Nueva 1',
      blockId: await blockId('S1-M01'),
    });
    const requestId = created.body.request.id;
    const resolved = await call(
      'POST',
      `/v1/connection-requests/${requestId}/resolve`,
      'secretario',
      { agreementId },
    );
    const chargeId = resolved.body.request.openingCharge.id;

    const shown = await preview('jm.s1m01', { extraChargeIds: [chargeId] });
    expect(shown.body.preview).toMatchObject({
      unit: null,
      months: [],
      charges: [{ id: chargeId, feeType: 'opening', amount: 150_000 }],
      total: 150_000,
    });
    expect((await preview('jm.s1m02', { extraChargeIds: [chargeId] })).body.error.code).toBe(
      'OUT_OF_SCOPE',
    );
    const paid = await pay('jm.s1m01', {
      extraChargeIds: [chargeId],
      paperFolio: 'AP-01',
      expectedTotal: 150_000,
    });
    expect(paid.body.payment).toMatchObject({
      unit: null,
      blockId: await blockId('S1-M01'),
      total: 150_000,
    });
    const twice = await pay('tesorero', {
      extraChargeIds: [chargeId],
      paperFolio: 'AP-02',
      expectedTotal: 150_000,
    });
    expect(twice.body.error.code).toBe('INVALID_STATE');
    const requestOf = async () =>
      (await call('GET', `/v1/connection-requests/${requestId}`, 'secretario')).body.request;
    expect((await requestOf()).status).toBe('pending_installation');

    // Cancelled: the request waits for payment again, with a new charge of the same amount.
    const cancel = await requestCancellation(paid.body.payment.id, 'jm.s1m01');
    await resolve(cancel.body.payment.cancellations[0].approvalId, 'approved');
    const reopened = await requestOf();
    expect(reopened.status).toBe('approved_pending_payment');
    expect(reopened.openingCharge).toMatchObject({ amount: 150_000, cancelledOn: null });
    expect(reopened.openingCharge.id).not.toBe(chargeId);
    const activateUnpaid = await call(
      'POST',
      `/v1/connection-requests/${requestId}/activate`,
      'jm.s1m01',
      {},
    );
    expect(activateUnpaid.body.error.code).toBe('OPENING_NOT_PAID');

    const repaid = await pay('tesorero', {
      extraChargeIds: [reopened.openingCharge.id],
      paperFolio: 'AP-03',
      expectedTotal: 150_000,
    });
    expect(repaid.status).toBe(201);
    const activated = await call(
      'POST',
      `/v1/connection-requests/${requestId}/activate`,
      'jm.s1m01',
      {},
    );
    expect(activated.status).toBe(201);
    const final = await requestCancellation(repaid.body.payment.id);
    expect(final).toMatchObject({
      status: 409,
      body: {
        error: {
          code: 'INVALID_STATE',
          message:
            'El pago liquidó la apertura de una toma que ya está instalada; no se puede cancelar.',
        },
      },
    });
  });

  // --- A block created through the API --------------------------------------------------------

  it('creates the cashbox of a block that has none with its first payment', async () => {
    // The leader of S2-M01 moves to the new block S2-M09 (setup as the owner).
    const sectionId = (
      await ctx.owner
        .select({ sectionId: vBlock.sectionId })
        .from(vBlock)
        .where(eq(vBlock.code, 'S2-M01'))
    )[0]?.sectionId;
    const created = await call('POST', '/v1/blocks', 'secretario', { sectionId, code: 'M09' });
    const newBlock = created.body.block.id as number;
    const leaderAssignment = await ctx.owner
      .select({ id: userAccount.roleAssignmentId })
      .from(userAccount)
      .where(eq(userAccount.username, 'jm.s2m01'));
    await ctx.owner
      .update(roleAssignment)
      .set({ blockId: newBlock })
      .where(eq(roleAssignment.id, leaderAssignment[0]?.id ?? 0));
    const [conn] = await ctx.owner
      .select({ id: connection.id })
      .from(connection)
      .where(sql`${connection.address} LIKE 'Camino Real%'`);
    await ctx.owner.execute(
      sql`UPDATE connection_block SET block_id = ${newBlock} WHERE connection_id = ${conn?.id ?? 0}`,
    );
    const target = await newUnit('Camino Real', '2026-10', 'Manzana nueva');

    const res = await pay('jm.s2m01', {
      unitId: target.id,
      periods: ['2026-10'],
      paperFolio: '0001',
      expectedTotal: 5_000,
    });
    expect(res.status).toBe(201);
    expect(res.body.payment.cashbox).toMatchObject({ type: 'block', label: 'S2-M09' });
    const boxes = await ctx.owner.select().from(cashbox).where(eq(cashbox.blockId, newBlock));
    expect(boxes).toHaveLength(1);
  });

  // --- Closed period (D-14) -------------------------------------------------------------------

  it('refuses payments and cancellations in a month with a closed closing (PERIOD_CLOSED)', async () => {
    const target = await newUnit('Calle Juárez', '2026-10', 'Cierre');
    const paid = await pay('tesorero', {
      unitId: target.id,
      periods: ['2026-10'],
      paperFolio: 'T-0100',
      expectedTotal: 5_000,
    });
    const cancel = await requestCancellation(paid.body.payment.id);

    const treasurer = await ctx.accountId('tesorero');
    const president = await ctx.accountId('presidente');
    await ctx.owner.insert(closing).values({
      cashboxId: paid.body.payment.cashbox.id,
      type: 'monthly',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      countedCash: 0,
      reviewedBy: president,
      reviewedAt: NOW,
      closedBy: president,
      closedAt: NOW,
      createdBy: treasurer,
    });

    const res = await pay('tesorero', {
      unitId: target.id,
      periods: ['2026-11'],
      paperFolio: 'T-0101',
      expectedTotal: 5_000,
    });
    expect(res).toMatchObject({ status: 409, body: { error: { code: 'PERIOD_CLOSED' } } });
    const approval = await resolve(cancel.body.payment.cancellations[0].approvalId, 'approved');
    expect(approval).toMatchObject({ status: 409, body: { error: { code: 'PERIOD_CLOSED' } } });
    const [still] = await ctx.owner
      .select({ cancelled: vPaymentAmount.cancelled })
      .from(vPaymentAmount)
      .where(and(eq(vPaymentAmount.id, paid.body.payment.id)));
    expect(still?.cancelled).toBe(false);
  });

  // --- Permissions ----------------------------------------------------------------------------

  it.each(['secretario', 'vocal', 'admin'])('%s cannot collect (403)', async (username) => {
    const body = { unitId: example.id, periods: ['2027-01'], paperFolio: 'P', expectedTotal: 0 };
    expect((await preview(username, body)).body.error.code).toBe('FORBIDDEN');
    expect((await pay(username, body)).body.error.code).toBe('FORBIDDEN');
  });

  it.each(['presidente', 'secretario', 'vocal', 'admin'])(
    '%s cannot register replacements or request cancellations (403)',
    async (username) => {
      const replacement = await call(
        'POST',
        `/v1/payments/${firstPayment.id}/replacements`,
        username,
        { paperFolio: 'P-1' },
      );
      expect(replacement).toMatchObject({ status: 403, body: { error: { code: 'FORBIDDEN' } } });
      expect((await requestCancellation(firstPayment.id, username)).body.error.code).toBe(
        'FORBIDDEN',
      );
    },
  );

  it('the superadmin does not read payments (403)', async () => {
    expect((await call('GET', '/v1/payments', 'admin')).body.error.code).toBe('FORBIDDEN');
    expect((await call('GET', `/v1/payments/${firstPayment.id}`, 'admin')).body.error.code).toBe(
      'FORBIDDEN',
    );
  });

  it('only the president resolves a cancellation (403)', async () => {
    const target = await newUnit('Av. Hidalgo', '2026-10', 'Permisos');
    const paid = await pay('tesorero', {
      unitId: target.id,
      periods: ['2026-10'],
      paperFolio: 'T-0200',
      expectedTotal: 5_000,
    });
    // The October closing of the committee cashbox blocks it; use a block leader's payment.
    expect(paid.body.error?.code).toBe('PERIOD_CLOSED');
    const leaderPaid = await pay('jm.s1m01', {
      unitId: target.id,
      periods: ['2026-10'],
      paperFolio: '001400',
      expectedTotal: 5_000,
    });
    const cancel = await requestCancellation(leaderPaid.body.payment.id, 'jm.s1m01');
    const approvalId = cancel.body.payment.cancellations[0].approvalId;
    for (const username of ['tesorero', 'secretario', 'vocal', 'jm.s1m01']) {
      const res = await call('POST', `/v1/approvals/${approvalId}/resolve`, username, {
        result: 'approved',
      });
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });
});
