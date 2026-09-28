-- Platform-level settings (maintained by superadmin). The product has ONE
-- website for all clubs, so the base URL lives here — not per club.
CREATE TABLE IF NOT EXISTS "platform_settings" (
  "key" varchar(50) PRIMARY KEY,
  "value" text,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "platform_settings" ("key", "value") VALUES ('base_url', '') ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Per-club public_url is dead: drop it.
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "public_url";
