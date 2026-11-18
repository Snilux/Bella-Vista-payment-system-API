import {
  type BlockReport,
  blockReportResponseSchema,
  type CommunityReport,
  communityReportResponseSchema,
} from '@bella-vista/shared';
import { useQuery } from '@tanstack/react-query';
import { requireApiClient } from './api.js';
import { queryKeys } from './keys.js';

// Reports (docs/api.md "Reportes"; RF-REP; D-25, D-26). R-01, S-01 and V-01 use the community
// report of the current month (its balances and debt are those of today, debtAsOf). G-06 and
// G-07 ask for a range of months; the PDF is built on the phone from the same response the
// screen shows, and nothing is stored on the server.

export type MonthRange = { from: string; to: string };

/** R-01, S-01, V-01 (current month) and G-07 (with a range). */
export function useCommunityReport(enabled = true, range?: MonthRange) {
  return useQuery({
    queryKey: range
      ? queryKeys.communityReportRange(range.from, range.to)
      : queryKeys.communityReport,
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/reports/community',
        ...(range ? { query: range } : {}),
        schema: communityReportResponseSchema,
        signal,
      }),
    select: (data): CommunityReport => data.report,
    enabled,
  });
}

/** G-06: the registry report of one block in a range (a leader only theirs). */
export function useBlockReport(blockId: number | null, range: MonthRange) {
  return useQuery({
    queryKey: queryKeys.blockReport(blockId ?? 0, range.from, range.to),
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/reports/block',
        query: { blockId, ...range },
        schema: blockReportResponseSchema,
        signal,
      }),
    select: (data): BlockReport => data.report,
    enabled: blockId !== null && blockId > 0,
  });
}
