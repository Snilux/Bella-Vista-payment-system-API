import type { AccountListResponse, AccountSummary, AuditEntry } from '@bella-vista/shared';
import { filterAccountList } from '../../src/features/accounts/account-list.js';
import { accountView, isManualLock } from '../../src/features/accounts/account-status.js';
import { auditEntryView } from '../../src/features/accounts/audit-labels.js';
import { suggestUsername } from '../../src/features/accounts/suggest-username.js';
import { account, assignment } from './fixtures.js';

// Pure rules of A-01 to A-04 (3.2 §10.8): the status in words, the actions each status allows
// (the API does not refuse the ones that make no sense), the search, the proposed user name and
// the audit log labels.

const MANUAL = '9999-12-31T00:00:00.000Z';
const UNTIL = '2026-11-17T16:42:00.000Z'; // 10:42 in Mexico City

describe('accountView', () => {
  it.each<[string, Partial<AccountSummary>, string, string | null, string[]]>([
    ['active', { status: 'active' }, 'Activa', null, ['reset', 'lock', 'deactivate']],
    [
      'temporary password',
      { status: 'must_change_password', mustChangePassword: true },
      'Debe cambiar la contraseña temporal al entrar',
      'Contraseña temporal',
      ['reset', 'lock', 'deactivate'],
    ],
    [
      'locked by failed attempts',
      { status: 'locked', lockedUntil: UNTIL, failedAttempts: 5 },
      'Bloqueada por intentos fallidos hasta 17 nov 2026, 10:42',
      'Bloqueada',
      ['unlock', 'reset', 'lock', 'deactivate'],
    ],
    [
      'locked by the superadmin',
      { status: 'locked', lockedUntil: MANUAL },
      'Bloqueada por el administrador',
      'Bloqueada',
      ['unlock', 'deactivate'],
    ],
    [
      'role not active',
      { status: 'role_not_active', assignmentEndDate: '2026-10-31' },
      'Su cargo no está vigente',
      'Cargo no vigente',
      ['deactivate'],
    ],
    [
      'disabled',
      { status: 'disabled', deactivatedAt: '2026-11-02T18:00:00.000Z' },
      'Desactivada el 2 nov 2026, 12:00',
      'Desactivada',
      [],
    ],
  ])('%s', (_name, change, summary, tag, commands) => {
    const view = accountView(account(change));
    expect(view.summary).toBe(summary);
    expect(view.tag?.label ?? null).toBe(tag);
    expect(view.commands).toEqual(commands);
  });

  it('never offers "Desbloquear" to an account that is not locked', () => {
    for (const status of [
      'active',
      'must_change_password',
      'role_not_active',
      'disabled',
    ] as const) {
      expect(accountView(account({ status })).commands).not.toContain('unlock');
    }
  });

  it('a disabled account says why nothing is offered', () => {
    expect(accountView(account({ status: 'disabled' })).notice).toMatch(/no se puede reactivar/);
  });

  it("offers nothing on the superadmin's own account (the API forbids locking it)", () => {
    const view = accountView(account({ status: 'active' }), true);
    expect(view.commands).toEqual([]);
    expect(view.notice).toMatch(/Perfil/);
  });

  it('tells a manual lock from a lock by failed attempts', () => {
    expect(isManualLock({ lockedUntil: MANUAL })).toBe(true);
    expect(isManualLock({ lockedUntil: UNTIL })).toBe(false);
    expect(isManualLock({ lockedUntil: null })).toBe(false);
  });
});

describe('filterAccountList', () => {
  const list: AccountListResponse = {
    accounts: [
      account({
        id: 1,
        username: 'tesorero',
        person: { ...account().person, fullName: 'Rosa Salinas' },
      }),
      account({ id: 2, username: 'vocal', status: 'disabled' }),
      account({ id: 3, username: 'jm.s1m01', status: 'locked', blockCode: 'S1-M01' }),
    ],
    assignmentsWithoutAccount: [
      assignment({ person: { ...assignment().person, fullName: 'Silvia Ramírez Cruz' } }),
    ],
  };

  it('puts locked accounts first and disabled ones last', () => {
    expect(filterAccountList(list, '').accounts.map((item) => item.username)).toEqual([
      'jm.s1m01',
      'tesorero',
      'vocal',
    ]);
  });

  it.each([
    ['user name', 'TESO', ['tesorero'], []],
    ['person name without accents', 'ramirez', [], ['Silvia Ramírez Cruz']],
    ['block code', 's1-m01', ['jm.s1m01'], []],
    ['nothing', 'zzz', [], []],
  ])('searches by %s', (_name, search, usernames, people) => {
    const found = filterAccountList(list, search);
    expect(found.accounts.map((item) => item.username)).toEqual(usernames);
    expect(found.assignmentsWithoutAccount.map((item) => item.person.fullName)).toEqual(people);
  });
});

describe('suggestUsername', () => {
  it.each([
    ['Ana Torres', 'ana.torres'],
    ['Laura Méndez Ruiz', 'laura.mendez'],
    ['María José López Hernández', 'maria.lopez'],
    ['Íñigo Núñez', 'inigo.nunez'],
    ['Al', null],
  ])('%s → %s', (fullName, username) => {
    expect(suggestUsername(fullName)).toBe(username);
  });
});

describe('auditEntryView', () => {
  const entry = (change: Partial<AuditEntry>): AuditEntry => ({
    id: 1,
    userAccountId: 1,
    username: 'admin',
    role: 'superadmin',
    action: 'reset_password',
    tableName: 'user_account',
    recordId: 7,
    before: null,
    after: null,
    reason: null,
    isTechnical: true,
    createdAt: '2026-10-23T16:00:00.000Z',
    ...change,
  });
  const usernames = new Map([
    [1, 'admin'],
    [7, 'jm.s1m01'],
  ]);

  it.each<[Partial<AuditEntry>, string, string]>([
    [
      { reason: 'Olvidó su contraseña' },
      'Contraseña restablecida',
      'jm.s1m01 · 23 oct 2026, 10:00 · Olvidó su contraseña · por admin',
    ],
    [{ action: 'create' }, 'Cuenta creada', 'jm.s1m01 · 23 oct 2026, 10:00 · por admin'],
    [
      {
        action: 'lock_after_failed_attempts',
        userAccountId: 7,
        username: 'jm.s1m01',
        reason: 'Bloqueo automático por intentos fallidos de inicio de sesión',
      },
      'Bloqueo por intentos fallidos',
      'jm.s1m01 · 23 oct 2026, 10:00',
    ],
    [
      { action: 'create', tableName: 'person', recordId: 3, reason: 'Arranque del sistema' },
      'Alta: Persona',
      'Persona 3 · 23 oct 2026, 10:00 · Arranque del sistema · por admin',
    ],
    [{ action: 'something_new' }, 'Acción técnica', 'jm.s1m01 · 23 oct 2026, 10:00 · por admin'],
  ])('%o', (change, title, subtitle) => {
    expect(auditEntryView(entry(change), usernames)).toEqual({ title, subtitle });
  });

  it('names an account that is not in the list by its number', () => {
    expect(auditEntryView(entry({ recordId: 99 }), usernames).subtitle).toMatch(/^Cuenta 99 · /);
  });
});
