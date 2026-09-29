-- Drop the visitor role: every club member is an associate (or admin).
-- Existing visitors are remapped, then the enum label is removed.
UPDATE "users" SET "role" = 'associate' WHERE "role" = 'visitor';--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'visitor'
  ) THEN
    CREATE TYPE user_role_new AS ENUM('associate', 'admin', 'superadmin');
    ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
    ALTER TABLE "users" ALTER COLUMN "role" TYPE user_role_new USING "role"::text::user_role_new;
    DROP TYPE "user_role";
    ALTER TYPE user_role_new RENAME TO "user_role";
    ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'associate'::"user_role";
  END IF;
END $$;
