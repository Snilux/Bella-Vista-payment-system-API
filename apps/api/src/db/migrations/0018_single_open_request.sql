-- Hand-written (API step 7): a cashbox has one opening balance and an expense one refund,
-- but a request the president rejects must free the place for a new one (migration 0017
-- dropped the unique constraints). These triggers allow a single open request, pending or
-- approved, per cashbox and per expense. The transaction-scoped advisory lock serializes two
-- requests for the same record so both cannot pass the check at once.

CREATE FUNCTION f_single_open_request() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_column text := TG_ARGV[0];
  v_target bigint;
  v_taken boolean;
BEGIN
  v_target := (to_jsonb(NEW) ->> v_column)::bigint;
  PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME || ':' || v_target));
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM %I x JOIN approval a ON a.id = x.approval_id
       WHERE x.%I = $1 AND x.id <> $2 AND (a.result IS NULL OR a.result = ''approved''))',
    TG_TABLE_NAME, v_column)
    INTO v_taken
    USING v_target, NEW.id;
  IF v_taken THEN
    RAISE EXCEPTION '% % already has a pending or approved request', TG_TABLE_NAME, v_target
      USING ERRCODE = 'check_violation', TABLE = TG_TABLE_NAME,
            CONSTRAINT = TG_TABLE_NAME || '_single_open';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER opening_balance_single_open BEFORE INSERT ON opening_balance
  FOR EACH ROW EXECUTE FUNCTION f_single_open_request('cashbox_id');
--> statement-breakpoint

CREATE TRIGGER expense_refund_single_open BEFORE INSERT ON expense_refund
  FOR EACH ROW EXECUTE FUNCTION f_single_open_request('expense_id');
--> statement-breakpoint

-- The identity sequence of opening_balance.id is new (0015 granted the existing ones).
GRANT USAGE ON SEQUENCE opening_balance_id_seq TO agua_api;
