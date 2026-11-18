import { type AuditEntry, type AuditLogQuery, auditLogPageSchema } from '@bella-vista/shared';
import { useCallback } from 'react';
import type { FetchPage } from '../ui/index.js';
import { getApiClient } from './api.js';
import { ApiError } from './errors.js';

// Audit log (docs/api.md "Bitácora"; 3.2 §10.8): the API decides what each role sees. For the
// superadmin (A-04) it returns only the technical entries; the president (R-05) sees every
// entry and filters by dates, role, table and action. Newest first, 20 per page.

export type AuditLogFilter = Omit<AuditLogQuery, 'limit' | 'cursor'>;

/** The page loader PaginatedList uses for /v1/audit-log (its queryKey must carry the filter). */
export function useAuditLogPages(filter: AuditLogFilter = {}): FetchPage<AuditEntry> {
  // Compared by value: a new object with the same filter keeps the same loader.
  const key = JSON.stringify(filter);
  return useCallback(
    async ({ limit, cursor, signal }) => {
      const client = getApiClient();
      if (!client) throw new ApiError('INVALID_REQUEST', 0, 'Falta EXPO_PUBLIC_API_URL.');
      return client.request({
        method: 'GET',
        path: '/audit-log',
        query: { ...(JSON.parse(key) as AuditLogFilter), limit, cursor },
        schema: auditLogPageSchema,
        signal,
      });
    },
    [key],
  );
}
