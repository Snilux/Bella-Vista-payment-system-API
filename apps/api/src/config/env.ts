import { isIP } from 'node:net';
import { z } from 'zod';

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

/** An IPv4/IPv6 address, optionally with a CIDR prefix (10.0.0.0/8, ::1/128). */
function isAddressOrCidr(value: string): boolean {
  const [address = '', prefix, ...rest] = value.split('/');
  const version = isIP(address);
  if (version === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  const bits = Number(prefix);
  return /^\d+$/.test(prefix) && bits <= (version === 4 ? 32 : 128);
}

/**
 * Which proxies may set X-Forwarded-For, so request.ip (and the login rate limit) is the real
 * client: `false` (default, the socket address), a number of trusted hops in front of the
 * API, or a comma-separated list of proxy addresses/CIDRs. `true` (trust any sender) is
 * refused because it lets any client choose its own IP.
 */
const trustProxySchema = z
  .string()
  .trim()
  .default('false')
  .transform((value, ctx): false | number | string[] => {
    if (value === 'false' || value === '0') return false;
    if (/^\d+$/.test(value)) return Number(value);
    const list = value.split(',').map((item) => item.trim());
    if (value !== 'true' && list.every(isAddressOrCidr)) return list;
    ctx.addIssue({
      code: 'custom',
      message:
        'use false, the number of proxies in front of the API, or their addresses/CIDRs separated by commas ("true" would trust any client)',
    });
    return z.NEVER;
  });

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  BUSINESS_TIMEZONE: z.string().min(1).default('America/Mexico_City'),
  TRUST_PROXY: trustProxySchema,
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_URL_TEST: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z
    .string()
    .regex(/^\d+[smhd]$/)
    .default('15m'),
  REFRESH_TOKEN_TTL_DAYS: positiveInt(30),
  LOGIN_MAX_ATTEMPTS: positiveInt(5),
  LOGIN_LOCKOUT_MINUTES: positiveInt(15),
});

export type Env = z.infer<typeof envSchema>;

export class InvalidEnvError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment variables:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'InvalidEnvError';
  }
}

/**
 * Parses and validates the environment. Throws `InvalidEnvError` listing every invalid
 * variable so the process fails at startup instead of on first use.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  // Treat empty strings (e.g. `FOO=` in an env file) as missing so defaults apply.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new InvalidEnvError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}
