-- Flexible slot grids (#24): a day is an ordered list of open windows, so a
-- court can have midday breaks and per-window durations. Backfills one window
-- per legacy open row → identical grids until an admin edits.
CREATE TABLE IF NOT EXISTS "timetable_windows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "court_id" uuid NOT NULL REFERENCES "courts"("id") ON DELETE CASCADE,
  "day_of_week" smallint NOT NULL CHECK ("day_of_week" BETWEEN 0 AND 6),
  "open_time" time NOT NULL,
  "close_time" time NOT NULL,
  "slot_duration_minutes" integer NOT NULL DEFAULT 60,
  "position" integer NOT NULL DEFAULT 0,
  UNIQUE ("court_id", "day_of_week", "position")
);--> statement-breakpoint
INSERT INTO "timetable_windows" ("court_id", "day_of_week", "open_time", "close_time", "slot_duration_minutes", "position")
SELECT "court_id", "day_of_week", "open_time", "close_time", "slot_duration_minutes", 0
FROM "timetables"
WHERE "court_id" IS NOT NULL AND NOT "is_closed" AND "open_time" IS NOT NULL AND "close_time" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "timetable_windows" ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "timetable_windows_scope_via_court" ON "timetable_windows";
  CREATE POLICY "timetable_windows_scope_via_court" ON "timetable_windows" FOR ALL
    USING (
      current_setting('app.superadmin', true) = '1'
      OR EXISTS (
        SELECT 1 FROM "courts"
        WHERE "courts"."id" = "timetable_windows"."court_id"
        AND "courts"."club_id"::text = current_setting('app.club_id', true)
      )
    )
    WITH CHECK (
      current_setting('app.superadmin', true) = '1'
      OR EXISTS (
        SELECT 1 FROM "courts"
        WHERE "courts"."id" = "timetable_windows"."court_id"
        AND "courts"."club_id"::text = current_setting('app.club_id', true)
      )
    );
END $$;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "flexible_slots" boolean DEFAULT false NOT NULL;
