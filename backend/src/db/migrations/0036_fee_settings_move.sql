-- Associate fees (#32) follow-up: fee amount + cadence belong on
-- app_settings (club-editable like every other toggle). The clubs table only
-- allows superadmin writes, so club-scoped PUTs there silently no-op.
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "fee_cents" integer;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "fee_cadence" text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
UPDATE "app_settings" s SET "fee_cents" = c."fee_cents", "fee_cadence" = c."fee_cadence" FROM "clubs" c WHERE s."club_id" = c."id" AND c."fee_cents" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "clubs" DROP COLUMN IF EXISTS "fee_cents";--> statement-breakpoint
ALTER TABLE "clubs" DROP COLUMN IF EXISTS "fee_cadence";
