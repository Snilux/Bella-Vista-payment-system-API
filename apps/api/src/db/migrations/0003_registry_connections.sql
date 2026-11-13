CREATE TYPE "public"."unit_change_type" AS ENUM('deactivation', 'holder_change');--> statement-breakpoint
CREATE SEQUENCE "public"."connection_folio_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."connection_request_folio_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."unit_folio_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "connection" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "connection_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"folio" text DEFAULT 'T-' || to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYYMM') || '-' || lpad(nextval('connection_folio_seq')::text, 6, '0') NOT NULL,
	"connection_request_id" bigint,
	"address" text NOT NULL,
	"activated_on" date NOT NULL,
	"deactivated_on" date,
	"deactivation_reason" text,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_folio_unique" UNIQUE("folio"),
	CONSTRAINT "connection_connection_request_id_unique" UNIQUE("connection_request_id"),
	CONSTRAINT "connection_address_not_blank" CHECK (btrim("connection"."address") <> ''),
	CONSTRAINT "connection_deactivation_reason" CHECK (("connection"."deactivated_on" IS NULL) = ("connection"."deactivation_reason" IS NULL) AND ("connection"."deactivation_reason" IS NULL OR btrim("connection"."deactivation_reason") <> '')),
	CONSTRAINT "connection_deactivated_after_activation" CHECK ("connection"."deactivated_on" IS NULL OR "connection"."deactivated_on" >= "connection"."activated_on")
);
--> statement-breakpoint
CREATE TABLE "connection_block" (
	"connection_id" bigint NOT NULL,
	"block_id" bigint NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_block_pk" PRIMARY KEY("connection_id","valid_from"),
	CONSTRAINT "connection_block_valid_range" CHECK ("connection_block"."valid_to" IS NULL OR "connection_block"."valid_to" > "connection_block"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "connection_request" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "connection_request_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"folio" text DEFAULT 'ST-' || to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYYMM') || '-' || lpad(nextval('connection_request_folio_seq')::text, 6, '0') NOT NULL,
	"applicant_id" bigint NOT NULL,
	"address" text NOT NULL,
	"block_id" bigint NOT NULL,
	"requested_on" date NOT NULL,
	"agreement_id" bigint,
	"resolution_reason" text,
	"cancelled_on" date,
	"cancellation_reason" text,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_request_folio_unique" UNIQUE("folio"),
	CONSTRAINT "connection_request_address_not_blank" CHECK (btrim("connection_request"."address") <> ''),
	CONSTRAINT "connection_request_resolution_needs_agreement" CHECK ("connection_request"."resolution_reason" IS NULL OR ("connection_request"."agreement_id" IS NOT NULL AND btrim("connection_request"."resolution_reason") <> '')),
	CONSTRAINT "connection_request_cancellation_reason" CHECK (("connection_request"."cancelled_on" IS NULL) = ("connection_request"."cancellation_reason" IS NULL) AND ("connection_request"."cancellation_reason" IS NULL OR btrim("connection_request"."cancellation_reason") <> '')),
	CONSTRAINT "connection_request_cancelled_after_request" CHECK ("connection_request"."cancelled_on" IS NULL OR "connection_request"."cancelled_on" >= "connection_request"."requested_on")
);
--> statement-breakpoint
CREATE TABLE "suspension" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "suspension_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"connection_id" bigint,
	"unit_id" bigint,
	"period_from" date NOT NULL,
	"period_to" date,
	"reason" text NOT NULL,
	"agreement_id" bigint NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suspension_single_target" CHECK (num_nonnulls("suspension"."connection_id", "suspension"."unit_id") = 1),
	CONSTRAINT "suspension_period_from_first_of_month" CHECK (extract(day from "suspension"."period_from") = 1),
	CONSTRAINT "suspension_period_to_first_of_month" CHECK ("suspension"."period_to" IS NULL OR extract(day from "suspension"."period_to") = 1),
	CONSTRAINT "suspension_period_range" CHECK ("suspension"."period_to" IS NULL OR "suspension"."period_to" >= "suspension"."period_from"),
	CONSTRAINT "suspension_reason_not_blank" CHECK (btrim("suspension"."reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "unit" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "unit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"folio" text DEFAULT 'U-' || to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYYMM') || '-' || lpad(nextval('unit_folio_seq')::text, 6, '0') NOT NULL,
	"connection_id" bigint NOT NULL,
	"reference" text,
	"registered_on" date NOT NULL,
	"activated_on" date,
	"billing_start_period" date,
	"deactivated_on" date,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_folio_unique" UNIQUE("folio"),
	CONSTRAINT "unit_billing_start_when_active" CHECK ("unit"."activated_on" IS NULL OR "unit"."billing_start_period" IS NOT NULL),
	CONSTRAINT "unit_billing_start_first_of_month" CHECK ("unit"."billing_start_period" IS NULL OR extract(day from "unit"."billing_start_period") = 1),
	CONSTRAINT "unit_activated_after_registration" CHECK ("unit"."activated_on" IS NULL OR "unit"."activated_on" >= "unit"."registered_on"),
	CONSTRAINT "unit_deactivated_after_registration" CHECK ("unit"."deactivated_on" IS NULL OR "unit"."deactivated_on" >= "unit"."registered_on"),
	CONSTRAINT "unit_reference_not_blank" CHECK ("unit"."reference" IS NULL OR btrim("unit"."reference") <> '')
);
--> statement-breakpoint
CREATE TABLE "unit_change_request" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "unit_change_request_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"unit_id" bigint NOT NULL,
	"type" "unit_change_type" NOT NULL,
	"new_holder_id" bigint,
	"approval_id" bigint NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_change_request_approval_id_unique" UNIQUE("approval_id"),
	CONSTRAINT "unit_change_request_new_holder" CHECK (("unit_change_request"."type" = 'holder_change') = ("unit_change_request"."new_holder_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "unit_holder" (
	"unit_id" bigint NOT NULL,
	"person_id" bigint NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_holder_pk" PRIMARY KEY("unit_id","valid_from"),
	CONSTRAINT "unit_holder_valid_range" CHECK ("unit_holder"."valid_to" IS NULL OR "unit_holder"."valid_to" > "unit_holder"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_connection_request_id_connection_request_id_fk" FOREIGN KEY ("connection_request_id") REFERENCES "public"."connection_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_block" ADD CONSTRAINT "connection_block_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_block" ADD CONSTRAINT "connection_block_block_id_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."block"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_block" ADD CONSTRAINT "connection_block_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_request" ADD CONSTRAINT "connection_request_applicant_id_person_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_request" ADD CONSTRAINT "connection_request_block_id_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."block"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_request" ADD CONSTRAINT "connection_request_agreement_id_agreement_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_request" ADD CONSTRAINT "connection_request_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension" ADD CONSTRAINT "suspension_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension" ADD CONSTRAINT "suspension_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension" ADD CONSTRAINT "suspension_agreement_id_agreement_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension" ADD CONSTRAINT "suspension_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_change_request" ADD CONSTRAINT "unit_change_request_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_change_request" ADD CONSTRAINT "unit_change_request_new_holder_id_person_id_fk" FOREIGN KEY ("new_holder_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_change_request" ADD CONSTRAINT "unit_change_request_approval_id_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_change_request" ADD CONSTRAINT "unit_change_request_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_holder" ADD CONSTRAINT "unit_holder_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_holder" ADD CONSTRAINT "unit_holder_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_holder" ADD CONSTRAINT "unit_holder_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connection_block_current_uq" ON "connection_block" USING btree ("connection_id") WHERE "connection_block"."valid_to" IS NULL;--> statement-breakpoint
CREATE INDEX "connection_block_block_id_idx" ON "connection_block" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "connection_request_block_id_idx" ON "connection_request" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "connection_request_applicant_id_idx" ON "connection_request" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "suspension_connection_id_idx" ON "suspension" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "suspension_unit_id_idx" ON "suspension" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "unit_connection_id_idx" ON "unit" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "unit_change_request_unit_id_idx" ON "unit_change_request" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_holder_current_uq" ON "unit_holder" USING btree ("unit_id") WHERE "unit_holder"."valid_to" IS NULL;--> statement-breakpoint
CREATE INDEX "unit_holder_person_id_idx" ON "unit_holder" USING btree ("person_id");