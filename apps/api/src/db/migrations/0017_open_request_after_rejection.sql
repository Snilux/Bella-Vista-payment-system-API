ALTER TABLE "expense_refund" DROP CONSTRAINT "expense_refund_expense_id_unique";--> statement-breakpoint
ALTER TABLE "opening_balance" DROP CONSTRAINT "opening_balance_pkey";--> statement-breakpoint
ALTER TABLE "opening_balance" ADD COLUMN "id" bigint PRIMARY KEY NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "opening_balance_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
CREATE INDEX "opening_balance_cashbox_id_idx" ON "opening_balance" USING btree ("cashbox_id");--> statement-breakpoint
CREATE INDEX "expense_refund_expense_id_idx" ON "expense_refund" USING btree ("expense_id");