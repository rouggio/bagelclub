-- Admin-managed accounts (#25): clubs can close public registration.
-- Open by default = current behaviour.
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "allow_open_signup" boolean DEFAULT true NOT NULL;
