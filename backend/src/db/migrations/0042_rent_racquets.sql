-- Per-club toggle for the racquet-rental picker (default on = current behaviour).
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "show_rent_racquets" boolean DEFAULT true NOT NULL;
