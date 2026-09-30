-- Explicit participant lists (#26): per-club require toggle + identities.
-- Off by default = current behaviour (count-only players field).
-- club_id denormalized on the join table for RLS (notify_event_prefs pattern).
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "require_participant_list" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_participants" (
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "club_id" uuid NOT NULL REFERENCES "clubs"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "booking_participants_pkey" PRIMARY KEY ("booking_id", "user_id")
);--> statement-breakpoint
ALTER TABLE "booking_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "booking_participants_tenant_isolation" ON "booking_participants";--> statement-breakpoint
CREATE POLICY "booking_participants_tenant_isolation" ON "booking_participants" FOR ALL
  USING ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1')
  WITH CHECK ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1');
