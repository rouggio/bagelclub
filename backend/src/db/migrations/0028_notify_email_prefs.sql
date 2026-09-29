-- Notifications per channel (#23): email channel + admin/user prefs split.
-- Admin events: notify_admin_on_request (pending approvals ping admins).
-- User events keep existing notify_on_approval / notify_on_rejection flags.
-- Per-user channel opt-outs live on users (default on = current behaviour).
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "notify_admin_on_request" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "notify_via_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "notify_email_sender" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notify_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notify_whatsapp" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notify_telegram" boolean DEFAULT true NOT NULL;
