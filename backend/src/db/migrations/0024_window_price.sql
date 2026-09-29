-- Per-window pricing (#29, pulled into #24): price lives on the slot window.
-- NULL means "inherit the court base price".
ALTER TABLE "timetable_windows" ADD COLUMN IF NOT EXISTS "price_cents" integer;
