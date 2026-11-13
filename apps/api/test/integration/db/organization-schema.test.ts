import { ROLES, requiresApproval, roleAssignmentViolations } from '@bella-vista/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, type Transaction } from '../../../src/db/client.js';
import {
  agreement,
  approval,
  block,
  person,
  refreshToken,
  role,
  roleAssignment,
  section,
  userAccount,
} from '../../../src/db/schema/index.js';

// Verifies the constraints of the "organization and access" block against a real database.
// Every case runs inside a transaction that is always rolled back.

const url = process.env.DATABASE_URL_TEST;

class Rollback extends Error {}

/** Year and month (YYYYMM) of "now" in the business time zone, as used in folios. */
function currentYearMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return get('year') + get('month');
}

/** The single row a `returning()` query must produce. */
function one<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined || rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}`);
  return row;
}

/** Postgres error fields, whether thrown directly or wrapped by Drizzle. */
interface PgErrorLike {
  code?: string;
  constraint_name?: string;
  cause?: unknown;
}

function pgError(error: unknown): PgErrorLike {
  let current = error as PgErrorLike | undefined;
  while (current && !current.code && current.cause) current = current.cause as PgErrorLike;
  return current ?? {};
}

describe.skipIf(!url)('organization and access schema', () => {
  const { db, sql: client } = createDb(url ?? '', { max: 2 });
  afterAll(() => client.end());

  /** Runs `fn` in a transaction and rolls it back. */
  async function rollback(fn: (tx: Transaction) => Promise<void>): Promise<void> {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  }

  /** Expects `fn` to violate `constraint`; runs in a savepoint so the outer tx survives. */
  async function expectViolation(
    tx: Transaction,
    constraint: string,
    fn: (sp: Transaction) => Promise<unknown>,
  ): Promise<void> {
    let caught: unknown;
    try {
      await tx.transaction(async (sp) => {
        await fn(sp);
      });
    } catch (error) {
      caught = error;
    }
    expect(caught, `expected violation of ${constraint}`).toBeDefined();
    expect(pgError(caught).constraint_name).toBe(constraint);
  }

  /** First superadmin: person, assignment and account with created_by null (bootstrap). */
  async function bootstrap(tx: Transaction) {
    const saPerson = one(
      await tx
        .insert(person)
        .values({ givenNames: 'Admin', paternalSurname: 'Sistema', registeredOn: '2026-01-01' })
        .returning(),
    );
    const saAssignment = one(
      await tx
        .insert(roleAssignment)
        .values({ personId: saPerson.id, role: 'superadmin', startDate: '2026-01-01' })
        .returning(),
    );
    const sa = one(
      await tx
        .insert(userAccount)
        .values({ roleAssignmentId: saAssignment.id, username: 'admin', passwordHash: 'x' })
        .returning(),
    );
    const s1 = one(
      await tx
        .insert(section)
        .values({ code: 'S1', name: 'Sección 1', createdBy: sa.id })
        .returning(),
    );
    const m01 = one(
      await tx
        .insert(block)
        .values({ sectionId: s1.id, code: 'M01', createdBy: sa.id })
        .returning(),
    );
    const m02 = one(
      await tx
        .insert(block)
        .values({ sectionId: s1.id, code: 'M02', createdBy: sa.id })
        .returning(),
    );

    let n = 0;
    const newPerson = async (givenNames = `Persona${++n}`, paternalSurname = 'Prueba') => {
      const row = one(
        await tx
          .insert(person)
          .values({ givenNames, paternalSurname, registeredOn: '2026-01-01', createdBy: sa.id })
          .returning(),
      );
      return row;
    };
    const newApproval = async () => {
      const row = one(
        await tx
          .insert(approval)
          .values({
            type: 'role_assignment',
            reason: 'Alta de cargo',
            requestedBy: sa.id,
            createdBy: sa.id,
          })
          .returning(),
      );
      return row;
    };
    const assign = async (values: {
      personId: number;
      role: 'president' | 'treasurer' | 'secretary' | 'member' | 'block_leader';
      blockId?: number;
      contactPhone?: string;
      endDate?: string;
    }) => {
      const { id: approvalId } = await newApproval();
      const row = one(
        await tx
          .insert(roleAssignment)
          .values({ startDate: '2026-01-01', approvalId, createdBy: sa.id, ...values })
          .returning(),
      );
      return row;
    };
    return { sa, saPerson, saAssignment, s1, m01, m02, newPerson, newApproval, assign };
  }

  describe('section and block', () => {
    it('rejects duplicate section code and name', () =>
      rollback(async (tx) => {
        const { sa } = await bootstrap(tx);
        await expectViolation(tx, 'section_code_unique', (sp) =>
          sp.insert(section).values({ code: 'S1', name: 'Otra', createdBy: sa.id }),
        );
        await expectViolation(tx, 'section_name_unique', (sp) =>
          sp.insert(section).values({ code: 'S9', name: 'Sección 1', createdBy: sa.id }),
        );
        await expectViolation(tx, 'section_code_not_blank', (sp) =>
          sp.insert(section).values({ code: '  ', name: 'Vacía', createdBy: sa.id }),
        );
      }));

    it('rejects a repeated block code within a section but allows it in another', () =>
      rollback(async (tx) => {
        const { sa, s1 } = await bootstrap(tx);
        await expectViolation(tx, 'block_section_id_code_unique', (sp) =>
          sp.insert(block).values({ sectionId: s1.id, code: 'M01', createdBy: sa.id }),
        );
        const s2 = one(
          await tx
            .insert(section)
            .values({ code: 'S2', name: 'Sección 2', createdBy: sa.id })
            .returning(),
        );
        await tx.insert(block).values({ sectionId: s2.id, code: 'M01', createdBy: sa.id });
      }));
  });

  describe('person', () => {
    it('assigns P-AAAAMM-NNNNNN folios from the sequence', () =>
      rollback(async (tx) => {
        const { saPerson } = await bootstrap(tx);
        expect(saPerson.folio).toMatch(new RegExp(`^P-${currentYearMonth()}-\\d{6}$`));
      }));

    it('normalizes names: joins, collapses spaces, strips accents, lowercases', () =>
      rollback(async (tx) => {
        const rows = await tx.execute<{ name: string }>(
          sql`SELECT f_normalize_name('  José  María ', 'PÉREZ', NULL) AS name`,
        );
        expect(rows[0]?.name).toBe('jose maria perez');
      }));

    it('rejects a homonym without a distinguishing note (D-10)', () =>
      rollback(async (tx) => {
        const { sa } = await bootstrap(tx);
        const base = { registeredOn: '2026-01-01', createdBy: sa.id };
        await tx.insert(person).values({
          ...base,
          givenNames: 'José',
          paternalSurname: 'Pérez',
          maternalSurname: 'López',
        });
        await expectViolation(tx, 'person_name_note_uq', (sp) =>
          sp.insert(person).values({
            ...base,
            givenNames: 'jose ',
            paternalSurname: 'PEREZ',
            maternalSurname: 'lopez',
          }),
        );
        // Accepted with a distinguishing note, but the same note cannot repeat.
        await tx.insert(person).values({
          ...base,
          givenNames: 'Jose',
          paternalSurname: 'Perez',
          maternalSurname: 'Lopez',
          distinguishingNote: 'M03',
        });
        await expectViolation(tx, 'person_name_note_uq', (sp) =>
          sp.insert(person).values({
            ...base,
            givenNames: 'José',
            paternalSurname: 'Pérez',
            maternalSurname: 'López',
            distinguishingNote: 'M03',
          }),
        );
        // Different maternal surname is a different name.
        await tx.insert(person).values({
          ...base,
          givenNames: 'José',
          paternalSurname: 'Pérez',
          maternalSurname: 'Gómez',
        });
      }));

    it('finds people with typos through the trigram expression', () =>
      rollback(async (tx) => {
        const { sa } = await bootstrap(tx);
        await tx.insert(person).values({
          givenNames: 'Guadalupe',
          paternalSurname: 'Hernández',
          registeredOn: '2026-01-01',
          createdBy: sa.id,
        });
        const rows = await tx.execute<{ given_names: string }>(sql`
          SELECT given_names FROM person
          WHERE f_normalize_name(given_names, paternal_surname, maternal_surname) % 'guadalupe hernandes'
        `);
        expect(rows.map((r) => r.given_names)).toContain('Guadalupe');
      }));
  });

  describe('role_assignment', () => {
    it('requires block and contact phone for a block leader, and a block only for leaders', () =>
      rollback(async (tx) => {
        const { sa, m01, newPerson, newApproval } = await bootstrap(tx);
        const p = await newPerson();
        const base = { personId: p.id, startDate: '2026-01-01', createdBy: sa.id };
        await expectViolation(tx, 'role_assignment_block_leader_fields', async (sp) =>
          sp.insert(roleAssignment).values({
            ...base,
            role: 'block_leader',
            blockId: m01.id,
            approvalId: (await newApproval()).id,
          }),
        );
        await expectViolation(tx, 'role_assignment_block_leader_fields', async (sp) =>
          sp.insert(roleAssignment).values({
            ...base,
            role: 'block_leader',
            contactPhone: '5512345678',
            approvalId: (await newApproval()).id,
          }),
        );
        await expectViolation(tx, 'role_assignment_block_only_for_leader', async (sp) =>
          sp.insert(roleAssignment).values({
            ...base,
            role: 'treasurer',
            blockId: m01.id,
            approvalId: (await newApproval()).id,
          }),
        );
      }));

    it('requires an approval except for the superadmin', () =>
      rollback(async (tx) => {
        const { sa, newPerson, newApproval } = await bootstrap(tx);
        const p = await newPerson();
        const base = { personId: p.id, startDate: '2026-01-01', createdBy: sa.id };
        await expectViolation(tx, 'role_assignment_approval_unless_superadmin', (sp) =>
          sp.insert(roleAssignment).values({ ...base, role: 'secretary' }),
        );
        await expectViolation(tx, 'role_assignment_approval_unless_superadmin', async (sp) =>
          sp
            .insert(roleAssignment)
            .values({ ...base, role: 'superadmin', approvalId: (await newApproval()).id }),
        );
      }));

    it('does not reuse an approval and keeps end_date after start_date', () =>
      rollback(async (tx) => {
        const { sa, newPerson, newApproval } = await bootstrap(tx);
        const p = await newPerson();
        const { id: approvalId } = await newApproval();
        const base = { personId: p.id, role: 'member' as const, approvalId, createdBy: sa.id };
        await tx.insert(roleAssignment).values({ ...base, startDate: '2026-01-01' });
        await expectViolation(tx, 'role_assignment_approval_id_unique', (sp) =>
          sp.insert(roleAssignment).values({ ...base, startDate: '2026-02-01' }),
        );
        await expectViolation(tx, 'role_assignment_dates', async (sp) =>
          sp.insert(roleAssignment).values({
            ...base,
            approvalId: (await newApproval()).id,
            startDate: '2026-03-01',
            endDate: '2026-02-01',
          }),
        );
      }));

    it('allows one open leader per block and one open block per leader (D-09)', () =>
      rollback(async (tx) => {
        const { m01, m02, newPerson, assign } = await bootstrap(tx);
        const ana = await newPerson();
        const beto = await newPerson();
        const leader = { role: 'block_leader' as const, contactPhone: '5512345678' };
        const first = await assign({ ...leader, personId: ana.id, blockId: m01.id });

        await expectViolation(tx, 'role_assignment_open_leader_block_uq', async () =>
          assign({ ...leader, personId: beto.id, blockId: m01.id }),
        );
        await expectViolation(tx, 'role_assignment_open_leader_person_uq', async () =>
          assign({ ...leader, personId: ana.id, blockId: m02.id }),
        );

        // Closing the assignment frees both the block and the person.
        await tx.execute(
          sql`UPDATE role_assignment SET end_date = '2026-06-30' WHERE id = ${first.id}`,
        );
        await assign({ ...leader, personId: beto.id, blockId: m01.id });
        await assign({ ...leader, personId: ana.id, blockId: m02.id });
      }));

    it('allows one open president, treasurer and secretary, but many members', () =>
      rollback(async (tx) => {
        const { newPerson, assign } = await bootstrap(tx);
        for (const role of ['president', 'treasurer', 'secretary'] as const) {
          await assign({ role, personId: (await newPerson()).id });
          await expectViolation(tx, 'role_assignment_open_officer_uq', async () =>
            assign({ role, personId: (await newPerson()).id }),
          );
          await assign({ role, personId: (await newPerson()).id, endDate: '2026-02-01' });
        }
        await assign({ role: 'member', personId: (await newPerson()).id });
        await assign({ role: 'member', personId: (await newPerson()).id });
      }));
  });

  describe('user_account and refresh_token', () => {
    it('allows one account per assignment (D-22) with a unique lowercase username', () =>
      rollback(async (tx) => {
        const { sa, saAssignment, newPerson, assign } = await bootstrap(tx);
        const treasurer = await assign({ role: 'treasurer', personId: (await newPerson()).id });
        const base = { passwordHash: 'x', createdBy: sa.id };
        await expectViolation(tx, 'user_account_role_assignment_id_unique', (sp) =>
          sp
            .insert(userAccount)
            .values({ ...base, roleAssignmentId: saAssignment.id, username: 'otro' }),
        );
        await expectViolation(tx, 'user_account_username_unique', (sp) =>
          sp
            .insert(userAccount)
            .values({ ...base, roleAssignmentId: treasurer.id, username: 'admin' }),
        );
        await expectViolation(tx, 'user_account_username_format', (sp) =>
          sp
            .insert(userAccount)
            .values({ ...base, roleAssignmentId: treasurer.id, username: 'Tesorero' }),
        );
        await expectViolation(tx, 'user_account_failed_attempts', (sp) =>
          sp.insert(userAccount).values({
            ...base,
            roleAssignmentId: treasurer.id,
            username: 'tesorero',
            failedAttempts: -1,
          }),
        );
        const account = one(
          await tx
            .insert(userAccount)
            .values({ ...base, roleAssignmentId: treasurer.id, username: 'tesorero' })
            .returning(),
        );
        expect(account.mustChangePassword).toBe(true);
        expect(account.failedAttempts).toBe(0);
      }));

    it('keeps token hashes unique', () =>
      rollback(async (tx) => {
        const { sa } = await bootstrap(tx);
        const token = {
          userAccountId: sa.id,
          tokenHash: 'abc',
          expiresAt: new Date('2026-12-31T00:00:00Z'),
          createdBy: sa.id,
        };
        const first = one(await tx.insert(refreshToken).values(token).returning());
        await expectViolation(tx, 'refresh_token_token_hash_unique', (sp) =>
          sp.insert(refreshToken).values(token),
        );
        await expectViolation(tx, 'refresh_token_not_self_replaced', (sp) =>
          sp
            .update(refreshToken)
            .set({ replacedById: first.id })
            .where(sql`${refreshToken.id} = ${first.id}`),
        );
      }));
  });

  describe('role rules shared with the backend', () => {
    it('uses the same roles as @bella-vista/shared', () => {
      expect(role.enumValues).toEqual([...ROLES]);
    });

    it('rejects a blank contact phone', () =>
      rollback(async (tx) => {
        const { m01, newPerson, assign } = await bootstrap(tx);
        const p = await newPerson();
        await expectViolation(tx, 'role_assignment_contact_phone_not_blank', () =>
          assign({ role: 'block_leader', personId: p.id, blockId: m01.id, contactPhone: '  ' }),
        );
      }));

    // Every combination of role, block and phone: PostgreSQL must accept exactly what
    // roleAssignmentViolations() accepts. Closed assignments avoid the partial unique indexes.
    const combinations = ROLES.flatMap((r) =>
      [false, true].flatMap((withBlock) =>
        [null, '5512345678'].map((contactPhone) => ({ role: r, withBlock, contactPhone })),
      ),
    );

    it.each(combinations)(
      'role=$role block=$withBlock phone=$contactPhone agrees with the backend',
      ({ role: r, withBlock, contactPhone }) =>
        rollback(async (tx) => {
          const { sa, m01, newPerson, newApproval } = await bootstrap(tx);
          const blockId = withBlock ? m01.id : null;
          const backendOk =
            roleAssignmentViolations({ role: r, blockId, contactPhone }).length === 0;
          const values = {
            personId: (await newPerson()).id,
            role: r,
            blockId,
            contactPhone,
            startDate: '2026-01-01',
            endDate: '2026-01-31',
            approvalId: requiresApproval(r) ? (await newApproval()).id : null,
            createdBy: sa.id,
          };
          let dbOk = true;
          try {
            await tx.transaction(async (sp) => {
              await sp.insert(roleAssignment).values(values);
            });
          } catch (error) {
            expect(pgError(error).code).toBe('23514'); // check_violation
            dbOk = false;
          }
          expect(dbOk).toBe(backendOk);
        }),
    );
  });

  describe('approval and agreement', () => {
    it('requires a complete resolution and a reason to reject', () =>
      rollback(async (tx) => {
        const { sa } = await bootstrap(tx);
        const base = {
          type: 'rate' as const,
          reason: 'Tarifa 2027',
          requestedBy: sa.id,
          createdBy: sa.id,
        };
        await expectViolation(tx, 'approval_resolution_complete', (sp) =>
          sp.insert(approval).values({ ...base, result: 'approved' }),
        );
        await expectViolation(tx, 'approval_rejection_reason', (sp) =>
          sp.insert(approval).values({
            ...base,
            result: 'rejected',
            resolvedBy: sa.id,
            resolvedAt: new Date(),
            resolutionReason: '  ',
          }),
        );
        await expectViolation(tx, 'approval_reason_not_blank', (sp) =>
          sp.insert(approval).values({ ...base, reason: '' }),
        );
        await tx.insert(approval).values({
          ...base,
          result: 'rejected',
          resolvedBy: sa.id,
          resolvedAt: new Date(),
          resolutionReason: 'Falta acuerdo',
        });
      }));

    it('assigns AC-AAAAMM-NNNNNN folios and rejects negative votes', () =>
      rollback(async (tx) => {
        const { sa } = await bootstrap(tx);
        const base = {
          meetingDate: '2026-03-01',
          topic: 'Tarifa',
          result: 'approved_by_majority' as const,
          createdBy: sa.id,
        };
        const row = one(await tx.insert(agreement).values(base).returning());
        expect(row.folio).toMatch(new RegExp(`^AC-${currentYearMonth()}-\\d{6}$`));
        await expectViolation(tx, 'agreement_votes_non_negative', (sp) =>
          sp.insert(agreement).values({ ...base, votesAgainst: -1 }),
        );
      }));
  });
});
