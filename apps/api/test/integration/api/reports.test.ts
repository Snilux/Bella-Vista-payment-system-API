import { randomUUID } from 'node:crypto';
import { blockReportResponseSchema, communityReportResponseSchema } from '@bella-vista/shared';
import { and, between, eq, inArray, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  cashbox,
  unit,
  userAccount,
  vBlock,
  vCashboxBalance,
  vCashboxMovement,
} from '../../../src/db/schema/index.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// API step 8, report data (RF-REP-01, RF-REP-02). In October 2026 a block leader, the
// president (support) and the treasurer collect, and one payment is cancelled; the community
// report of October must agree with the monthly closings of every cashbox. The clock ends on
// 2026-11-16 (Mexico City). Cases run in order.

const NOW = new Date('2026-11-16T18:00:00Z');
const OCTOBER = new Date('2026-10-20T18:00:00Z');

describe.skipIf(!testDatabaseUrl)('reports', () => {
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
    return { status: res.statusCode, body: res.json() };
  };
  const unitId = async (reference: string) => {
    const [row] = await ctx.owner
      .select({ id: unit.id })
      .from(unit)
      .where(eq(unit.reference, reference));
    return row?.id ?? 0;
  };
  const blockId = async (code: string) => {
    const [row] = await ctx.owner
      .select({ id: vBlock.id })
      .from(vBlock)
      .where(eq(vBlock.code, code));
    return row?.id ?? 0;
  };
  /** Pays the oldest unpaid month of a unit at the previewed total. */
  const payOldest = async (username: string, reference: string, folio: string) => {
    const id = await unitId(reference);
    const statement = await call('GET', `/v1/units/${id}/account-statement`, 'tesorero');
    const month = statement.body.statement.months.find(
      (m: { status: string }) => m.status === 'overdue' || m.status === 'pending',
    );
    const preview = await call('POST', '/v1/payments/preview', username, {
      unitId: id,
      periods: [month.period],
    });
    const paid = await call(
      'POST',
      '/v1/payments',
      username,
      {
        unitId: id,
        periods: [month.period],
        paperFolio: folio,
        expectedTotal: preview.body.preview.total,
      },
      randomUUID(),
    );
    expect(paid.status).toBe(201);
    return paid.body.payment;
  };
  const october = { dateFrom: '2026-10-01', dateTo: '2026-10-31' };
  const collectedOf = async (range: { dateFrom: string; dateTo: string }) => {
    const [row] = await ctx.owner
      .select({ total: sql<number>`coalesce(sum(${vCashboxMovement.amount}), 0)`.mapWith(Number) })
      .from(vCashboxMovement)
      .where(
        and(
          inArray(vCashboxMovement.kind, ['payment', 'payment_cancellation']),
          between(vCashboxMovement.occurredOn, range.dateFrom, range.dateTo),
        ),
      );
    return row?.total ?? 0;
  };

  it('prepares October: payments by a leader, the president and the treasurer, one cancelled', async () => {
    ctx.setNow(OCTOBER);
    await payOldest('jm.s1m01', 'Planta alta', 'R-OCT-1');
    await payOldest('presidente', 'Casa A', 'R-OCT-2');
    const cancelled = await payOldest('tesorero', 'Casa B', 'R-OCT-3');
    const request = await call(
      'POST',
      `/v1/payments/${cancelled.id}/request-cancellation`,
      'tesorero',
      { reason: 'Unidad equivocada' },
      randomUUID(),
    );
    await call(
      'POST',
      `/v1/approvals/${request.body.payment.cancellations[0].approvalId}/resolve`,
      'presidente',
      { result: 'approved' },
    );
    ctx.setNow(NOW);
  });

  // --- Community report -----------------------------------------------------------------------

  it('gives the community report of a month with every figure', async () => {
    const res = await call('GET', '/v1/reports/community?from=2026-10&to=2026-10', 'secretario');
    expect(res.status).toBe(200);
    expect(communityReportResponseSchema.safeParse(res.body).success).toBe(true);
    const report = res.body.report;
    expect(report.range).toMatchObject({ from: '2026-10', to: '2026-10', ...october });
    expect(report.sections.map((s: { code: string }) => s.code)).toEqual(['S1', 'S2']);
    const s1m02 = report.sections[0].blocks.find((b: { code: string }) => b.code === 'S1-M02');
    // Collected in S1-M02 by the president (support); the treasurer's payment was cancelled.
    expect(s1m02.collected).toBeGreaterThan(0);
    expect(report.supportCashboxes).toEqual([
      expect.objectContaining({ label: 'Apoyo · Ana Salinas', collected: s1m02.collected }),
    ]);
    expect(report.committee.collected).toBe(0);

    // Collected by blocks = collected by cashboxes (same movements as the closings).
    expect(report.totals.collected).toBe(await collectedOf(october));
    const balances = await ctx.owner
      .select({ balance: vCashboxBalance.balance })
      .from(vCashboxBalance);
    expect(report.totals.expectedCommunityFunds).toBe(
      balances.reduce((sum, b) => sum + b.balance, 0),
    );
    expect(
      report.totals.cashWithLeaders + report.totals.cashInSupport + report.totals.committeeBalance,
    ).toBe(report.totals.expectedCommunityFunds);
    const debts = report.sections.flatMap((s: { blocks: { totalDue: number }[] }) => s.blocks);
    expect(report.totals.totalDue).toBe(
      debts.reduce((sum: number, b: { totalDue: number }) => sum + b.totalDue, 0),
    );
  });

  it('agrees with the monthly closings of October of every cashbox', async () => {
    const boxes = await ctx.owner.select({ id: cashbox.id }).from(cashbox);
    let collected = 0;
    let differences = 0;
    for (const box of boxes) {
      const opened = await call('POST', '/v1/closings', 'tesorero', {
        type: 'monthly',
        period: '2026-10',
        cashboxId: box.id,
      });
      expect(opened.status).toBe(201);
      const { figures, id } = opened.body.closing;
      collected += figures.payments + figures.cancellations;
      if (figures.payments > 0) {
        // Each cashbox that collected is counted with $10.00 more than expected.
        await call('POST', `/v1/closings/${id}/count`, 'tesorero', {
          countedCash: figures.expectedBalance + 1_000,
          notes: 'Sobrante',
        });
        differences += 1_000;
      }
    }
    const report = (await call('GET', '/v1/reports/community?from=2026-10', 'tesorero')).body
      .report;
    expect(report.totals.collected).toBe(collected);
    expect(report.totals.closingDifferences).toBe(differences);
  });

  // --- Block report ---------------------------------------------------------------------------

  it('gives the registry report of a block (RF-REP-01)', async () => {
    const res = await call(
      'GET',
      `/v1/reports/block?blockId=${await blockId('S1-M01')}&from=2025-01&to=2026-11`,
      'jm.s1m01',
    );
    expect(res.status).toBe(200);
    expect(blockReportResponseSchema.safeParse(res.body).success).toBe(true);
    const report = res.body.report;
    expect(report.block).toMatchObject({
      code: 'S1-M01',
      section: { code: 'S1' },
      leader: { fullName: expect.any(String), phone: expect.any(String) },
    });
    expect(report.connections.map((c: { address: string }) => c.address)).toEqual(
      expect.arrayContaining(['Av. Hidalgo 12', 'Calle Morelos 45']),
    );
    const units = report.connections.flatMap((c: { units: unknown[] }) => c.units);
    const alta = units.find((u: { reference: string }) => u.reference === 'Planta alta');
    expect(alta.payments.map((p: { paperFolio: string }) => p.paperFolio)).toContain('R-OCT-1');
    expect(alta.debtMonths.length).toBe(alta.debt.overdueCount + 1);
    expect(alta.holder).toMatchObject({ fullName: expect.any(String) });
    const morelos = units.find((u: { advances: string[] }) => u.advances.length > 0);
    expect(morelos.advances).toEqual(['2026-12']);

    expect(report.totals).toMatchObject({
      activeUnits: units.filter((u: { status: string }) => u.status === 'active').length,
      collected: report.cashbox.collected,
      totalDue: units.reduce(
        (sum: number, u: { debt: { totalDue: number } }) => sum + u.debt.totalDue,
        0,
      ),
      advances: 1,
    });
    expect(report.cashbox).toMatchObject({
      label: 'S1-M01',
      collected:
        report.cashbox.collectedFees +
        report.cashbox.collectedCharges +
        report.cashbox.cancellations,
      lastClosing: { type: 'monthly', dateFrom: '2026-10-01' },
    });
  });

  it('keeps the block report to the leader of the block', async () => {
    const other = await call(
      'GET',
      `/v1/reports/block?blockId=${await blockId('S1-M01')}`,
      'jm.s1m02',
    );
    expect(other.body.error.code).toBe('OUT_OF_SCOPE');
    expect(
      (await call('GET', `/v1/reports/block?blockId=${await blockId('S1-M02')}`, 'vocal')).status,
    ).toBe(200);
    expect(
      (await call('GET', '/v1/reports/block?blockId=999999', 'tesorero')).body.error.code,
    ).toBe('NOT_FOUND');
    const backwards = await call(
      'GET',
      '/v1/reports/community?from=2026-10&to=2026-09',
      'tesorero',
    );
    expect(backwards.body.error.code).toBe('VALIDATION_ERROR');
  });

  it.each(['jm.s1m01', 'admin'])('%s does not get the community report (403)', async (username) => {
    expect((await call('GET', '/v1/reports/community', username)).body.error.code).toBe(
      'FORBIDDEN',
    );
  });

  it('the superadmin gets no block report (403)', async () => {
    expect(
      (await call('GET', `/v1/reports/block?blockId=${await blockId('S1-M01')}`, 'admin')).body
        .error.code,
    ).toBe('FORBIDDEN');
  });
});
