import type { ErrorCode } from '@bella-vista/shared';

// Errors the HTTP client throws. API errors keep the API's code (docs/glosario.md); the client
// adds two of its own: NETWORK_ERROR (no connection or no answer within the time limit) and
// INVALID_RESPONSE (the answer does not match the shared schema: the API changed and the app
// did not).

export const CLIENT_ERROR_CODES = ['NETWORK_ERROR', 'INVALID_RESPONSE'] as const;

export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];
export type ApiErrorCode = ErrorCode | ClientErrorCode;

export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly code: ApiErrorCode,
    /** HTTP status; 0 when the request never got an answer. */
    readonly status: number,
    /** The API's Spanish message, when there is one. Screens show describeError() instead. */
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

/** True when the request never got an answer: for a money operation, nobody knows if it went in. */
export const isNetworkError = (error: unknown): boolean =>
  isApiError(error) && error.code === 'NETWORK_ERROR';
