CREATE TYPE "public"."fee_type" AS ENUM('opening', 'reconnection', 'repair', 'other');--> statement-breakpoint
CREATE TABLE "extra_charge" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "extra_charge_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"fee_id" bigint NOT NULL,
	"connection_request_id" bigint,
	"connection_id" bigint,
	"unit_id" bigint,
	"charged_on" date NOT NULL,
	"cancelled_on" date,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extra_charge_single_target" CHECK (num_nonnulls("extra_charge"."connection_request_id", "extra_charge"."connection_id", "extra_charge"."unit_id") = 1),
	CONSTRAINT "extra_charge_cancelled_after_charge" CHECK ("extra_charge"."cancelled_on" IS NULL OR "extra_charge"."cancelled_on" >= "extra_charge"."charged_on")
);
--> statement-breakpoint
CREATE TABLE "fee" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fee_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" "fee_type" NOT NULL,
	"name" text NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_name_unique" UNIQUE("name"),
	CONSTRAINT "fee_name_not_blank" CHECK (btrim("fee"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "fee_amount" (
	"fee_id" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"amount" bigint NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_amount_pk" PRIMARY KEY("fee_id","effective_from"),
	CONSTRAINT "fee_amount_amount_positive" CHECK ("fee_amount"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "rate" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rate_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"effective_period" date NOT NULL,
	"amount" bigint NOT NULL,
	"approved_on" date NOT NULL,
	"agreement_id" bigint NOT NULL,
	"approval_id" bigint NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_approval_id_unique" UNIQUE("approval_id"),
	CONSTRAINT "rate_effective_period_first_of_month" CHECK (extract(day from "rate"."effective_period") = 1),
	CONSTRAINT "rate_amount_positive" CHECK ("rate"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "extra_charge" ADD CONSTRAINT "extra_charge_fee_id_fee_id_fk" FOREIGN KEY ("fee_id") REFERENCES "public"."fee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_charge" ADD CONSTRAINT "extra_charge_connection_request_id_connection_request_id_fk" FOREIGN KEY ("connection_request_id") REFERENCES "public"."connection_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_charge" ADD CONSTRAINT "extra_charge_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_charge" ADD CONSTRAINT "extra_charge_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_charge" ADD CONSTRAINT "extra_charge_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee" ADD CONSTRAINT "fee_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_amount" ADD CONSTRAINT "fee_amount_fee_id_fee_id_fk" FOREIGN KEY ("fee_id") REFERENCES "public"."fee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_amount" ADD CONSTRAINT "fee_amount_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate" ADD CONSTRAINT "rate_agreement_id_agreement_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate" ADD CONSTRAINT "rate_approval_id_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate" ADD CONSTRAINT "rate_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "extra_charge_request_current_uq" ON "extra_charge" USING btree ("connection_request_id") WHERE "extra_charge"."cancelled_on" IS NULL;--> statement-breakpoint
CREATE INDEX "extra_charge_fee_id_idx" ON "extra_charge" USING btree ("fee_id");--> statement-breakpoint
CREATE INDEX "extra_charge_connection_id_idx" ON "extra_charge" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "extra_charge_unit_id_idx" ON "extra_charge" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "rate_effective_period_idx" ON "rate" USING btree ("effective_period");--> statement-breakpoint
CREATE INDEX "rate_agreement_id_idx" ON "rate" USING btree ("agreement_id");