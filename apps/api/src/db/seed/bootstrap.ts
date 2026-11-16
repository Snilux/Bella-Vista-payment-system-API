import { eq, sql } from 'drizzle-orm';
import { businessDate } from '../../lib/dates.js';
import { generateTemporaryPassword, hashPassword } from '../../lib/password.js';
import { type Actor, auditCreate } from '../audit.js';
import type { Database, Transaction } from '../client.js';
import {
  agreement,
  approval,
  cashbox,
  expenseCategory,
  fee,
  type feeType,
  person,
  roleAssignment,
  userAccount,
} from '../schema/index.js';
import type { BootstrapFile, BootstrapPerson } from './bootstrap-file.js';

// Initial bootstrap (D-27, 3.1 §2.2): run once, in a single transaction. It creates the
// superadmin and their temporary password, the agreement that elected the president,
// treasurer and secretary with their assignments "approved by bootstrap", the committee
// cashbox, the expense categories and the fees without amount, plus technical audit entries.

export const BOOTSTRAP_AUDIT_REASON = 'Arranque inicial (D-27)';

/** Expense categories of 3.1 §2.2; exactly one marks the plumber's salary. */
export const BOOTSTRAP_EXPENSE_CATEGORIES = [
  { name: 'Electricidad', isPlumberSalary: false },
  { name: 'Reparaciones', isPlumberSalary: false },
  { name: 'Materiales', isPlumberSalary: false },
  { name: 'Instalaciones', isPlumberSalary: false },
  { name: 'Salario del fontanero', isPlumberSalary: true },
  { name: 'Otros', isPlumberSalary: false },
] as const;

/** Fees of 3.1 §2.2, without amount: the treasurer captures it from the app. */
export const BOOTSTRAP_FEES: { type: (typeof feeType.enumValues)[number]; name: string }[] = [
  { type: 'opening', name: 'Apertura de toma' },
  { type: 'reconnection', name: 'Reinstalación' },
  { type: 'repair', name: 'Reparación a usuario' },
];

const OFFICERS = [
  { key: 'presidente', role: 'president' },
  { key: 'tesorero', role: 'treasurer' },
  { key: 'secretario', role: 'secretary' },
] as const;

// Serializes concurrent runs: the second one waits and then sees the superadmin.
const BOOTSTRAP_LOCK_KEY = 'bella-vista:db-seed';

export interface BootstrapOptions {
  /** Moment of the bootstrap (approval resolution, registration dates). */
  now: Date;
  /** Business time zone used for registration dates. */
  timeZone: string;
  /** Override for tests; defaults to a random temporary password. */
  generatePassword?: () => string;
}

export type BootstrapResult =
  | {
      status: 'created';
      username: string;
      /** Shown once by the CLI; it is stored only as an Argon2id hash. */
      temporaryPassword: string;
      superadminUserAccountId: number;
      agreementFolio: string;
    }
  | { status: 'already_bootstrapped'; username: string | null };

export async function runBootstrap(
  db: Database,
  file: BootstrapFile,
  options: BootstrapOptions,
): Promise<BootstrapResult> {
  const temporaryPassword = (options.generatePassword ?? generateTemporaryPassword)();
  // Hash outside the transaction: Argon2 is deliberately slow.
  const passwordHash = await hashPassword(temporaryPassword);
  const today = businessDate(options.now, options.timeZone);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${BOOTSTRAP_LOCK_KEY}))`);

    const [existing] = await tx
      .select({ username: userAccount.username })
      .from(roleAssignment)
      .leftJoin(userAccount, eq(userAccount.roleAssignmentId, roleAssignment.id))
      .where(eq(roleAssignment.role, 'superadmin'))
      .limit(1);
    if (existing) return { status: 'already_bootstrapped', username: existing.username };

    // Superadmin: person, assignment (no approval, D-19) and account, with created_by null.
    const saData = file.superadministrador;
    const saPerson = await findOrCreatePerson(tx, saData, today, null);
    const saAssignment = single(
      await tx
        .insert(roleAssignment)
        .values({ personId: saPerson.row.id, role: 'superadmin', startDate: today })
        .returning(),
    );
    const saAccount = single(
      await tx
        .insert(userAccount)
        .values({
          roleAssignmentId: saAssignment.id,
          username: saData.usuario,
          passwordHash,
          mustChangePassword: true,
        })
        .returning(),
    );
    const actor: Actor = { userAccountId: saAccount.id, role: 'superadmin' };
    const audit = (table: Parameters<typeof auditCreate>[2], id: number, after: object) =>
      auditCreate(tx, actor, table, id, { ...after }, BOOTSTRAP_AUDIT_REASON);

    await audit(person, saPerson.row.id, saPerson.row);
    await audit(roleAssignment, saAssignment.id, saAssignment);
    const { passwordHash: _secret, ...accountWithoutHash } = saAccount;
    await audit(userAccount, saAccount.id, accountWithoutHash);

    // Agreement of the meeting that elected the committee.
    const meeting = file.acuerdo;
    const electionAgreement = single(
      await tx
        .insert(agreement)
        .values({
          meetingDate: meeting.fechaJunta,
          topic: meeting.tema,
          result: 'approved_by_majority',
          votesFor: meeting.votosFavor,
          votesAgainst: meeting.votosContra,
          abstentions: meeting.abstenciones,
          minutesReference: meeting.referenciaActa,
          createdBy: saAccount.id,
        })
        .returning(),
    );
    await audit(agreement, electionAgreement.id, electionAgreement);

    // President, treasurer and secretary, approved by bootstrap: the approval is resolved
    // by the superadmin with the agreement folio as the reason. Their accounts are created
    // later by the superadmin from the app.
    const approvalReason = `Autorizada por arranque inicial (D-27). Acuerdo ${electionAgreement.folio}.`;
    for (const officer of OFFICERS) {
      const data = file[officer.key];
      const officerPerson = await findOrCreatePerson(tx, data, today, saAccount.id);
      if (officerPerson.created) await audit(person, officerPerson.row.id, officerPerson.row);

      const officerApproval = single(
        await tx
          .insert(approval)
          .values({
            type: 'role_assignment',
            reason: approvalReason,
            requestedBy: saAccount.id,
            requestedAt: options.now,
            result: 'approved',
            resolvedBy: saAccount.id,
            resolvedAt: options.now,
            resolutionReason: approvalReason,
            createdBy: saAccount.id,
          })
          .returning(),
      );
      await audit(approval, officerApproval.id, officerApproval);

      const assignment = single(
        await tx
          .insert(roleAssignment)
          .values({
            personId: officerPerson.row.id,
            role: officer.role,
            startDate: data.fechaInicio,
            approvalId: officerApproval.id,
            createdBy: saAccount.id,
          })
          .returning(),
      );
      await audit(roleAssignment, assignment.id, assignment);
    }

    const committeeBox = single(
      await tx.insert(cashbox).values({ type: 'committee', createdBy: saAccount.id }).returning(),
    );
    await audit(cashbox, committeeBox.id, committeeBox);

    const categories = await tx
      .insert(expenseCategory)
      .values(BOOTSTRAP_EXPENSE_CATEGORIES.map((c) => ({ ...c, createdBy: saAccount.id })))
      .returning();
    for (const category of categories) await audit(expenseCategory, category.id, category);

    const fees = await tx
      .insert(fee)
      .values(BOOTSTRAP_FEES.map((f) => ({ ...f, createdBy: saAccount.id })))
      .returning();
    for (const row of fees) await audit(fee, row.id, row);

    return {
      status: 'created',
      username: saAccount.username,
      temporaryPassword,
      superadminUserAccountId: saAccount.id,
      agreementFolio: electionAgreement.folio,
    };
  });
}

/**
 * Reuses the person with the same normalized name and distinguishing note (the homonym key
 * of D-10), so one person can be superadmin and officer with two assignments (D-22).
 */
async function findOrCreatePerson(
  tx: Transaction,
  data: BootstrapPerson,
  registeredOn: string,
  createdBy: number | null,
) {
  const [found] = await tx
    .select()
    .from(person)
    .where(
      sql`f_normalize_name(${person.givenNames}, ${person.paternalSurname}, ${person.maternalSurname})
            = f_normalize_name(${data.nombres}, ${data.apellidoPaterno}, ${data.apellidoMaterno})
          AND coalesce(${person.distinguishingNote}, '') = ${data.distintivo ?? ''}`,
    )
    .limit(1);
  if (found) return { row: found, created: false };

  const row = single(
    await tx
      .insert(person)
      .values({
        givenNames: data.nombres,
        paternalSurname: data.apellidoPaterno,
        maternalSurname: data.apellidoMaterno,
        distinguishingNote: data.distintivo,
        phone: data.telefono,
        registeredOn,
        createdBy,
      })
      .returning(),
  );
  return { row, created: true };
}

function single<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined || rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}`);
  return row;
}
