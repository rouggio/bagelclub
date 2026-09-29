-- Notifications v2 (#23a–e): reachability x subscription x policy.
-- Send iff admin policy AND recipient subscription AND channel connected.
-- Policy moves from app_settings columns to notify_policy (per club x event);
-- per-user per-event push prefs move to notify_event_prefs (email locked ON).
-- Backfill preserves current behaviour: request alerts on, auto off,
-- user decisions on; untouched clubs keep defaults via table defaults.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notify_push_master" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notify_policy" (
  "club_id" uuid NOT NULL REFERENCES "clubs"("id") ON DELETE CASCADE,
  "event" varchar(20) NOT NULL,
  "to_users_email" boolean DEFAULT true NOT NULL,
  "to_users_push" boolean DEFAULT true NOT NULL,
  "to_admins_email" boolean DEFAULT true NOT NULL,
  "to_admins_push" boolean DEFAULT true NOT NULL,
  CONSTRAINT "notify_policy_pkey" PRIMARY KEY ("club_id", "event")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notify_event_prefs" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "club_id" uuid NOT NULL REFERENCES "clubs"("id") ON DELETE CASCADE,
  "event" varchar(20) NOT NULL,
  "push" boolean DEFAULT true NOT NULL,
  CONSTRAINT "notify_event_prefs_pkey" PRIMARY KEY ("user_id", "event")
);--> statement-breakpoint
INSERT INTO "notify_policy" ("club_id", "event", "to_users_email", "to_users_push", "to_admins_email", "to_admins_push")
SELECT "club_id", 'request', false, false, COALESCE("notify_request_email", true), COALESCE("notify_request_push", true) FROM "app_settings"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "notify_policy" ("club_id", "event", "to_users_email", "to_users_push", "to_admins_email", "to_admins_push")
SELECT "club_id", 'auto', COALESCE("notify_approval_email", true), COALESCE("notify_approval_push", true), COALESCE("notify_auto_email", false), COALESCE("notify_auto_push", false) FROM "app_settings"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "notify_policy" ("club_id", "event", "to_users_email", "to_users_push", "to_admins_email", "to_admins_push")
SELECT "club_id", 'approval', COALESCE("notify_approval_email", true), COALESCE("notify_approval_push", true), false, false FROM "app_settings"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "notify_policy" ("club_id", "event", "to_users_email", "to_users_push", "to_admins_email", "to_admins_push")
SELECT "club_id", 'rejection', COALESCE("notify_rejection_email", true), COALESCE("notify_rejection_push", true), false, false FROM "app_settings"
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "notify_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "notify_policy_tenant_isolation" ON "notify_policy";--> statement-breakpoint
CREATE POLICY "notify_policy_tenant_isolation" ON "notify_policy" FOR ALL
  USING ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1')
  WITH CHECK ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1');--> statement-breakpoint
ALTER TABLE "notify_event_prefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "notify_event_prefs_tenant_isolation" ON "notify_event_prefs";--> statement-breakpoint
CREATE POLICY "notify_event_prefs_tenant_isolation" ON "notify_event_prefs" FOR ALL
  USING ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1')
  WITH CHECK ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1');--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "notifications_enabled";--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "notify_on_auto_approved";--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "notify_on_approval";--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "notify_on_rejection";--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "notify_via_telegram";--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "notify_via_whatsapp";--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "notify_via_email";--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "notify_request_email";--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "notify_request_push";--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "notify_auto_email";--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "notify_auto_push";--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "notify_approval_email";--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "notify_approval_push";--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "notify_rejection_email";--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "notify_rejection_push";
