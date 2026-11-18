import {
  type CashboxListItem,
  type CashboxMovement,
  formatMoney,
  formatPeriod,
  type Handover,
  type MyCashbox,
} from '@bella-vista/shared';
import type { StatusTone } from '../../ui/index.js';

// Texts of the cashbox screens (J-02 to J-04, T-02, T-03, T-12, G-09, R-06; D-16, D-18). Pure
// functions: the screens only paint what these return, and the tests read them as tables.

// --- Handovers ------------------------------------------------------------------------------

export const HANDOVER_TAGS: Record<Handover['status'], { tone: StatusTone; label: string }> = {
  pending: { tone: 'pending', label: 'Por confirmar' },
  withdrawn: { tone: 'cancelled', label: 'Retirada' },
  confirmed: { tone: 'paid', label: 'Confirmada' },
  with_difference: { tone: 'overdue', label: 'Con diferencia' },
  adjusted: { tone: 'paid', label: 'Aclarada' },
};

/** J-04 and T-02: the line under the folio of a handover. */
export function handoverSummary(handover: Handover): string {
  const received = handover.receivedAmount ?? 0;
  switch (handover.status) {
    case 'pending':
      return `Declarado ${formatMoney(handover.declaredAmount)}`;
    case 'withdrawn':
      return `Retirada · declarado ${formatMoney(handover.declaredAmount)}`;
    case 'confirmed':
      return `Confirmada: recibido ${formatMoney(received)}`;
    case 'with_difference':
      return `Recibido ${formatMoney(received)} · faltan ${formatMoney(handover.difference ?? 0)}`;
    case 'adjusted':
      return `Recibido ${formatMoney(received)} · faltante aclarado`;
  }
}

/** J-03 and R-06: the help under the amount (the reason the amount is limited). */
export const HANDOVER_AMOUNT_HELP = 'No puede ser mayor a lo que debe tener.';

/**
 * J-03: why the declared amount cannot be sent, or null. The limit is what the custodian may
 * still hand over (the balance minus the handovers waiting for the treasurer).
 */
export function handoverAmountError(
  amount: number | null,
  cashbox: Pick<MyCashbox, 'available' | 'pendingHandover'>,
): string | null {
  if (amount === null) return null;
  if (amount <= 0) return 'El importe debe ser mayor que cero.';
  if (amount <= cashbox.available) return null;
  const pending =
    cashbox.pendingHandover > 0
      ? ` (ya tiene ${formatMoney(cashbox.pendingHandover)} en entregas por confirmar)`
      : '';
  return `Es mayor a lo que debe tener: puede entregar hasta ${formatMoney(cashbox.available)}${pending}.`;
}

export type Difference =
  | { kind: 'none' }
  | { kind: 'shortfall'; amount: number; message: string }
  | { kind: 'over'; message: string };

/** T-03: the live difference between what was declared and what the treasurer counted. */
export function handoverDifference(declared: number, received: number | null): Difference {
  if (received === null || received === declared) return { kind: 'none' };
  if (received > declared) {
    return {
      kind: 'over',
      message: `No puede ser mayor que lo declarado (${formatMoney(declared)}). Si recibió de más, registre solo lo declarado y el jefe prepara otra entrega.`,
    };
  }
  const amount = declared - received;
  return {
    kind: 'shortfall',
    amount,
    message: `Diferencia: faltan ${formatMoney(amount)}. Quedarán en la caja del jefe hasta aclararlo.`,
  };
}

/** G-11 (adjustment): the fixed amount of the adjustment of a handover, by the model's sign. */
export const adjustmentAmount = (handover: Pick<Handover, 'difference'>): number =>
  -(handover.difference ?? 0);

// --- Movements (G-09) -----------------------------------------------------------------------

export const MOVEMENT_LABELS: Record<CashboxMovement['kind'], string> = {
  opening_balance: 'Saldo inicial',
  payment: 'Cobro',
  payment_cancellation: 'Cancelación de pago',
  handover_out: 'Entrega',
  handover_in: 'Entrega',
  income: 'Ingreso',
  expense: 'Gasto',
  expense_refund: 'Reintegro de gasto',
  adjustment: 'Aclaración',
};

export function movementTitle(movement: CashboxMovement): string {
  const label = MOVEMENT_LABELS[movement.kind];
  const detail =
    movement.detail && (movement.kind === 'payment' || movement.kind === 'payment_cancellation')
      ? `Familia de ${movement.detail}`
      : movement.detail;
  return detail ? `${label} · ${detail}` : label;
}

/** The date as AAAA-MM-DD (as the committee writes it) and the folio. */
export const movementSubtitle = (movement: CashboxMovement): string =>
  [movement.occurredOn, movement.folio].filter(Boolean).join(' · ');

export type MonthOption = { key: string; label: string; from: string; to: string };

/** G-09: the current month and the 11 before it, newest first. */
export function monthOptions(today: string, count = 12): MonthOption[] {
  const [year = 0, month = 1] = today.split('-').map(Number);
  return Array.from({ length: count }, (_, back) => {
    const index = year * 12 + (month - 1) - back;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { key, label: formatPeriod(key), from: `${key}-01`, to: `${key}-${last}` };
  });
}

// --- Opening balances (T-12) ----------------------------------------------------------------

export type OpeningRow = {
  subtitle: string;
  tag?: { tone: StatusTone; label: string };
  amount?: number;
  /** No pending or authorized opening balance: "Capturar saldo" may choose it. */
  capturable: boolean;
};

export function openingRow(cashbox: Pick<CashboxListItem, 'openingBalance'>): OpeningRow {
  const opening = cashbox.openingBalance;
  if (!opening) return { subtitle: 'Sin capturar', capturable: true };
  switch (opening.status) {
    case 'approved':
      return {
        subtitle: `Confirmado por el presidente · ${opening.date}`,
        amount: opening.amount,
        capturable: false,
      };
    case 'pending':
      return {
        subtitle: 'Espera confirmación del presidente',
        tag: { tone: 'pending', label: 'Pendiente' },
        amount: opening.amount,
        capturable: false,
      };
    case 'rejected':
      return {
        subtitle: 'Rechazado: puede capturarlo de nuevo',
        tag: { tone: 'cancelled', label: 'Rechazado' },
        capturable: true,
      };
  }
}

/** "Manzana S1-M03", "Caja del comité" or "Caja de apoyo · <name>". */
export function cashboxTitle(cashbox: Pick<CashboxListItem, 'type' | 'label'>): string {
  switch (cashbox.type) {
    case 'block':
      return `Manzana ${cashbox.label}`;
    case 'committee':
      return 'Caja del comité';
    default:
      return cashbox.label.replace(/^Apoyo/, 'Caja de apoyo');
  }
}
