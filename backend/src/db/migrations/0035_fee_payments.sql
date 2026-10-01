-- Associate fees (#32): club amount + cadence, per-user exemption flag,
-- per-user per-period collection rows. club_id denormalized on the payments
-- table for RLS (booking_participants pattern); fee config lives on clubs
-- (nullable amount = feature off), toggles on app_settings.
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "fee_cents" integer;--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "fee_cadence" text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "fee_exempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "notify_fee_overdue" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "fee_block_booking" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fee_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "club_id" uuid NOT NULL REFERENCES "clubs"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "period_start" date NOT NULL,
  "note" varchar(200),
  "collected_at" timestamp with time zone NOT NULL DEFAULT now(),
  "collected_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "fee_payments_user_period_unique" UNIQUE ("user_id", "period_start")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fee_payments_club_idx" ON "fee_payments" ("club_id");--> statement-breakpoint
ALTER TABLE "fee_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "fee_payments_tenant_isolation" ON "fee_payments";--> statement-breakpoint
CREATE POLICY "fee_payments_tenant_isolation" ON "fee_payments" FOR ALL
  USING (("club_id" = NULLIF(current_setting('app.club_id', true), '')::uuid) OR (current_setting('app.superadmin', true) = '1'));
