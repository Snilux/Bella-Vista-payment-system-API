import {
  addMonths,
  type BlockReport,
  type ConnectionRequest,
  type ConnectionRequestStatus,
  computeAccountStatement,
  formatMoney,
  formatPeriod,
  type Period,
  periodOf,
} from '@bella-vista/shared';
import type { StatusTone } from '../../ui/index.js';

// How the registry screens say things (3.2 §10.2, §10.4, §10.7; 2.4 §7): "familia", never
// "unidad"; statuses with words, the color only reinforces them. Every function takes what the
// API sent; nothing here decides whether a month is overdue (the API and the domain do).

type Tag = { tone: StatusTone; label: string };

export type DebtSummary = { totalDue: number; overdueCount: number };

/** "Debe $450.00" with Recargo, "Debe $50.00" with Pendiente, or "Al corriente" with Pagado. */
export function debtView(debt: DebtSummary): { text: string; tag: Tag } {
  if (debt.totalDue <= 0) return { text: 'Al corriente', tag: { tone: 'paid', label: 'Pagado' } };
  const text = `Debe ${formatMoney(debt.totalDue)}`;
  return debt.overdueCount > 0
    ? { text, tag: { tone: 'surcharge', label: 'Recargo' } }
    : { text, tag: { tone: 'pending', label: 'Pendiente' } };
}

export const UNIT_STATUS_LABELS = {
  pending_activation: 'Por activar',
  active: 'Activa',
  suspended: 'Suspendida',
  deactivated: 'Dada de baja',
} as const;

export const CONNECTION_STATUS_LABELS = {
  active: 'Activa',
  suspended: 'Suspendida',
  deactivated: 'Dada de baja',
} as const;

/** The tag of a family that is not simply active: its status beats its debt. */
export function unitTag(status: keyof typeof UNIT_STATUS_LABELS, debt: DebtSummary): Tag {
  if (status === 'suspended') return { tone: 'cancelled', label: 'Suspendida' };
  if (status === 'deactivated') return { tone: 'cancelled', label: 'Dada de baja' };
  if (status === 'pending_activation') return { tone: 'advance', label: 'Por activar' };
  return debtView(debt).tag;
}

// --- P-01 · the block roster ----------------------------------------------------------------

export type RosterFilter = 'all' | 'debt' | 'surcharge' | 'suspended';

export const ROSTER_FILTERS: { value: RosterFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'debt', label: 'Con atraso' },
  { value: 'surcharge', label: 'Con recargo' },
  { value: 'suspended', label: 'Suspendidas' },
];

export type RosterRow = {
  unitId: number;
  title: string;
  subtitle: string;
  tag: Tag;
  /** Lower-case text the search box matches (name, distinguishing note, address, folios). */
  haystack: string;
  debt: DebtSummary;
  suspended: boolean;
};

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** One row per family of the block, connection by connection, as the report sends them. */
export function rosterRows(report: BlockReport): RosterRow[] {
  return report.connections.flatMap((connection) =>
    connection.units.map((unit) => {
      const holder = unit.holder
        ? [unit.holder.fullName, unit.holder.distinguishingNote].filter(Boolean).join(' · ')
        : 'Sin titular';
      const suspended = unit.status === 'suspended' || connection.status === 'suspended';
      return {
        unitId: unit.id,
        title: `${unit.folio} · ${holder}`,
        subtitle: [connection.folio, connection.address, unit.reference]
          .filter(Boolean)
          .join(' · '),
        tag: suspended
          ? { tone: 'cancelled' as const, label: 'Suspendida' }
          : unitTag(unit.status, unit.debt),
        haystack: normalize(
          [holder, connection.address, connection.folio, unit.folio, unit.reference]
            .filter(Boolean)
            .join(' '),
        ),
        debt: unit.debt,
        suspended,
      };
    }),
  );
}

/** The chips and the search box of P-01, on the rows already loaded (no request). */
export function filterRoster(rows: readonly RosterRow[], filter: RosterFilter, text: string) {
  const words = normalize(text.trim()).split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (filter === 'debt' && row.debt.totalDue <= 0) return false;
    if (filter === 'surcharge' && row.debt.overdueCount === 0) return false;
    if (filter === 'suspended' && !row.suspended) return false;
    return words.every((word) => row.haystack.includes(word));
  });
}

// --- Connection requests (S-02, S-03, J-06, P-06) ----------------------------------------------

/** S-02: one chip per status of the API, "Por resolver" first. */
export const REQUEST_FILTERS: { value: ConnectionRequestStatus; label: string }[] = [
  { value: 'requested', label: 'Por resolver' },
  { value: 'approved_pending_payment', label: 'Por pagar apertura' },
  { value: 'pending_installation', label: 'Por instalar' },
  { value: 'installed', label: 'Instaladas' },
  { value: 'rejected', label: 'Rechazadas' },
  { value: 'cancelled', label: 'Canceladas' },
];

/** The third line of a request card and its tag. */
export function requestStatusView(request: ConnectionRequest): { text: string; tag: Tag | null } {
  switch (request.status) {
    case 'requested':
      return { text: 'Por revisar en junta', tag: { tone: 'pending', label: 'Pendiente' } };
    case 'approved_pending_payment':
      return {
        text: request.openingCharge
          ? `Aprobada · apertura de ${formatMoney(request.openingCharge.amount)} por pagar`
          : 'Aprobada · apertura por pagar',
        tag: { tone: 'pending', label: 'Por pagar' },
      };
    case 'pending_installation':
      return {
        text: 'Aprobada · apertura pagada',
        tag: { tone: 'advance', label: 'Por instalar' },
      };
    case 'installed':
      return { text: 'Toma instalada', tag: { tone: 'paid', label: 'Instalada' } };
    case 'rejected':
      return {
        text: request.resolutionReason ? `Rechazada: ${request.resolutionReason}` : 'Rechazada',
        tag: { tone: 'overdue', label: 'Rechazada' },
      };
    case 'cancelled':
      return {
        text: request.cancellationReason ? `Cancelada: ${request.cancellationReason}` : 'Cancelada',
        tag: { tone: 'cancelled', label: 'Cancelada' },
      };
  }
}

/** D-12: only requested or approved with the opening still unpaid can be cancelled. */
export const canCancelRequest = (request: Pick<ConnectionRequest, 'status'>) =>
  request.status === 'requested' || request.status === 'approved_pending_payment';

// --- Months ---------------------------------------------------------------------------------

/** The current business month (America/Mexico_City). */
export const currentPeriod = (now: Date = new Date()): Period => periodOf(now);

/** Month options from `from` to `to` (inclusive), newest first, as "Junio 2026". */
export function monthOptions(from: Period, to: Period): { value: Period; label: string }[] {
  const options: { value: Period; label: string }[] = [];
  for (let period = to; period >= from; period = addMonths(period, -1)) {
    options.push({ value: period, label: formatPeriod(period) });
  }
  return options;
}

/**
 * S-08 "Reactivar": "Se vuelve a cobrar desde" this month or the next one; the API wants the last
 * month without billing (periodTo = the chosen month − 1), never before the first suspended
 * month. Returns the options that make sense for this suspension (none if it has not started).
 */
export function reactivationOptions(periodFrom: Period, now: Date = new Date()) {
  const current = currentPeriod(now);
  return [current, addMonths(current, 1)]
    .map((billFrom) => ({ billFrom, periodTo: addMonths(billFrom, -1) }))
    .filter((option) => option.periodTo >= periodFrom)
    .map((option) => ({
      value: option.billFrom,
      label: formatPeriod(option.billFrom),
      periodTo: option.periodTo,
    }));
}

// --- P-03 · estimate of a family that already existed (D-18) ---------------------------------

export type DebtEstimate = {
  text: string;
  totalDue: number;
  /** Months without an approved rate: not priced, so the estimate is short of them. */
  missingRates: number;
};

/**
 * What the family owes today if its first pending month in the paper ledger is `billingStart`,
 * with the same function the API uses (computeAccountStatement) and the approved rates. It is an
 * estimate to compare with the ledger: the API computes the real statement after saving.
 */
export function estimateDebt(
  billingStart: Period,
  rates: readonly { id: number; effectivePeriod: Period; amount: number }[],
  now: Date = new Date(),
): DebtEstimate {
  const { summary, missingRatePeriods } = computeAccountStatement({
    now,
    billingStartPeriod: billingStart,
    lastBillablePeriod: null,
    rates,
    suspensions: [],
    coveredMonths: [],
  });
  const parts: string[] = [];
  if (summary.overdueCount > 0) {
    // The surcharge only exists with the debt cycle open (D-02): said only when there is one.
    const months =
      summary.overdueCount === 1 ? '1 mes vencido' : `${summary.overdueCount} meses vencidos`;
    parts.push(summary.surchargeTotal > 0 ? `${months} con recargo` : months);
  }
  if (summary.pendingCount > 0) {
    parts.push(`${formatPeriod(currentPeriod(now)).split(' ')[0]?.toLowerCase()} pendiente`);
  }
  const text =
    parts.length === 0
      ? 'No debería nada a hoy.'
      : `Debería ${parts.join(' y ')}: ${formatMoney(summary.totalDue)}.`;
  return { text, totalDue: summary.totalDue, missingRates: missingRatePeriods.length };
}

/** P-06: "Ir a cobrar" stays disabled until the payment screens (M6, 3.2 §6). */
export const CHARGE_COMES_LATER = 'El cobro desde la app llega en la siguiente versión.';

// --- S-08 · suspensions (D-06) -------------------------------------------------------------------

/** What every suspension screen repeats (D-06). */
export const SUSPENSION_EFFECT =
  'Mientras esté suspendida no se generan mensualidades; los adeudos anteriores se conservan.';

/** The card of a suspension: what is suspended, since when and why. */
export function suspensionCard(item: {
  target: 'connection' | 'unit';
  periodFrom: Period;
  periodTo: Period | null;
  reason: string;
  agreement: { folio: string };
  connection: { folio: string; address: string; blockCode: string | null; unitCount: number };
  unit: { folio: string; holderName: string | null } | null;
}): { title: string; details: string[]; summary: string } {
  const when = item.periodTo
    ? `De ${formatPeriod(item.periodFrom).toLowerCase()} a ${formatPeriod(item.periodTo).toLowerCase()}`
    : `Desde ${formatPeriod(item.periodFrom).toLowerCase()}`;
  if (item.target === 'unit' && item.unit) {
    return {
      title: `Familia ${item.unit.folio}${item.unit.holderName ? ` · ${item.unit.holderName}` : ''}`,
      details: [
        `${when} · ${item.agreement.folio}`,
        [`Toma ${item.connection.folio}`, item.connection.address, item.connection.blockCode]
          .filter(Boolean)
          .join(' · '),
      ],
      summary: item.reason,
    };
  }
  const families =
    item.connection.unitCount === 1 ? '1 familia' : `${item.connection.unitCount} familias`;
  return {
    title: `Toma ${item.connection.folio} · ${item.connection.address}`,
    details: [`${when} · ${item.agreement.folio}`, item.connection.blockCode ?? ''].filter(Boolean),
    summary: `${item.reason} · ${families}`,
  };
}
