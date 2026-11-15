CREATE TYPE "public"."salary_frequency" AS ENUM('weekly', 'biweekly', 'monthly');--> statement-breakpoint
CREATE SEQUENCE "public"."handover_folio_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."expense_folio_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."income_folio_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "handover" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "handover_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"folio" text DEFAULT 'EN-' || to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYYMM') || '-' || lpad(nextval('handover_folio_seq')::text, 6, '0') NOT NULL,
	"source_cashbox_id" bigint NOT NULL,
	"declared_amount" bigint NOT NULL,
	"date" date NOT NULL,
	"notes" text,
	"withdrawn_at" timestamp with time zone,
	"received_amount" bigint,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" bigint,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handover_folio_unique" UNIQUE("folio"),
	CONSTRAINT "handover_declared_amount_positive" CHECK ("handover"."declared_amount" > 0),
	CONSTRAINT "handover_received_amount_not_negative" CHECK ("handover"."received_amount" >= 0),
	CONSTRAINT "handover_not_withdrawn_and_confirmed" CHECK ("handover"."withdrawn_at" IS NULL OR "handover"."confirmed_at" IS NULL),
	CONSTRAINT "handover_confirmation_complete" CHECK (num_nonnulls("handover"."received_amount", "handover"."confirmed_at", "handover"."confirmed_by") IN (0, 3))
);
--> statement-breakpoint
CREATE TABLE "expense" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expense_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"folio" text DEFAULT 'GA-' || to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYYMM') || '-' || lpad(nextval('expense_folio_seq')::text, 6, '0') NOT NULL,
	"category_id" bigint NOT NULL,
	"description" text NOT NULL,
	"amount" bigint,
	"agreement_id" bigint,
	"paid_on" date,
	"rejected_on" date,
	"rejection_reason" text,
	"voucher_reference" text,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_folio_unique" UNIQUE("folio"),
	CONSTRAINT "expense_amount_positive" CHECK ("expense"."amount" > 0),
	CONSTRAINT "expense_description_not_blank" CHECK (btrim("expense"."description") <> ''),
	CONSTRAINT "expense_not_paid_and_rejected" CHECK ("expense"."paid_on" IS NULL OR "expense"."rejected_on" IS NULL),
	CONSTRAINT "expense_rejection_reason" CHECK (("expense"."rejected_on" IS NULL) = ("expense"."rejection_reason" IS NULL)),
	CONSTRAINT "expense_rejection_reason_not_blank" CHECK (btrim("expense"."rejection_reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "expense_category" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expense_category_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"is_plumber_salary" boolean DEFAULT false NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_category_name_unique" UNIQUE("name"),
	CONSTRAINT "expense_category_name_not_blank" CHECK (btrim("expense_category"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "expense_refund" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expense_refund_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"expense_id" bigint NOT NULL,
	"date" date NOT NULL,
	"approval_id" bigint NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_refund_expense_id_unique" UNIQUE("expense_id"),
	CONSTRAINT "expense_refund_approval_id_unique" UNIQUE("approval_id")
);
--> statement-breakpoint
CREATE TABLE "income" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "income_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"folio" text DEFAULT 'IN-' || to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYYMM') || '-' || lpad(nextval('income_folio_seq')::text, 6, '0') NOT NULL,
	"concept" text NOT NULL,
	"amount" bigint NOT NULL,
	"date" date NOT NULL,
	"voucher_reference" text,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "income_folio_unique" UNIQUE("folio"),
	CONSTRAINT "income_amount_positive" CHECK ("income"."amount" > 0),
	CONSTRAINT "income_concept_not_blank" CHECK (btrim("income"."concept") <> '')
);
--> statement-breakpoint
CREATE TABLE "plumber" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "plumber_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plumber_name_not_blank" CHECK (btrim("plumber"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "plumber_payment" (
	"expense_id" bigint PRIMARY KEY NOT NULL,
	"plumber_salary_id" bigint NOT NULL,
	"plumber_id" bigint NOT NULL,
	"period_start" date NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plumber_payment_plumber_period_unique" UNIQUE("plumber_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "plumber_salary" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "plumber_salary_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"plumber_id" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"frequency" "salary_frequency" NOT NULL,
	"effective_from" date NOT NULL,
	"agreement_id" bigint NOT NULL,
	"approval_id" bigint NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plumber_salary_approval_id_unique" UNIQUE("approval_id"),
	CONSTRAINT "plumber_salary_id_plumber_id_unique" UNIQUE("id","plumber_id"),
	CONSTRAINT "plumber_salary_amount_positive" CHECK ("plumber_salary"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "handover" ADD CONSTRAINT "handover_source_cashbox_id_cashbox_id_fk" FOREIGN KEY ("source_cashbox_id") REFERENCES "public"."cashbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover" ADD CONSTRAINT "handover_confirmed_by_user_account_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover" ADD CONSTRAINT "handover_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_category_id_expense_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_agreement_id_agreement_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_category" ADD CONSTRAINT "expense_category_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_refund" ADD CONSTRAINT "expense_refund_expense_id_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expense"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_refund" ADD CONSTRAINT "expense_refund_approval_id_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_refund" ADD CONSTRAINT "expense_refund_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income" ADD CONSTRAINT "income_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plumber" ADD CONSTRAINT "plumber_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plumber_payment" ADD CONSTRAINT "plumber_payment_expense_id_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expense"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plumber_payment" ADD CONSTRAINT "plumber_payment_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plumber_payment" ADD CONSTRAINT "plumber_payment_salary_plumber_fk" FOREIGN KEY ("plumber_salary_id","plumber_id") REFERENCES "public"."plumber_salary"("id","plumber_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plumber_salary" ADD CONSTRAINT "plumber_salary_plumber_id_plumber_id_fk" FOREIGN KEY ("plumber_id") REFERENCES "public"."plumber"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plumber_salary" ADD CONSTRAINT "plumber_salary_agreement_id_agreement_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plumber_salary" ADD CONSTRAINT "plumber_salary_approval_id_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plumber_salary" ADD CONSTRAINT "plumber_salary_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "handover_source_cashbox_id_idx" ON "handover" USING btree ("source_cashbox_id");--> statement-breakpoint
CREATE INDEX "expense_category_id_idx" ON "expense" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "expense_agreement_id_idx" ON "expense" USING btree ("agreement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_category_plumber_salary_uq" ON "expense_category" USING btree ("is_plumber_salary") WHERE "expense_category"."is_plumber_salary";--> statement-breakpoint
CREATE INDEX "plumber_payment_plumber_salary_id_idx" ON "plumber_payment" USING btree ("plumber_salary_id");--> statement-breakpoint
CREATE INDEX "plumber_salary_plumber_id_idx" ON "plumber_salary" USING btree ("plumber_id");--> statement-breakpoint
CREATE INDEX "plumber_salary_agreement_id_idx" ON "plumber_salary" USING btree ("agreement_id");