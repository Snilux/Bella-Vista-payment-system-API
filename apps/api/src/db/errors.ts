// postgres.js connection failures (the server is down, unreachable or closed the connection),
// as opposed to errors raised by a query (constraints, triggers), which carry a SQLSTATE.
const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  // SQLSTATE class 08 (connection exception) and 57P0x (server shutting down)
  '08000',
  '08003',
  '08006',
  '57P01',
  '57P02',
  '57P03',
]);

/** Whether `error` (or its cause, as wrapped by Drizzle) means the database is unreachable. */
export function isDatabaseUnavailable(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
