import type { AccountListResponse, AccountSummary } from '@bella-vista/shared';

// A-01 · Cuentas: "Buscar usuario" filters on the phone (the list is short and not paginated),
// by user name or person name, ignoring accents and capitals. Assignments without account come
// first (they are the superadmin's pending work); disabled accounts go last.

function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const RANK: Record<AccountSummary['status'], number> = {
  locked: 0,
  must_change_password: 1,
  active: 2,
  role_not_active: 3,
  disabled: 4,
};

export function filterAccountList(list: AccountListResponse, search: string): AccountListResponse {
  const query = plain(search);
  const matches = (...texts: string[]) =>
    !query || texts.some((text) => plain(text).includes(query));
  return {
    assignmentsWithoutAccount: list.assignmentsWithoutAccount.filter((assignment) =>
      matches(assignment.person.fullName, assignment.blockCode ?? ''),
    ),
    accounts: list.accounts
      .filter((account) =>
        matches(account.username, account.person.fullName, account.blockCode ?? ''),
      )
      .sort((a, b) => RANK[a.status] - RANK[b.status] || a.username.localeCompare(b.username)),
  };
}
