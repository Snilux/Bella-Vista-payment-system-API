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
  /** Person search of the pickers (G-01 in M5): ['search', text]. */
  search: (text: string) => ['search', text] as const,
};
