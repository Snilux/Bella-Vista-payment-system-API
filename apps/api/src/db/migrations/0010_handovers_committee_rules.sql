-- Hand-written: rules of the handovers and committee block that Drizzle cannot express.
-- Every rule of this block that fits a CHECK or a (partial) unique index lives in 0009; the
-- two below need other tables and are enforced in block 7 (views, triggers and permissions).

-- Pending rule (block 7): a trigger must require the source cashbox to be of type block or
-- support (the destination is always the committee cashbox). A CHECK cannot read cashbox.
COMMENT ON TABLE handover IS
  'Cash handover to the committee cashbox. Pending (block 7): trigger requiring the source cashbox to be of type block or support.';
--> statement-breakpoint

-- Pending rule (block 7): amount and agreement_id are required unless the expense pays the
-- plumber (both then come from plumber_salary). plumber_payment is inserted after its
-- expense, so the check must be a constraint trigger DEFERRABLE INITIALLY DEFERRED that runs
-- at commit.
COMMENT ON TABLE expense IS
  'Committee expense. Pending (block 7): deferred trigger requiring amount and agreement_id unless the expense has a plumber_payment.';
