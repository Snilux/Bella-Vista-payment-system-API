CREATE TYPE "public"."agreement_result" AS ENUM('approved_by_majority', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."approval_result" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."approval_type" AS ENUM('role_assignment', 'rate', 'plumber_salary', 'opening_balance', 'unit_deactivation', 'holder_change', 'payment_cancellation', 'adjustment', 'expense_refund');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('superadmin', 'president', 'treasurer', 'secretary', 'member', 'block_leader');--> statement-breakpoint
CREATE SEQUENCE "public"."agreement_folio_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."person_folio_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "refresh_token" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "refresh_token_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_account_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" bigint,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_token_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "refresh_token_not_self_replaced" CHECK ("refresh_token"."replaced_by_id" <> "refresh_token"."id")
);
--> statement-breakpoint
CREATE TABLE "user_account" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_account_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"role_assignment_id" bigint NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"failed_attempts" smallint DEFAULT 0 NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_account_role_assignment_id_unique" UNIQUE("role_assignment_id"),
	CONSTRAINT "user_account_username_unique" UNIQUE("username"),
	CONSTRAINT "user_account_username_format" CHECK ("user_account"."username" = lower(btrim("user_account"."username")) AND "user_account"."username" <> ''),
	CONSTRAINT "user_account_failed_attempts" CHECK ("user_account"."failed_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "agreement" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agreement_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"folio" text DEFAULT 'AC-' || lpad(nextval('agreement_folio_seq')::text, 6, '0') NOT NULL,
	"meeting_date" date NOT NULL,
	"topic" text NOT NULL,
	"result" "agreement_result" NOT NULL,
	"votes_for" smallint,
	"votes_against" smallint,
	"abstentions" smallint,
	"minutes_reference" text,
	"corrects_id" bigint,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreement_folio_unique" UNIQUE("folio"),
	CONSTRAINT "agreement_topic_not_blank" CHECK (btrim("agreement"."topic") <> ''),
	CONSTRAINT "agreement_votes_non_negative" CHECK (coalesce("agreement"."votes_for", 0) >= 0 AND coalesce("agreement"."votes_against", 0) >= 0 AND coalesce("agreement"."abstentions", 0) >= 0),
	CONSTRAINT "agreement_not_self_correction" CHECK ("agreement"."corrects_id" <> "agreement"."id")
);
--> statement-breakpoint
CREATE TABLE "approval" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "approval_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" "approval_type" NOT NULL,
	"reason" text NOT NULL,
	"requested_by" bigint NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" "approval_result",
	"resolved_by" bigint,
	"resolved_at" timestamp with time zone,
	"resolution_reason" text,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_reason_not_blank" CHECK (btrim("approval"."reason") <> ''),
	CONSTRAINT "approval_resolution_complete" CHECK (num_nulls("approval"."result", "approval"."resolved_by", "approval"."resolved_at") IN (0, 3)),
	CONSTRAINT "approval_rejection_reason" CHECK ("approval"."result" IS DISTINCT FROM 'rejected' OR nullif(btrim("approval"."resolution_reason"), '') IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "block" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "block_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"section_id" bigint NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "block_section_id_code_unique" UNIQUE("section_id","code"),
	CONSTRAINT "block_code_not_blank" CHECK (btrim("block"."code") <> '')
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "person_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"folio" text DEFAULT 'P-' || lpad(nextval('person_folio_seq')::text, 6, '0') NOT NULL,
	"given_names" text NOT NULL,
	"paternal_surname" text NOT NULL,
	"maternal_surname" text,
	"distinguishing_note" text,
	"phone" text,
	"registered_on" date NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_folio_unique" UNIQUE("folio"),
	CONSTRAINT "person_given_names_not_blank" CHECK (btrim("person"."given_names") <> ''),
	CONSTRAINT "person_paternal_surname_not_blank" CHECK (btrim("person"."paternal_surname") <> ''),
	CONSTRAINT "person_distinguishing_note_not_blank" CHECK ("person"."distinguishing_note" IS NULL OR btrim("person"."distinguishing_note") <> '')
);
--> statement-breakpoint
CREATE TABLE "role_assignment" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "role_assignment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"person_id" bigint NOT NULL,
	"role" "role" NOT NULL,
	"block_id" bigint,
	"contact_phone" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"approval_id" bigint,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_assignment_approval_id_unique" UNIQUE("approval_id"),
	CONSTRAINT "role_assignment_block_leader_fields" CHECK ("role_assignment"."role" <> 'block_leader' OR ("role_assignment"."block_id" IS NOT NULL AND "role_assignment"."contact_phone" IS NOT NULL)),
	CONSTRAINT "role_assignment_block_only_for_leader" CHECK ("role_assignment"."role" = 'block_leader' OR "role_assignment"."block_id" IS NULL),
	CONSTRAINT "role_assignment_approval_unless_superadmin" CHECK (("role_assignment"."role" = 'superadmin') = ("role_assignment"."approval_id" IS NULL)),
	CONSTRAINT "role_assignment_dates" CHECK ("role_assignment"."end_date" IS NULL OR "role_assignment"."end_date" >= "role_assignment"."start_date")
);
--> statement-breakpoint
CREATE TABLE "section" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "section_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "section_code_unique" UNIQUE("code"),
	CONSTRAINT "section_name_unique" UNIQUE("name"),
	CONSTRAINT "section_code_not_blank" CHECK (btrim("section"."code") <> ''),
	CONSTRAINT "section_name_not_blank" CHECK (btrim("section"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_account_id_user_account_id_fk" FOREIGN KEY ("user_account_id") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_replaced_by_id_refresh_token_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."refresh_token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_role_assignment_id_role_assignment_id_fk" FOREIGN KEY ("role_assignment_id") REFERENCES "public"."role_assignment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_corrects_id_agreement_id_fk" FOREIGN KEY ("corrects_id") REFERENCES "public"."agreement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_requested_by_user_account_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_resolved_by_user_account_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_section_id_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."section"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_block_id_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."block"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_approval_id_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_token_user_account_id_idx" ON "refresh_token" USING btree ("user_account_id");--> statement-breakpoint
CREATE INDEX "approval_pending_idx" ON "approval" USING btree ("requested_at") WHERE "approval"."result" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignment_open_leader_block_uq" ON "role_assignment" USING btree ("block_id") WHERE "role_assignment"."role" = 'block_leader' AND "role_assignment"."end_date" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignment_open_leader_person_uq" ON "role_assignment" USING btree ("person_id") WHERE "role_assignment"."role" = 'block_leader' AND "role_assignment"."end_date" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignment_open_officer_uq" ON "role_assignment" USING btree ("role") WHERE "role_assignment"."role" IN ('president', 'treasurer', 'secretary') AND "role_assignment"."end_date" IS NULL;