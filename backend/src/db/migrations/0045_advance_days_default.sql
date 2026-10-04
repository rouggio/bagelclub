-- Default booking horizon is now 21 days (was 14). Existing rows keep their
-- stored value; clubs change it from Admin → Parametri.
ALTER TABLE "app_settings" ALTER COLUMN "max_advance_days" SET DEFAULT 21;
