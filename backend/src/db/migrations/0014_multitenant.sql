DO $$ BEGIN
  CREATE TYPE "club_plan" AS ENUM('free', 'starter', 'pro');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'superadmin'
  ) THEN
    CREATE TYPE user_role_new AS ENUM('visitor', 'associate', 'admin', 'superadmin');
    ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
    ALTER TABLE "users" ALTER COLUMN "role" TYPE user_role_new USING "role"::text::user_role_new;
    DROP TYPE "user_role";
    ALTER TYPE user_role_new RENAME TO "user_role";
    ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'visitor'::"user_role";
  END IF;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clubs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" varchar(50) NOT NULL,
  "name" varchar(100) NOT NULL,
  "timezone" varchar(50) NOT NULL,
  "plan" "club_plan" DEFAULT 'starter' NOT NULL,
  "currency" char(3) DEFAULT 'EUR' NOT NULL,
  "trial_ends_at" timestamptz,
  "is_active" boolean DEFAULT true NOT NULL,
  "max_courts" integer,
  "is_demo" boolean DEFAULT false NOT NULL,
  "demo_expires_at" timestamptz,
  "is_listed" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "clubs_slug_unique" UNIQUE("slug"),
  CONSTRAINT "clubs_slug_format" CHECK ("slug" ~ '^[a-z0-9-]{3,50}$')
);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "club_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "courts" ADD COLUMN IF NOT EXISTS "club_id" uuid;--> statement-breakpoint
ALTER TABLE "courts" ADD COLUMN IF NOT EXISTS "base_price_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "club_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "price_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN IF NOT EXISTS "club_id" uuid;--> statement-breakpoint
ALTER TABLE "blocking_rules" ADD COLUMN IF NOT EXISTS "club_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "club_id" uuid;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "club_id" uuid;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD COLUMN IF NOT EXISTS "club_id" uuid;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "club_id" uuid;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "enabled_locales" text[] DEFAULT ARRAY['it','en','fr','de','es'] NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "default_locale" varchar(5) DEFAULT 'it' NOT NULL;--> statement-breakpoint
INSERT INTO "clubs" ("slug", "name", "timezone")
SELECT 'green-village', COALESCE("club_name", 'Green Village'), 'Europe/Rome'
FROM "app_settings" WHERE "id" = 1
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
INSERT INTO "clubs" ("slug", "name", "timezone")
SELECT 'green-village', 'Green Village', 'Europe/Rome'
WHERE NOT EXISTS (SELECT 1 FROM "clubs" WHERE "slug" = 'green-village');--> statement-breakpoint
UPDATE "users" SET "club_id" = (SELECT "id" FROM "clubs" WHERE "slug" = 'green-village') WHERE "club_id" IS NULL;--> statement-breakpoint
UPDATE "courts" SET "club_id" = (SELECT "id" FROM "clubs" WHERE "slug" = 'green-village') WHERE "club_id" IS NULL;--> statement-breakpoint
UPDATE "bookings" SET "club_id" = (SELECT "id" FROM "clubs" WHERE "slug" = 'green-village') WHERE "club_id" IS NULL;--> statement-breakpoint
UPDATE "blocks" SET "club_id" = (SELECT "id" FROM "clubs" WHERE "slug" = 'green-village') WHERE "club_id" IS NULL;--> statement-breakpoint
UPDATE "blocking_rules" SET "club_id" = (SELECT "id" FROM "clubs" WHERE "slug" = 'green-village') WHERE "club_id" IS NULL;--> statement-breakpoint
UPDATE "audit_log" SET "club_id" = (SELECT "id" FROM "clubs" WHERE "slug" = 'green-village') WHERE "club_id" IS NULL;--> statement-breakpoint
UPDATE "announcements" SET "club_id" = (SELECT "id" FROM "clubs" WHERE "slug" = 'green-village') WHERE "club_id" IS NULL;--> statement-breakpoint
UPDATE "telegram_link_tokens" SET "club_id" = (SELECT "user_club"."club_id" FROM "users" AS "user_club" WHERE "user_club"."id" = "telegram_link_tokens"."user_id") WHERE "club_id" IS NULL;--> statement-breakpoint
UPDATE "app_settings" SET "club_id" = (SELECT "id" FROM "clubs" WHERE "slug" = 'green-village') WHERE "club_id" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "club_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "courts" ALTER COLUMN "club_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "club_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "blocks" ALTER COLUMN "club_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "blocking_rules" ALTER COLUMN "club_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ALTER COLUMN "club_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ALTER COLUMN "club_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "club_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" DROP CONSTRAINT IF EXISTS "app_settings_pkey";--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "id";--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY("club_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_username_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_unique";--> statement-breakpoint
ALTER TABLE "courts" DROP CONSTRAINT IF EXISTS "courts_number_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_club_username_active" ON "users" USING btree ("club_id","username") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_club_email_active" ON "users" USING btree ("club_id","email") WHERE "deleted_at" IS NULL AND "email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_club_username_idx" ON "users" USING btree ("club_id","username");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_club_email_idx" ON "users" USING btree ("club_id","email");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "courts" ADD CONSTRAINT "courts_club_number_unique" UNIQUE("club_id","number");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "courts" ADD CONSTRAINT "courts_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "blocks" ADD CONSTRAINT "blocks_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "blocking_rules" ADD CONSTRAINT "blocking_rules_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "announcements" ADD CONSTRAINT "announcements_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
