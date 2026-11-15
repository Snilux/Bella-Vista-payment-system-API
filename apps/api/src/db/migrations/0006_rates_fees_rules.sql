-- Hand-written: rules of the rates and fees block that Drizzle cannot express.

-- Pending rule, enforced in block 7 (views, triggers and permissions): when an approval is
-- resolved, a trigger must reject a second approved rate for the same effective_period.
COMMENT ON TABLE rate IS
  'Monthly fee. Pending (block 7): trigger on approval resolution allowing a single approved rate per effective_period.';
--> statement-breakpoint

-- The amount of an extra charge is not stored: it is the fee_amount in force on charged_on
-- (D-13). A charge with no amount in force on that date could never be priced, so it is
-- rejected. fee_amount rows are never deleted (money history), so checking here is enough.
CREATE FUNCTION f_extra_charge_amount_in_force() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM fee_amount
    WHERE fee_id = NEW.fee_id AND effective_from <= NEW.charged_on
  ) THEN
    RAISE EXCEPTION 'fee % has no amount in force on %', NEW.fee_id, NEW.charged_on
      USING ERRCODE = 'check_violation',
            TABLE = 'extra_charge',
            CONSTRAINT = 'extra_charge_amount_in_force';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER extra_charge_amount_in_force
  BEFORE INSERT OR UPDATE OF fee_id, charged_on ON extra_charge
  FOR EACH ROW EXECUTE FUNCTION f_extra_charge_amount_in_force();
--> statement-breakpoint

-- The opening fee is charged to a connection request and only openings are charged to a
-- request. Together with extra_charge_request_current_uq this guarantees a single current
-- opening per request.
CREATE FUNCTION f_extra_charge_opening_target() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  is_opening boolean;
BEGIN
  SELECT type = 'opening' INTO is_opening FROM fee WHERE id = NEW.fee_id;
  IF is_opening IS DISTINCT FROM (NEW.connection_request_id IS NOT NULL) THEN
    RAISE EXCEPTION 'opening fees go to a connection request and only there (fee %)', NEW.fee_id
      USING ERRCODE = 'check_violation',
            TABLE = 'extra_charge',
            CONSTRAINT = 'extra_charge_opening_target';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER extra_charge_opening_target
  BEFORE INSERT OR UPDATE OF fee_id, connection_request_id ON extra_charge
  FOR EACH ROW EXECUTE FUNCTION f_extra_charge_opening_target();
--> statement-breakpoint

-- Changing a fee's type after it has been charged would break the rule above for the
-- existing charges.
CREATE FUNCTION f_fee_type_locked() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM OLD.type
     AND EXISTS (SELECT 1 FROM extra_charge WHERE fee_id = OLD.id)
  THEN
    RAISE EXCEPTION 'fee % has charges; its type cannot change', OLD.id
      USING ERRCODE = 'check_violation',
            TABLE = 'fee',
            CONSTRAINT = 'fee_type_locked';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER fee_type_locked
  BEFORE UPDATE OF type ON fee
  FOR EACH ROW EXECUTE FUNCTION f_fee_type_locked();
