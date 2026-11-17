// Query keys by resource (3.2 §3.3). After an operation the hooks invalidate what it affected
// (e.g. registering a payment invalidates the account statement, the person, the search and
// "Mi caja"). Each later phase adds the keys of its screens here.

export const queryKeys = {
  health: ['health'] as const,
  /** A-01 and A-03: accounts and current assignments without account (superadmin). */
  accounts: ['accounts'] as const,
  /** A-04 (and R-05 in M8): the audit log as the role sees it. */
  auditLog: ['audit-log'] as const,
};
