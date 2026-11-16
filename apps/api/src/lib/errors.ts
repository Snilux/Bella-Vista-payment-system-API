import type { ErrorCode } from '@bella-vista/shared';

// Every error the API returns has the shape { error: { code, message, details } } (docs/api.md):
// `code` in English for the app, `message` in Spanish ready to show to the user.

export type ErrorDetails = Record<string, unknown>;

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly statusCode: number,
    message: string,
    readonly details: ErrorDetails = {},
  ) {
    super(message);
    this.name = 'AppError';
  }

  toResponse() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

/** General errors (2.3 §4.1). Business errors are created by each module. */
export const errors = {
  validation: (details: ErrorDetails) =>
    new AppError('VALIDATION_ERROR', 400, 'Los datos enviados no son válidos.', details),
  invalidRequest: (statusCode = 400) =>
    new AppError('INVALID_REQUEST', statusCode, 'La solicitud no es válida.'),
  idempotencyKeyRequired: () =>
    new AppError(
      'IDEMPOTENCY_KEY_REQUIRED',
      400,
      'Falta el encabezado Idempotency-Key o no es un UUID válido.',
    ),
  unauthenticated: () => new AppError('UNAUTHENTICATED', 401, 'Inicie sesión para continuar.'),
  tokenExpired: () => new AppError('TOKEN_EXPIRED', 401, 'Su sesión venció. Vuelva a intentarlo.'),
  accountDisabled: () => new AppError('ACCOUNT_DISABLED', 401, 'Su cuenta está desactivada.'),
  accountLocked: (lockedUntil: Date) =>
    new AppError('ACCOUNT_LOCKED', 401, 'Su cuenta está bloqueada temporalmente.', {
      lockedUntil: lockedUntil.toISOString(),
    }),
  roleNotActive: () => new AppError('ROLE_NOT_ACTIVE', 403, 'Su cargo no está vigente.'),
  passwordChangeRequired: () =>
    new AppError('PASSWORD_CHANGE_REQUIRED', 403, 'Debe cambiar su contraseña antes de continuar.'),
  forbidden: () => new AppError('FORBIDDEN', 403, 'Su cargo no tiene permiso para esta operación.'),
  outOfScope: () => new AppError('OUT_OF_SCOPE', 403, 'Este registro pertenece a otra manzana.'),
  notFound: () => new AppError('NOT_FOUND', 404, 'No se encontró lo que busca.'),
  idempotencyKeyReused: () =>
    new AppError(
      'IDEMPOTENCY_KEY_REUSED',
      409,
      'La clave Idempotency-Key ya se usó en otra operación.',
    ),
  tooManyRequests: () =>
    new AppError('TOO_MANY_REQUESTS', 429, 'Demasiadas solicitudes. Espere un momento.'),
  internal: () =>
    new AppError('INTERNAL_ERROR', 500, 'Ocurrió un error inesperado. Intente de nuevo.'),
  /**
   * The operation does not fit the current state of the record. Only when no more specific
   * code applies (APPROVAL_ALREADY_RESOLVED, CONNECTION_NOT_ACTIVE...).
   */
  invalidState: (message: string, status: string, action: string) =>
    new AppError('INVALID_STATE', 409, message, { status, action }),
  periodClosed: () =>
    new AppError(
      'PERIOD_CLOSED',
      409,
      'El mes ya tiene un corte cerrado; el movimiento debe registrarse en el periodo abierto.',
    ),
  databaseUnavailable: () =>
    new AppError('DATABASE_UNAVAILABLE', 503, 'La base de datos no responde. Intente más tarde.'),
};
