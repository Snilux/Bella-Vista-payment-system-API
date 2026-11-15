-- Hand-written: triggers of block 7 (3.1 §2.1) plus the two rules left pending in blocks 5
-- and 6. Every violation raises check_violation with CONSTRAINT set to the rule name, so the
-- API maps it to an error code as it does with CHECK constraints.

-- 1. Closed period (D-14) ------------------------------------------------------------------
-- A month with a closed monthly closing of a cashbox admits no movement dated in it.
-- Corrections go to the open period. The dates checked are the same ones v_cashbox_movement
-- uses. FOR SHARE makes a movement wait for a concurrent close of that month to commit and
-- then see it as closed.
CREATE FUNCTION f_assert_period_open(p_cashbox_id bigint, p_on date, p_table text) RETURNS void
  LANGUAGE plpgsql
AS $$
DECLARE
  v_closed_at timestamptz;
BEGIN
  IF p_cashbox_id IS NULL OR p_on IS NULL THEN
    RETURN;
  END IF;
  SELECT closed_at INTO v_closed_at
  FROM closing
  WHERE cashbox_id = p_cashbox_id AND type = 'monthly' AND p_on BETWEEN date_from AND date_to
  FOR SHARE;
  IF v_closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'cashbox % has a closed closing for the month of %', p_cashbox_id, p_on
      USING ERRCODE = 'check_violation', TABLE = p_table, CONSTRAINT = 'period_closed';
  END IF;
END;
$$;
--> statement-breakpoint

-- Movements recorded on insert, dated by their own row.
CREATE FUNCTION f_period_open_on_insert() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'payment' THEN
      PERFORM f_assert_period_open(NEW.cashbox_id, f_business_date(NEW.occurred_at), TG_TABLE_NAME);
    WHEN 'opening_balance', 'adjustment' THEN
      PERFORM f_assert_period_open(NEW.cashbox_id, NEW.date, TG_TABLE_NAME);
    WHEN 'income', 'expense_refund' THEN
      PERFORM f_assert_period_open(f_committee_cashbox_id(), NEW.date, TG_TABLE_NAME);
  END CASE;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER payment_period_open BEFORE INSERT ON payment
  FOR EACH ROW EXECUTE FUNCTION f_period_open_on_insert();
--> statement-breakpoint
CREATE TRIGGER opening_balance_period_open BEFORE INSERT ON opening_balance
  FOR EACH ROW EXECUTE FUNCTION f_period_open_on_insert();
--> statement-breakpoint
CREATE TRIGGER adjustment_period_open BEFORE INSERT ON adjustment
  FOR EACH ROW EXECUTE FUNCTION f_period_open_on_insert();
--> statement-breakpoint
CREATE TRIGGER income_period_open BEFORE INSERT ON income
  FOR EACH ROW EXECUTE FUNCTION f_period_open_on_insert();
--> statement-breakpoint
CREATE TRIGGER expense_refund_period_open BEFORE INSERT ON expense_refund
  FOR EACH ROW EXECUTE FUNCTION f_period_open_on_insert();
--> statement-breakpoint

-- A handover moves cash when it is confirmed: out of the source box, into the committee box.
CREATE FUNCTION f_handover_period_open() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.confirmed_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.confirmed_at IS DISTINCT FROM NEW.confirmed_at) THEN
    PERFORM f_assert_period_open(NEW.source_cashbox_id, f_business_date(NEW.confirmed_at), 'handover');
    PERFORM f_assert_period_open(f_committee_cashbox_id(), f_business_date(NEW.confirmed_at), 'handover');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER handover_period_open BEFORE INSERT OR UPDATE OF confirmed_at ON handover
  FOR EACH ROW EXECUTE FUNCTION f_handover_period_open();
--> statement-breakpoint

-- An expense moves cash when it is paid.
CREATE FUNCTION f_expense_period_open() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.paid_on IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.paid_on IS DISTINCT FROM NEW.paid_on) THEN
    PERFORM f_assert_period_open(f_committee_cashbox_id(), NEW.paid_on, 'expense');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER expense_period_open BEFORE INSERT OR UPDATE OF paid_on ON expense
  FOR EACH ROW EXECUTE FUNCTION f_expense_period_open();
--> statement-breakpoint

-- 2 and 3. Rules checked when an approval is approved -----------------------------------------
-- * Closed period: the movement an approval enables cannot fall in a closed month (a
--   cancellation is dated on its resolution; the others on their own date).
-- * A single approved rate per effective_period.
-- * A single approved cancellation per payment.
-- The advisory locks serialize concurrent approvals of the same period or payment, so two
-- transactions cannot both see "no other approved" and commit.
CREATE FUNCTION f_assert_single_approved_rate(p_rate_id bigint) RETURNS void
  LANGUAGE plpgsql
AS $$
DECLARE
  v_period date;
BEGIN
  SELECT effective_period INTO v_period FROM rate WHERE id = p_rate_id;
  PERFORM pg_advisory_xact_lock(hashtext('rate:' || v_period));
  IF (SELECT count(*) FROM rate r
      JOIN approval a ON a.id = r.approval_id AND a.result = 'approved'
      WHERE r.effective_period = v_period) > 1 THEN
    RAISE EXCEPTION 'period % already has an approved rate', v_period
      USING ERRCODE = 'check_violation', TABLE = 'rate', CONSTRAINT = 'rate_single_approved';
  END IF;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION f_assert_single_approved_cancellation(p_payment_id bigint) RETURNS void
  LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('payment_cancellation:' || p_payment_id));
  IF (SELECT count(*) FROM payment_cancellation pc
      JOIN approval a ON a.id = pc.approval_id AND a.result = 'approved'
      WHERE pc.payment_id = p_payment_id) > 1 THEN
    RAISE EXCEPTION 'payment % already has an approved cancellation', p_payment_id
      USING ERRCODE = 'check_violation', TABLE = 'payment_cancellation',
            CONSTRAINT = 'payment_cancellation_single_approved';
  END IF;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION f_approval_approved() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  r record;
BEGIN
  IF NEW.result IS DISTINCT FROM 'approved' OR OLD.result IS NOT DISTINCT FROM NEW.result THEN
    RETURN NEW;
  END IF;
  CASE NEW.type
    WHEN 'rate' THEN
      FOR r IN SELECT id FROM rate WHERE approval_id = NEW.id LOOP
        PERFORM f_assert_single_approved_rate(r.id);
      END LOOP;
    WHEN 'payment_cancellation' THEN
      FOR r IN SELECT pc.payment_id, p.cashbox_id FROM payment_cancellation pc
               JOIN payment p ON p.id = pc.payment_id WHERE pc.approval_id = NEW.id LOOP
        PERFORM f_assert_single_approved_cancellation(r.payment_id);
        PERFORM f_assert_period_open(r.cashbox_id, f_business_date(NEW.resolved_at), 'payment_cancellation');
      END LOOP;
    WHEN 'opening_balance' THEN
      FOR r IN SELECT cashbox_id, date FROM opening_balance WHERE approval_id = NEW.id LOOP
        PERFORM f_assert_period_open(r.cashbox_id, r.date, 'opening_balance');
      END LOOP;
    WHEN 'adjustment' THEN
      FOR r IN SELECT cashbox_id, date FROM adjustment WHERE approval_id = NEW.id LOOP
        PERFORM f_assert_period_open(r.cashbox_id, r.date, 'adjustment');
      END LOOP;
    WHEN 'expense_refund' THEN
      FOR r IN SELECT date FROM expense_refund WHERE approval_id = NEW.id LOOP
        PERFORM f_assert_period_open(f_committee_cashbox_id(), r.date, 'expense_refund');
      END LOOP;
    ELSE
      NULL;
  END CASE;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER approval_approved AFTER UPDATE OF result ON approval
  FOR EACH ROW EXECUTE FUNCTION f_approval_approved();
--> statement-breakpoint

-- A rate or cancellation inserted with an approval that is already approved is checked too.
CREATE FUNCTION f_single_approved_on_insert() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM approval WHERE id = NEW.approval_id AND result = 'approved') THEN
    IF TG_TABLE_NAME = 'rate' THEN
      PERFORM f_assert_single_approved_rate(NEW.id);
    ELSE
      PERFORM f_assert_single_approved_cancellation(NEW.payment_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER rate_single_approved AFTER INSERT OR UPDATE OF approval_id, effective_period ON rate
  FOR EACH ROW EXECUTE FUNCTION f_single_approved_on_insert();
--> statement-breakpoint
CREATE TRIGGER payment_cancellation_single_approved
  AFTER INSERT OR UPDATE OF approval_id, payment_id ON payment_cancellation
  FOR EACH ROW EXECUTE FUNCTION f_single_approved_on_insert();
--> statement-breakpoint

-- 4. Approval type matches the table that uses it ---------------------------------------------
-- TG_ARGV[0] is the expected approval type; unit_change_request derives it from its own type.
CREATE FUNCTION f_approval_type_matches() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_expected approval_type;
  v_actual approval_type;
BEGIN
  IF NEW.approval_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'unit_change_request' THEN
    v_expected := CASE NEW.type WHEN 'deactivation' THEN 'unit_deactivation' ELSE 'holder_change' END;
  ELSE
    v_expected := TG_ARGV[0]::approval_type;
  END IF;
  SELECT type INTO v_actual FROM approval WHERE id = NEW.approval_id;
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'approval % is of type %, expected %', NEW.approval_id, v_actual, v_expected
      USING ERRCODE = 'check_violation', TABLE = TG_TABLE_NAME,
            CONSTRAINT = TG_TABLE_NAME || '_approval_type';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER role_assignment_approval_type BEFORE INSERT OR UPDATE OF approval_id ON role_assignment
  FOR EACH ROW EXECUTE FUNCTION f_approval_type_matches('role_assignment');
--> statement-breakpoint
CREATE TRIGGER rate_approval_type BEFORE INSERT OR UPDATE OF approval_id ON rate
  FOR EACH ROW EXECUTE FUNCTION f_approval_type_matches('rate');
--> statement-breakpoint
CREATE TRIGGER plumber_salary_approval_type BEFORE INSERT OR UPDATE OF approval_id ON plumber_salary
  FOR EACH ROW EXECUTE FUNCTION f_approval_type_matches('plumber_salary');
--> statement-breakpoint
CREATE TRIGGER opening_balance_approval_type BEFORE INSERT OR UPDATE OF approval_id ON opening_balance
  FOR EACH ROW EXECUTE FUNCTION f_approval_type_matches('opening_balance');
--> statement-breakpoint
CREATE TRIGGER unit_change_request_approval_type
  BEFORE INSERT OR UPDATE OF approval_id, type ON unit_change_request
  FOR EACH ROW EXECUTE FUNCTION f_approval_type_matches();
--> statement-breakpoint
CREATE TRIGGER payment_cancellation_approval_type
  BEFORE INSERT OR UPDATE OF approval_id ON payment_cancellation
  FOR EACH ROW EXECUTE FUNCTION f_approval_type_matches('payment_cancellation');
--> statement-breakpoint
CREATE TRIGGER adjustment_approval_type BEFORE INSERT OR UPDATE OF approval_id ON adjustment
  FOR EACH ROW EXECUTE FUNCTION f_approval_type_matches('adjustment');
--> statement-breakpoint
CREATE TRIGGER expense_refund_approval_type BEFORE INSERT OR UPDATE OF approval_id ON expense_refund
  FOR EACH ROW EXECUTE FUNCTION f_approval_type_matches('expense_refund');
--> statement-breakpoint

-- 5. Handover source cashbox (pending from block 5) --------------------------------------------
-- Only block and support cashboxes hand over; the destination is always the committee box.
CREATE FUNCTION f_handover_source_type() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cashbox WHERE id = NEW.source_cashbox_id AND type IN ('block', 'support')
  ) THEN
    RAISE EXCEPTION 'cashbox % cannot hand over cash', NEW.source_cashbox_id
      USING ERRCODE = 'check_violation', TABLE = 'handover', CONSTRAINT = 'handover_source_type';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER handover_source_type BEFORE INSERT OR UPDATE OF source_cashbox_id ON handover
  FOR EACH ROW EXECUTE FUNCTION f_handover_source_type();
--> statement-breakpoint

-- 6. Expense amount and agreement (pending from block 5) ---------------------------------------
-- Required unless the expense pays the plumber (both then come from plumber_salary). The
-- plumber_payment row is inserted after its expense, so the check is deferred to commit.
CREATE FUNCTION f_expense_amount_agreement() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.amount IS NULL OR NEW.agreement_id IS NULL)
     AND NOT EXISTS (SELECT 1 FROM plumber_payment WHERE expense_id = NEW.id) THEN
    RAISE EXCEPTION 'expense % needs an amount and an agreement', NEW.id
      USING ERRCODE = 'check_violation', TABLE = 'expense',
            CONSTRAINT = 'expense_amount_agreement_required';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER expense_amount_agreement_required
  AFTER INSERT OR UPDATE OF amount, agreement_id ON expense
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION f_expense_amount_agreement();
--> statement-breakpoint

-- 7. A closed closing is immutable --------------------------------------------------------------
-- While open, a closing can be counted, reviewed and closed (closing is the last UPDATE it
-- accepts). Once closed_at has a value, any UPDATE is rejected, including clearing closed_at
-- (that would reopen a locked month, D-14), and so is DELETE. Corrections go to the open
-- period as an adjustment.
CREATE FUNCTION f_closing_closed_immutable() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'closing % is closed and cannot change', OLD.id
      USING ERRCODE = 'check_violation', TABLE = 'closing', CONSTRAINT = 'closing_closed_immutable';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER closing_closed_immutable BEFORE UPDATE OR DELETE ON closing
  FOR EACH ROW EXECUTE FUNCTION f_closing_closed_immutable();
--> statement-breakpoint

-- 8. A resolved approval is immutable -----------------------------------------------------------
-- The first resolution (OLD.result IS NULL) is allowed. After it, result, resolved_by,
-- resolved_at and resolution_reason cannot change, not even back to pending (result = NULL).
-- A mistake is corrected with a new request.
CREATE FUNCTION f_approval_resolved_immutable() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.result IS NOT NULL
     AND (NEW.result IS DISTINCT FROM OLD.result
          OR NEW.resolved_by IS DISTINCT FROM OLD.resolved_by
          OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
          OR NEW.resolution_reason IS DISTINCT FROM OLD.resolution_reason) THEN
    RAISE EXCEPTION 'approval % is already resolved', OLD.id
      USING ERRCODE = 'check_violation', TABLE = 'approval',
            CONSTRAINT = 'approval_resolved_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER approval_resolved_immutable
  BEFORE UPDATE OF result, resolved_by, resolved_at, resolution_reason ON approval
  FOR EACH ROW EXECUTE FUNCTION f_approval_resolved_immutable();
--> statement-breakpoint

-- The rules noted as pending in migrations 0006, 0008, 0010 and 0012 are now enforced.
COMMENT ON TABLE rate IS NULL;
--> statement-breakpoint
COMMENT ON TABLE payment_cancellation IS NULL;
--> statement-breakpoint
COMMENT ON TABLE handover IS NULL;
--> statement-breakpoint
COMMENT ON TABLE expense IS NULL;
--> statement-breakpoint
COMMENT ON TABLE closing IS NULL;
