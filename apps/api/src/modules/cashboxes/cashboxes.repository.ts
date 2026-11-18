import { and, desc, eq, gte, inArray, isNull, lt, lte, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database, Transaction } from '../../db/client.js';
import {
  adjustment,
  approval,
  cashbox,
  closing,
  handover,
  openingBalance,
  person,
  userAccount,
  vBlock,
  vCashboxBalance,
  vCashboxMovement,
  vClosing,
  vHandover,
} from '../../db/schema/index.js';

// Queries of cashboxes (CU-17, CU-18). Cashboxes have no UPDATE grant for the API user, so
// services lock them with lockRecord (db/locks.ts); handovers have one and use FOR UPDATE.

type Executor = Database | Transaction;

const personName = (p: typeof person) =>
  sql<string>`concat_ws(' ', ${p.givenNames}, ${p.paternalSurname}, ${p.maternalSurname})`;

export async function blockCashbox(db: Executor, blockId: number) {
  const [row] = await db
    .select({ id: cashbox.id })
    .from(cashbox)
    .where(eq(cashbox.blockId, blockId))
    .limit(1);
  return row?.id ?? null;
}

export async function committeeCashbox(db: Executor) {
  const [row] = await db
    .select({ id: cashbox.id })
    .from(cashbox)
    .where(eq(cashbox.type, 'committee'))
    .limit(1);
  return row?.id ?? null;
}

export async function supportCashbox(db: Executor, personId: number) {
  const [row] = await db
    .select({ id: cashbox.id })
    .from(cashbox)
    .where(eq(cashbox.custodianPersonId, personId))
    .limit(1);
  return row?.id ?? null;
}

export async function insertCashbox(tx: Transaction, values: typeof cashbox.$inferInsert) {
  const [row] = await tx.insert(cashbox).values(values).returning();
  if (!row) throw new Error('cashbox not inserted');
  return row;
}

/** Labels of cashboxes: block code, "Comité" or "Apoyo · <custodian>". */
export function cashboxLabels(db: Executor, ids: number[]) {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: cashbox.id,
      type: cashbox.type,
      label: sql<string>`CASE ${cashbox.type}
        WHEN 'block' THEN ${vBlock.code}
        WHEN 'committee' THEN 'Comité'
        ELSE 'Apoyo · ' || ${personName(person)} END`,
    })
    .from(cashbox)
    .leftJoin(vBlock, eq(vBlock.id, cashbox.blockId))
    .leftJoin(person, eq(person.id, cashbox.custodianPersonId))
    .where(inArray(cashbox.id, ids));
}

export async function blockCode(db: Executor, blockId: number) {
  const [row] = await db.select({ code: vBlock.code }).from(vBlock).where(eq(vBlock.id, blockId));
  return row?.code ?? null;
}

export async function personFullName(db: Executor, personId: number) {
  const [row] = await db
    .select({ name: personName(person) })
    .from(person)
    .where(eq(person.id, personId));
  return row?.name ?? null;
}

/** Every cashbox with its label and expected balance. */
export async function listCashboxes(db: Executor) {
  const rows = await db
    .select({ id: cashbox.id, balance: vCashboxBalance.balance })
    .from(cashbox)
    .innerJoin(vCashboxBalance, eq(vCashboxBalance.cashboxId, cashbox.id))
    .orderBy(cashbox.id);
  const labels = await cashboxLabels(
    db,
    rows.map((r) => r.id),
  );
  const openings = await currentOpeningBalances(db);
  return rows.map((r) => {
    const label = labels.find((l) => l.id === r.id);
    return {
      id: r.id,
      type: label?.type ?? 'block',
      label: label?.label ?? '',
      balance: r.balance,
      opening: openings.get(r.id) ?? null,
    };
  });
}

/** Cashbox with its block (null for committee and support boxes). */
export async function findCashbox(db: Executor, id: number) {
  const [row] = await db
    .select({ id: cashbox.id, type: cashbox.type, blockId: cashbox.blockId })
    .from(cashbox)
    .where(eq(cashbox.id, id))
    .limit(1);
  return row ?? null;
}

export async function balanceOf(db: Executor, cashboxId: number): Promise<number> {
  const [row] = await db
    .select({ balance: vCashboxBalance.balance })
    .from(vCashboxBalance)
    .where(eq(vCashboxBalance.cashboxId, cashboxId));
  return row?.balance ?? 0;
}

/** Totals by movement kind of a cashbox. */
export function totalsByKind(db: Executor, cashboxId: number) {
  return db
    .select({
      kind: vCashboxMovement.kind,
      amount: sql<number>`coalesce(sum(${vCashboxMovement.amount}), 0)`.mapWith(Number),
    })
    .from(vCashboxMovement)
    .where(eq(vCashboxMovement.cashboxId, cashboxId))
    .groupBy(vCashboxMovement.kind);
}

/** Movements of a cashbox, newest first; `offset` pages through them. */
// What G-09 shows of each movement (read only): the folio of the record behind it and a short
// description. A page holds at most 100 rows, so the correlated subqueries stay cheap.
const ref = vCashboxMovement.recordId;
const nameOf = (alias: string) =>
  sql.raw(
    `concat_ws(' ', ${alias}.given_names, ${alias}.paternal_surname, ${alias}.maternal_surname)`,
  );

/** The family of a payment: the holder of its unit, or the applicant of an opening. */
const payerOf = (paymentId: SQL) => sql`coalesce(
  (SELECT ${nameOf('hp')} FROM payment p
     JOIN unit_holder uh ON uh.unit_id = p.unit_id AND uh.valid_to IS NULL
     JOIN person hp ON hp.id = uh.person_id
   WHERE p.id = ${paymentId} LIMIT 1),
  (SELECT ${nameOf('ap')} FROM payment_charge pc
     JOIN extra_charge ec ON ec.id = pc.extra_charge_id
     JOIN connection_request cr ON cr.id = ec.connection_request_id
     JOIN person ap ON ap.id = cr.applicant_id
   WHERE pc.payment_id = ${paymentId} LIMIT 1))`;

const movementFolio = sql<string | null>`CASE ${vCashboxMovement.tableName}
  WHEN 'payment' THEN (SELECT folio FROM payment WHERE id = ${ref})
  WHEN 'payment_cancellation' THEN (SELECT p.folio FROM payment_cancellation pca
    JOIN payment p ON p.id = pca.payment_id WHERE pca.id = ${ref})
  WHEN 'handover' THEN (SELECT folio FROM handover WHERE id = ${ref})
  WHEN 'income' THEN (SELECT folio FROM income WHERE id = ${ref})
  WHEN 'expense' THEN (SELECT folio FROM expense WHERE id = ${ref})
  WHEN 'expense_refund' THEN (SELECT e.folio FROM expense_refund er
    JOIN expense e ON e.id = er.expense_id WHERE er.id = ${ref})
  WHEN 'adjustment' THEN (SELECT coalesce(h.folio, c.folio) FROM adjustment adj
    LEFT JOIN handover h ON h.id = adj.handover_id
    LEFT JOIN closing c ON c.id = adj.closing_id WHERE adj.id = ${ref})
  END`;

const movementDetail = sql<string | null>`CASE ${vCashboxMovement.tableName}
  WHEN 'payment' THEN ${payerOf(sql`${ref}`)}
  WHEN 'payment_cancellation' THEN ${payerOf(
    sql`(SELECT payment_id FROM payment_cancellation WHERE id = ${ref})`,
  )}
  WHEN 'handover' THEN (SELECT CASE cb.type WHEN 'block' THEN b.code
      WHEN 'committee' THEN 'Comité' ELSE 'Apoyo · ' || ${nameOf('cp')} END
    FROM handover h JOIN cashbox cb ON cb.id = h.source_cashbox_id
    LEFT JOIN v_block b ON b.id = cb.block_id
    LEFT JOIN person cp ON cp.id = cb.custodian_person_id WHERE h.id = ${ref})
  WHEN 'income' THEN (SELECT concept FROM income WHERE id = ${ref})
  WHEN 'expense' THEN (SELECT description FROM expense WHERE id = ${ref})
  WHEN 'expense_refund' THEN (SELECT e.description FROM expense_refund er
    JOIN expense e ON e.id = er.expense_id WHERE er.id = ${ref})
  END`;

export function movementsOf(
  db: Executor,
  cashboxId: number,
  filter: { from?: string | undefined; to?: string | undefined; offset: number; limit: number },
) {
  return db
    .select({
      occurredOn: vCashboxMovement.occurredOn,
      kind: vCashboxMovement.kind,
      amount: vCashboxMovement.amount,
      tableName: vCashboxMovement.tableName,
      recordId: vCashboxMovement.recordId,
      folio: movementFolio,
      detail: movementDetail,
    })
    .from(vCashboxMovement)
    .where(
      and(
        eq(vCashboxMovement.cashboxId, cashboxId),
        filter.from !== undefined ? gte(vCashboxMovement.occurredOn, filter.from) : undefined,
        filter.to !== undefined ? lte(vCashboxMovement.occurredOn, filter.to) : undefined,
      ),
    )
    .orderBy(
      desc(vCashboxMovement.occurredOn),
      desc(vCashboxMovement.tableName),
      desc(vCashboxMovement.recordId),
    )
    .offset(filter.offset)
    .limit(filter.limit + 1);
}

// --- Opening balances (D-18) ----------------------------------------------------------------

const openingBalanceColumns = {
  id: openingBalance.id,
  cashboxId: openingBalance.cashboxId,
  amount: openingBalance.amount,
  date: openingBalance.date,
  approvalId: openingBalance.approvalId,
  result: approval.result,
};

/** The current request of every cashbox, in one query (same order as openingBalanceOf). */
async function currentOpeningBalances(db: Executor) {
  const rows = await db
    .selectDistinctOn([openingBalance.cashboxId], openingBalanceColumns)
    .from(openingBalance)
    .innerJoin(approval, eq(approval.id, openingBalance.approvalId))
    .orderBy(
      openingBalance.cashboxId,
      sql`CASE WHEN ${approval.result} = 'approved' THEN 0 WHEN ${approval.result} IS NULL THEN 1 ELSE 2 END`,
      desc(openingBalance.id),
    );
  return new Map(rows.map((row) => [row.cashboxId, row]));
}

/** The current request of a cashbox: approved, else pending, else the latest rejected one. */
export async function openingBalanceOf(db: Executor, cashboxId: number) {
  const [row] = await db
    .select(openingBalanceColumns)
    .from(openingBalance)
    .innerJoin(approval, eq(approval.id, openingBalance.approvalId))
    .where(eq(openingBalance.cashboxId, cashboxId))
    .orderBy(
      sql`CASE WHEN ${approval.result} = 'approved' THEN 0 WHEN ${approval.result} IS NULL THEN 1 ELSE 2 END`,
      desc(openingBalance.id),
    )
    .limit(1);
  return row ?? null;
}

export async function findOpeningBalance(db: Executor, id: number) {
  const [row] = await db
    .select(openingBalanceColumns)
    .from(openingBalance)
    .innerJoin(approval, eq(approval.id, openingBalance.approvalId))
    .where(eq(openingBalance.id, id));
  return row ?? null;
}

export async function hasOpenOpeningBalance(db: Executor, cashboxId: number) {
  const [row] = await db
    .select({ id: openingBalance.id })
    .from(openingBalance)
    .innerJoin(approval, eq(approval.id, openingBalance.approvalId))
    .where(
      and(
        eq(openingBalance.cashboxId, cashboxId),
        or(isNull(approval.result), eq(approval.result, 'approved')),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function insertApproval(
  tx: Transaction,
  values: {
    type: 'opening_balance' | 'adjustment';
    reason: string;
    requestedBy: number;
    requestedAt: Date;
  },
) {
  const [row] = await tx
    .insert(approval)
    .values({ ...values, createdBy: values.requestedBy })
    .returning({ id: approval.id });
  if (!row) throw new Error('approval not inserted');
  return row.id;
}

export async function insertOpeningBalance(
  tx: Transaction,
  values: typeof openingBalance.$inferInsert,
) {
  const [row] = await tx.insert(openingBalance).values(values).returning({ id: openingBalance.id });
  if (!row) throw new Error('opening balance not inserted');
  return row.id;
}

export function openingBalancesByApproval(db: Executor, approvalIds: number[]) {
  if (approvalIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      approvalId: openingBalance.approvalId,
      cashboxId: openingBalance.cashboxId,
      amount: openingBalance.amount,
    })
    .from(openingBalance)
    .where(inArray(openingBalance.approvalId, approvalIds));
}

// --- Handovers (D-16) -----------------------------------------------------------------------

const preparer = alias(userAccount, 'preparer');

function handoverQuery(db: Executor) {
  return db
    .select({
      id: vHandover.id,
      folio: vHandover.folio,
      cashboxId: vHandover.sourceCashboxId,
      date: vHandover.date,
      declaredAmount: vHandover.declaredAmount,
      receivedAmount: vHandover.receivedAmount,
      difference: vHandover.difference,
      adjustedAmount: vHandover.adjustedAmount,
      status: vHandover.status,
      withdrawnAt: vHandover.withdrawnAt,
      confirmedAt: vHandover.confirmedAt,
      notes: handover.notes,
      preparedById: handover.createdBy,
      preparedByUsername: preparer.username,
      preparedByName: sql<string>`(SELECT concat_ws(' ', p.given_names, p.paternal_surname, p.maternal_surname)
        FROM role_assignment ra JOIN person p ON p.id = ra.person_id
        WHERE ra.id = ${preparer.roleAssignmentId})`,
      confirmedById: handover.confirmedBy,
      confirmedByUsername: userAccount.username,
    })
    .from(vHandover)
    .innerJoin(handover, eq(handover.id, vHandover.id))
    .innerJoin(preparer, eq(preparer.id, handover.createdBy))
    .leftJoin(userAccount, eq(userAccount.id, handover.confirmedBy));
}

export type HandoverRow = Awaited<ReturnType<typeof listHandovers>>[number];

export function listHandovers(
  db: Executor,
  filter: {
    cashboxId?: number | null | undefined;
    status?: (typeof vHandover.status)['_']['data'] | undefined;
    cursor?: number | undefined;
    limit: number;
  },
) {
  return handoverQuery(db)
    .where(
      and(
        filter.cashboxId != null ? eq(vHandover.sourceCashboxId, filter.cashboxId) : undefined,
        filter.status !== undefined ? eq(vHandover.status, filter.status) : undefined,
        filter.cursor !== undefined ? lt(vHandover.id, filter.cursor) : undefined,
      ),
    )
    .orderBy(desc(vHandover.id))
    .limit(filter.limit + 1);
}

export async function findHandover(db: Executor, id: number): Promise<HandoverRow | null> {
  const [row] = await handoverQuery(db).where(eq(vHandover.id, id)).limit(1);
  return row ?? null;
}

/** Locks a handover (FOR UPDATE: it has UPDATE grants on its confirmation columns). */
export async function lockHandover(tx: Transaction, id: number): Promise<boolean> {
  const [row] = await tx
    .select({ id: handover.id })
    .from(handover)
    .where(eq(handover.id, id))
    .for('update');
  return row !== undefined;
}

/** Declared amount of the handovers of a cashbox still pending confirmation. */
export async function pendingHandoverTotal(db: Executor, cashboxId: number): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${handover.declaredAmount}), 0)`.mapWith(Number),
    })
    .from(handover)
    .where(
      and(
        eq(handover.sourceCashboxId, cashboxId),
        isNull(handover.withdrawnAt),
        isNull(handover.confirmedAt),
      ),
    );
  return row?.total ?? 0;
}

export async function insertHandover(tx: Transaction, values: typeof handover.$inferInsert) {
  const [row] = await tx.insert(handover).values(values).returning({ id: handover.id });
  if (!row) throw new Error('handover not inserted');
  return row.id;
}

export async function withdrawHandover(tx: Transaction, id: number, at: Date) {
  await tx.update(handover).set({ withdrawnAt: at }).where(eq(handover.id, id));
}

export async function confirmHandover(
  tx: Transaction,
  id: number,
  values: { receivedAmount: number; confirmedAt: Date; confirmedBy: number },
) {
  await tx.update(handover).set(values).where(eq(handover.id, id));
}

// --- Adjustments ----------------------------------------------------------------------------

const adjustmentColumns = {
  id: adjustment.id,
  cashboxId: adjustment.cashboxId,
  handoverId: adjustment.handoverId,
  closingId: adjustment.closingId,
  amount: adjustment.amount,
  date: adjustment.date,
  approvalId: adjustment.approvalId,
  result: approval.result,
};

export async function findAdjustment(db: Executor, id: number) {
  const [row] = await db
    .select(adjustmentColumns)
    .from(adjustment)
    .innerJoin(approval, eq(approval.id, adjustment.approvalId))
    .where(eq(adjustment.id, id));
  return row ?? null;
}

/** Whether any adjustment (pending or resolved) was requested for the origin. */
export async function hasAdjustment(db: Executor, origin: { handoverId: number }) {
  const [row] = await db
    .select({ id: adjustment.id })
    .from(adjustment)
    .where(eq(adjustment.handoverId, origin.handoverId))
    .limit(1);
  return row !== undefined;
}

export async function hasPendingAdjustment(
  db: Executor,
  origin: { handoverId: number } | { closingId: number },
) {
  const [row] = await db
    .select({ id: adjustment.id })
    .from(adjustment)
    .innerJoin(approval, eq(approval.id, adjustment.approvalId))
    .where(
      and(
        'handoverId' in origin
          ? eq(adjustment.handoverId, origin.handoverId)
          : eq(adjustment.closingId, origin.closingId),
        isNull(approval.result),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** A closing with its cashbox, status and difference, locked (closing has UPDATE grants). */
export async function lockClosingForAdjustment(tx: Transaction, id: number) {
  const [locked] = await tx
    .select({ id: closing.id })
    .from(closing)
    .where(eq(closing.id, id))
    .for('update');
  if (!locked) return null;
  const [row] = await tx
    .select({
      cashboxId: vClosing.cashboxId,
      folio: vClosing.folio,
      status: vClosing.status,
      difference: vClosing.difference,
    })
    .from(vClosing)
    .where(eq(vClosing.id, id));
  return row ?? null;
}

export async function insertAdjustment(tx: Transaction, values: typeof adjustment.$inferInsert) {
  const [row] = await tx.insert(adjustment).values(values).returning({ id: adjustment.id });
  if (!row) throw new Error('adjustment not inserted');
  return row.id;
}

export function adjustmentsByApproval(db: Executor, approvalIds: number[]) {
  if (approvalIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      approvalId: adjustment.approvalId,
      amount: adjustment.amount,
      handoverId: adjustment.handoverId,
      closingId: adjustment.closingId,
      handoverFolio: handover.folio,
      closingFolio: closing.folio,
    })
    .from(adjustment)
    .leftJoin(handover, eq(handover.id, adjustment.handoverId))
    .leftJoin(closing, eq(closing.id, adjustment.closingId))
    .where(inArray(adjustment.approvalId, approvalIds));
}
