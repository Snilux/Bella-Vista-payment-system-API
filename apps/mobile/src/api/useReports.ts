import { communityReportResponseSchema } from '@bella-vista/shared';
import { useQuery } from '@tanstack/react-query';
import { requireApiClient } from './api.js';
import { queryKeys } from './keys.js';

// Reports (docs/api.md "Reportes"). M4 uses the community report of the current month for the
// summaries of R-01 and S-01: its balances and debt are those of today (debtAsOf). G-06 and
// G-07 (M8) add the ranges and the PDF.

export function useCommunityReport(enabled = true) {
  return useQuery({
    queryKey: queryKeys.communityReport,
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/reports/community',
        schema: communityReportResponseSchema,
        signal,
      }),
    select: (data) => data.report,
    enabled,
  });
}
