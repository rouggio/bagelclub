-- Per-club toggle for the single/double (player count) selector (default on = current behaviour).
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "show_player_count" boolean DEFAULT true NOT NULL;
