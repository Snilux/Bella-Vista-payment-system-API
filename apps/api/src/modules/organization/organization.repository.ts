import { and, asc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client.js';
import {
  approval,
  block,
  person,
  roleAssignment,
  section,
  userAccount,
  vBlock,
} from '../../db/schema/index.js';

// Queries of the organization module (sections, blocks and role assignments).

type Executor = Database | Transaction;

// --- Sections -------------------------------------------------------------------------------

const sectionColumns = {
  id: section.id,
  code: section.code,
  name: section.name,
  active: section.active,
};

export function listSections(db: Executor) {
  return db.select(sectionColumns).from(section).orderBy(asc(section.code));
}

export async function findSection(db: Executor, id: number, lock = false) {
  const query = db.select(sectionColumns).from(section).where(eq(section.id, id)).limit(1);
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

export async function findSectionBy(db: Executor, where: { code?: string; name?: string }) {
  const [row] = await db
    .select(sectionColumns)
    .from(section)
    .where(
      where.code !== undefined ? eq(section.code, where.code) : eq(section.name, where.name ?? ''),
    )
    .limit(1);
  return row ?? null;
}

export async function insertSection(
  tx: Transaction,
  values: { code: string; name: string; createdBy: number },
) {
  const [row] = await tx.insert(section).values(values).returning(sectionColumns);
  if (!row) throw new Error('section not inserted');
  return row;
}

export async function updateSection(
  tx: Transaction,
  id: number,
  values: { name?: string | undefined; active?: boolean | undefined },
): Promise<void> {
  await tx.update(section).set(values).where(eq(section.id, id));
}

// --- Blocks ---------------------------------------------------------------------------------

const blockQuery = (db: Executor) =>
  db
    .select({
      id: block.id,
      sectionId: block.sectionId,
      code: block.code,
      fullCode: vBlock.code,
      name: block.name,
      active: block.active,
      leaderPersonId: vBlock.leaderPersonId,
      leaderName: vBlock.leaderName,
      leaderContactPhone: vBlock.leaderContactPhone,
    })
    .from(block)
    .innerJoin(vBlock, eq(vBlock.id, block.id));

export function listBlocks(db: Executor, sectionId?: number) {
  return blockQuery(db)
    .where(sectionId === undefined ? undefined : eq(block.sectionId, sectionId))
    .orderBy(asc(vBlock.code));
}

export type BlockRow = Awaited<ReturnType<typeof listBlocks>>[number];

export async function findBlock(db: Executor, id: number): Promise<BlockRow | null> {
  const [row] = await blockQuery(db).where(eq(block.id, id)).limit(1);
  return row ?? null;
}

/** Block row locked (serializes leader assignments and changes of the same block). */
export async function lockBlock(tx: Transaction, id: number) {
  const [row] = await tx
    .select({
      id: block.id,
      sectionId: block.sectionId,
      code: block.code,
      name: block.name,
      active: block.active,
    })
    .from(block)
    .where(eq(block.id, id))
    .limit(1)
    .for('update');
  return row ?? null;
}

export async function blockCodeExists(
  db: Executor,
  sectionId: number,
  code: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: block.id })
    .from(block)
    .where(and(eq(block.sectionId, sectionId), eq(block.code, code)))
    .limit(1);
  return row !== undefined;
}

export async function insertBlock(
  tx: Transaction,
  values: { sectionId: number; code: string; name: string | null; createdBy: number },
): Promise<number> {
  const [row] = await tx.insert(block).values(values).returning({ id: block.id });
  if (!row) throw new Error('block not inserted');
  return row.id;
}

export async function updateBlock(
  tx: Transaction,
  id: number,
  values: { name?: string | null | undefined; active?: boolean | undefined },
): Promise<void> {
  await tx.update(block).set(values).where(eq(block.id, id));
}

// --- Role assignments -----------------------------------------------------------------------

const assignmentQuery = (db: Executor) =>
  db
    .select({
      id: roleAssignment.id,
      role: roleAssignment.role,
      startDate: roleAssignment.startDate,
      endDate: roleAssignment.endDate,
      blockId: roleAssignment.blockId,
      blockCode: vBlock.code,
      contactPhone: roleAssignment.contactPhone,
      approvalId: roleAssignment.approvalId,
      approvalResult: approval.result,
      accountId: userAccount.id,
      personId: person.id,
      personFolio: person.folio,
      givenNames: person.givenNames,
      paternalSurname: person.paternalSurname,
      maternalSurname: person.maternalSurname,
      distinguishingNote: person.distinguishingNote,
    })
    .from(roleAssignment)
    .innerJoin(person, eq(person.id, roleAssignment.personId))
    .leftJoin(approval, eq(approval.id, roleAssignment.approvalId))
    .leftJoin(userAccount, eq(userAccount.roleAssignmentId, roleAssignment.id))
    .leftJoin(vBlock, eq(vBlock.id, roleAssignment.blockId));

export function listAssignments(
  db: Executor,
  filter: {
    role?: (typeof roleAssignment.role.enumValues)[number] | undefined;
    blockId?: number | undefined;
  },
) {
  const conditions: SQL[] = [];
  if (filter.role) conditions.push(eq(roleAssignment.role, filter.role));
  if (filter.blockId) conditions.push(eq(roleAssignment.blockId, filter.blockId));
  return assignmentQuery(db)
    .where(and(...conditions))
    .orderBy(asc(roleAssignment.role), asc(roleAssignment.startDate), asc(roleAssignment.id));
}

export type AssignmentRow = Awaited<ReturnType<typeof listAssignments>>[number];

export async function findAssignment(db: Executor, id: number): Promise<AssignmentRow | null> {
  const [row] = await assignmentQuery(db).where(eq(roleAssignment.id, id)).limit(1);
  return row ?? null;
}

export function assignmentsByApproval(db: Executor, approvalIds: number[]) {
  return assignmentQuery(db).where(inArray(roleAssignment.approvalId, approvalIds));
}

/** Open (end_date null) assignments that block a new one: the same rule as the DB indexes. */
export async function findOpenConflicts(
  db: Executor,
  input: { role: string; blockId: number | null; personId: number },
) {
  const open = isNull(roleAssignment.endDate);
  const leaderOfBlock =
    input.role === 'block_leader' && input.blockId !== null
      ? await db
          .select({ id: roleAssignment.id })
          .from(roleAssignment)
          .where(
            and(
              open,
              eq(roleAssignment.role, 'block_leader'),
              eq(roleAssignment.blockId, input.blockId),
            ),
          )
          .limit(1)
      : [];
  const leaderPerson =
    input.role === 'block_leader'
      ? await db
          .select({ id: roleAssignment.id })
          .from(roleAssignment)
          .where(
            and(
              open,
              eq(roleAssignment.role, 'block_leader'),
              eq(roleAssignment.personId, input.personId),
            ),
          )
          .limit(1)
      : [];
  const officer = ['president', 'treasurer', 'secretary'].includes(input.role)
    ? await db
        .select({ id: roleAssignment.id })
        .from(roleAssignment)
        .where(
          and(
            open,
            eq(roleAssignment.role, input.role as (typeof roleAssignment.role.enumValues)[number]),
          ),
        )
        .limit(1)
    : [];
  return {
    blockHasLeader: leaderOfBlock.length > 0,
    personIsLeader: leaderPerson.length > 0,
    roleTaken: officer.length > 0,
  };
}

export async function personExists(db: Executor, id: number): Promise<boolean> {
  const [row] = await db.select({ id: person.id }).from(person).where(eq(person.id, id)).limit(1);
  return row !== undefined;
}

export async function insertApproval(
  tx: Transaction,
  values: { reason: string; requestedBy: number; requestedAt: Date },
): Promise<number> {
  const [row] = await tx
    .insert(approval)
    .values({ type: 'role_assignment', ...values, createdBy: values.requestedBy })
    .returning({ id: approval.id });
  if (!row) throw new Error('approval not inserted');
  return row.id;
}

export async function insertAssignment(
  tx: Transaction,
  values: typeof roleAssignment.$inferInsert,
): Promise<number> {
  const [row] = await tx.insert(roleAssignment).values(values).returning({ id: roleAssignment.id });
  if (!row) throw new Error('role assignment not inserted');
  return row.id;
}

/** Assignment locked for closing or for its approval's resolution. */
export async function lockAssignment(
  tx: Transaction,
  where: { id: number } | { approvalId: number },
) {
  const [row] = await tx
    .select({
      id: roleAssignment.id,
      role: roleAssignment.role,
      startDate: roleAssignment.startDate,
      endDate: roleAssignment.endDate,
      approvalId: roleAssignment.approvalId,
    })
    .from(roleAssignment)
    .where(
      'id' in where
        ? eq(roleAssignment.id, where.id)
        : eq(roleAssignment.approvalId, where.approvalId),
    )
    .limit(1)
    .for('update');
  return row ?? null;
}

export async function setAssignmentEndDate(
  tx: Transaction,
  id: number,
  endDate: string,
): Promise<void> {
  await tx.update(roleAssignment).set({ endDate }).where(eq(roleAssignment.id, id));
}

/** Account of an assignment (D-22: deactivated when the assignment closes). */
export async function findAccountOfAssignment(tx: Transaction, roleAssignmentId: number) {
  const [row] = await tx
    .select({ id: userAccount.id, deactivatedAt: userAccount.deactivatedAt })
    .from(userAccount)
    .where(eq(userAccount.roleAssignmentId, roleAssignmentId))
    .limit(1)
    .for('update');
  return row ?? null;
}

export async function deactivateAccount(tx: Transaction, id: number, at: Date): Promise<void> {
  await tx.update(userAccount).set({ deactivatedAt: at }).where(eq(userAccount.id, id));
}
