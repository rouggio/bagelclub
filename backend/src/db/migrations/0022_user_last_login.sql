-- Last-login tracking: true activity signal for idle detection (demo hygiene).
-- Nullable: unknown until the first login after this migration.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamptz;
