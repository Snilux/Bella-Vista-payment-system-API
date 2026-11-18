ALTER TABLE "extra_charge" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
-- D-28: the treasurer cancels an unpaid extra charge with its reason (nothing is deleted).
GRANT UPDATE (cancellation_reason) ON extra_charge TO agua_api;
