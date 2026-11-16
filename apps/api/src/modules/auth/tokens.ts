import { createHash, randomBytes } from 'node:crypto';

// Refresh tokens are 256 random bits: guessing one is infeasible, so a fast SHA-256 is enough
// to store them (Argon2 is for low-entropy passwords). Only the hash is stored (2.1 §5.3).

export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86_400 } as const;

/** Seconds in a duration like `15m` (the JWT_ACCESS_TTL format: <n><s|m|h|d>). */
export function durationSeconds(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) throw new Error(`invalid duration ${duration}`);
  return Number(match[1]) * UNIT_SECONDS[match[2] as keyof typeof UNIT_SECONDS];
}
