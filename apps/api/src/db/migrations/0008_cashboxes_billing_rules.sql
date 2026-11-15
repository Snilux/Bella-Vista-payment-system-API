-- Hand-written: rules of the cashboxes and billing block that Drizzle cannot express.
-- The billing service validates the same rules before inserting; these triggers are the
-- last line of defense. payment and rate rows are insert-only (block 7 grants), so checking
-- on the payment_month side is enough.

-- Pending rule, enforced in block 7 (views, triggers and permissions): when an approval is
-- resolved, a trigger must allow a single approved cancellation per payment.
COMMENT ON TABLE payment_cancellation IS
  'Payment cancellation request. Pending (block 7): trigger on approval resolution allowing a single approved cancellation per payment.';
--> statement-breakpoint

-- A monthly fee belongs to a unit: a payment without unit (opening fee only) cannot carry
-- months.
CREATE FUNCTION f_payment_month_unit_required() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payment WHERE id = NEW.payment_id AND unit_id IS NOT NULL) THEN
    RAISE EXCEPTION 'payment % has no unit; it cannot cover months', NEW.payment_id
      USING ERRCODE = 'check_violation',
            TABLE = 'payment_month',
            CONSTRAINT = 'payment_month_unit_required';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER payment_month_unit_required
  BEFORE INSERT OR UPDATE OF payment_id ON payment_month
  FOR EACH ROW EXECUTE FUNCTION f_payment_month_unit_required();
--> statement-breakpoint

-- A month is priced with a rate already in effect for it (D-05): the rate cannot start
-- after the period. Whether it is approved and the latest one in effect is checked by the
-- service (and the approval rules of block 7).
CREATE FUNCTION f_payment_month_rate_in_effect() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rate WHERE id = NEW.rate_id AND effective_period <= NEW.period) THEN
    RAISE EXCEPTION 'rate % is not in effect for period %', NEW.rate_id, NEW.period
      USING ERRCODE = 'check_violation',
            TABLE = 'payment_month',
            CONSTRAINT = 'payment_month_rate_in_effect';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER payment_month_rate_in_effect
  BEFORE INSERT OR UPDATE OF rate_id, period ON payment_month
  FOR EACH ROW EXECUTE FUNCTION f_payment_month_rate_in_effect();
