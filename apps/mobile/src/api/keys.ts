// Query keys by resource (3.2 §3.3). After an operation the hooks invalidate what it affected
// (e.g. registering a payment invalidates the account statement, the person, the search and
// "Mi caja"). Each later phase adds the keys of its screens here.

export const queryKeys = {
  health: ['health'] as const,
  /** A-01 and A-03: accounts and current assignments without account (superadmin). */
  accounts: ['accounts'] as const,
  /** A-04 (and R-05 in M8): the audit log as the role sees it. */
  auditLog: ['audit-log'] as const,
  /** S-06: sections and blocks with their current leader. */
  sections: ['sections'] as const,
  blocks: ['blocks'] as const,
  /** S-01, S-06 and S-07: role assignments (every status). */
  roleAssignments: ['role-assignments'] as const,
  /** R-01, R-02 and R-03: ['approvals', 'pending' | 'resolved' | 'all']. */
  approvals: ['approvals'] as const,
  approvalList: (status: 'pending' | 'resolved' | 'all') => ['approvals', status] as const,
  /** R-01 and S-01 (G-07 in M8): the community report of the current month. */
  communityReport: ['reports', 'community'] as const,
  /** R-01 counts and the handover record of S-07: ['closings', filter]. */
  closings: ['closings'] as const,
  /** S-01: connection requests by status. */
  connectionRequests: ['connection-requests'] as const,
  /** G-01 and the pickers: ['search', text]. */
  searchAll: ['search'] as const,
  search: (text: string) => ['search', text] as const,
  /** G-02 and G-03. */
  people: ['people'] as const,
  person: (id: number) => ['people', id] as const,
  connections: ['connections'] as const,
  connection: (id: number) => ['connections', id] as const,
  /** P-01: the block report of a block, its roster. */
  blockRosters: ['reports', 'block'] as const,
  blockRoster: (blockId: number) => ['reports', 'block', blockId] as const,
  /** P-03 (T-10 in M6): the rate history. */
  rates: ['rates'] as const,
  /** P-05 and S-03 (T-11 in M6): the fees with their amount in force. */
  fees: ['fees'] as const,
  /** S-02, J-06, S-03 and P-06: ['connection-requests', …]. */
  connectionRequest: (id: number) => ['connection-requests', 'detail', id] as const,
  /** S-03, S-04, S-05 and S-08. */
  agreements: ['agreements'] as const,
  /** S-08 and S-01. */
  suspensions: ['suspensions'] as const,
  /** G-04: a family and its account statement. */
  units: ['units'] as const,
  unit: (id: number) => ['units', id] as const,
  statement: (id: number) => ['units', id, 'account-statement'] as const,
  /** G-05, G-10 and the payment flow (F-03 preview). */
  payments: ['payments'] as const,
  payment: (id: number) => ['payments', id] as const,
  /** J-01, J-02, T-01, T-04 and R-06: the custodian's cashbox. */
  myCashbox: ['cashboxes', 'mine'] as const,
  /** Every cashbox key (T-12 list, G-09 movements): invalidated by any cash movement. */
  cashboxes: ['cashboxes'] as const,
  cashboxList: ['cashboxes', 'list'] as const,
  movements: (cashboxId: number, month: string) =>
    ['cashboxes', cashboxId, 'movements', month] as const,
  /** J-04, T-02, T-03 and R-03: handovers (list by filter, and one). */
  handovers: ['handovers'] as const,
  handover: (id: number) => ['handovers', 'detail', id] as const,
  /** F-02 and G-04: the extra charges of a family ('pending' or 'all'). */
  unitCharges: (unitId: number, status: 'pending' | 'all') =>
    ['units', unitId, 'extra-charges', status] as const,
  /** T-04, T-06 and T-07: expenses (list by status, and one), categories and incomes. */
  expenses: ['expenses'] as const,
  expense: (id: number) => ['expenses', 'detail', id] as const,
  expenseCategories: ['expense-categories'] as const,
  incomes: ['incomes'] as const,
  /** T-08 and T-09: the plumbers and one with its salaries and payments. */
  plumbers: ['plumbers'] as const,
  plumber: (id: number) => ['plumbers', id] as const,
  /** R-03: one approval with its subject. */
  approval: (id: number) => ['approvals', 'detail', id] as const,
};
