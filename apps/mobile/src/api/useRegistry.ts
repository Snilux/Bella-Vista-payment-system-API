import {
  blockReportResponseSchema,
  type CreatePersonRequest,
  type CreatePreexistingConnectionRequest,
  type CreateUnitRequest,
  connectionResponseSchema,
  personMatchesResponseSchema,
  personResponseSchema,
  rateListResponseSchema,
  unitResponseSchema,
} from '@bella-vista/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requireApiClient } from './api.js';
import { queryKeys } from './keys.js';

// Padrón (docs/api.md "Padrón y tomas"; 3.2 §10.2 and §10.4): people, connections, units and the
// block roster. The API decides the scope: a screen shows what arrives and never assumes a
// field the role may not receive (a person with access "basic", a unit of "other_block").

export function usePerson(id: number) {
  return useQuery({
    queryKey: queryKeys.person(id),
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: `/people/${id}`,
        schema: personResponseSchema,
        signal,
      }),
    select: (data) => data.person,
  });
}

export function useConnection(id: number) {
  return useQuery({
    queryKey: queryKeys.connection(id),
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: `/connections/${id}`,
        schema: connectionResponseSchema,
        signal,
      }),
    select: (data) => data.connection,
  });
}

/**
 * P-01: every connection of a block with its families, status and debt (GET /v1/reports/block of
 * the current month). There is no list of units: the block report is the roster, not paginated.
 */
export function useBlockRoster(blockId: number | null) {
  return useQuery({
    queryKey: queryKeys.blockRoster(blockId ?? 0),
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/reports/block',
        query: { blockId },
        schema: blockReportResponseSchema,
        signal,
      }),
    select: (data) => data.report,
    enabled: blockId !== null,
  });
}

/** P-03: the approved rates, to estimate the debt of a family that already existed. */
export function useApprovedRates() {
  return useQuery({
    queryKey: queryKeys.rates,
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/rates',
        schema: rateListResponseSchema,
        signal,
      }),
    select: (data) => data.rates.filter((rate) => rate.status === 'approved'),
  });
}

/** What a new person, connection or family changes: the search, the files and the rosters. */
export function afterRegistryChange(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.searchAll });
  void queryClient.invalidateQueries({ queryKey: queryKeys.people });
  void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
  void queryClient.invalidateQueries({ queryKey: queryKeys.blockRosters });
  void queryClient.invalidateQueries({ queryKey: queryKeys.communityReport });
}

/** P-02: homonyms (`exact`) and similar names before registering (D-10). */
export function usePersonMatches() {
  return useMutation({
    mutationFn: (
      name: Pick<CreatePersonRequest, 'givenNames' | 'paternalSurname' | 'maternalSurname'>,
    ) =>
      requireApiClient().request({
        method: 'GET',
        path: '/people/matches',
        query: {
          givenNames: name.givenNames,
          paternalSurname: name.paternalSurname,
          maternalSurname: name.maternalSurname ?? undefined,
        },
        schema: personMatchesResponseSchema,
      }),
  });
}

export function useCreatePerson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePersonRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: '/people',
        body,
        schema: personResponseSchema,
      }),
    onSuccess: () => afterRegistryChange(queryClient),
  });
}

export function useCreatePreexistingConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePreexistingConnectionRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: '/connections/pre-existing',
        body,
        schema: connectionResponseSchema,
      }),
    onSuccess: () => afterRegistryChange(queryClient),
  });
}

export function useCreateUnit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUnitRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: '/units',
        body,
        schema: unitResponseSchema,
      }),
    onSuccess: () => afterRegistryChange(queryClient),
  });
}
