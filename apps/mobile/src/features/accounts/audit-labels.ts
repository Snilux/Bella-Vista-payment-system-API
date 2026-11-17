import { type AuditEntry, formatDateTime } from '@bella-vista/shared';

// A-04 · Bitácora técnica: each technical entry of the API in words (3.2 §10.8). The entry's
// `username` is who did it; the account it touched is `recordId` (user_account), which the
// screen names with the account list.

const ACTION_TITLES: Record<string, string> = {
  reset_password: 'Contraseña restablecida',
  lock: 'Cuenta bloqueada',
  unlock: 'Cuenta desbloqueada',
  deactivate: 'Cuenta desactivada',
  lock_after_failed_attempts: 'Bloqueo por intentos fallidos',
  change_password: 'Contraseña cambiada',
  set_dev_password: 'Contraseña de desarrollo asignada',
};

const TABLE_NAMES: Record<string, string> = {
  user_account: 'Cuenta',
  person: 'Persona',
  role_assignment: 'Asignación de cargo',
  agreement: 'Acuerdo',
  approval: 'Autorización',
};

export type AuditEntryView = { title: string; subtitle: string };

/** `usernames`: account id → username, from the account list (may still be loading). */
export function auditEntryView(
  entry: AuditEntry,
  usernames: ReadonlyMap<number, string>,
): AuditEntryView {
  const isAccount = entry.tableName === 'user_account';
  const title =
    entry.action === 'create'
      ? isAccount
        ? 'Cuenta creada'
        : `Alta: ${TABLE_NAMES[entry.tableName] ?? 'registro'}`
      : (ACTION_TITLES[entry.action] ?? 'Acción técnica');

  const subject = isAccount
    ? (usernames.get(entry.recordId) ?? `Cuenta ${entry.recordId}`)
    : `${TABLE_NAMES[entry.tableName] ?? 'Registro'} ${entry.recordId}`;
  const parts = [subject, formatDateTime(entry.createdAt)];
  // The title of an automatic lock already says why.
  if (entry.reason && entry.action !== 'lock_after_failed_attempts') parts.push(entry.reason);
  if (entry.username !== subject) parts.push(`por ${entry.username}`);
  return { title, subtitle: parts.join(' · ') };
}
