import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client.js';
import {
  agreement,
  approval,
  connection,
  person,
  suspension,
  unit,
  unitChangeRequest,
  unitHolder,
  vBlock,
  vConnection,
  vConnectionRequest,
  vPaymentAmount,
  vUnit,
} from '../../db/schema/index.js';

// Queries of the registry module: search, people, units, unit change requests and
// suspensions. Scope decisions (block leaders) are taken by the service with these results.

type Executor = Database | Transaction;

/** Minimum word_similarity for a fuzzy name match ("hernandes" finds "Hernández"). */
export const NAME_SIMILARITY = 0.5;
const SEARCH_LIMIT = 20;

const personNameSql = sql`f_normalize_name(${person.givenNames}, ${person.paternalSurname}, ${person.maternalSurname})`;
const normalized = (text: string) => sql`f_normalize_name(${text}::text, NULL, NULL)`;
/**
 * Free text (address, reference, distinguishing note) normalized like names and without
 * punctuation, so "av hidalgo" matches "Av. Hidalgo 12".
 */
const plain = (value: SQL | string) =>
  typeof value === 'string'
    ? sql`regexp_replace(f_normalize_name(${value}::text, NULL, NULL), '[[:punct:]]', '', 'g')`
    : sql`regexp_replace(f_normalize_name(${value}, NULL, NULL), '[[:punct:]]', '', 'g')`;
/** Whether free-text column `column` contains the user text `q` (see plain). */
const plainContains = (column: SQL | AnyColumn, q: string) =>
  sql`${plain(sql`${column}`)} LIKE '%' || ${plain(q)} || '%'`;
/** LIKE pattern for user text, escaping its wildcards. */
const containing = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const personBasicColumns = {
  id: person.id,
  folio: person.folio,
  givenNames: person.givenNames,
  paternalSurname: person.paternalSurname,
  maternalSurname: person.maternalSurname,
  distinguishingNote: person.distinguishingNote,
};

// --- Search ---------------------------------------------------------------------------------

export function searchPeople(db: Executor, q: string) {
  const score = sql<number>`greatest(
      word_similarity(${normalized(q)}, ${personNameSql}),
      CASE WHEN ${person.folio} ILIKE ${containing(q)} THEN 1 ELSE 0 END,
      CASE WHEN ${plainContains(person.distinguishingNote, q)} THEN 0.9 ELSE 0 END)`;
  return db
    .select({ ...personBasicColumns, score })
    .from(person)
    .where(sql`${score} >= ${NAME_SIMILARITY}`)
    .orderBy(desc(score), asc(person.id))
    .limit(SEARCH_LIMIT);
}

export function searchConnections(db: Executor, q: string, blockId: number | null) {
  const match = or(
    sql`${vConnection.folio} ILIKE ${containing(q)}`,
    plainContains(vConnection.address, q),
  );
  return db
    .select({
      id: vConnection.id,
      folio: vConnection.folio,
      address: vConnection.address,
      status: vConnection.status,
      unitCount: vConnection.unitCount,
      blockId: vConnection.blockId,
      blockCode: vBlock.code,
    })
    .from(vConnection)
    .leftJoin(vBlock, eq(vBlock.id, vConnection.blockId))
    .where(and(match, blockId === null ? undefined : eq(vConnection.blockId, blockId)))
    .orderBy(asc(vConnection.folio))
    .limit(SEARCH_LIMIT);
}

export function searchUnits(db: Executor, q: string, blockId: number | null) {
  const match = or(sql`${vUnit.folio} ILIKE ${containing(q)}`, plainContains(vUnit.reference, q));
  return unitListQuery(db)
    .where(and(match, blockId === null ? undefined : eq(vConnection.blockId, blockId)))
    .orderBy(asc(vUnit.folio))
    .limit(SEARCH_LIMIT);
}

const unitListQuery = (db: Executor) =>
  db
    .select({
      id: vUnit.id,
      folio: vUnit.folio,
      reference: vUnit.reference,
      status: vUnit.status,
      billingStartPeriod: vUnit.billingStartPeriod,
      connectionId: vUnit.connectionId,
      connectionFolio: vConnection.folio,
      address: vConnection.address,
      blockId: vConnection.blockId,
      blockCode: vBlock.code,
      holder: personBasicColumns,
    })
    .from(vUnit)
    .innerJoin(vConnection, eq(vConnection.id, vUnit.connectionId))
    .leftJoin(vBlock, eq(vBlock.id, vConnection.blockId))
    .leftJoin(person, eq(person.id, vUnit.holderPersonId));

export function unitsOfConnection(db: Executor, connectionId: number) {
  return unitListQuery(db).where(eq(vUnit.connectionId, connectionId)).orderBy(asc(vUnit.id));
}

// --- People ---------------------------------------------------------------------------------

export function peopleWithName(
  db: Executor,
  name: { givenNames: string; paternalSurname: string; maternalSurname: string | null },
) {
  return db
    .select(personBasicColumns)
    .from(person)
    .where(
      sql`${personNameSql} = f_normalize_name(${name.givenNames}::text, ${name.paternalSurname}::text, ${name.maternalSurname}::text)`,
    )
    .orderBy(asc(person.id));
}

export function peopleWithSimilarName(
  db: Executor,
  name: { givenNames: string; paternalSurname: string; maternalSurname: string | null },
) {
  const wanted = sql`f_normalize_name(${name.givenNames}::text, ${name.paternalSurname}::text, ${name.maternalSurname}::text)`;
  const score = sql<number>`similarity(${wanted}, ${personNameSql})`;
  return db
    .select(personBasicColumns)
    .from(person)
    .where(and(sql`${score} >= 0.4`, sql`${personNameSql} <> ${wanted}`))
    .orderBy(desc(score), asc(person.id))
    .limit(10);
}

export async function findPerson(db: Executor, id: number) {
  const [row] = await db
    .select({
      ...personBasicColumns,
      phone: person.phone,
      registeredOn: person.registeredOn,
      createdBy: person.createdBy,
    })
    .from(person)
    .where(eq(person.id, id))
    .limit(1);
  return row ?? null;
}

export async function insertPerson(tx: Transaction, values: typeof person.$inferInsert) {
  const [row] = await tx.insert(person).values(values).returning({ id: person.id });
  if (!row) throw new Error('person not inserted');
  return row.id;
}

/** Statuses of a connection request that still tie its applicant to the block. */
const LIVE_REQUEST = ['rejected', 'cancelled'] as const;

/**
 * Whether a block leader sees the person in full (RF-PAD-04): current holder of a unit in
 * the block, applicant of a live request there, or registered by this leader and still
 * without any unit or live request.
 */
export async function leaderSeesPerson(
  db: Executor,
  personId: number,
  blockId: number,
  userAccountId: number,
): Promise<boolean> {
  const rows = await db.execute<{ visible: boolean }>(sql`
    SELECT
      EXISTS (
        SELECT 1 FROM unit_holder uh
        JOIN unit u ON u.id = uh.unit_id
        JOIN connection_block cb ON cb.connection_id = u.connection_id AND cb.valid_to IS NULL
        WHERE uh.person_id = ${personId} AND uh.valid_to IS NULL AND cb.block_id = ${blockId}
      )
      OR EXISTS (
        SELECT 1 FROM v_connection_request r
        WHERE r.applicant_id = ${personId} AND r.block_id = ${blockId}
          AND r.status NOT IN ('rejected', 'cancelled')
      )
      OR EXISTS (
        SELECT 1 FROM person p
        WHERE p.id = ${personId} AND p.created_by = ${userAccountId}
          AND NOT EXISTS (
            SELECT 1 FROM unit_holder uh WHERE uh.person_id = p.id AND uh.valid_to IS NULL)
          AND NOT EXISTS (
            SELECT 1 FROM v_connection_request r
            WHERE r.applicant_id = p.id AND r.status NOT IN ('rejected', 'cancelled'))
      ) AS visible`);
  return rows[0]?.visible === true;
}

/** Units the person currently holds, with their block. */
export function unitsHeldBy(db: Executor, personId: number) {
  return db
    .select({
      id: vUnit.id,
      folio: vUnit.folio,
      reference: vUnit.reference,
      status: vUnit.status,
      connectionId: vUnit.connectionId,
      connectionFolio: vConnection.folio,
      address: vConnection.address,
      blockId: vConnection.blockId,
      blockCode: vBlock.code,
      holderSince: unitHolder.validFrom,
    })
    .from(unitHolder)
    .innerJoin(vUnit, eq(vUnit.id, unitHolder.unitId))
    .innerJoin(vConnection, eq(vConnection.id, vUnit.connectionId))
    .leftJoin(vBlock, eq(vBlock.id, vConnection.blockId))
    .where(and(eq(unitHolder.personId, personId), isNull(unitHolder.validTo)))
    .orderBy(asc(vUnit.id));
}

export function requestsOf(db: Executor, personId: number, blockId: number | null) {
  return db
    .select({
      id: vConnectionRequest.id,
      folio: vConnectionRequest.folio,
      status: vConnectionRequest.status,
      address: vConnectionRequest.address,
      blockCode: vBlock.code,
    })
    .from(vConnectionRequest)
    .leftJoin(vBlock, eq(vBlock.id, vConnectionRequest.blockId))
    .where(
      and(
        eq(vConnectionRequest.applicantId, personId),
        blockId === null ? undefined : eq(vConnectionRequest.blockId, blockId),
        blockId === null ? undefined : notInArray(vConnectionRequest.status, [...LIVE_REQUEST]),
      ),
    )
    .orderBy(desc(vConnectionRequest.requestedOn));
}

// --- Units ----------------------------------------------------------------------------------

export async function findUnit(db: Executor, id: number) {
  const [row] = await unitListQuery(db).where(eq(vUnit.id, id)).limit(1);
  if (!row) return null;
  const [dates] = await db
    .select({
      registeredOn: vUnit.registeredOn,
      activatedOn: vUnit.activatedOn,
      deactivatedOn: vUnit.deactivatedOn,
    })
    .from(vUnit)
    .where(eq(vUnit.id, id));
  return { ...row, ...(dates ?? { registeredOn: '', activatedOn: null, deactivatedOn: null }) };
}

export function holdersOf(db: Executor, unitId: number) {
  return db
    .select({ ...personBasicColumns, validFrom: unitHolder.validFrom, validTo: unitHolder.validTo })
    .from(unitHolder)
    .innerJoin(person, eq(person.id, unitHolder.personId))
    .where(eq(unitHolder.unitId, unitId))
    .orderBy(asc(unitHolder.validFrom));
}

export function suspensionsOf(db: Executor, unitId: number, connectionId: number) {
  return db
    .select()
    .from(suspension)
    .where(or(eq(suspension.unitId, unitId), eq(suspension.connectionId, connectionId)))
    .orderBy(asc(suspension.periodFrom), asc(suspension.id));
}

export function paymentsOf(db: Executor, unitId: number) {
  return db
    .select({
      id: vPaymentAmount.id,
      folio: vPaymentAmount.folio,
      occurredAt: vPaymentAmount.occurredAt,
      total: vPaymentAmount.total,
      cancelled: vPaymentAmount.cancelled,
    })
    .from(vPaymentAmount)
    .where(eq(vPaymentAmount.unitId, unitId))
    .orderBy(desc(vPaymentAmount.occurredAt), desc(vPaymentAmount.id));
}

/** Pending deactivation or holder change of a unit (approval not yet resolved). */
export async function pendingChangeOf(db: Executor, unitId: number) {
  const [row] = await db
    .select({ type: unitChangeRequest.type, approvalId: unitChangeRequest.approvalId })
    .from(unitChangeRequest)
    .innerJoin(approval, eq(approval.id, unitChangeRequest.approvalId))
    .where(and(eq(unitChangeRequest.unitId, unitId), isNull(approval.result)))
    .limit(1);
  return row ?? null;
}

/** Connection locked, with its current block and derived status. */
export async function lockConnection(tx: Transaction, id: number) {
  const [locked] = await tx
    .select({ id: connection.id })
    .from(connection)
    .where(eq(connection.id, id))
    .for('update');
  if (!locked) return null;
  const [row] = await tx
    .select({ id: vConnection.id, status: vConnection.status, blockId: vConnection.blockId })
    .from(vConnection)
    .where(eq(vConnection.id, id));
  return row ?? null;
}

/** Unit locked, with its connection's current block and derived status. */
export async function lockUnit(tx: Transaction, id: number) {
  const [locked] = await tx
    .select({ id: unit.id, registeredOn: unit.registeredOn })
    .from(unit)
    .where(eq(unit.id, id))
    .for('update');
  if (!locked) return null;
  const [row] = await tx
    .select({
      status: vUnit.status,
      connectionId: vUnit.connectionId,
      holderPersonId: vUnit.holderPersonId,
      blockId: vConnection.blockId,
    })
    .from(vUnit)
    .innerJoin(vConnection, eq(vConnection.id, vUnit.connectionId))
    .where(eq(vUnit.id, id));
  return row ? { id, registeredOn: locked.registeredOn, ...row } : null;
}

export async function insertUnitWithHolder(
  tx: Transaction,
  values: {
    connectionId: number;
    reference: string | null;
    registeredOn: string;
    activatedOn: string;
    billingStartPeriod: string;
    holderPersonId: number;
    createdBy: number;
  },
): Promise<number> {
  const [row] = await tx
    .insert(unit)
    .values({
      connectionId: values.connectionId,
      reference: values.reference,
      registeredOn: values.registeredOn,
      activatedOn: values.activatedOn,
      billingStartPeriod: values.billingStartPeriod,
      createdBy: values.createdBy,
    })
    .returning({ id: unit.id });
  if (!row) throw new Error('unit not inserted');
  await tx.insert(unitHolder).values({
    unitId: row.id,
    personId: values.holderPersonId,
    validFrom: values.registeredOn,
    createdBy: values.createdBy,
  });
  return row.id;
}

export async function insertUnitChangeRequest(
  tx: Transaction,
  values: {
    unitId: number;
    type: 'deactivation' | 'holder_change';
    newHolderId: number | null;
    reason: string;
    requestedBy: number;
    requestedAt: Date;
  },
) {
  const [request] = await tx
    .insert(approval)
    .values({
      type: values.type === 'deactivation' ? 'unit_deactivation' : 'holder_change',
      reason: values.reason,
      requestedBy: values.requestedBy,
      requestedAt: values.requestedAt,
      createdBy: values.requestedBy,
    })
    .returning({ id: approval.id });
  if (!request) throw new Error('approval not inserted');
  const [row] = await tx
    .insert(unitChangeRequest)
    .values({
      unitId: values.unitId,
      type: values.type,
      newHolderId: values.newHolderId,
      approvalId: request.id,
      createdBy: values.requestedBy,
    })
    .returning({ id: unitChangeRequest.id });
  if (!row) throw new Error('unit change request not inserted');
  return { id: row.id, approvalId: request.id };
}

/** Change requests by approval, for the approval handlers. */
export function changeRequestsByApproval(db: Executor, approvalIds: number[]) {
  return db
    .select({
      approvalId: unitChangeRequest.approvalId,
      type: unitChangeRequest.type,
      unitId: unitChangeRequest.unitId,
      unitFolio: vUnit.folio,
      newHolder: personBasicColumns,
    })
    .from(unitChangeRequest)
    .innerJoin(vUnit, eq(vUnit.id, unitChangeRequest.unitId))
    .leftJoin(person, eq(person.id, unitChangeRequest.newHolderId))
    .where(inArray(unitChangeRequest.approvalId, approvalIds));
}

export async function currentHolderOf(db: Executor, unitId: number) {
  const [row] = await db
    .select({ ...personBasicColumns, validFrom: unitHolder.validFrom })
    .from(unitHolder)
    .innerJoin(person, eq(person.id, unitHolder.personId))
    .where(and(eq(unitHolder.unitId, unitId), isNull(unitHolder.validTo)))
    .limit(1);
  return row ?? null;
}

export async function closeHolder(
  tx: Transaction,
  unitId: number,
  validFrom: string,
  validTo: string,
): Promise<void> {
  await tx
    .update(unitHolder)
    .set({ validTo })
    .where(and(eq(unitHolder.unitId, unitId), eq(unitHolder.validFrom, validFrom)));
}

export async function openHolder(
  tx: Transaction,
  values: { unitId: number; personId: number; validFrom: string; createdBy: number },
): Promise<void> {
  await tx.insert(unitHolder).values(values);
}

export async function deactivateUnit(tx: Transaction, unitId: number, on: string): Promise<void> {
  await tx.update(unit).set({ deactivatedOn: on }).where(eq(unit.id, unitId));
}

// --- Suspensions ----------------------------------------------------------------------------

export async function findAgreement(db: Executor, id: number) {
  const [row] = await db
    .select({ id: agreement.id, folio: agreement.folio, result: agreement.result })
    .from(agreement)
    .where(eq(agreement.id, id))
    .limit(1);
  return row ?? null;
}

/** A suspension of the same target overlapping the open period starting at `from`. */
export async function overlappingSuspension(
  db: Executor,
  target: { connectionId: number | null; unitId: number | null },
  from: string,
) {
  const sameTarget: SQL | undefined =
    target.connectionId !== null
      ? eq(suspension.connectionId, target.connectionId)
      : eq(suspension.unitId, target.unitId ?? 0);
  const [row] = await db
    .select({ id: suspension.id })
    .from(suspension)
    .where(
      and(
        sameTarget,
        or(isNull(suspension.periodTo), sql`${suspension.periodTo} >= ${from}::date`),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function insertSuspension(tx: Transaction, values: typeof suspension.$inferInsert) {
  const [row] = await tx.insert(suspension).values(values).returning();
  if (!row) throw new Error('suspension not inserted');
  return row;
}

export async function lockSuspension(tx: Transaction, id: number) {
  const [row] = await tx
    .select()
    .from(suspension)
    .where(eq(suspension.id, id))
    .limit(1)
    .for('update');
  return row ?? null;
}

export async function endSuspension(tx: Transaction, id: number, periodTo: string) {
  const [row] = await tx
    .update(suspension)
    .set({ periodTo })
    .where(eq(suspension.id, id))
    .returning();
  if (!row) throw new Error('suspension not updated');
  return row;
}
