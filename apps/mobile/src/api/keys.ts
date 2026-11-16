// Query keys by resource (3.2 §3.3). After an operation the hooks invalidate what it affected
// (e.g. registering a payment invalidates the account statement, the person, the search and
// "Mi caja"). Each later phase adds the keys of its screens here.

export const queryKeys = {
  health: ['health'] as const,
};
