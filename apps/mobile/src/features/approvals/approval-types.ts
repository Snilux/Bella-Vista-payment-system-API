import { type Action, APPROVAL_TYPES, type Approval, type ApprovalType } from '@bella-vista/shared';
import type { IconName } from '../../ui/Icon.js';
import type { StatusTone } from '../../ui/index.js';

// Approval types as the president reads them (R-02, R-03) and the requests the app sends with
// G-11. The order of R-02 follows APPROVAL_TYPES. `effect` says what authorizing does, so the
// president decides from R-03 without opening another screen (3.2 §10.8); the data of each
// request comes in the API's description.

export type ApprovalTypeText = {
  label: string;
  icon: IconName;
  /** What authorizing (and, when it matters, rejecting) does. */
  effect: string;
};

export const APPROVAL_TYPE_TEXTS: Record<ApprovalType, ApprovalTypeText> = {
  role_assignment: {
    label: 'Asignación de cargo',
    icon: 'people',
    effect:
      'Al autorizar, la persona ocupa el cargo desde la fecha de inicio y el administrador le crea su cuenta. Al rechazar, la manzana o el cargo quedan libres; en una sustitución, el jefe saliente ya dejó el cargo y la manzana se queda sin jefe.',
  },
  rate: {
    label: 'Tarifa',
    icon: 'rate',
    effect: 'Al autorizar, la tarifa se cobra desde el mes indicado.',
  },
  plumber_salary: {
    label: 'Salario del fontanero',
    icon: 'plumber',
    effect: 'Al autorizar, los pagos al fontanero usan este salario desde la fecha indicada.',
  },
  opening_balance: {
    label: 'Saldo inicial',
    icon: 'wallet',
    effect: 'Al autorizar, el saldo inicial entra en la caja.',
  },
  unit_deactivation: {
    label: 'Baja de familia',
    icon: 'people',
    effect: 'Al autorizar, la familia queda dada de baja desde hoy; su adeudo se conserva.',
  },
  holder_change: {
    label: 'Cambio de titular',
    icon: 'people',
    effect: 'Al autorizar, el titular cambia desde hoy; el adeudo se queda con la familia.',
  },
  payment_cancellation: {
    label: 'Cancelación de pago',
    icon: 'cash',
    effect:
      'Al autorizar, los meses vuelven a quedar pendientes y el importe sale de la caja que lo cobró.',
  },
  adjustment: {
    label: 'Aclaración',
    icon: 'handover',
    effect: 'Al autorizar, el importe de la aclaración se aplica a la caja de origen.',
  },
  expense_refund: {
    label: 'Reintegro de gasto',
    icon: 'fees',
    effect: 'Al autorizar, el importe del gasto vuelve a la caja del comité.',
  },
};

export type ApprovalGroup = { type: ApprovalType; items: Approval[] };

/** R-02: the pending requests by type, in the order of APPROVAL_TYPES, without empty groups. */
export function groupByType(approvals: readonly Approval[]): ApprovalGroup[] {
  return APPROVAL_TYPES.flatMap((type) => {
    const items = approvals.filter((item) => item.type === type);
    return items.length > 0 ? [{ type, items }] : [];
  });
}

export const APPROVAL_STATUS_TAGS: Record<Approval['status'], { tone: StatusTone; label: string }> =
  {
    pending: { tone: 'pending', label: 'Pendiente' },
    approved: { tone: 'paid', label: 'Autorizada' },
    rejected: { tone: 'overdue', label: 'Rechazada' },
  };

// --- G-11 · Solicitud con motivo ------------------------------------------------------------

/** The requests a person sends with G-11 (the others have their own screens). */
export const REQUEST_TYPES = [
  'unit_deactivation',
  'holder_change',
  'payment_cancellation',
  'expense_refund',
  'adjustment',
] as const satisfies readonly ApprovalType[];

export type RequestType = (typeof REQUEST_TYPES)[number];

export type RequestConfig = {
  /** Screen title. */
  title: string;
  /** POST path for the record id. */
  path: (id: number) => string;
  /** The body, when it is more than the reason (the default is { reason }). */
  body?: (id: number, vars: { reason: string; amount?: number }) => unknown;
  /** The amount is fixed by the record (adjustment: the whole difference), shown, not typed. */
  fixedAmount?: boolean;
  /** Moves money: Idempotency-Key (docs/api.md "Idempotencia"). */
  idempotent: boolean;
  /** Asks for the new holder (person picker). */
  needsNewHolder: boolean;
  /** Who may send it (the API decides anyway). */
  action: Action;
  /** What stays true while the president decides. */
  meanwhile: string;
};

export const REQUEST_CONFIGS: Record<RequestType, RequestConfig> = {
  unit_deactivation: {
    title: 'Solicitar baja',
    path: (id) => `/units/${id}/request-deactivation`,
    idempotent: false,
    needsNewHolder: false,
    action: 'unitChanges.request',
    meanwhile: 'Mientras el presidente no la autorice, la familia sigue activa.',
  },
  holder_change: {
    title: 'Cambiar titular',
    path: (id) => `/units/${id}/request-holder-change`,
    idempotent: false,
    needsNewHolder: true,
    action: 'unitChanges.request',
    meanwhile: 'Mientras el presidente no lo autorice, el titular sigue siendo el mismo.',
  },
  payment_cancellation: {
    title: 'Solicitar cancelación',
    path: (id) => `/payments/${id}/request-cancellation`,
    idempotent: true,
    needsNewHolder: false,
    action: 'payments.requestCancellation',
    meanwhile: 'Mientras el presidente no la autorice, el pago sigue vigente.',
  },
  expense_refund: {
    title: 'Solicitar reintegro',
    path: (id) => `/expenses/${id}/request-refund`,
    idempotent: true,
    needsNewHolder: false,
    action: 'committee.manage',
    meanwhile: 'Mientras el presidente no lo autorice, el gasto sigue pagado.',
  },
  // T-03: the shortfall of a handover (D-16), one per handover, for the whole difference.
  adjustment: {
    title: 'Solicitar aclaración',
    path: () => '/adjustments',
    body: (id, vars) => ({ handoverId: id, amount: vars.amount, reason: vars.reason }),
    fixedAmount: true,
    idempotent: true,
    needsNewHolder: false,
    action: 'adjustments.propose',
    meanwhile: 'Mientras el presidente no la autorice, el faltante sigue en la caja del jefe.',
  },
};

export const isRequestType = (value: unknown): value is RequestType =>
  typeof value === 'string' && (REQUEST_TYPES as readonly string[]).includes(value);

/** Why "Enviar solicitud" is disabled (2.4: a disabled button says why). */
export const MISSING_REASON = 'Escriba el motivo.';
export const MISSING_HOLDER = 'Elija al nuevo titular.';
