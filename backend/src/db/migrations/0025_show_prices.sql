-- Club master switch for price display (default on = current behaviour).
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "show_prices" boolean DEFAULT true NOT NULL;
