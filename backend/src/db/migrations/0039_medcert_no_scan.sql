-- Medical certificates (#33) follow-up: scans dropped, expiry date only.
ALTER TABLE "users" DROP COLUMN IF EXISTS "medical_cert_scan";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "medical_cert_mime";
