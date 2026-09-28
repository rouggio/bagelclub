-- Club-admin 2FA: per-club opt-in (off by default), activation only after a
-- verified delivery proof. Challenge purposes separate login/activation/contact.
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "two_fa_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "login_challenges" ADD COLUMN IF NOT EXISTS "purpose" varchar(20) DEFAULT 'login' NOT NULL;
