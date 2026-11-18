import { formatMoney, formatPeriod, validationIssueSchema } from '@bella-vista/shared';
import { z } from 'zod';
import type { SessionEndReason } from './client.js';
import { type ApiErrorCode, isApiError } from './errors.js';

// Mensajes de error (3.2 §11.1 and §11.3): API code → Spanish message (formal "usted", 2.4 §7)
// → suggested action. The record is typed over every code, so a code the API adds to
// packages/shared without a message here fails the type check and test/error-messages.test.ts.
// The app keeps its own text per code so each one matches the screen (3.2 §11.3 wording); it
// uses the API's text only where it carries data the app cannot rebuild (useServerMessage).

/** What the screen offers after the message. */
export type ErrorAction =
  /** Nothing to do but read it. */
  | 'none'
  /** A "Reintentar" button (same Idempotency-Key for money operations). */
  | 'retry'
  /** Reload the query: the record changed. */
  | 'reload'
  /** The session ended: back to C-01. */
  | 'login'
  /** The account must change its temporary password: C-02. */
  | 'change-password'
  /** Show the message next to the field. */
  | 'fix-field'
  /** Back to F-02 with the new summary. */
  | 'back-to-months'
  /** Offer "Ir a cobrar" (opening fee). */
  | 'go-to-charge'
  /** The treasurer must register the amount (T-11). */
  | 'ask-treasurer'
  /** Wait a moment before trying again. */
  | 'wait';

type Details = Record<string, unknown>;

export type ErrorInfo = {
  message: string | ((details: Details) => string);
  action: ErrorAction;
  /** Show the API's message instead (it carries data, e.g. the amounts). */
  useServerMessage?: boolean;
};

const numberField = (details: Details, key: string): number | null => {
  const value = details[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
};

const periodsField = (details: Details): string[] => {
  const parsed = z.array(z.string().regex(/^\d{4}-\d{2}$/)).safeParse(details.periods);
  return parsed.success ? parsed.data : [];
};

/**
 * S-07 "Sustituir jefe" (D-08): what is missing before the substitution. The screen shows the
 * first two before sending, when it finds no counted extraordinary closing of the block.
 */
export const SUBSTITUTION_MESSAGES = {
  noClosing:
    'Antes de sustituir al jefe, el tesorero debe hacer el corte extraordinario de la caja de esta manzana y contar el efectivo.',
  notCounted:
    'El corte extraordinario de esta manzana aún no tiene el conteo del efectivo. Pida al tesorero que lo capture antes de sustituir al jefe.',
  staleClosing:
    'La caja de esta manzana tuvo movimientos después del corte extraordinario. El tesorero debe hacer un corte extraordinario nuevo.',
  noLeader: 'Esta manzana no tiene un jefe vigente. Use «Asignar cargo» para registrar al jefe.',
} as const;

/** INVALID_STATE of POST /v1/blocks/{id}/leader-substitution: `details.status` says why. */
function substitutionMessage(status: unknown): string | null {
  switch (status) {
    // The record sent is a monthly closing, or a closing of another cashbox.
    case 'monthly':
    case 'extraordinary':
      return SUBSTITUTION_MESSAGES.noClosing;
    case 'draft':
      return SUBSTITUTION_MESSAGES.notCounted;
    case 'stale_closing':
      return SUBSTITUTION_MESSAGES.staleClosing;
    case 'no_leader':
      return SUBSTITUTION_MESSAGES.noLeader;
    default:
      return null;
  }
}

export const ERROR_MESSAGES: Record<ApiErrorCode, ErrorInfo> = {
  // Business codes
  INVALID_CREDENTIALS: {
    message: 'Usuario o contraseña incorrectos.',
    action: 'fix-field',
    useServerMessage: true,
  },
  ACCOUNT_LOCKED: {
    message: 'Su cuenta está bloqueada. Espere unos minutos o pida ayuda al administrador.',
    action: 'login',
  },
  ROLE_NOT_ACTIVE: { message: 'Su cargo ya no está vigente.', action: 'login' },
  OUT_OF_SCOPE: { message: 'Este registro pertenece a otra manzana.', action: 'none' },
  ASSIGNMENT_HAS_ACCOUNT: {
    message: 'Esa asignación de cargo ya tiene una cuenta.',
    action: 'reload',
  },
  ASSIGNMENT_NOT_ACTIVE: { message: 'Esa asignación de cargo no está vigente.', action: 'reload' },
  USERNAME_TAKEN: {
    message: 'Ese nombre de usuario ya existe. Escriba otro.',
    action: 'fix-field',
  },
  HOMONYM_WITHOUT_NOTE: {
    message: 'Ya hay una persona con ese nombre. Escriba un distintivo para diferenciarlas.',
    action: 'fix-field',
  },
  DUPLICATE_DISTINGUISHING_NOTE: {
    message: 'Ya hay una persona con ese nombre y ese distintivo. Escriba otro distintivo.',
    action: 'fix-field',
  },
  MONTH_ORDER: { message: 'Los meses se pagan en orden.', action: 'back-to-months' },
  PERIOD_ALREADY_PAID: {
    message: (details) => {
      const paid = periodsField(details).map(formatPeriod);
      if (paid.length === 1) return `${paid[0]} ya está pagado.`;
      if (paid.length > 1) return `Estos meses ya están pagados: ${paid.join(', ')}.`;
      return 'Uno de los meses ya está pagado.';
    },
    action: 'back-to-months',
  },
  TOTAL_CHANGED: {
    message: (details) => {
      const total = numberField(details, 'total');
      const expected = numberField(details, 'expectedTotal');
      const amounts =
        total !== null && expected !== null
          ? `: ahora es ${formatMoney(total)} (antes ${formatMoney(expected)})`
          : '';
      return `El total cambió${amounts}. Revise el resumen y confirme de nuevo.`;
    },
    action: 'back-to-months',
  },
  DUPLICATE_PAPER_FOLIO: { message: 'Este folio ya se usó en su talonario.', action: 'fix-field' },
  PERIOD_CLOSED: {
    message: 'Ese mes ya tiene el corte cerrado. Registre el movimiento en el mes abierto.',
    action: 'none',
  },
  INSUFFICIENT_BALANCE: {
    message: 'No hay saldo suficiente para ese importe.',
    action: 'fix-field',
    useServerMessage: true,
  },
  CONNECTION_NOT_ACTIVE: { message: 'Solo se agregan familias a una toma activa.', action: 'none' },
  LEADER_ALREADY_ASSIGNED: {
    message: 'Esa manzana ya tiene jefe, o la persona ya es jefe de otra manzana.',
    action: 'reload',
    useServerMessage: true,
  },
  ROLE_ALREADY_ASSIGNED: {
    message: 'Ese cargo ya está asignado.',
    action: 'reload',
    useServerMessage: true,
  },
  DUPLICATE_CODE: { message: 'Esa clave o ese nombre ya está registrado.', action: 'fix-field' },
  INVALID_RATE_EFFECTIVE_PERIOD: {
    message: 'La tarifa nueva debe empezar después del mes actual.',
    action: 'fix-field',
  },
  APPROVAL_ALREADY_RESOLVED: {
    message: 'Esta solicitud ya fue resuelta. Se actualizó la pantalla.',
    action: 'reload',
  },
  FEE_WITHOUT_AMOUNT: {
    message: 'Este concepto aún no tiene importe. El tesorero debe registrarlo.',
    action: 'ask-treasurer',
  },
  OPENING_NOT_PAID: {
    message: 'Primero hay que cobrar la cuota de apertura.',
    action: 'go-to-charge',
  },
  INVALID_STATE: {
    message: (details) =>
      (details.action === 'substitute_leader' ? substitutionMessage(details.status) : null) ??
      'Esto ya cambió. Se actualizó la pantalla.',
    action: 'reload',
  },

  // General codes
  VALIDATION_ERROR: { message: 'Revise los datos marcados.', action: 'fix-field' },
  INVALID_REQUEST: {
    message: 'No se pudo enviar la solicitud. Intente de nuevo.',
    action: 'retry',
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    message: 'No se pudo enviar la operación. Intente de nuevo.',
    action: 'retry',
  },
  UNAUTHENTICATED: { message: 'Su sesión terminó, inicie sesión de nuevo.', action: 'login' },
  TOKEN_EXPIRED: { message: 'Su sesión terminó, inicie sesión de nuevo.', action: 'login' },
  ACCOUNT_DISABLED: {
    message: 'Su cuenta está desactivada. Pida ayuda al administrador.',
    action: 'login',
  },
  PASSWORD_CHANGE_REQUIRED: {
    message: 'Debe cambiar su contraseña para continuar.',
    action: 'change-password',
  },
  FORBIDDEN: { message: 'No tiene permiso para esta acción.', action: 'none' },
  NOT_FOUND: { message: 'No se encontró lo que busca.', action: 'none' },
  IDEMPOTENCY_KEY_REUSED: {
    message: 'Esta operación ya se había enviado con otros datos. Empiece de nuevo.',
    action: 'none',
  },
  TOO_MANY_REQUESTS: {
    message: 'Demasiados intentos. Espere un momento e intente de nuevo.',
    action: 'wait',
  },
  INTERNAL_ERROR: { message: 'Ocurrió un error inesperado. Intente de nuevo.', action: 'retry' },
  DATABASE_UNAVAILABLE: { message: 'El servidor no responde. Intente más tarde.', action: 'retry' },

  // Client codes
  NETWORK_ERROR: {
    message: 'No hay conexión. Revise su señal e intente de nuevo.',
    action: 'retry',
  },
  INVALID_RESPONSE: {
    message: 'La respuesta del servidor no es la esperada. Actualice la app o intente más tarde.',
    action: 'retry',
  },
};

/** A money operation whose request got no answer: it may or may not have been registered. */
export const UNKNOWN_OUTCOME_MESSAGE =
  'No sabemos si se registró. Toque Reintentar: si ya se había registrado, no se duplica.';

export type DescribedError = { code: ApiErrorCode; message: string; action: ErrorAction };

/** Any thrown value → the message and action a screen shows. */
export function describeError(error: unknown): DescribedError {
  if (!isApiError(error)) {
    return { code: 'INTERNAL_ERROR', ...resolve('INTERNAL_ERROR', {}, '') };
  }
  return { code: error.code, ...resolve(error.code, error.details, error.message) };
}

function resolve(code: ApiErrorCode, details: Details, serverMessage: string) {
  const info = ERROR_MESSAGES[code];
  const own = typeof info.message === 'function' ? info.message(details) : info.message;
  return {
    message: info.useServerMessage && serverMessage ? serverMessage : own,
    action: info.action,
  };
}

const issuesSchema = z.array(validationIssueSchema);

/**
 * VALIDATION_ERROR → message per field, keyed by the last part of the API path
 * ("body.paperFolio" → "paperFolio"), so a form shows each one next to its field.
 */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!isApiError(error) || error.code !== 'VALIDATION_ERROR') return {};
  const parsed = issuesSchema.safeParse(error.details.issues);
  if (!parsed.success) return {};
  const result: Record<string, string> = {};
  for (const issue of parsed.data) {
    const field = issue.path.split('.').at(-1) ?? issue.path;
    result[field] ??= issue.message;
  }
  return result;
}

const SESSION_END_CODES: Record<SessionEndReason, ApiErrorCode> = {
  expired: 'UNAUTHENTICATED',
  'role-not-active': 'ROLE_NOT_ACTIVE',
  'account-disabled': 'ACCOUNT_DISABLED',
  'account-locked': 'ACCOUNT_LOCKED',
};

/** What C-01 says when the app ended the session by itself (3.2 §3.2). */
export function sessionEndMessage(reason: SessionEndReason): string {
  return resolve(SESSION_END_CODES[reason], {}, '').message;
}
