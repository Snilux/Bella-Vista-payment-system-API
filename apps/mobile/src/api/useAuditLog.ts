import { type AuditEntry, auditLogPageSchema } from '@bella-vista/shared';
import { useCallback } from 'react';
import type { FetchPage } from '../ui/index.js';
import { getApiClient } from './api.js';
import { ApiError } from './errors.js';

// Audit log (docs/api.md "Bitácora"; 3.2 §10.8): the API decides what each role sees. For the
// superadmin (A-04) it returns only the technical entries, newest first, 20 per page.

/** The page loader PaginatedList uses for /v1/audit-log. */
export function useAuditLogPages(): FetchPage<AuditEntry> {
  return useCallback(async ({ limit, cursor, signal }) => {
    const client = getApiClient();
    if (!client) throw new ApiError('INVALID_REQUEST', 0, 'Falta EXPO_PUBLIC_API_URL.');
    return client.request({
      method: 'GET',
      path: '/audit-log',
      query: { limit, cursor },
      schema: auditLogPageSchema,
      signal,
    });
  }, []);
}
