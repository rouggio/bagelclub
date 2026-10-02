-- Slot time display format per club (#36 follow-up UI pref): start only,
-- start + duration, or start-end range. Pure display, defaults to range.
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "slot_time_format" text DEFAULT 'start_end' NOT NULL;
