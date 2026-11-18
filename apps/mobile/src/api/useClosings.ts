import { type Block, closingPageSchema, periodOf } from '@bella-vista/shared';
import { useQuery } from '@tanstack/react-query';
import { requireApiClient } from './api.js';
import { queryKeys } from './keys.js';
import { COUNT_LIMIT } from './useOrganization.js';

// Closings (docs/api.md "Cortes"). M4 only reads them: how many wait for the president's review
// (R-01) and the handover record of a leader substitution (S-07, D-08). The closing screens
// themselves come in M8.

/** R-01 "Cortes por revisar": counted closings (count of the first 100). */
export function useCountedClosingCount(enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.closings, { status: 'counted' }],
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/closings',
        query: { status: 'counted', limit: COUNT_LIMIT },
        schema: closingPageSchema,
        signal,
      }),
    select: (page) => ({ count: page.data.length, more: page.next !== null }),
    enabled,
  });
}

/**
 * S-07 "Sustituir jefe": the extraordinary closings of the block's cashbox this month (an
 * extraordinary closing covers from day 1 of the current month to its date), newest first.
 * Drafts come too, so the screen can say the cash still has to be counted.
 */
export function useBlockExtraordinaryClosings(block: Pick<Block, 'fullCode'> | null) {
  const period = periodOf(new Date());
  return useQuery({
    queryKey: [...queryKeys.closings, { period, type: 'extraordinary' }],
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/closings',
        query: { period, limit: COUNT_LIMIT },
        schema: closingPageSchema,
        signal,
      }),
    select: (page) =>
      page.data
        .filter(
          (closing) =>
            closing.type === 'extraordinary' &&
            closing.cashbox.type === 'block' &&
            closing.cashbox.label === block?.fullCode,
        )
        .sort((a, b) => b.dateTo.localeCompare(a.dateTo) || b.id - a.id),
    enabled: block !== null,
  });
}
