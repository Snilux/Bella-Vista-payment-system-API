-- Hand-written: rules of the closings and control block that Drizzle cannot express.
-- Every rule of this block that fits a CHECK, a composite FK or a (partial) unique index
-- lives in 0011; the ones below are enforced in block 7 (triggers and permissions).

-- Pending rule (block 7): closing a period locks it (D-14). A trigger on the money tables
-- must reject rows dated inside a month with a closed closing of the same cashbox.
COMMENT ON TABLE closing IS
  'Cashbox closing. Pending (block 7): closed-period trigger on money tables (D-14).';
--> statement-breakpoint

-- Pending rule (block 7): the API database user gets INSERT and SELECT only, so the audit
-- log cannot be edited or deleted.
COMMENT ON TABLE audit_log IS
  'Audit log, insert-only. Pending (block 7): grants without UPDATE or DELETE for the API database user.';
