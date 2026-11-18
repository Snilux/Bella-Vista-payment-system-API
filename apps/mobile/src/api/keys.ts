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
  /** J-01 (Mi caja in M7). */
  myCashbox: ['cashboxes', 'mine'] as const,
  handovers: ['handovers'] as const,
  /** R-03: one approval with its subject. */
  approval: (id: number) => ['approvals', 'detail', id] as const,
};
