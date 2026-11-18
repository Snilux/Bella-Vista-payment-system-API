import { type AuditEntry, formatDateTime } from '@bella-vista/shared';

// R-05 · Bitácora (CU-25, RF-AUD): each entry in words and its detail without sensitive data.
// The API never stores passwords or tokens in the log, but the detail filters any field whose
// name looks like one anyway (defense in depth).

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  create: 'Alta',
  update: 'Cambio',
  cancel: 'Cancelación',
  open: 'Apertura',
  count: 'Conteo',
  review: 'Revisión',
  close: 'Cierre',
  prepare: 'Preparación',
  confirm: 'Confirmación',
  withdraw: 'Retiro',
  pay: 'Pago',
  pay_plumber: 'Pago al fontanero',
  reject: 'Rechazo',
  propose: 'Aclaración propuesta',
  activate: 'Activación',
  end: 'Fin',
  deactivate: 'Baja',
  change_holder: 'Cambio de titular',
  create_preexisting: 'Alta de toma existente',
  add_amount: 'Importe agregado',
  replace_receipt: 'Reposición de recibo',
  request_cancellation: 'Cancelación solicitada',
  request_refund: 'Reintegro solicitado',
  request_salary: 'Salario solicitado',
  request_opening_balance: 'Saldo inicial solicitado',
  substitute_leader: 'Sustitución de jefe',
  resolve: 'Resolución',
  reset_password: 'Contraseña restablecida',
  change_password: 'Contraseña cambiada',
  lock: 'Cuenta bloqueada',
  unlock: 'Cuenta desbloqueada',
  lock_after_failed_attempts: 'Bloqueo por intentos fallidos',
  set_dev_password: 'Contraseña de desarrollo',
};

export const AUDIT_TABLE_LABELS: Record<string, string> = {
  payment: 'Pago',
  payment_cancellation: 'Cancelación de pago',
  paper_receipt: 'Recibo de papel',
  handover: 'Entrega',
  expense: 'Gasto',
  expense_refund: 'Reintegro',
  income: 'Ingreso',
  closing: 'Corte',
  adjustment: 'Aclaración',
  opening_balance: 'Saldo inicial',
  approval: 'Autorización',
  rate: 'Tarifa',
  fee: 'Concepto',
  extra_charge: 'Cargo extraordinario',
  unit: 'Familia',
  unit_change_request: 'Cambio de familia',
  connection: 'Toma',
  connection_request: 'Solicitud de toma',
  person: 'Persona',
  agreement: 'Acuerdo',
  role_assignment: 'Asignación de cargo',
  user_account: 'Cuenta',
  suspension: 'Suspensión',
  plumber: 'Fontanero',
  plumber_salary: 'Salario del fontanero',
  section: 'Sección',
  block: 'Manzana',
};

/** The chips of R-05: everything, payments, approvals (the table of the entry). */
export const AUDIT_TABLE_CHIPS = [
  { label: 'Todo', tableName: undefined },
  { label: 'Pagos', tableName: 'payment' },
  { label: 'Autorizaciones', tableName: 'approval' },
  { label: 'Cortes', tableName: 'closing' },
  { label: 'Gastos', tableName: 'expense' },
] as const;

const folioOf = (value: unknown): string | null => {
  if (value && typeof value === 'object' && 'folio' in value) {
    const folio = (value as { folio: unknown }).folio;
    return typeof folio === 'string' ? folio : null;
  }
  return null;
};

export type AuditRow = { title: string; subtitle: string };

/** "Alta: Pago PG-202610-000981" · "María López · 25 oct 2026, 18:30". */
export function auditRow(entry: AuditEntry): AuditRow {
  const action = AUDIT_ACTION_LABELS[entry.action] ?? entry.action;
  const table = AUDIT_TABLE_LABELS[entry.tableName] ?? entry.tableName;
  const folio = folioOf(entry.after) ?? folioOf(entry.before);
  return {
    title: `${action}: ${table}${folio ? ` ${folio}` : ''}`,
    subtitle: `${entry.fullName} · ${formatDateTime(entry.createdAt)}`,
  };
}

/** Field names that never reach the screen. */
const SENSITIVE =
  /hash|token|secret|idempotency|key$|^(password|currentPassword|newPassword|temporaryPassword)$/i;

const show = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

export type AuditChange = { field: string; before: string; after: string };

/** The fields of before and after, side by side, without the sensitive ones. */
export function auditChanges(entry: Pick<AuditEntry, 'before' | 'after'>): AuditChange[] {
  const asObject = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const before = asObject(entry.before);
  const after = asObject(entry.after);
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (field) => !SENSITIVE.test(field),
  );
  return fields.map((field) => ({
    field,
    before: field in before ? show(before[field]) : '—',
    after: field in after ? show(after[field]) : '—',
  }));
}
