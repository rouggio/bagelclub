-- Notifications per channel (#23): email channel + admin/user prefs split.
-- Per-user channel opt-outs live on users (default on = current behaviour).
-- (The interim notify_admin_on_request flag was superseded by the 0029 matrix
-- before ever shipping; 0029 drops it if present.)
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "notify_via_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "notify_email_sender" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notify_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notify_whatsapp" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notify_telegram" boolean DEFAULT true NOT NULL;
