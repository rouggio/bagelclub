-- Booking manager role (#35): staff that can only approve/reject bookings.
-- Nothing else changes: every other endpoint stays admin-only, so the grant
-- is exactly the moderation queue + the two decision endpoints.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'manager'
  ) THEN
    CREATE TYPE user_role_new AS ENUM('associate', 'manager', 'admin', 'superadmin');
    ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
    ALTER TABLE "users" ALTER COLUMN "role" TYPE user_role_new USING "role"::text::user_role_new;
    DROP TYPE "user_role";
    ALTER TYPE user_role_new RENAME TO "user_role";
    ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'associate'::"user_role";
  END IF;
END $$;
