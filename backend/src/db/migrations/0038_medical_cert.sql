-- Medical certificates (#33): per-player expiry + scanned document (base64),
-- verified-by stamp; club opt-in toggle on app_settings (default off).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "medical_cert_expires_at" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "medical_cert_scan" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "medical_cert_mime" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "medical_cert_verified_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "medical_cert_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "require_medical_cert" boolean DEFAULT false NOT NULL;
