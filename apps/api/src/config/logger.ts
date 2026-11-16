import pino, { type LoggerOptions } from 'pino';

// Logger configuration shared by the API (server.ts) and the seed scripts: no personal data
// nor secrets in the logs (RNF-SEG-06).
// - Redaction: authorization headers, passwords and tokens are always replaced, wherever they
//   appear (up to three levels deep), even if a future log call includes a body or headers.
// - Database errors: Drizzle puts the SQL and every parameter in the error message
//   ("Failed query: ... params: ...") and postgres.js adds the query, parameters and detail
//   (e.g. "Key (username)=(...) already exists"). They are logged without them.
// - Requests: the URL is logged without its query string (`/v1/search?q=<name>`).

const SECRET_KEYS = [
  'authorization',
  'cookie',
  'password',
  'currentPassword',
  'newPassword',
  'temporaryPassword',
  'passwordHash',
  'accessToken',
  'refreshToken',
  'token',
  'tokenHash',
];

/** pino redact paths: each secret key at the top level and nested up to three levels. */
export const REDACTED_PATHS = SECRET_KEYS.flatMap((key) => [
  key,
  `*.${key}`,
  `*.*.${key}`,
  `*.*.*.${key}`,
]);

/** Properties of database errors that carry SQL text or values. */
const DATABASE_ERROR_SECRETS = new Set([
  'query',
  'params',
  'parameters',
  'detail',
  'where',
  'internal_query',
  'internal_position',
]);

const MAX_CAUSE_DEPTH = 5;

/** Drizzle's DrizzleQueryError (query and params) or a postgres.js PostgresError. */
function isDatabaseError(error: Error): boolean {
  return ('query' in error && 'params' in error) || ('severity' in error && 'code' in error);
}

function chainHasDatabaseError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; current instanceof Error && depth < MAX_CAUSE_DEPTH; depth++) {
    if (isDatabaseError(current)) return true;
    current = current.cause;
  }
  return false;
}

function safeMessage(error: Error): string {
  if ('query' in error && 'params' in error) {
    return 'Failed query (SQL and parameters omitted from the log)';
  }
  const code = (error as { code?: unknown }).code;
  // Class 22 (data exception) messages quote the offending value: invalid input syntax for
  // type integer: "...". Other messages name constraints, tables or record ids only.
  if (typeof code === 'string' && code.startsWith('22')) {
    return `Data exception ${code} (message omitted: it may contain the value)`;
  }
  return error.message;
}

function sanitizeChain(error: Error, depth: number): Error {
  const message = safeMessage(error);
  const cause =
    error.cause instanceof Error && depth < MAX_CAUSE_DEPTH
      ? sanitizeChain(error.cause, depth + 1)
      : undefined;
  const safe = new Error(message, cause ? { cause } : undefined);
  safe.name = error.name;
  for (const [key, value] of Object.entries(error)) {
    if (!DATABASE_ERROR_SECRETS.has(key) && key !== 'cause') {
      (safe as unknown as Record<string, unknown>)[key] = value;
    }
  }
  const frames = (error.stack ?? '').split('\n').filter((line) => /^\s+at /.test(line));
  safe.stack = [`${error.name}: ${message}`, ...frames].join('\n');
  return safe;
}

/**
 * The error as it may be logged: when it (or a cause) is a database error, a copy without the
 * SQL, the parameters and the values; any other error unchanged.
 */
export function sanitizeError(error: unknown): unknown {
  return error instanceof Error && chainHasDatabaseError(error) ? sanitizeChain(error, 0) : error;
}

/** Path of a request URL without its query string. */
export function pathOnly(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

interface LoggedRequest {
  method: string;
  url: string;
  host?: string;
  ip?: string;
  socket?: { remotePort?: number };
}

/** Serializers: errors without database values; requests without the query string. */
export const logSerializers: {
  err: (error: unknown) => object;
  req: (request: LoggedRequest) => object;
} = {
  err: (error: unknown) => pino.stdSerializers.err(sanitizeError(error) as Error),
  req: (request: LoggedRequest) => ({
    method: request.method,
    url: pathOnly(request.url),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  }),
};

export interface LoggerConfig {
  LOG_LEVEL: string;
  NODE_ENV: string;
}

/** pino options for the API and the scripts (pretty output in development). */
export function loggerOptions(env: LoggerConfig): LoggerOptions {
  return {
    level: env.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    serializers: logSerializers,
    ...(env.NODE_ENV === 'development' && { transport: { target: 'pino-pretty' } }),
  };
}
