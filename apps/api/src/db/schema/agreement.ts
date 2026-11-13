import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  date,
  pgSequence,
  pgTable,
  smallint,
  text,
} from 'drizzle-orm/pg-core';
import { userAccount } from './access.js';
import { createdAt, createdBy, fk, folioDefault, id } from './columns.js';
import { agreementResult } from './enums.js';

export const agreementFolioSeq = pgSequence('agreement_folio_seq');

// Meeting agreements are never edited; a correction is a new agreement (corrects_id).
export const agreement = pgTable(
  'agreement',
  {
    id: id(),
    folio: text()
      .notNull()
      .unique('agreement_folio_unique')
      .default(folioDefault('AC', 'agreement_folio_seq')),
    meetingDate: date({ mode: 'string' }).notNull(),
    topic: text().notNull(),
    result: agreementResult().notNull(),
    votesFor: smallint(),
    votesAgainst: smallint(),
    abstentions: smallint(),
    minutesReference: text(),
    correctsId: fk().references((): AnyPgColumn => agreement.id),
    createdBy: createdBy((): AnyPgColumn => userAccount.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('agreement_topic_not_blank', sql`btrim(${t.topic}) <> ''`),
    check(
      'agreement_votes_non_negative',
      sql`coalesce(${t.votesFor}, 0) >= 0 AND coalesce(${t.votesAgainst}, 0) >= 0 AND coalesce(${t.abstentions}, 0) >= 0`,
    ),
    check('agreement_not_self_correction', sql`${t.correctsId} <> ${t.id}`),
  ],
);
