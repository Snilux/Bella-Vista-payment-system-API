import { randomUUID } from 'node:crypto';
import { agreementPageSchema, connectionRequestPageSchema } from '@bella-vista/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { fee, feeAmount, person, userAccount, vBlock } from '../../../src/db/schema/index.js';
import { businessDate } from '../../../src/lib/dates.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// API step 4, connections module: pre-existing connections (D-18), agreements and connection
// requests from application to installation (RF-TOM, D-12, D-13). The opening fee is paid
// through /v1/payments (API step 6). Cases run in order.

const today = () => businessDate(new Date(), 'America/Mexico_City');
const OPENING_AMOUNT = 150_000;

describe.skipIf(!testDatabaseUrl)('connections', () => {
  const ctx = useApiTestApp();

  beforeAll(async () => {
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
  ) => {
    const res = await ctx.app.inject({
      method,
      url,
      headers: await ctx.authFor(username),
      ...(payload && { payload }),
    });
    return { status: res.statusCode, body: res.json() };
  };
  const blockId = async (code: string) => {
    const [row] = await ctx.owner
      .select({ id: vBlock.id })
      .from(vBlock)
      .where(eq(vBlock.code, code));
    if (!row) throw new Error(`no block ${code}`);
    return row.id;
  };
  const newPerson = async (givenNames: string) =>
    (
      await call('POST', '/v1/people', 'secretario', {
        givenNames,
        paternalSurname: 'Solicitante',
      })
    ).body.person.id as number;
  const newAgreement = async (result: 'approved_by_majority' | 'rejected') =>
    (
      await call('POST', '/v1/agreements', 'secretario', {
        meetingDate: '2026-11-01',
        topic: result === 'rejected' ? 'Solicitud rechazada' : 'Solicitudes aprobadas',
        result,
        votesFor: 40,
      })
    ).body.agreement.id as number;
  const newRequest = async (username: string, block: string, applicantName: string) =>
    call('POST', '/v1/connection-requests', username, {
      applicantId: await newPerson(applicantName),
      address: `Calle Nueva ${applicantName}`,
      blockId: await blockId(block),
    });
  /** Pays the current opening charge of a request through the API (RF-TOM-05). */
  const payOpening = async (requestId: number, username: string) => {
    const { request } = (await call('GET', `/v1/connection-requests/${requestId}`, username)).body;
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: { ...(await ctx.authFor(username)), 'idempotency-key': randomUUID() },
      payload: {
        extraChargeIds: [request.openingCharge.id],
        paperFolio: `AP-${randomUUID().slice(0, 8)}`,
        expectedTotal: request.openingCharge.amount,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().payment.id as number;
  };

  // --- Pre-existing connections ---------------------------------------------------------------

  it('registers a pre-existing connection with its first unit and billing start (D-18)', async () => {
    const holder = await newPerson('Gilberto');
    const res = await call('POST', '/v1/connections/pre-existing', 'jm.s1m01', {
      address: 'Callejón del Sol 4',
      blockId: await blockId('S1-M01'),
      activatedOn: '2018-05-01',
      unit: {
        holderPersonId: holder,
        reference: 'Casa única',
        registeredOn: '2026-11-01',
        billingStartPeriod: '2025-08',
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.connection).toMatchObject({
      address: 'Callejón del Sol 4',
      status: 'active',
      activatedOn: '2018-05-01',
      blockCode: 'S1-M01',
      connectionRequestId: null,
      units: [
        {
          reference: 'Casa única',
          status: 'active',
          billingStartPeriod: '2025-08',
          holder: expect.objectContaining({ fullName: 'Gilberto Solicitante' }),
        },
      ],
    });
    const id = res.body.connection.id;
    expect((await call('GET', `/v1/connections/${id}`, 'jm.s1m01')).status).toBe(200);
    expect((await call('GET', `/v1/connections/${id}`, 'jm.s1m02')).body.error.code).toBe(
      'OUT_OF_SCOPE',
    );

    const elsewhere = await call('POST', '/v1/connections/pre-existing', 'jm.s1m01', {
      address: 'Otra 1',
      blockId: await blockId('S1-M02'),
      unit: { holderPersonId: holder, billingStartPeriod: '2025-08' },
    });
    expect(elsewhere.body.error.code).toBe('OUT_OF_SCOPE');
  });

  // --- Agreements -----------------------------------------------------------------------------

  it('lets the secretary record agreements and the committee page through them', async () => {
    const created = await call('POST', '/v1/agreements', 'secretario', {
      meetingDate: '2026-10-15',
      topic: 'Reparación del tanque',
      result: 'approved_by_majority',
      votesFor: 55,
      votesAgainst: 3,
      abstentions: 1,
      minutesReference: 'Acta 2026-10, foja 4',
    });
    expect(created.status).toBe(201);
    expect(created.body.agreement).toMatchObject({
      folio: expect.stringMatching(/^AC-\d{6}-\d{6}$/),
      votesFor: 55,
    });

    const first = await call('GET', '/v1/agreements?limit=1', 'vocal');
    expect(agreementPageSchema.safeParse(first.body).success).toBe(true);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.next).not.toBeNull();
    const second = await call('GET', `/v1/agreements?limit=1&cursor=${first.body.next}`, 'vocal');
    expect(second.body.data[0].id).toBeLessThan(first.body.data[0].id);

    expect(
      (
        await call('POST', '/v1/agreements', 'secretario', {
          meetingDate: '2026-10-16',
          topic: 'Corrección',
          result: 'approved_by_majority',
          correctsId: 999_999,
        })
      ).body.error.code,
    ).toBe('NOT_FOUND');
  });

  // --- Connection requests --------------------------------------------------------------------

  it('takes requests from the leader of the block only and lists them by scope', async () => {
    const own = await newRequest('jm.s2m01', 'S2-M01', 'Adela');
    expect(own.status).toBe(201);
    expect(own.body.request).toMatchObject({
      status: 'requested',
      blockCode: 'S2-M01',
      requestedOn: today(),
      agreement: null,
      openingCharge: null,
      applicant: expect.objectContaining({ fullName: 'Adela Solicitante' }),
    });
    expect((await newRequest('jm.s2m01', 'S1-M01', 'Benito')).body.error.code).toBe('OUT_OF_SCOPE');

    const leader = await call('GET', '/v1/connection-requests', 'jm.s2m01');
    expect(connectionRequestPageSchema.safeParse(leader.body).success).toBe(true);
    expect(leader.body.data.every((r: { blockCode: string }) => r.blockCode === 'S2-M01')).toBe(
      true,
    );
    expect(
      (await call('GET', `/v1/connection-requests?blockId=${await blockId('S1-M01')}`, 'jm.s2m01'))
        .body.error.code,
    ).toBe('OUT_OF_SCOPE');
    expect(
      (await call('GET', `/v1/connection-requests/${own.body.request.id}`, 'jm.s1m01')).body.error
        .code,
    ).toBe('OUT_OF_SCOPE');
  });

  it('approves with the agreement, charging the opening fee in force (D-13), and does not activate without payment', async () => {
    const created = await newRequest('jm.s2m01', 'S2-M01', 'Cecilia');
    const id = created.body.request.id;
    const approvedAgreement = await newAgreement('approved_by_majority');

    // The bootstrap creates the opening fee without amount: approval is refused until it has one.
    const noAmount = await call('POST', `/v1/connection-requests/${id}/resolve`, 'secretario', {
      agreementId: approvedAgreement,
    });
    expect(noAmount).toMatchObject({
      status: 422,
      body: {
        error: { code: 'FEE_WITHOUT_AMOUNT', details: { fee: 'Apertura de toma', on: today() } },
      },
    });
    expect(
      (await call('GET', `/v1/connection-requests/${id}`, 'secretario')).body.request.status,
    ).toBe('requested');

    const [opening] = await ctx.owner.select().from(fee).where(eq(fee.type, 'opening'));
    await ctx.owner.insert(feeAmount).values({
      feeId: opening?.id ?? 0,
      effectiveFrom: '2026-01-01',
      amount: OPENING_AMOUNT,
      createdBy: await ctx.accountId('tesorero'),
    });

    const approved = await call('POST', `/v1/connection-requests/${id}/resolve`, 'secretario', {
      agreementId: approvedAgreement,
    });
    expect(approved.status).toBe(200);
    expect(approved.body.request).toMatchObject({
      status: 'approved_pending_payment',
      agreement: { id: approvedAgreement, result: 'approved_by_majority' },
      openingCharge: {
        feeName: 'Apertura de toma',
        amount: OPENING_AMOUNT,
        chargedOn: today(),
        cancelledOn: null,
      },
    });

    const twice = await call('POST', `/v1/connection-requests/${id}/resolve`, 'secretario', {
      agreementId: approvedAgreement,
    });
    expect(twice.body.error).toEqual({
      code: 'INVALID_STATE',
      message: 'La solicitud está aprobada pendiente de pago.',
      details: { status: 'approved_pending_payment', action: 'resolve' },
    });

    // Without the opening fee paid, the connection is not activated (RF-TOM-06).
    for (const username of ['jm.s2m01', 'secretario']) {
      const res = await call('POST', `/v1/connection-requests/${id}/activate`, username, {});
      expect(res).toMatchObject({ status: 422, body: { error: { code: 'OPENING_NOT_PAID' } } });
    }
    expect(
      (await call('GET', `/v1/connection-requests/${id}`, 'secretario')).body.request,
    ).toMatchObject({
      status: 'approved_pending_payment',
      connectionId: null,
    });

    // Paid and then cancelled (D-15): it waits for the payment again, same amount (D-13).
    const cancelled = await payOpening(id, 'jm.s2m01');
    const cancellation = await ctx.app.inject({
      method: 'POST',
      url: `/v1/payments/${cancelled}/request-cancellation`,
      headers: { ...(await ctx.authFor('jm.s2m01')), 'idempotency-key': randomUUID() },
      payload: { reason: 'Recibo capturado dos veces' },
    });
    await call(
      'POST',
      `/v1/approvals/${cancellation.json().payment.cancellations[0].approvalId}/resolve`,
      'presidente',
      { result: 'approved' },
    );
    expect(
      (await call('GET', `/v1/connection-requests/${id}`, 'secretario')).body.request,
    ).toMatchObject({
      status: 'approved_pending_payment',
      openingCharge: { amount: OPENING_AMOUNT, cancelledOn: null },
    });
    expect(
      (await call('POST', `/v1/connection-requests/${id}/activate`, 'jm.s2m01', {})).body.error
        .code,
    ).toBe('OPENING_NOT_PAID');

    // Once paid, it can no longer be cancelled and it is activated.
    await payOpening(id, 'tesorero');
    expect(
      (await call('GET', `/v1/connection-requests/${id}`, 'secretario')).body.request.status,
    ).toBe('pending_installation');
    expect(
      (await call('POST', `/v1/connection-requests/${id}/cancel`, 'secretario', { reason: 'x' }))
        .body.error,
    ).toMatchObject({
      code: 'INVALID_STATE',
      details: { status: 'pending_installation', action: 'cancel' },
    });

    const activated = await call('POST', `/v1/connection-requests/${id}/activate`, 'jm.s2m01', {
      reference: 'Casa principal',
    });
    expect(activated.status).toBe(201);
    expect(activated.body.request).toMatchObject({
      status: 'installed',
      connectionId: activated.body.connection.id,
    });
    expect(activated.body.connection).toMatchObject({
      address: 'Calle Nueva Cecilia',
      blockCode: 'S2-M01',
      activatedOn: today(),
      connectionRequestId: id,
      units: [
        {
          reference: 'Casa principal',
          status: 'active',
          billingStartPeriod: today().slice(0, 7),
          holder: expect.objectContaining({ fullName: 'Cecilia Solicitante' }),
        },
      ],
    });
    expect(
      (await call('POST', `/v1/connection-requests/${id}/activate`, 'secretario', {})).body.error,
    ).toMatchObject({
      code: 'INVALID_STATE',
      details: { status: 'installed', action: 'activate' },
    });
  });

  it('rejects with the agreement only with a reason', async () => {
    const created = await newRequest('secretario', 'S1-M02', 'Daniel');
    const id = created.body.request.id;
    const rejectedAgreement = await newAgreement('rejected');
    const noReason = await call('POST', `/v1/connection-requests/${id}/resolve`, 'secretario', {
      agreementId: rejectedAgreement,
    });
    expect(noReason.body.error.details.issues).toEqual([
      { path: 'body.resolutionReason', message: 'Escribe el motivo del rechazo.' },
    ]);
    const rejected = await call('POST', `/v1/connection-requests/${id}/resolve`, 'secretario', {
      agreementId: rejectedAgreement,
      resolutionReason: 'No hay presión suficiente en la zona',
    });
    expect(rejected.body.request).toMatchObject({
      status: 'rejected',
      resolutionReason: 'No hay presión suficiente en la zona',
      openingCharge: null,
    });
    expect(
      (await call('POST', `/v1/connection-requests/${id}/activate`, 'secretario', {})).body.error,
    ).toMatchObject({
      code: 'INVALID_STATE',
      details: { status: 'rejected', action: 'activate' },
    });
  });

  it('cancels a request before payment, with the opening charge (D-12)', async () => {
    const pending = await newRequest('jm.s2m01', 'S2-M01', 'Elena');
    const withdrawn = await call(
      'POST',
      `/v1/connection-requests/${pending.body.request.id}/cancel`,
      'jm.s2m01',
      {
        reason: 'El solicitante la retiró',
      },
    );
    expect(withdrawn.body.request).toMatchObject({
      status: 'cancelled',
      cancelledOn: today(),
      cancellationReason: 'El solicitante la retiró',
    });
    expect(
      (
        await call(
          'POST',
          `/v1/connection-requests/${pending.body.request.id}/cancel`,
          'secretario',
          { reason: 'x' },
        )
      ).body.error,
    ).toMatchObject({ code: 'INVALID_STATE', details: { status: 'cancelled', action: 'cancel' } });

    const approved = await newRequest('secretario', 'S1-M02', 'Fausto');
    const id = approved.body.request.id;
    await call('POST', `/v1/connection-requests/${id}/resolve`, 'secretario', {
      agreementId: await newAgreement('approved_by_majority'),
    });
    expect(
      (await call('POST', `/v1/connection-requests/${id}/cancel`, 'jm.s2m01', { reason: 'x' })).body
        .error.code,
    ).toBe('OUT_OF_SCOPE');
    expect(
      (await call('POST', `/v1/connection-requests/${id}/cancel`, 'secretario', {})).status,
    ).toBe(400);
    const cancelled = await call('POST', `/v1/connection-requests/${id}/cancel`, 'jm.s1m02', {
      reason: 'No pagó la apertura a tiempo',
    });
    expect(cancelled.body.request).toMatchObject({
      status: 'cancelled',
      openingCharge: { amount: OPENING_AMOUNT, cancelledOn: today() },
    });
  });

  it('validates applicants and blocks', async () => {
    expect(
      (
        await call('POST', '/v1/connection-requests', 'secretario', {
          applicantId: 999_999,
          address: 'X',
          blockId: await blockId('S1-M01'),
        })
      ).body.error.code,
    ).toBe('NOT_FOUND');
    const [someone] = await ctx.owner.select({ id: person.id }).from(person).limit(1);
    expect(
      (
        await call('POST', '/v1/connection-requests', 'secretario', {
          applicantId: someone?.id,
          address: 'X',
          blockId: 999_999,
        })
      ).body.error.code,
    ).toBe('NOT_FOUND');
  });

  // --- Permissions ----------------------------------------------------------------------------

  const cases: [string, 'GET' | 'POST', string, Record<string, unknown> | undefined, string[]][] = [
    [
      'create pre-existing',
      'POST',
      '/v1/connections/pre-existing',
      { address: 'X', blockId: 1, unit: { holderPersonId: 1, billingStartPeriod: '2025-01' } },
      ['admin', 'presidente', 'tesorero', 'vocal'],
    ],
    ['connection detail', 'GET', '/v1/connections/1', undefined, ['admin']],
    ['list agreements', 'GET', '/v1/agreements', undefined, ['admin', 'jm.s1m01']],
    [
      'create agreement',
      'POST',
      '/v1/agreements',
      { meetingDate: '2026-11-01', topic: 'X', result: 'rejected' },
      ['admin', 'presidente', 'tesorero', 'vocal', 'jm.s1m01'],
    ],
    ['list requests', 'GET', '/v1/connection-requests', undefined, ['admin']],
    [
      'create request',
      'POST',
      '/v1/connection-requests',
      { applicantId: 1, address: 'X', blockId: 1 },
      ['admin', 'presidente', 'tesorero', 'vocal'],
    ],
    [
      'resolve request',
      'POST',
      '/v1/connection-requests/1/resolve',
      { agreementId: 1 },
      ['admin', 'presidente', 'tesorero', 'vocal', 'jm.s1m01'],
    ],
    [
      'activate request',
      'POST',
      '/v1/connection-requests/1/activate',
      {},
      ['admin', 'presidente', 'tesorero', 'vocal'],
    ],
    [
      'cancel request',
      'POST',
      '/v1/connection-requests/1/cancel',
      { reason: 'x' },
      ['admin', 'presidente', 'tesorero', 'vocal'],
    ],
  ];
  it.each(
    cases.flatMap(([name, method, url, payload, usernames]) =>
      usernames.map((username) => [name, username, method, url, payload] as const),
    ),
  )('%s is forbidden for %s', async (_name, username, method, url, payload) => {
    const res = await call(method, url, username, payload);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
