-- Hand-written: rules of the registry and connections block that Drizzle cannot express.

-- Lets GiST indexes combine a plain equality column (bigint) with a range overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- Histories without overlaps. The partial unique indexes only stop two *current* rows; these
-- also stop two closed periods from overlapping (e.g. two holders in March, D-11).
-- valid_to is exclusive ('[)') and null means "until further notice".
ALTER TABLE connection_block
  ADD CONSTRAINT connection_block_no_overlap
  EXCLUDE USING gist (connection_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&);
--> statement-breakpoint

ALTER TABLE unit_holder
  ADD CONSTRAINT unit_holder_no_overlap
  EXCLUDE USING gist (unit_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&);
--> statement-breakpoint

-- A connection request resolved by a rejected agreement needs a resolution reason. A CHECK
-- cannot read agreement.result; agreements are never edited (they are corrected with a new
-- agreement), so checking on the request side is enough.
CREATE FUNCTION f_connection_request_rejection_reason() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.agreement_id IS NOT NULL
     AND nullif(btrim(NEW.resolution_reason), '') IS NULL
     AND EXISTS (SELECT 1 FROM agreement WHERE id = NEW.agreement_id AND result = 'rejected')
  THEN
    RAISE EXCEPTION 'connection request % rejected without resolution reason', NEW.id
      USING ERRCODE = 'check_violation',
            TABLE = 'connection_request',
            CONSTRAINT = 'connection_request_rejection_reason';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER connection_request_rejection_reason
  BEFORE INSERT OR UPDATE OF agreement_id, resolution_reason ON connection_request
  FOR EACH ROW EXECUTE FUNCTION f_connection_request_rejection_reason();
