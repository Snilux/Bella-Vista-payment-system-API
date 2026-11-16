import { describe, expect, it } from 'vitest';
import type { AccountAccess } from '../../../src/modules/auth/auth.repository.js';
import { accountAccessError } from '../../../src/plugins/auth.js';

// Rule applied to the account on every authenticated request. "Now" is 2026-11-16 12:00 in
// Mexico City (18:00 UTC); at 01:00 UTC on the 17th it is still the 16th in Mexico City.

const NOW = new Date('2026-11-16T18:00:00Z');
const TZ = 'America/Mexico_City';

const account = (overrides: Partial<AccountAccess> = {}): AccountAccess => ({
  userAccountId: 1,
  username: 'tesorero',
  mustChangePassword: false,
  failedAttempts: 0,
  deactivatedAt: null,
  lockedUntil: null,
  roleAssignmentId: 1,
  role: 'treasurer',
  personId: 1,
  blockId: null,
  startDate: '2026-01-01',
  endDate: null,
  approvalResult: 'approved',
  ...overrides,
});

describe('accountAccessError', () => {
  it.each<[string, Partial<AccountAccess>, string | null, Date?]>([
    ['current account', {}, null],
    ['deactivated', { deactivatedAt: new Date('2026-11-16T17:00:00Z') }, 'ACCOUNT_DISABLED'],
    ['deactivation scheduled later', { deactivatedAt: new Date('2026-11-17T00:00:00Z') }, null],
    ['locked', { lockedUntil: new Date('2026-11-16T18:05:00Z') }, 'ACCOUNT_LOCKED'],
    ['lock just expired', { lockedUntil: NOW }, null],
    ['ends today', { endDate: '2026-11-16' }, null],
    ['ended yesterday', { endDate: '2026-11-15' }, 'ROLE_NOT_ACTIVE'],
    ['starts today', { startDate: '2026-11-16' }, null],
    ['starts tomorrow', { startDate: '2026-11-17' }, 'ROLE_NOT_ACTIVE'],
    ['approval pending', { approvalResult: null }, 'ROLE_NOT_ACTIVE'],
    ['approval rejected', { approvalResult: 'rejected' }, 'ROLE_NOT_ACTIVE'],
    ['superadmin without approval', { role: 'superadmin', approvalResult: null }, null],
    [
      'ended yesterday in Mexico City while UTC is already the next day',
      { endDate: '2026-11-15' },
      'ROLE_NOT_ACTIVE',
      new Date('2026-11-17T01:00:00Z'),
    ],
    [
      'ends today in Mexico City while UTC is already the next day',
      { endDate: '2026-11-16' },
      null,
      new Date('2026-11-17T01:00:00Z'),
    ],
  ])('%s', (_case, overrides, code, now = NOW) => {
    expect(accountAccessError(account(overrides), now, TZ)?.code ?? null).toBe(code);
  });
});
