CREATE TYPE "public"."cashbox_type" AS ENUM('block', 'committee', 'support');--> statement-breakpoint
CREATE TYPE "public"."receipt_type" AS ENUM('original', 'replacement');--> statement-breakpoint
CREATE SEQUENCE "public"."payment_folio_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "covered_period" (
	"unit_id" bigint NOT NULL,
	"period" date NOT NULL,
	"payment_id" bigint NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "covered_period_pk" PRIMARY KEY("unit_id","period")
);
--> statement-breakpoint
CREATE TABLE "paper_receipt" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "paper_receipt_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"payment_id" bigint NOT NULL,
	"cashbox_id" bigint NOT NULL,
	"paper_folio" text NOT NULL,
	"type" "receipt_type" NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paper_receipt_cashbox_folio_unique" UNIQUE("cashbox_id","paper_folio"),
	CONSTRAINT "paper_receipt_folio_not_blank" CHECK (btrim("paper_receipt"."paper_folio") <> '')
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"folio" text DEFAULT 'PG-' || to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYYMM') || '-' || lpad(nextval('payment_folio_seq')::text, 6, '0') NOT NULL,
	"unit_id" bigint,
	"cashbox_id" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_folio_unique" UNIQUE("folio"),
	CONSTRAINT "payment_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payment_id_unit_id_unique" UNIQUE("id","unit_id"),
	CONSTRAINT "payment_id_cashbox_id_unique" UNIQUE("id","cashbox_id")
);
--> statement-breakpoint
CREATE TABLE "payment_cancellation" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_cancellation_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"payment_id" bigint NOT NULL,
	"approval_id" bigint NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_cancellation_approval_id_unique" UNIQUE("approval_id")
);
--> statement-breakpoint
CREATE TABLE "payment_charge" (
	"payment_id" bigint NOT NULL,
	"extra_charge_id" bigint NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_charge_pk" PRIMARY KEY("payment_id","extra_charge_id"),
	CONSTRAINT "payment_charge_extra_charge_id_unique" UNIQUE("extra_charge_id")
);
--> statement-breakpoint
CREATE TABLE "payment_month" (
	"payment_id" bigint NOT NULL,
	"period" date NOT NULL,
	"rate_id" bigint NOT NULL,
	"with_surcharge" boolean NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_month_pk" PRIMARY KEY("payment_id","period"),
	CONSTRAINT "payment_month_period_first_of_month" CHECK (extract(day from "payment_month"."period") = 1)
);
--> statement-breakpoint
CREATE TABLE "cashbox" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cashbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" "cashbox_type" NOT NULL,
	"block_id" bigint,
	"custodian_person_id" bigint,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cashbox_block_id_unique" UNIQUE("block_id"),
	CONSTRAINT "cashbox_custodian_person_id_unique" UNIQUE("custodian_person_id"),
	CONSTRAINT "cashbox_type_target" CHECK (("cashbox"."type" = 'block') = ("cashbox"."block_id" IS NOT NULL) AND ("cashbox"."type" = 'support') = ("cashbox"."custodian_person_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "opening_balance" (
	"cashbox_id" bigint PRIMARY KEY NOT NULL,
	"amount" bigint NOT NULL,
	"date" date NOT NULL,
	"approval_id" bigint NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opening_balance_approval_id_unique" UNIQUE("approval_id"),
	CONSTRAINT "opening_balance_amount_positive" CHECK ("opening_balance"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "covered_period" ADD CONSTRAINT "covered_period_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "covered_period" ADD CONSTRAINT "covered_period_payment_unit_fk" FOREIGN KEY ("payment_id","unit_id") REFERENCES "public"."payment"("id","unit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "covered_period" ADD CONSTRAINT "covered_period_payment_month_fk" FOREIGN KEY ("payment_id","period") REFERENCES "public"."payment_month"("payment_id","period") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_receipt" ADD CONSTRAINT "paper_receipt_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_receipt" ADD CONSTRAINT "paper_receipt_payment_cashbox_fk" FOREIGN KEY ("payment_id","cashbox_id") REFERENCES "public"."payment"("id","cashbox_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_cashbox_id_cashbox_id_fk" FOREIGN KEY ("cashbox_id") REFERENCES "public"."cashbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_cancellation" ADD CONSTRAINT "payment_cancellation_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_cancellation" ADD CONSTRAINT "payment_cancellation_approval_id_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_cancellation" ADD CONSTRAINT "payment_cancellation_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_charge" ADD CONSTRAINT "payment_charge_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_charge" ADD CONSTRAINT "payment_charge_extra_charge_id_extra_charge_id_fk" FOREIGN KEY ("extra_charge_id") REFERENCES "public"."extra_charge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_charge" ADD CONSTRAINT "payment_charge_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_month" ADD CONSTRAINT "payment_month_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_month" ADD CONSTRAINT "payment_month_rate_id_rate_id_fk" FOREIGN KEY ("rate_id") REFERENCES "public"."rate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_month" ADD CONSTRAINT "payment_month_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbox" ADD CONSTRAINT "cashbox_block_id_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."block"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbox" ADD CONSTRAINT "cashbox_custodian_person_id_person_id_fk" FOREIGN KEY ("custodian_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbox" ADD CONSTRAINT "cashbox_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance" ADD CONSTRAINT "opening_balance_cashbox_id_cashbox_id_fk" FOREIGN KEY ("cashbox_id") REFERENCES "public"."cashbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance" ADD CONSTRAINT "opening_balance_approval_id_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance" ADD CONSTRAINT "opening_balance_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "covered_period_payment_id_idx" ON "covered_period" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_receipt_original_uq" ON "paper_receipt" USING btree ("payment_id") WHERE "paper_receipt"."type" = 'original';--> statement-breakpoint
CREATE INDEX "paper_receipt_payment_id_idx" ON "paper_receipt" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_unit_id_idx" ON "payment" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "payment_cashbox_id_idx" ON "payment" USING btree ("cashbox_id");--> statement-breakpoint
CREATE INDEX "payment_cancellation_payment_id_idx" ON "payment_cancellation" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_month_rate_id_idx" ON "payment_month" USING btree ("rate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cashbox_committee_uq" ON "cashbox" USING btree ("type") WHERE "cashbox"."type" = 'committee';