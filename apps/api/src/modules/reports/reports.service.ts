import {
  type BlockReport,
  type BlockReportQuery,
  type CommunityReport,
  currentPeriod,
  type ReportQuery,
} from '@bella-vista/shared';
import type { Database } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { periodToDate } from '../../lib/periods.js';
import type { AuthenticatedAccount } from '../../plugins/auth.js';
import { assertInScope } from '../../plugins/permissions.js';
import { loadAccountStatements } from '../billing/account-statements.js';
import { cashboxLabels } from '../cashboxes/cashboxes.repository.js';
import * as repo from './reports.repository.js';

// Report data (CU-23, CU-24; RF-REP-01, RF-REP-02). Money figures of the month range come from
// the same movements as the closings, so they agree with them; debts are the account statement
// at the moment of the query (D-25).

export interface ReportsServiceDeps {
  db: Database;
  now: () => Date;
  timeZone: string;
}

const lastDay = (period: string) => {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};

type Totals = Map<string, number>;

/** Sum of the movement kinds of one cashbox. */
const kindTotals = (rows: { cashboxId: number; kind: string; amount: number }[], id: number) => {
  const totals: Totals = new Map();
  for (const row of rows) {
    if (row.cashboxId === id) totals.set(row.kind, (totals.get(row.kind) ?? 0) + row.amount);
  }
  return (kind: string) => totals.get(kind) ?? 0;
};

export function createReportsService(deps: ReportsServiceDeps) {
  const { db } = deps;

  function rangeOf(query: ReportQuery) {
    const now = deps.now();
    const current = currentPeriod(now, deps.timeZone);
    const from = query.from ?? query.to ?? current;
    const to = query.to ?? query.from ?? current;
    return {
      from,
      to,
      dateFrom: periodToDate(from),
      dateTo: lastDay(to),
      debtAsOf: now.toISOString(),
      now,
    };
  }

  async function statementsOf(unitIds: number[], now: Date) {
    return loadAccountStatements(db, unitIds, now, deps.timeZone);
  }

  return {
    /** Registry report of a block (RF-REP-01); a block leader only of their block. */
    async block(
      viewer: AuthenticatedAccount,
      query: BlockReportQuery,
    ): Promise<{ report: BlockReport }> {
      assertInScope(viewer, query.blockId);
      const range = rangeOf(query);
      const block = await repo.findBlock(db, query.blockId);
      if (!block) throw new AppError('NOT_FOUND', 404, 'No existe esa manzana.');

      const [connections, unitRows, boxes] = await Promise.all([
        repo.connectionsOfBlock(db, block.id),
        repo.units(db, block.id),
        repo.cashboxes(db),
      ]);
      const unitIds = unitRows.map((u) => u.id);
      const [statements, payments] = await Promise.all([
        statementsOf(unitIds, range.now),
        repo.paymentsOfUnits(db, unitIds, range),
      ]);

      const box = boxes.find((b) => b.type === 'block' && b.blockId === block.id) ?? null;
      const [movements, split, pending, opening, closing, labels] = box
        ? await Promise.all([
            repo.movementsByKind(db, range, box.id),
            repo.paymentSplit(db, box.id, range),
            repo.pendingHandovers(db, box.id),
            repo.approvedOpeningBalance(db, box.id),
            repo.lastClosing(db, box.id),
            cashboxLabels(db, [box.id]),
          ])
        : [[], { fees: 0, charges: 0 }, 0, null, null, []];
      const total = kindTotals(movements, box?.id ?? -1);

      let activeUnits = 0;
      let totalDue = 0;
      let advances = 0;
      const unitsByConnection = new Map<number, BlockReport['connections'][number]['units']>();
      for (const u of unitRows) {
        const loaded = statements.get(u.id);
        const months = loaded?.statement.months ?? [];
        const summary = loaded?.statement.summary;
        if (u.status === 'active') activeUnits++;
        totalDue += summary?.totalDue ?? 0;
        advances += summary?.advanceCount ?? 0;
        const list = unitsByConnection.get(u.connectionId) ?? [];
        list.push({
          id: u.id,
          folio: u.folio,
          reference: u.reference,
          holder: u.holderName
            ? { fullName: u.holderName, distinguishingNote: u.holderNote }
            : null,
          registeredOn: u.registeredOn,
          activatedOn: u.activatedOn,
          status: u.status,
          payments: payments
            .filter((p) => p.unitId === u.id)
            .map((p) => ({
              id: p.id,
              folio: p.folio,
              occurredAt: p.occurredAt.toISOString(),
              total: p.total,
              paperFolio: p.paperFolio,
              cancelled: p.cancelled,
            })),
          debtMonths: months.flatMap((m) =>
            m.status === 'pending' || m.status === 'overdue'
              ? [
                  {
                    period: m.period,
                    status: m.status,
                    baseAmount: m.baseAmount,
                    surcharge: m.surcharge,
                    total: m.total,
                  },
                ]
              : [],
          ),
          debt: {
            totalDue: summary?.totalDue ?? 0,
            overdueCount: summary?.overdueCount ?? 0,
            inDebtCycle: summary?.inDebtCycle ?? false,
          },
          advances: months.filter((m) => m.status === 'advance').map((m) => m.period),
        });
        unitsByConnection.set(u.connectionId, list);
      }

      const collected = total('payment') + total('payment_cancellation');
      return {
        report: {
          range: {
            from: range.from,
            to: range.to,
            dateFrom: range.dateFrom,
            dateTo: range.dateTo,
            debtAsOf: range.debtAsOf,
          },
          block: {
            id: block.id,
            code: block.code,
            name: block.name,
            section: { id: block.sectionId, code: block.sectionCode, name: block.sectionName },
            leader: block.leaderName
              ? { fullName: block.leaderName, phone: block.leaderPhone }
              : null,
          },
          connections: connections.map((c) => ({
            ...c,
            units: unitsByConnection.get(c.id) ?? [],
          })),
          cashbox: {
            id: box?.id ?? null,
            label: labels[0]?.label ?? block.code,
            openingBalance: opening,
            collectedFees: split.fees,
            collectedCharges: split.charges,
            cancellations: total('payment_cancellation'),
            collected,
            handedOver: -total('handover_out'),
            pendingHandover: pending,
            expectedBalance: box?.balance ?? 0,
            lastClosing: closing,
          },
          totals: { activeUnits, collected, totalDue, advances },
        },
      };
    },

    /** Community report (RF-REP-02): every block, the support cashboxes and the committee. */
    async community(query: ReportQuery): Promise<{ report: CommunityReport }> {
      const range = rangeOf(query);
      const [blocks, unitRows, boxes, movements, paid, cancelled, categories, differences] =
        await Promise.all([
          repo.listBlocks(db),
          repo.units(db),
          repo.cashboxes(db),
          repo.movementsByKind(db, range),
          repo.paymentsByBlock(db, range),
          repo.cancellationsByBlock(db, range),
          repo.expensesByCategory(db, range),
          repo.closingDifferences(db, range),
        ]);
      const statements = await statementsOf(
        unitRows.map((u) => u.id),
        range.now,
      );
      const labels = await cashboxLabels(
        db,
        boxes.map((b) => b.id),
      );

      type Figures = CommunityReport['sections'][number]['totals'];
      const zero = (): Figures => ({
        activeUnits: 0,
        collected: 0,
        totalDue: 0,
        advances: 0,
        handedOver: 0,
        cashWithLeader: 0,
      });
      const add = (into: Figures, from: Figures) => {
        for (const key of Object.keys(into) as (keyof Figures)[]) into[key] += from[key];
      };

      const perBlock = new Map<number, Figures>();
      for (const u of unitRows) {
        if (u.blockId === null) continue;
        const figures = perBlock.get(u.blockId) ?? zero();
        const summary = statements.get(u.id)?.statement.summary;
        if (u.status === 'active') figures.activeUnits++;
        figures.totalDue += summary?.totalDue ?? 0;
        figures.advances += summary?.advanceCount ?? 0;
        perBlock.set(u.blockId, figures);
      }
      for (const p of paid) {
        if (p.blockId === null) continue;
        const figures = perBlock.get(p.blockId) ?? zero();
        figures.collected += p.amount;
        perBlock.set(p.blockId, figures);
      }
      for (const c of cancelled) {
        if (c.blockId === null) continue;
        const figures = perBlock.get(c.blockId) ?? zero();
        figures.collected -= c.amount;
        perBlock.set(c.blockId, figures);
      }
      for (const box of boxes) {
        if (box.type !== 'block' || box.blockId === null) continue;
        const figures = perBlock.get(box.blockId) ?? zero();
        figures.handedOver += -kindTotals(movements, box.id)('handover_out');
        figures.cashWithLeader += box.balance;
        perBlock.set(box.blockId, figures);
      }

      const sections: CommunityReport['sections'] = [];
      for (const b of blocks) {
        let current = sections.at(-1);
        if (!current || current.id !== b.sectionId) {
          current = {
            id: b.sectionId,
            code: b.sectionCode,
            name: b.sectionName,
            blocks: [],
            totals: zero(),
          };
          sections.push(current);
        }
        const figures = perBlock.get(b.id) ?? zero();
        current.blocks.push({ id: b.id, code: b.code, leaderName: b.leaderName, ...figures });
        add(current.totals, figures);
      }

      const supportCashboxes = boxes
        .filter((b) => b.type === 'support')
        .map((b) => {
          const total = kindTotals(movements, b.id);
          return {
            id: b.id,
            label: labels.find((l) => l.id === b.id)?.label ?? '',
            collected: total('payment') + total('payment_cancellation'),
            handedOver: -total('handover_out'),
            balance: b.balance,
          };
        });

      const committeeBox = boxes.find((b) => b.type === 'committee');
      const c = kindTotals(movements, committeeBox?.id ?? -1);
      const committee = {
        cashboxId: committeeBox?.id ?? 0,
        openingBalance: c('opening_balance'),
        collected: c('payment') + c('payment_cancellation'),
        handoversReceived: c('handover_in'),
        incomes: c('income'),
        expensesByCategory: categories,
        expenses: -c('expense'),
        refunds: c('expense_refund'),
        adjustments: c('adjustment'),
        balance: committeeBox?.balance ?? 0,
      };

      const blockTotals = zero();
      for (const s of sections) add(blockTotals, s.totals);
      const cashInSupport = supportCashboxes.reduce((sum, b) => sum + b.balance, 0);
      return {
        report: {
          range: {
            from: range.from,
            to: range.to,
            dateFrom: range.dateFrom,
            dateTo: range.dateTo,
            debtAsOf: range.debtAsOf,
          },
          sections,
          supportCashboxes,
          committee,
          totals: {
            collected: blockTotals.collected,
            cashWithLeaders: blockTotals.cashWithLeader,
            cashInSupport,
            committeeBalance: committee.balance,
            expectedCommunityFunds: boxes.reduce((sum, b) => sum + b.balance, 0),
            totalDue: blockTotals.totalDue,
            advances: blockTotals.advances,
            closingDifferences: differences,
          },
        },
      };
    },
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;
