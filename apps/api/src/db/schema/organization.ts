import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  pgSequence,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { userAccount } from './access.js';
import { approval } from './approval.js';
import { createdAt, createdBy, createdByBootstrap, fk, folioDefault, id } from './columns.js';
import { role } from './enums.js';

const userAccountId = (): AnyPgColumn => userAccount.id;

// Visible folios: P-202611-000001 (docs/modelo-datos.md, "Convenciones").
export const personFolioSeq = pgSequence('person_folio_seq');

export const section = pgTable(
  'section',
  {
    id: id(),
    code: text().notNull().unique('section_code_unique'),
    name: text().notNull().unique('section_name_unique'),
    active: boolean().notNull().default(true),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    check('section_code_not_blank', sql`btrim(${t.code}) <> ''`),
    check('section_name_not_blank', sql`btrim(${t.name}) <> ''`),
  ],
);

export const block = pgTable(
  'block',
  {
    id: id(),
    sectionId: fk()
      .notNull()
      .references((): AnyPgColumn => section.id),
    code: text().notNull(),
    name: text(),
    active: boolean().notNull().default(true),
    createdBy: createdBy(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    unique('block_section_id_code_unique').on(t.sectionId, t.code),
    check('block_code_not_blank', sql`btrim(${t.code}) <> ''`),
  ],
);

// The homonym rule (D-10) is a unique index on f_normalize_name(...) plus a trigram index;
// both live in the hand-written migration because they index an expression.
export const person = pgTable(
  'person',
  {
    id: id(),
    folio: text()
      .notNull()
      .unique('person_folio_unique')
      .default(folioDefault('P', 'person_folio_seq')),
    givenNames: text().notNull(),
    paternalSurname: text().notNull(),
    maternalSurname: text(),
    distinguishingNote: text(),
    phone: text(),
    registeredOn: date({ mode: 'string' }).notNull(),
    createdBy: createdByBootstrap(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    check('person_given_names_not_blank', sql`btrim(${t.givenNames}) <> ''`),
    check('person_paternal_surname_not_blank', sql`btrim(${t.paternalSurname}) <> ''`),
    check(
      'person_distinguishing_note_not_blank',
      sql`${t.distinguishingNote} IS NULL OR btrim(${t.distinguishingNote}) <> ''`,
    ),
  ],
);

export const roleAssignment = pgTable(
  'role_assignment',
  {
    id: id(),
    personId: fk()
      .notNull()
      .references((): AnyPgColumn => person.id),
    role: role().notNull(),
    blockId: fk().references((): AnyPgColumn => block.id),
    contactPhone: text(),
    startDate: date({ mode: 'string' }).notNull(),
    // Filled when the assignment is closed or its approval is rejected.
    endDate: date({ mode: 'string' }),
    approvalId: fk()
      .unique('role_assignment_approval_id_unique')
      .references((): AnyPgColumn => approval.id),
    createdBy: createdByBootstrap(userAccountId),
    createdAt: createdAt(),
  },
  (t) => [
    // Mirrors roleAssignmentViolations() in @bella-vista/shared (domain/role-assignment.ts):
    // block and phone required for a block leader, block forbidden for other roles.
    check(
      'role_assignment_contact_phone_not_blank',
      sql`${t.contactPhone} IS NULL OR btrim(${t.contactPhone}) <> ''`,
    ),
    check(
      'role_assignment_block_leader_fields',
      sql`${t.role} <> 'block_leader' OR (${t.blockId} IS NOT NULL AND ${t.contactPhone} IS NOT NULL)`,
    ),
    check(
      'role_assignment_block_only_for_leader',
      sql`${t.role} = 'block_leader' OR ${t.blockId} IS NULL`,
    ),
    // Every assignment is approved by the president except the superadmin's (D-19).
    check(
      'role_assignment_approval_unless_superadmin',
      sql`(${t.role} = 'superadmin') = (${t.approvalId} IS NULL)`,
    ),
    check('role_assignment_dates', sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`),
    // D-09: one open leader per block and one open block per leader.
    uniqueIndex('role_assignment_open_leader_block_uq')
      .on(t.blockId)
      .where(sql`${t.role} = 'block_leader' AND ${t.endDate} IS NULL`),
    uniqueIndex('role_assignment_open_leader_person_uq')
      .on(t.personId)
      .where(sql`${t.role} = 'block_leader' AND ${t.endDate} IS NULL`),
    // One open president, treasurer and secretary at a time.
    uniqueIndex('role_assignment_open_officer_uq')
      .on(t.role)
      .where(sql`${t.role} IN ('president', 'treasurer', 'secretary') AND ${t.endDate} IS NULL`),
  ],
);
