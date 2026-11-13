-- Hand-written: what Drizzle cannot express for the organization block.
-- Homonym rule (D-10): normalized full name + distinguishing note is unique, and a trigram
-- index on the same expression backs accent- and typo-tolerant search.

-- Already created by docker/postgres/init, repeated so any fresh database is reproducible.
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- f_normalizar (docs/glosario.md). Joins the names, collapses whitespace, strips accents and
-- lowercases. unaccent() is only STABLE because it looks up its dictionary through
-- search_path; passing the dictionary explicitly (resolved to an OID when this SQL-standard
-- body is parsed) makes the result depend only on the arguments, so IMMUTABLE is honest
-- and the function can be used in indexes.
CREATE FUNCTION f_normalize_name(given_names text, paternal_surname text, maternal_surname text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
RETURN lower(
  public.unaccent(
    'public.unaccent'::regdictionary,
    regexp_replace(btrim(concat_ws(' ', given_names, paternal_surname, maternal_surname)), '\s+', ' ', 'g')
  )
);
--> statement-breakpoint

CREATE UNIQUE INDEX person_name_note_uq
  ON person (f_normalize_name(given_names, paternal_surname, maternal_surname), coalesce(distinguishing_note, ''));
--> statement-breakpoint

CREATE INDEX person_name_trgm_idx
  ON person USING gin (f_normalize_name(given_names, paternal_surname, maternal_surname) gin_trgm_ops);
