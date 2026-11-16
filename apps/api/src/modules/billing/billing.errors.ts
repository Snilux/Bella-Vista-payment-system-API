import { formatMoney, formatPeriod, type PaymentSelectionIssue } from '@bella-vista/shared';
import { AppError, errors } from '../../lib/errors.js';

// Business errors of billing (2.3 §5): codes in English, messages in Spanish.

const periods = (issues: PaymentSelectionIssue[]) =>
  issues.map((i) => i.period).filter((p): p is string => p !== null);

const list = (values: string[]) => values.map(formatPeriod).join(', ');

export const billingErrors = {
  monthOrder: (issues: PaymentSelectionIssue[]) =>
    new AppError(
      'MONTH_ORDER',
      422,
      'Los meses se pagan en orden, desde el más antiguo y sin saltar ninguno; los adelantados solo cuando no queda nada pendiente.',
      { periods: periods(issues) },
    ),
  periodAlreadyPaid: (paid: string[]) =>
    new AppError(
      'PERIOD_ALREADY_PAID',
      409,
      paid.length === 1
        ? `${list(paid)} ya está pagado.`
        : `Estos meses ya están pagados: ${list(paid)}.`,
      { periods: paid },
    ),
  /** Selections the domain rejects for other reasons (not billable, no rate, repeated). */
  invalidSelection: (issues: PaymentSelectionIssue[]) =>
    errors.validation({
      issues: issues.map((issue) => ({
        path: 'body.periods',
        message:
          issue.code === 'RATE_MISSING'
            ? `${formatPeriod(issue.period ?? '')} no tiene tarifa autorizada; no se puede cobrar todavía.`
            : issue.code === 'DUPLICATE_PERIOD'
              ? `${formatPeriod(issue.period ?? '')} está repetido.`
              : issue.code === 'EMPTY_SELECTION'
                ? 'Elija al menos un mes.'
                : `${issue.period ? formatPeriod(issue.period) : 'Ese periodo'} no se cobra a esta unidad.`,
      })),
      selection: issues,
    }),
  totalChanged: (expected: number, details: Record<string, unknown> & { total: number }) =>
    new AppError(
      'TOTAL_CHANGED',
      409,
      `El total cambió: ahora es ${formatMoney(details.total)} (antes ${formatMoney(expected)}). Revise el resumen y confirme de nuevo.`,
      { expectedTotal: expected, ...details },
    ),
  duplicatePaperFolio: (paperFolio: string) =>
    new AppError(
      'DUPLICATE_PAPER_FOLIO',
      409,
      `El folio de papel ${paperFolio} ya está registrado en esta caja.`,
      { paperFolio },
    ),
  chargeNotFound: (id: number) =>
    errors.validation({
      issues: [{ path: 'body.extraChargeIds', message: `No existe el cargo ${id}.` }],
    }),
  chargeNotPayable: (message: string, status: string) =>
    errors.invalidState(message, status, 'pay_charge'),
  chargeTarget: (message: string) =>
    errors.validation({ issues: [{ path: 'body.extraChargeIds', message }] }),
  unitNotFound: () => new AppError('NOT_FOUND', 404, 'No existe esa unidad.'),
  paymentNotFound: () => new AppError('NOT_FOUND', 404, 'No existe ese pago.'),
  paymentCancelled: (action: string) =>
    errors.invalidState('El pago está cancelado.', 'cancelled', action),
  cancellationPending: () =>
    errors.invalidState(
      'El pago ya tiene una solicitud de cancelación pendiente.',
      'cancellation_pending',
      'request_cancellation',
    ),
  openingInstalled: (action: string) =>
    errors.invalidState(
      'El pago liquidó la apertura de una toma que ya está instalada; no se puede cancelar.',
      'installed',
      action,
    ),
};
