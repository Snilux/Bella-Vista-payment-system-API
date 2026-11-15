-- Hand-written: privileges of the API database user (2.2 §7, 3.1 §2.1). The API connects as
-- agua_api (DATABASE_URL); migrations run as the owner (DATABASE_URL_MIGRATIONS). Money is
-- never edited or deleted, and the database enforces it, not only the code.
--
-- In development docker/postgres/init/03-api-user.sh creates agua_api with LOGIN and its
-- password when the volume is created. The role is created here too (NOLOGIN) when missing,
-- so migrations also apply on a volume created before that script; LOGIN and the password
-- are then enabled by hand with ALTER ROLE (never stored in a migration).
--
-- A table added by a later migration must grant its own privileges there.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agua_api') THEN
    CREATE ROLE agua_api NOLOGIN;
  END IF;
END;
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO agua_api;
--> statement-breakpoint

-- SELECT on every table and view.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO agua_api;
--> statement-breakpoint

-- INSERT on every base table (not on views).
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('GRANT INSERT ON %I TO agua_api', t);
  END LOOP;
END;
$$;
--> statement-breakpoint

-- Folio sequences are read by column defaults (nextval).
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO agua_api;
--> statement-breakpoint

-- UPDATE only on status columns: resolution of an approval, confirmation or withdrawal of a
-- handover, payment and rejection of an expense, count, review and close of a closing, the
-- user account, end dates and histories, plus the contact data of people and the plumber.
-- No UPDATE on payment, payment_month, paper_receipt, income or audit_log (nor on any other
-- money or catalog table).
GRANT UPDATE (result, resolved_by, resolved_at, resolution_reason) ON approval TO agua_api;
--> statement-breakpoint
GRANT UPDATE (withdrawn_at, received_amount, confirmed_at, confirmed_by) ON handover TO agua_api;
--> statement-breakpoint
GRANT UPDATE (paid_on, rejected_on, rejection_reason) ON expense TO agua_api;
--> statement-breakpoint
GRANT UPDATE (counted_cash, notes, reviewed_by, reviewed_at, closed_by, closed_at)
  ON closing TO agua_api;
--> statement-breakpoint
GRANT UPDATE (password_hash, must_change_password, deactivated_at, locked_until, failed_attempts)
  ON user_account TO agua_api;
--> statement-breakpoint
GRANT UPDATE (revoked_at, replaced_by_id) ON refresh_token TO agua_api;
--> statement-breakpoint
GRANT UPDATE (end_date) ON role_assignment TO agua_api;
--> statement-breakpoint
GRANT UPDATE (deactivated_on, deactivation_reason) ON connection TO agua_api;
--> statement-breakpoint
GRANT UPDATE (activated_on, billing_start_period, deactivated_on) ON unit TO agua_api;
--> statement-breakpoint
GRANT UPDATE (agreement_id, resolution_reason, cancelled_on, cancellation_reason)
  ON connection_request TO agua_api;
--> statement-breakpoint
GRANT UPDATE (valid_to) ON connection_block TO agua_api;
--> statement-breakpoint
GRANT UPDATE (valid_to) ON unit_holder TO agua_api;
--> statement-breakpoint
GRANT UPDATE (period_to) ON suspension TO agua_api;
--> statement-breakpoint
GRANT UPDATE (cancelled_on) ON extra_charge TO agua_api;
--> statement-breakpoint
GRANT UPDATE (active) ON section TO agua_api;
--> statement-breakpoint
GRANT UPDATE (active) ON block TO agua_api;
--> statement-breakpoint
GRANT UPDATE (phone, distinguishing_note) ON person TO agua_api;
--> statement-breakpoint
GRANT UPDATE (phone, active) ON plumber TO agua_api;
--> statement-breakpoint

-- DELETE only where rows are not history: covered periods released by an approved
-- cancellation (the only DELETE in billing), refresh tokens and stored idempotent responses.
GRANT DELETE ON covered_period, refresh_token, idempotency_key TO agua_api;
--> statement-breakpoint

-- Contact data changes are audited by the database itself. The API sets the acting account
-- per transaction (SET LOCAL app.user_account_id = '<id>', optionally app.audit_reason); an
-- update without it is rejected, so no change goes unrecorded.
CREATE FUNCTION f_audit_contact_change() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_user_account_id bigint := nullif(current_setting('app.user_account_id', true), '')::bigint;
  v_role role;
  v_columns text[] := CASE TG_TABLE_NAME
    WHEN 'person' THEN ARRAY['phone', 'distinguishing_note']
    ELSE ARRAY['phone']
  END;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  c text;
BEGIN
  FOREACH c IN ARRAY v_columns LOOP
    IF (to_jsonb(OLD) -> c) IS DISTINCT FROM (to_jsonb(NEW) -> c) THEN
      v_before := v_before || jsonb_build_object(c, to_jsonb(OLD) -> c);
      v_after := v_after || jsonb_build_object(c, to_jsonb(NEW) -> c);
    END IF;
  END LOOP;
  IF v_after = '{}'::jsonb THEN
    RETURN NULL;
  END IF;
  SELECT ra.role INTO v_role
  FROM user_account ua
  JOIN role_assignment ra ON ra.id = ua.role_assignment_id
  WHERE ua.id = v_user_account_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'contact data of % % changed without a valid app.user_account_id',
      TG_TABLE_NAME, NEW.id
      USING ERRCODE = 'check_violation', TABLE = TG_TABLE_NAME,
            CONSTRAINT = TG_TABLE_NAME || '_contact_change_audited';
  END IF;
  INSERT INTO audit_log (user_account_id, role, action, table_name, record_id, before, after,
                         reason, is_technical)
  VALUES (v_user_account_id, v_role, 'update_contact', TG_TABLE_NAME, NEW.id, v_before, v_after,
          nullif(current_setting('app.audit_reason', true), ''), v_role = 'superadmin');
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER person_contact_change_audited AFTER UPDATE OF phone, distinguishing_note ON person
  FOR EACH ROW EXECUTE FUNCTION f_audit_contact_change();
--> statement-breakpoint
CREATE TRIGGER plumber_contact_change_audited AFTER UPDATE OF phone ON plumber
  FOR EACH ROW EXECUTE FUNCTION f_audit_contact_change();
--> statement-breakpoint

COMMENT ON TABLE audit_log IS NULL;
