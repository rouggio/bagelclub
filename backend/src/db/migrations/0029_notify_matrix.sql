-- Notifications matrix (#23 reshape): per-event email/push prefs.
-- Replaces the interim notify_admin_on_request single flag (never shipped).
-- Existing per-event choices are carried over; untouched clubs keep defaults
-- (request on, auto off, decisions on).
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "notify_admin_on_request";--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "notify_request_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "notify_request_push" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "notify_auto_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "notify_auto_push" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "notify_approval_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "notify_approval_push" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "notify_rejection_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "notify_rejection_push" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "app_settings" SET "notify_approval_email" = "notify_on_approval", "notify_approval_push" = "notify_on_approval";--> statement-breakpoint
UPDATE "app_settings" SET "notify_rejection_email" = "notify_on_rejection", "notify_rejection_push" = "notify_on_rejection";--> statement-breakpoint
UPDATE "app_settings" SET "notify_auto_email" = "notify_on_auto_approved", "notify_auto_push" = "notify_on_auto_approved";
