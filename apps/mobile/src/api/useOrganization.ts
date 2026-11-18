import {
  type Block,
  blockListResponseSchema,
  blockResponseSchema,
  type CreateBlockRequest,
  type CreateRoleAssignmentInput,
  type CreateSectionRequest,
  connectionRequestPageSchema,
  type LeaderSubstitutionRequest,
  leaderSubstitutionResponseSchema,
  roleAssignmentListResponseSchema,
  roleAssignmentResponseSchema,
  sectionListResponseSchema,
  sectionResponseSchema,
} from '@bella-vista/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requireApiClient } from './api.js';
import { queryKeys } from './keys.js';

// Organization of the secretary (docs/api.md "Organización"; 3.2 §10.7, S-01, S-06, S-07).
// There is no /v1/organization: S-06 joins sections, blocks (with their current leader) and the
// pending block leader assignments in the app. Every assignment goes to the president
// (role_assignment approval), so each change also reloads the approvals.

export function useSections() {
  return useQuery({
    queryKey: queryKeys.sections,
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/sections',
        schema: sectionListResponseSchema,
        signal,
      }),
    select: (data) => data.sections,
  });
}

/** Every block of every section (no sectionId), each with its current leader. */
export function useBlocks() {
  return useQuery({
    queryKey: queryKeys.blocks,
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/blocks',
        schema: blockListResponseSchema,
        signal,
      }),
    select: (data) => data.blocks,
  });
}

/** All assignments (pending, rejected, scheduled, active, closed); screens filter them. */
export function useRoleAssignments() {
  return useQuery({
    queryKey: queryKeys.roleAssignments,
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/role-assignments',
        schema: roleAssignmentListResponseSchema,
        signal,
      }),
    select: (data) => data.assignments,
  });
}

/** The biggest page the API serves: counts above it read "100+". */
export const COUNT_LIMIT = 100;

/** S-01: connection requests waiting for the secretary (count of the first 100). */
export function useConnectionRequestCount(status: 'requested') {
  return useQuery({
    queryKey: [...queryKeys.connectionRequests, { status }],
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/connection-requests',
        query: { status, limit: COUNT_LIMIT },
        schema: connectionRequestPageSchema,
        signal,
      }),
    select: (page) => ({ count: page.data.length, more: page.next !== null }),
  });
}

function afterOrganizationChange(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.sections });
  void queryClient.invalidateQueries({ queryKey: queryKeys.blocks });
  void queryClient.invalidateQueries({ queryKey: queryKeys.roleAssignments });
}

export function useCreateSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSectionRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: '/sections',
        body,
        schema: sectionResponseSchema,
      }),
    onSettled: () => afterOrganizationChange(queryClient),
  });
}

export function useCreateBlock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBlockRequest) =>
      requireApiClient().request({
        method: 'POST',
        path: '/blocks',
        body,
        schema: blockResponseSchema,
      }),
    onSettled: () => afterOrganizationChange(queryClient),
  });
}

/** Registers an assignment; it stays pending until the president approves it. */
export function useAssignRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRoleAssignmentInput) =>
      requireApiClient().request({
        method: 'POST',
        path: '/role-assignments',
        body,
        schema: roleAssignmentResponseSchema,
      }),
    onSuccess: () => {
      afterOrganizationChange(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
    },
  });
}

/**
 * D-08: ends the outgoing leader (and deactivates their account) and registers the new one,
 * pending the president's approval, with the counted extraordinary closing as handover record.
 */
export function useLeaderSubstitution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ block, body }: { block: Pick<Block, 'id'>; body: LeaderSubstitutionRequest }) =>
      requireApiClient().request({
        method: 'POST',
        path: `/blocks/${block.id}/leader-substitution`,
        body,
        schema: leaderSubstitutionResponseSchema,
      }),
    onSuccess: () => {
      afterOrganizationChange(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
    },
  });
}
