-- Show booking participant usernames as a tooltip on availability cells (#36).
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "show_participant_names" boolean DEFAULT false NOT NULL;
