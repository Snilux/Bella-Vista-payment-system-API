import {
  type Agreement,
  agreementPageSchema,
  agreementResponseSchema,
  type CreateAgreementRequest,
} from '@bella-vista/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FetchPage } from '../ui/PaginatedList.js';
import { requireApiClient } from './api.js';
import { queryKeys } from './keys.js';
import { COUNT_LIMIT } from './useOrganization.js';

// Acuerdos de junta (docs/api.md; S-03, S-04, S-05, S-08). An agreement is never edited: it is
// corrected with another one that mentions it (correctsId). Minutes are a text reference (D-26).

/** S-04: newest first, paginated. */
export const agreementPages: { queryKey: readonly unknown[]; fetchPage: FetchPage<Agreement> } = {
  queryKey: [...queryKeys.agreements, 'list'],
  fetchPage: ({ limit, cursor, signal }) =>
    requireApiClient().request({
      method: 'GET',
      path: '/agreements',
      query: { limit, cursor },
      schema: agreementPageSchema,
      signal,
    }),
};

/** The selectors of S-03, S-05 and S-08: the latest 100 agreements, optionally by result. */
export function useAgreementOptions(result?: Agreement['result']) {
  return useQuery({
    queryKey: [...queryKeys.agreements, 'options'],
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/agreements',
        query: { limit: COUNT_LIMIT },
        schema: agreementPageSchema,
        signal,
      }),
    select: (page) =>
      result ? page.data.filter((agreement) => agreement.result === result) : page.data,
  });
}

export function useCreateAgreement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAgreementRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: '/agreements',
        body,
        schema: agreementResponseSchema,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.agreements }),
  });
}
