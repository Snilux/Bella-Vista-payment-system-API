import type {
  AssignmentStatus,
  Block,
  CloseRoleAssignmentRequest,
  CreateBlockRequest,
  CreateRoleAssignmentInput,
  CreateSectionRequest,
  RoleAssignment,
  RoleAssignmentListQuery,
  UpdateBlockRequest,
  UpdateSectionRequest,
} from '@bella-vista/shared';
import { isBlockScoped } from '@bella-vista/shared';
import { type Actor, writeAudit } from '../../db/audit.js';
import type { Database, Transaction } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { businessDate } from '../../lib/dates.js';
import type { AuthenticatedAccount } from '../../plugins/auth.js';
import type { ApprovalHandler } from '../approvals/approval-registry.js';
import { revokeAllRefreshTokens } from '../auth/auth.repository.js';
import { ensureBlockCashbox } from '../cashboxes/cashboxes.service.js';
import { organizationErrors } from './organization.errors.js';
import {
  type AssignmentRow,
  assignmentsByApproval,
  type BlockRow,
  blockCodeExists,
  deactivateAccount,
  findAccountOfAssignment,
  findAssignment,
  findBlock,
  findOpenConflicts,
  findSection,
  findSectionBy,
  insertApproval,
  insertAssignment,
  insertBlock,
  insertSection,
  listAssignments,
  listBlocks,
  listSections,
  lockAssignment,
  lockBlock,
  personExists,
  setAssignmentEndDate,
  updateBlock,
  updateSection,
} from './organization.repository.js';

// Sections, blocks and role assignments (CU-03, CU-04, RF-ORG; D-09, D-19, D-22). The
// secretary registers; an assignment waits for the president's approval (approvals module),
// whose outcome is handled by roleAssignmentApprovalHandler below.

export interface OrganizationServiceDeps {
  db: Database;
  now: () => Date;
  timeZone: string;
}

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'superadministrador',
  president: 'presidente',
  treasurer: 'tesorero',
  secretary: 'secretario',
  member: 'vocal',
  block_leader: 'jefe de manzana',
};

const fullName = (row: {
  givenNames: string;
  paternalSurname: string;
  maternalSurname: string | null;
}) => [row.givenNames, row.paternalSurname, row.maternalSurname].filter(Boolean).join(' ');

/** Derived status (same validity rule as the auth plugin and the views). */
export function assignmentStatus(
  row: { role: string; approvalResult: string | null; startDate: string; endDate: string | null },
  today: string,
): AssignmentStatus {
  const approved = row.role === 'superadmin' || row.approvalResult === 'approved';
  if (row.approvalResult === 'rejected') return 'rejected';
  if (!approved) return 'pending';
  if (row.endDate !== null && row.endDate < today) return 'closed';
  if (row.startDate > today) return 'scheduled';
  return 'active';
}

function toAssignment(row: AssignmentRow, today: string): RoleAssignment {
  return {
    id: row.id,
    role: row.role,
    status: assignmentStatus(row, today),
    person: {
      id: row.personId,
      folio: row.personFolio,
      fullName: fullName(row),
      distinguishingNote: row.distinguishingNote,
    },
    blockId: row.blockId,
    blockCode: row.blockCode,
    contactPhone: row.contactPhone,
    startDate: row.startDate,
    endDate: row.endDate,
    approvalId: row.approvalId,
    hasAccount: row.accountId !== null,
  };
}

/** RF-ORG-06: the leader's phone is visible to the committee and to that block's leader. */
function toBlock(row: BlockRow, viewer: AuthenticatedAccount): Block {
  const seesPhone = !isBlockScoped(viewer.role) || viewer.blockId === row.id;
  return {
    id: row.id,
    sectionId: row.sectionId,
    code: row.code,
    fullCode: row.fullCode,
    name: row.name,
    active: row.active,
    leader:
      row.leaderPersonId !== null && row.leaderName !== null
        ? {
            personId: row.leaderPersonId,
            fullName: row.leaderName,
            contactPhone: seesPhone ? row.leaderContactPhone : null,
          }
        : null,
  };
}

/** Maps the unique indexes of sections and blocks to DUPLICATE_CODE. */
function duplicateFrom(
  error: unknown,
  input: { code?: string | undefined; name?: string | null | undefined },
) {
  if (
    isUniqueViolation(error, 'section_code_unique') ||
    isUniqueViolation(error, 'block_section_id_code_unique')
  ) {
    return organizationErrors.duplicateCode('code', input.code ?? '');
  }
  if (isUniqueViolation(error, 'section_name_unique')) {
    return organizationErrors.duplicateCode('name', input.name ?? '');
  }
  return null;
}

export function createOrganizationService(deps: OrganizationServiceDeps) {
  const { db } = deps;
  const today = () => businessDate(deps.now(), deps.timeZone);

  async function blockOrThrow(
    executor: Database | Transaction,
    id: number,
    viewer: AuthenticatedAccount,
  ) {
    const row = await findBlock(executor, id);
    if (!row) throw organizationErrors.blockNotFound();
    return toBlock(row, viewer);
  }

  async function assignmentOrThrow(executor: Database | Transaction, id: number) {
    const row = await findAssignment(executor, id);
    if (!row) throw organizationErrors.assignmentNotFound();
    return toAssignment(row, today());
  }

  return {
    // --- Sections ---------------------------------------------------------------------------

    async listSections() {
      return { sections: await listSections(db) };
    },

    async createSection(actor: Actor, input: CreateSectionRequest) {
      try {
        const created = await db.transaction(async (tx) => {
          if (await findSectionBy(tx, { code: input.code })) {
            throw organizationErrors.duplicateCode('code', input.code);
          }
          if (await findSectionBy(tx, { name: input.name })) {
            throw organizationErrors.duplicateCode('name', input.name);
          }
          const row = await insertSection(tx, { ...input, createdBy: actor.userAccountId });
          await writeAudit(tx, actor, {
            action: 'create',
            table: 'section',
            recordId: row.id,
            after: row,
          });
          return row;
        });
        return { section: created };
      } catch (error) {
        throw duplicateFrom(error, input) ?? error;
      }
    },

    async updateSection(actor: Actor, id: number, input: UpdateSectionRequest) {
      try {
        const updated = await db.transaction(async (tx) => {
          const before = await findSection(tx, id, true);
          if (!before) throw organizationErrors.sectionNotFound();
          if (input.name !== undefined && input.name !== before.name) {
            const other = await findSectionBy(tx, { name: input.name });
            if (other && other.id !== id)
              throw organizationErrors.duplicateCode('name', input.name);
          }
          await updateSection(tx, id, { name: input.name, active: input.active });
          const after = await findSection(tx, id);
          if (!after) throw organizationErrors.sectionNotFound();
          await writeAudit(tx, actor, {
            action: 'update',
            table: 'section',
            recordId: id,
            before,
            after,
          });
          return after;
        });
        return { section: updated };
      } catch (error) {
        throw duplicateFrom(error, { name: input.name }) ?? error;
      }
    },

    // --- Blocks -----------------------------------------------------------------------------

    async listBlocks(viewer: AuthenticatedAccount, sectionId?: number) {
      const rows = await listBlocks(db, sectionId);
      return { blocks: rows.map((row) => toBlock(row, viewer)) };
    },

    async getBlock(viewer: AuthenticatedAccount, id: number) {
      return { block: await blockOrThrow(db, id, viewer) };
    },

    async createBlock(actor: Actor, viewer: AuthenticatedAccount, input: CreateBlockRequest) {
      try {
        return await db.transaction(async (tx) => {
          const parent = await findSection(tx, input.sectionId, true);
          if (!parent) throw organizationErrors.sectionNotFound();
          if (!parent.active) {
            throw organizationErrors.invalidField('body.sectionId', 'La sección está inactiva.');
          }
          if (await blockCodeExists(tx, input.sectionId, input.code)) {
            throw organizationErrors.duplicateCode('code', `${parent.code}-${input.code}`);
          }
          const id = await insertBlock(tx, { ...input, createdBy: actor.userAccountId });
          const created = await blockOrThrow(tx, id, viewer);
          await writeAudit(tx, actor, {
            action: 'create',
            table: 'block',
            recordId: id,
            after: { sectionId: created.sectionId, code: created.code, name: created.name },
          });
          // The cashbox belongs to the block (D-08): it exists from day one, so the treasurer
          // can capture its opening balance before the first payment.
          await ensureBlockCashbox(tx, id, actor);
          return { block: created };
        });
      } catch (error) {
        throw duplicateFrom(error, { code: input.code }) ?? error;
      }
    },

    async updateBlock(
      actor: Actor,
      viewer: AuthenticatedAccount,
      id: number,
      input: UpdateBlockRequest,
    ) {
      return db.transaction(async (tx) => {
        const before = await lockBlock(tx, id);
        if (!before) throw organizationErrors.blockNotFound();
        await updateBlock(tx, id, { name: input.name, active: input.active });
        const after = await blockOrThrow(tx, id, viewer);
        await writeAudit(tx, actor, {
          action: 'update',
          table: 'block',
          recordId: id,
          before: { name: before.name, active: before.active },
          after: { name: after.name, active: after.active },
        });
        return { block: after };
      });
    },

    // --- Role assignments -------------------------------------------------------------------

    async listAssignments(query: RoleAssignmentListQuery) {
      const now = today();
      const rows = await listAssignments(db, { role: query.role, blockId: query.blockId });
      const assignments = rows.map((row) => toAssignment(row, now));
      return {
        assignments: query.status
          ? assignments.filter((a) => a.status === query.status)
          : assignments,
      };
    },

    /** SEC registers; the assignment waits for the president's approval (pending). */
    async createAssignment(actor: Actor, input: CreateRoleAssignmentInput) {
      const blockId = input.blockId ?? null;
      try {
        return await db.transaction(async (tx) => {
          if (!(await personExists(tx, input.personId))) throw organizationErrors.personNotFound();
          let blockCode: string | null = null;
          if (blockId !== null) {
            const target = await lockBlock(tx, blockId);
            if (!target) throw organizationErrors.blockNotFound();
            if (!target.active) {
              throw organizationErrors.invalidField('body.blockId', 'La manzana está inactiva.');
            }
            blockCode = (await findBlock(tx, blockId))?.fullCode ?? null;
          }

          const conflicts = await findOpenConflicts(tx, {
            role: input.role,
            blockId,
            personId: input.personId,
          });
          if (conflicts.blockHasLeader) throw organizationErrors.blockHasLeader(blockCode ?? '');
          if (conflicts.personIsLeader) throw organizationErrors.personIsLeader();
          if (conflicts.roleTaken)
            throw organizationErrors.roleTaken(ROLE_LABELS[input.role] ?? input.role);

          const label = ROLE_LABELS[input.role] ?? input.role;
          const approvalId = await insertApproval(tx, {
            reason:
              input.reason ??
              `Registro de ${label}${blockCode ? ` de la manzana ${blockCode}` : ''}`,
            requestedBy: actor.userAccountId,
            requestedAt: deps.now(),
          });
          const id = await insertAssignment(tx, {
            personId: input.personId,
            role: input.role,
            blockId,
            contactPhone: input.contactPhone ?? null,
            startDate: input.startDate,
            approvalId,
            createdBy: actor.userAccountId,
          });
          const created = await assignmentOrThrow(tx, id);
          await writeAudit(tx, actor, {
            action: 'create',
            table: 'role_assignment',
            recordId: id,
            after: {
              personId: input.personId,
              role: input.role,
              blockId,
              startDate: input.startDate,
              approvalId,
            },
          });
          return { assignment: created };
        });
      } catch (error) {
        if (isUniqueViolation(error, 'role_assignment_open_leader_block_uq')) {
          throw organizationErrors.blockHasLeader(
            (await findBlock(db, blockId ?? 0))?.fullCode ?? '',
          );
        }
        if (isUniqueViolation(error, 'role_assignment_open_leader_person_uq')) {
          throw organizationErrors.personIsLeader();
        }
        if (isUniqueViolation(error, 'role_assignment_open_officer_uq')) {
          throw organizationErrors.roleTaken(ROLE_LABELS[input.role] ?? input.role);
        }
        throw error;
      }
    },

    /**
     * End of term of a committee officer (D-22): sets the end date and deactivates the
     * account, closing its sessions. Block leaders are replaced with the extraordinary closing
     * of D-08 (API step 8), never closed here.
     */
    async closeAssignment(actor: Actor, id: number, input: CloseRoleAssignmentRequest) {
      const now = deps.now();
      const todayDate = businessDate(now, deps.timeZone);
      return db.transaction(async (tx) => {
        const current = await lockAssignment(tx, { id });
        if (!current) throw organizationErrors.assignmentNotFound();
        if (current.role === 'block_leader') {
          throw organizationErrors.invalidField(
            'params.id',
            'El jefe de manzana se sustituye con acta de entrega de la caja (corte extraordinario), no se cierra.',
          );
        }
        if (current.role === 'superadmin') {
          throw organizationErrors.invalidField(
            'params.id',
            'La asignación del superadministrador no se cierra.',
          );
        }
        if (current.endDate !== null) {
          throw organizationErrors.invalidField('params.id', 'La asignación ya está cerrada.');
        }
        const row = await findAssignment(tx, id);
        if (!row || assignmentStatus(row, todayDate) !== 'active') {
          throw organizationErrors.invalidField(
            'params.id',
            'Solo se cierra una asignación vigente.',
          );
        }
        if (input.endDate < current.startDate) {
          throw organizationErrors.invalidField(
            'body.endDate',
            'La fecha de fin no puede ser anterior a la fecha de inicio.',
          );
        }
        if (input.endDate > todayDate) {
          throw organizationErrors.invalidField(
            'body.endDate',
            'La fecha de fin no puede ser posterior a hoy.',
          );
        }

        await setAssignmentEndDate(tx, id, input.endDate);
        const account = await findAccountOfAssignment(tx, id);
        if (account && !account.deactivatedAt) {
          await deactivateAccount(tx, account.id, now);
          await revokeAllRefreshTokens(tx, account.id, now);
        }
        await writeAudit(tx, actor, {
          action: 'close',
          table: 'role_assignment',
          recordId: id,
          before: { endDate: null },
          after: { endDate: input.endDate, deactivatedAccountId: account?.id ?? null },
          reason: input.reason,
        });
        return { assignment: await assignmentOrThrow(tx, id) };
      });
    },
  };
}

export type OrganizationService = ReturnType<typeof createOrganizationService>;

/**
 * Handler of role_assignment approvals. Approving needs no extra change (the assignment is
 * current from its start date; the superadmin then creates its account). Rejecting closes it
 * with end_date = start_date, which frees the block or the officer role (D-09).
 */
export const roleAssignmentApprovalHandler: ApprovalHandler = {
  async onApproved() {},

  async onRejected({ tx, approvalId }) {
    const assignment = await lockAssignment(tx, { approvalId });
    if (assignment && assignment.endDate === null) {
      await setAssignmentEndDate(tx, assignment.id, assignment.startDate);
    }
  },

  async describe(executor, approvalIds) {
    const rows = await assignmentsByApproval(executor, approvalIds);
    return new Map(
      rows.flatMap((row) =>
        row.approvalId === null
          ? []
          : [
              [
                row.approvalId,
                `${capitalize(ROLE_LABELS[row.role] ?? row.role)}${row.blockCode ? ` ${row.blockCode}` : ''}: ${fullName(row)} (desde ${row.startDate})`,
              ] as const,
            ],
      ),
    );
  },
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
