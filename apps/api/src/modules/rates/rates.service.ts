import {
  type CreateFeeAmountRequest,
  type CreateFeeRequest,
  type CreateRateRequest,
  currentPeriod,
  type Fee,
  formatMoney,
  formatPeriod,
  isValidRateEffectivePeriod,
  type Rate,
} from '@bella-vista/shared';
import { type Actor, writeAudit } from '../../db/audit.js';
import type { Database, Transaction } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { businessDate } from '../../lib/dates.js';
import { AppError, errors } from '../../lib/errors.js';
import { dateToPeriod, periodToDate } from '../../lib/periods.js';
import type { ApprovalHandler } from '../approvals/approval-registry.js';
import * as repo from './rates.repository.js';

// Rates and fees (CU-12; RF-TAR; D-05, D-13, D-18, D-20). The treasurer registers a rate with
// its meeting agreement and the president approves it through the approvals inbox; fee
// amounts keep their history and apply from their date.

export interface RatesServiceDeps {
  db: Database;
  now: () => Date;
  timeZone: string;
}

type Executor = Database | Transaction;

export const rateErrors = {
  invalidEffectivePeriod: (period: string, current: string) =>
    new AppError(
      'INVALID_RATE_EFFECTIVE_PERIOD',
      422,
      `Una tarifa nueva solo puede entrar en vigor a partir de ${formatPeriod(nextPeriod(current))}.`,
      { effectivePeriod: period, currentPeriod: current },
    ),
  periodTaken: (period: string) =>
    errors.invalidState(
      `${formatPeriod(period)} ya tiene una tarifa autorizada o pendiente de autorizar.`,
      'rate_exists',
      'register_rate',
    ),
  agreementNotApproved: () =>
    errors.validation({
      issues: [{ path: 'body.agreementId', message: 'El acuerdo de junta no fue aprobado.' }],
    }),
  feeNameTaken: () => new AppError('DUPLICATE_CODE', 409, 'Ya existe un concepto con ese nombre.'),
};

function nextPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

function toRate(row: repo.RateRow): Rate {
  return {
    id: row.id,
    effectivePeriod: dateToPeriod(row.effectivePeriod),
    amount: row.amount,
    approvedOn: row.approvedOn,
    agreement: { id: row.agreementId, folio: row.agreementFolio },
    status: row.result ?? 'pending',
    approvalId: row.approvalId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createRatesService(deps: RatesServiceDeps) {
  const { db } = deps;
  const today = () => businessDate(deps.now(), deps.timeZone);

  async function rateOrThrow(tx: Executor, id: number): Promise<Rate> {
    const row = await repo.findRate(tx, id);
    if (!row) throw errors.internal();
    return toRate(row);
  }

  async function toFees(tx: Executor, rows: { id: number; type: Fee['type']; name: string }[]) {
    const amounts = await repo.amountsOf(
      tx,
      rows.map((r) => r.id),
    );
    const on = today();
    return rows.map((row): Fee => {
      const history = amounts
        .filter((a) => a.feeId === row.id)
        .map((a) => ({ effectiveFrom: a.effectiveFrom, amount: a.amount }));
      return {
        id: row.id,
        type: row.type,
        name: row.name,
        currentAmount: history.find((a) => a.effectiveFrom <= on) ?? null,
        amounts: history,
      };
    });
  }

  async function feeOrThrow(tx: Executor, id: number): Promise<Fee> {
    const row = await repo.findFee(tx, id);
    if (!row) throw errors.internal();
    const [fee] = await toFees(tx, [row]);
    if (!fee) throw errors.internal();
    return fee;
  }

  return {
    async listRates() {
      return { rates: (await repo.listRates(db)).map(toRate) };
    },

    /**
     * Registers a rate pending the president's approval (D-20). It starts from the month
     * after the current one (D-05) or, to capture the startup history (D-18), before the
     * earliest approved rate.
     */
    async registerRate(actor: Actor, input: CreateRateRequest) {
      const now = deps.now();
      const current = currentPeriod(now, deps.timeZone);
      return db.transaction(async (tx) => {
        await repo.lockRateRegistration(tx);
        const earliest = await repo.earliestApprovedPeriod(tx);
        if (
          !isValidRateEffectivePeriod(
            input.effectivePeriod,
            current,
            earliest ? dateToPeriod(earliest) : null,
          )
        ) {
          throw rateErrors.invalidEffectivePeriod(input.effectivePeriod, current);
        }
        const agreement = await repo.findAgreement(tx, input.agreementId);
        if (!agreement) throw new AppError('NOT_FOUND', 404, 'No existe ese acuerdo de junta.');
        if (agreement.result !== 'approved_by_majority') throw rateErrors.agreementNotApproved();

        const effectivePeriod = periodToDate(input.effectivePeriod);
        if ((await repo.openRatesFor(tx, effectivePeriod)).length > 0) {
          throw rateErrors.periodTaken(input.effectivePeriod);
        }
        const reason =
          input.reason ??
          `Tarifa de ${formatMoney(input.amount)} desde ${formatPeriod(input.effectivePeriod)} (acuerdo ${agreement.folio}).`;
        const { id, approvalId } = await repo.insertRateWithApproval(tx, {
          effectivePeriod,
          amount: input.amount,
          approvedOn: input.approvedOn,
          agreementId: agreement.id,
          reason,
          requestedBy: actor.userAccountId,
          requestedAt: now,
        });
        await writeAudit(tx, actor, {
          action: 'create',
          table: 'rate',
          recordId: id,
          after: {
            effectivePeriod,
            amount: input.amount,
            approvedOn: input.approvedOn,
            agreementId: agreement.id,
            approvalId,
          },
          reason,
        });
        return { rate: await rateOrThrow(tx, id) };
      });
    },

    async listFees() {
      return { fees: await toFees(db, await repo.listFees(db)) };
    },

    /** A new fee in the catalog (RF-TAR-03); its amount is captured separately. */
    async createFee(actor: Actor, input: CreateFeeRequest) {
      try {
        return await db.transaction(async (tx) => {
          const id = await repo.insertFee(tx, {
            type: input.type,
            name: input.name,
            createdBy: actor.userAccountId,
          });
          await writeAudit(tx, actor, {
            action: 'create',
            table: 'fee',
            recordId: id,
            after: { type: input.type, name: input.name },
          });
          return { fee: await feeOrThrow(tx, id) };
        });
      } catch (error) {
        if (isUniqueViolation(error, 'fee_name_unique')) throw rateErrors.feeNameTaken();
        throw error;
      }
    },

    /**
     * A new amount of a fee from `effectiveFrom` (today or later, D-13). Charges store no
     * amount (it is the one in force on their date), so an amount that would change an
     * existing charge is refused.
     */
    async addFeeAmount(actor: Actor, id: number, input: CreateFeeAmountRequest) {
      const on = today();
      if (input.effectiveFrom < on) {
        throw errors.validation({
          issues: [
            {
              path: 'body.effectiveFrom',
              message: 'El importe nuevo no puede aplicar a fechas pasadas.',
            },
          ],
        });
      }
      return db.transaction(async (tx) => {
        const fee = await repo.lockFee(tx, id);
        if (!fee) throw new AppError('NOT_FOUND', 404, 'No existe ese concepto.');
        if (await repo.hasChargesSince(tx, id, input.effectiveFrom)) {
          throw errors.invalidState(
            'Ya hay cargos de este concepto con esa fecha o posterior; su importe no puede cambiar.',
            'charged',
            'add_fee_amount',
          );
        }
        const before = await repo.amountOn(tx, id, input.effectiveFrom);
        try {
          await repo.insertFeeAmount(tx, {
            feeId: id,
            effectiveFrom: input.effectiveFrom,
            amount: input.amount,
            createdBy: actor.userAccountId,
          });
        } catch (error) {
          if (isUniqueViolation(error, 'fee_amount_pk')) {
            throw errors.invalidState(
              'Ese concepto ya tiene un importe desde esa fecha.',
              'amount_exists',
              'add_fee_amount',
            );
          }
          throw error;
        }
        await writeAudit(tx, actor, {
          action: 'add_amount',
          table: 'fee',
          recordId: id,
          before: { amount: before },
          after: { effectiveFrom: input.effectiveFrom, amount: input.amount },
        });
        return { fee: await feeOrThrow(tx, id) };
      });
    },
  };
}

export type RatesService = ReturnType<typeof createRatesService>;

/**
 * rate: approving it makes it price its months (D-20). A second approved rate for the same
 * period is refused here with a clear message (the database trigger is the last defense).
 */
export const rateApprovalHandler: ApprovalHandler = {
  async onApproved({ tx, approvalId }) {
    const rate = await repo.lockRateByApproval(tx, approvalId);
    if (!rate) return;
    const others = await repo.openRatesFor(tx, rate.effectivePeriod, rate.id);
    if (others.some((r) => r.result === 'approved')) {
      throw errors.invalidState(
        `${formatPeriod(dateToPeriod(rate.effectivePeriod))} ya tiene una tarifa autorizada.`,
        'rate_exists',
        'approve_rate',
      );
    }
  },
  async onRejected() {},
  async describe(db, approvalIds) {
    const rows = await repo.ratesByApproval(db, approvalIds);
    return new Map(
      rows.map((r) => [
        r.approvalId,
        `Tarifa de ${formatMoney(r.amount)} desde ${formatPeriod(dateToPeriod(r.effectivePeriod))}`,
      ]),
    );
  },
};
