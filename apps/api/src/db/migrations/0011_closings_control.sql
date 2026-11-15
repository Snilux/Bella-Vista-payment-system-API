CREATE TYPE "public"."closing_type" AS ENUM('monthly', 'extraordinary');--> statement-breakpoint
CREATE SEQUENCE "public"."closing_folio_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_account_id" bigint NOT NULL,
	"role" "role" NOT NULL,
	"action" text NOT NULL,
	"table_name" text NOT NULL,
	"record_id" bigint NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"is_technical" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_action_not_blank" CHECK (btrim("audit_log"."action") <> ''),
	CONSTRAINT "audit_log_table_name_not_blank" CHECK (btrim("audit_log"."table_name") <> '')
);
--> statement-breakpoint
CREATE TABLE "idempotency_key" (
	"key" uuid PRIMARY KEY NOT NULL,
	"user_account_id" bigint NOT NULL,
	"route" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "adjustment" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "adjustment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"cashbox_id" bigint NOT NULL,
	"handover_id" bigint,
	"closing_id" bigint,
	"amount" bigint NOT NULL,
	"date" date NOT NULL,
	"approval_id" bigint NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adjustment_approval_id_unique" UNIQUE("approval_id"),
	CONSTRAINT "adjustment_single_origin" CHECK (num_nonnulls("adjustment"."handover_id", "adjustment"."closing_id") = 1),
	CONSTRAINT "adjustment_amount_not_zero" CHECK ("adjustment"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "closing" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "closing_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"folio" text DEFAULT 'CO-' || to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYYMM') || '-' || lpad(nextval('closing_folio_seq')::text, 6, '0') NOT NULL,
	"cashbox_id" bigint NOT NULL,
	"type" "closing_type" NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"counted_cash" bigint,
	"notes" text,
	"reviewed_by" bigint,
	"reviewed_at" timestamp with time zone,
	"closed_by" bigint,
	"closed_at" timestamp with time zone,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closing_folio_unique" UNIQUE("folio"),
	CONSTRAINT "closing_id_cashbox_id_unique" UNIQUE("id","cashbox_id"),
	CONSTRAINT "closing_date_range" CHECK ("closing"."date_from" <= "closing"."date_to"),
	CONSTRAINT "closing_monthly_whole_month" CHECK ("closing"."type" <> 'monthly' OR (extract(day from "closing"."date_from") = 1 AND "closing"."date_to" = ("closing"."date_from" + interval '1 month' - interval '1 day')::date)),
	CONSTRAINT "closing_counted_cash_not_negative" CHECK ("closing"."counted_cash" >= 0),
	CONSTRAINT "closing_review_complete" CHECK (num_nonnulls("closing"."reviewed_by", "closing"."reviewed_at") IN (0, 2)),
	CONSTRAINT "closing_close_complete" CHECK (num_nonnulls("closing"."closed_by", "closing"."closed_at") IN (0, 2)),
	CONSTRAINT "closing_reviewed_after_count" CHECK ("closing"."reviewed_at" IS NULL OR "closing"."counted_cash" IS NOT NULL),
	CONSTRAINT "closing_closed_after_review" CHECK ("closing"."closed_at" IS NULL OR "closing"."reviewed_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_account_id_user_account_id_fk" FOREIGN KEY ("user_account_id") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_user_account_id_user_account_id_fk" FOREIGN KEY ("user_account_id") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover" ADD CONSTRAINT "handover_id_source_cashbox_id_unique" UNIQUE("id","source_cashbox_id");--> statement-breakpoint
ALTER TABLE "adjustment" ADD CONSTRAINT "adjustment_cashbox_id_cashbox_id_fk" FOREIGN KEY ("cashbox_id") REFERENCES "public"."cashbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment" ADD CONSTRAINT "adjustment_approval_id_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment" ADD CONSTRAINT "adjustment_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment" ADD CONSTRAINT "adjustment_handover_cashbox_fk" FOREIGN KEY ("handover_id","cashbox_id") REFERENCES "public"."handover"("id","source_cashbox_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment" ADD CONSTRAINT "adjustment_closing_cashbox_fk" FOREIGN KEY ("closing_id","cashbox_id") REFERENCES "public"."closing"("id","cashbox_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing" ADD CONSTRAINT "closing_cashbox_id_cashbox_id_fk" FOREIGN KEY ("cashbox_id") REFERENCES "public"."cashbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing" ADD CONSTRAINT "closing_reviewed_by_user_account_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing" ADD CONSTRAINT "closing_closed_by_user_account_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing" ADD CONSTRAINT "closing_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_table_record_idx" ON "audit_log" USING btree ("table_name","record_id");--> statement-breakpoint
CREATE INDEX "audit_log_user_account_id_idx" ON "audit_log" USING btree ("user_account_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idempotency_key_created_at_idx" ON "idempotency_key" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "adjustment_cashbox_id_idx" ON "adjustment" USING btree ("cashbox_id");--> statement-breakpoint
CREATE INDEX "adjustment_handover_id_idx" ON "adjustment" USING btree ("handover_id");--> statement-breakpoint
CREATE INDEX "adjustment_closing_id_idx" ON "adjustment" USING btree ("closing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "closing_monthly_uq" ON "closing" USING btree ("cashbox_id","date_from") WHERE "closing"."type" = 'monthly';--> statement-breakpoint
CREATE INDEX "closing_cashbox_id_idx" ON "closing" USING btree ("cashbox_id");
