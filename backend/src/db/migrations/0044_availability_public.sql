-- Per-club availability visibility: public (default) or logged-in club members only.
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "availability_public" boolean DEFAULT true NOT NULL;
