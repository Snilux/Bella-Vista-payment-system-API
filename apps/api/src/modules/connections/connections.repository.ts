import { and, desc, eq, inArray, isNull, lt, lte, type SQL, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client.js';
import {
  agreement,
  connection,
  connectionBlock,
  connectionRequest,
  extraCharge,
  fee,
  feeAmount,
  person,
  vBlock,
  vConnection,
  vConnectionRequest,
} from '../../db/schema/index.js';

// Queries of the connections module: connections, agreements and connection requests.

type Executor = Database | Transaction;

// --- Connections ----------------------------------------------------------------------------

export async function insertConnection(
  tx: Transaction,
  values: {
    connectionRequestId: number | null;
    address: string;
    activatedOn: string;
    blockId: number;
    createdBy: number;
  },
): Promise<number> {
  const [row] = await tx
    .insert(connection)
    .values({
      connectionRequestId: values.connectionRequestId,
      address: values.address,
      activatedOn: values.activatedOn,
      createdBy: values.createdBy,
    })
    .returning({ id: connection.id });
  if (!row) throw new Error('connection not inserted');
  await tx.insert(connectionBlock).values({
    connectionId: row.id,
    blockId: values.blockId,
    validFrom: values.activatedOn,
    createdBy: values.createdBy,
  });
  return row.id;
}

export async function findConnection(db: Executor, id: number) {
  const [row] = await db
    .select({
      id: vConnection.id,
      folio: vConnection.folio,
      address: vConnection.address,
      status: vConnection.status,
      activatedOn: vConnection.activatedOn,
      deactivatedOn: vConnection.deactivatedOn,
      blockId: vConnection.blockId,
      blockCode: vBlock.code,
      connectionRequestId: connection.connectionRequestId,
    })
    .from(vConnection)
    .innerJoin(connection, eq(connection.id, vConnection.id))
    .leftJoin(vBlock, eq(vBlock.id, vConnection.blockId))
    .where(eq(vConnection.id, id))
    .limit(1);
  return row ?? null;
}

// --- Agreements -----------------------------------------------------------------------------

const agreementColumns = {
  id: agreement.id,
  folio: agreement.folio,
  meetingDate: agreement.meetingDate,
  topic: agreement.topic,
  result: agreement.result,
  votesFor: agreement.votesFor,
  votesAgainst: agreement.votesAgainst,
  abstentions: agreement.abstentions,
  minutesReference: agreement.minutesReference,
  correctsId: agreement.correctsId,
};

export function listAgreements(db: Executor, page: { limit: number; cursor?: number | undefined }) {
  return db
    .select(agreementColumns)
    .from(agreement)
    .where(page.cursor === undefined ? undefined : lt(agreement.id, page.cursor))
    .orderBy(desc(agreement.id))
    .limit(page.limit + 1);
}

export async function findAgreement(db: Executor, id: number) {
  const [row] = await db
    .select(agreementColumns)
    .from(agreement)
    .where(eq(agreement.id, id))
    .limit(1);
  return row ?? null;
}

export async function insertAgreement(tx: Transaction, values: typeof agreement.$inferInsert) {
  const [row] = await tx.insert(agreement).values(values).returning(agreementColumns);
  if (!row) throw new Error('agreement not inserted');
  return row;
}

// --- Connection requests --------------------------------------------------------------------

const requestQuery = (db: Executor) =>
  db
    .select({
      id: vConnectionRequest.id,
      folio: vConnectionRequest.folio,
      status: vConnectionRequest.status,
      address: vConnectionRequest.address,
      blockId: vConnectionRequest.blockId,
      blockCode: vBlock.code,
      requestedOn: vConnectionRequest.requestedOn,
      cancelledOn: vConnectionRequest.cancelledOn,
      connectionId: vConnectionRequest.connectionId,
      resolutionReason: connectionRequest.resolutionReason,
      cancellationReason: connectionRequest.cancellationReason,
      applicant: {
        id: person.id,
        folio: person.folio,
        givenNames: person.givenNames,
        paternalSurname: person.paternalSurname,
        maternalSurname: person.maternalSurname,
        distinguishingNote: person.distinguishingNote,
      },
      agreement: { id: agreement.id, folio: agreement.folio, result: agreement.result },
    })
    .from(vConnectionRequest)
    .innerJoin(connectionRequest, eq(connectionRequest.id, vConnectionRequest.id))
    .innerJoin(person, eq(person.id, vConnectionRequest.applicantId))
    .innerJoin(vBlock, eq(vBlock.id, vConnectionRequest.blockId))
    .leftJoin(agreement, eq(agreement.id, vConnectionRequest.agreementId));

export function listRequests(
  db: Executor,
  filter: {
    blockId: number | null;
    status?: string | undefined;
    limit: number;
    cursor?: number | undefined;
  },
) {
  const conditions: SQL[] = [];
  if (filter.blockId !== null) conditions.push(eq(vConnectionRequest.blockId, filter.blockId));
  if (filter.status) conditions.push(sql`${vConnectionRequest.status} = ${filter.status}`);
  if (filter.cursor !== undefined) conditions.push(lt(vConnectionRequest.id, filter.cursor));
  return requestQuery(db)
    .where(and(...conditions))
    .orderBy(desc(vConnectionRequest.id))
    .limit(filter.limit + 1);
}

export type RequestRow = Awaited<ReturnType<typeof listRequests>>[number];

export async function findRequest(db: Executor, id: number): Promise<RequestRow | null> {
  const [row] = await requestQuery(db).where(eq(vConnectionRequest.id, id)).limit(1);
  return row ?? null;
}

/** Latest opening charge of each request (cancelled ones included), with its amount (D-13). */
export function openingCharges(db: Executor, requestIds: number[]) {
  if (requestIds.length === 0) return Promise.resolve([]);
  return db
    .selectDistinctOn([extraCharge.connectionRequestId], {
      requestId: extraCharge.connectionRequestId,
      id: extraCharge.id,
      feeName: fee.name,
      chargedOn: extraCharge.chargedOn,
      cancelledOn: extraCharge.cancelledOn,
      amount: sql<number>`(
        SELECT fa.amount FROM fee_amount fa
        WHERE fa.fee_id = ${extraCharge.feeId} AND fa.effective_from <= ${extraCharge.chargedOn}
        ORDER BY fa.effective_from DESC LIMIT 1)`.mapWith(Number),
    })
    .from(extraCharge)
    .innerJoin(fee, eq(fee.id, extraCharge.feeId))
    .where(inArray(extraCharge.connectionRequestId, requestIds))
    .orderBy(extraCharge.connectionRequestId, desc(extraCharge.id));
}

/** Request row locked, with its derived status. */
export async function lockRequest(tx: Transaction, id: number) {
  const [locked] = await tx
    .select({ id: connectionRequest.id })
    .from(connectionRequest)
    .where(eq(connectionRequest.id, id))
    .for('update');
  if (!locked) return null;
  return findRequest(tx, id);
}

/** An address as typed, without accents, case or punctuation ("Calle Encino #8" = "calle encino 8"). */
const plainAddress = (value: SQL) =>
  sql`regexp_replace(f_normalize_name(${value}, NULL, NULL), '[[:punct:]]', '', 'g')`;

/**
 * The open request (requested, approved pending payment or pending installation) of
 * `applicantId` for the same address, if any. The caller holds lockApplicantRequests.
 */
export async function findOpenRequestFor(tx: Transaction, applicantId: number, address: string) {
  const [row] = await tx
    .select({ id: vConnectionRequest.id, folio: vConnectionRequest.folio })
    .from(vConnectionRequest)
    .where(
      and(
        eq(vConnectionRequest.applicantId, applicantId),
        inArray(vConnectionRequest.status, [
          'requested',
          'approved_pending_payment',
          'pending_installation',
        ]),
        sql`${plainAddress(sql`${vConnectionRequest.address}`)} = ${plainAddress(sql`${address}::text`)}`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Serializes the requests of one applicant, so two at once cannot both pass the check. */
export async function lockApplicantRequests(tx: Transaction, applicantId: number) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`connection_request:applicant:${applicantId}`}))`,
  );
}

export async function insertRequest(
  tx: Transaction,
  values: typeof connectionRequest.$inferInsert,
) {
  const [row] = await tx
    .insert(connectionRequest)
    .values(values)
    .returning({ id: connectionRequest.id });
  if (!row) throw new Error('connection request not inserted');
  return row.id;
}

export async function setResolution(
  tx: Transaction,
  id: number,
  values: { agreementId: number; resolutionReason: string | null },
): Promise<void> {
  await tx.update(connectionRequest).set(values).where(eq(connectionRequest.id, id));
}

export async function setCancellation(
  tx: Transaction,
  id: number,
  values: { cancelledOn: string; cancellationReason: string },
): Promise<void> {
  await tx.update(connectionRequest).set(values).where(eq(connectionRequest.id, id));
}

/** The opening fee of the catalog (created by the bootstrap, D-27). */
export async function openingFee(db: Executor) {
  const [row] = await db
    .select({ id: fee.id, name: fee.name })
    .from(fee)
    .where(eq(fee.type, 'opening'))
    .orderBy(fee.id)
    .limit(1);
  return row ?? null;
}

export async function amountInForce(db: Executor, feeId: number, on: string) {
  const [row] = await db
    .select({ amount: feeAmount.amount })
    .from(feeAmount)
    .where(and(eq(feeAmount.feeId, feeId), lte(feeAmount.effectiveFrom, on)))
    .orderBy(desc(feeAmount.effectiveFrom))
    .limit(1);
  return row?.amount ?? null;
}

export async function insertOpeningCharge(
  tx: Transaction,
  values: { feeId: number; connectionRequestId: number; chargedOn: string; createdBy: number },
): Promise<number> {
  const [row] = await tx.insert(extraCharge).values(values).returning({ id: extraCharge.id });
  if (!row) throw new Error('opening charge not inserted');
  return row.id;
}

/** Cancels the current opening charge of a request (D-12). */
export async function cancelOpeningCharge(
  tx: Transaction,
  connectionRequestId: number,
  on: string,
): Promise<void> {
  await tx
    .update(extraCharge)
    .set({ cancelledOn: on })
    .where(
      and(
        eq(extraCharge.connectionRequestId, connectionRequestId),
        isNull(extraCharge.cancelledOn),
      ),
    );
}
