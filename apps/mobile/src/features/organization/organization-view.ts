import type { Block, RoleAssignment, Section } from '@bella-vista/shared';
import { ROLE_LABELS } from '../../session/role-labels.js';
import type { StatusTone } from '../../ui/index.js';

// How S-06 and S-07 show the organization (3.2 §10.7). There is no /v1/organization: the app
// joins sections, blocks (each with its current, approved leader) and the assignments that wait
// for the president. The role names stay neutral ("Jefe de manzana"): the app does not know
// anyone's gender.

/** A count of the first page: "100+" when the API has more. */
export const countLabel = ({ count, more }: { count: number; more: boolean }): string =>
  more ? `${count}+` : String(count);

export type BlockView = {
  block: Block;
  /** The block leader assignment waiting for the president, if any. */
  pending: RoleAssignment | null;
  subtitle: string;
  tag: { tone: StatusTone; label: string } | null;
};

export type SectionView = { section: Section; blocks: BlockView[] };

/** Assignments the president has not resolved yet. */
export const isPending = (assignment: RoleAssignment) => assignment.status === 'pending';

export function blockView(block: Block, assignments: readonly RoleAssignment[]): BlockView {
  const pending =
    assignments.find(
      (item) => isPending(item) && item.role === 'block_leader' && item.blockId === block.id,
    ) ?? null;
  const subtitle = block.leader
    ? `Jefe de manzana: ${block.leader.fullName}`
    : pending
      ? `Por confirmar: ${pending.person.fullName}`
      : 'Sin jefe asignado';
  const tag = !block.active
    ? { tone: 'cancelled' as const, label: 'Inactiva' }
    : pending
      ? { tone: 'pending' as const, label: 'Pendiente' }
      : null;
  return { block, pending, subtitle, tag };
}

/** S-06: the sections by code, each with its blocks by visible code (S1-M01, S1-M02…). */
export function organizationView(
  sections: readonly Section[],
  blocks: readonly Block[],
  assignments: readonly RoleAssignment[],
): SectionView[] {
  return [...sections]
    .sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }))
    .map((section) => ({
      section,
      blocks: blocks
        .filter((block) => block.sectionId === section.id)
        .sort((a, b) => a.fullCode.localeCompare(b.fullCode, 'es', { numeric: true }))
        .map((block) => blockView(block, assignments)),
    }));
}

// --- S-07 -----------------------------------------------------------------------------------

const COMMITTEE_ORDER = ['president', 'treasurer', 'secretary', 'member'] as const;

/** What "Asignaciones vigentes" lists: in office, starting later, or waiting for approval. */
const isCurrent = (assignment: RoleAssignment) =>
  ['active', 'scheduled', 'pending'].includes(assignment.status);

export type AssignmentGroups = { committee: RoleAssignment[]; leaders: RoleAssignment[] };

/** S-07: committee officers in the order of the committee, then block leaders by block. */
export function assignmentGroups(assignments: readonly RoleAssignment[]): AssignmentGroups {
  const current = assignments.filter(isCurrent);
  const committee = current
    .filter((item) => item.role !== 'block_leader' && item.role !== 'superadmin')
    .sort(
      (a, b) =>
        COMMITTEE_ORDER.indexOf(a.role as (typeof COMMITTEE_ORDER)[number]) -
          COMMITTEE_ORDER.indexOf(b.role as (typeof COMMITTEE_ORDER)[number]) ||
        a.startDate.localeCompare(b.startDate),
    );
  const leaders = current
    .filter((item) => item.role === 'block_leader')
    .sort(
      (a, b) =>
        (a.blockCode ?? '').localeCompare(b.blockCode ?? '', 'es', { numeric: true }) ||
        a.startDate.localeCompare(b.startDate),
    );
  return { committee, leaders };
}

export const ASSIGNMENT_TAGS: Partial<
  Record<RoleAssignment['status'], { tone: StatusTone; label: string }>
> = {
  pending: { tone: 'pending', label: 'Pendiente' },
  scheduled: { tone: 'advance', label: 'Programada' },
};

/** "Presidente", or "S1-M03 · María López" for a block leader. */
export function assignmentTitle(assignment: RoleAssignment): string {
  return assignment.role === 'block_leader'
    ? `${assignment.blockCode ?? 'Manzana'} · ${assignment.person.fullName}`
    : ROLE_LABELS[assignment.role];
}
