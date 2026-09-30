-- Feature requests (#30): shared cross-club board, club admins → platform.
-- No RLS by design: rows are visible across clubs (anonymized for club
-- admins, full origin for superadmin). Anonymity + scoping are enforced in
-- code — mirrors platform tables (platform_settings, ip_blocks).
-- Requests are stored as-written (no translations); status transitions are
-- validated in Zod, not a PG type.
CREATE TABLE IF NOT EXISTS "feature_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "club_id" uuid NOT NULL REFERENCES "clubs"("id") ON DELETE CASCADE,
  "author_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "title" varchar(200) NOT NULL,
  "body" text NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'open',
  "reply" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feature_request_votes" (
  "request_id" uuid NOT NULL REFERENCES "feature_requests"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "club_id" uuid NOT NULL REFERENCES "clubs"("id") ON DELETE CASCADE,
  CONSTRAINT "feature_request_votes_pkey" PRIMARY KEY ("request_id", "user_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feature_requests_club_idx" ON "feature_requests" ("club_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feature_request_votes_request_idx" ON "feature_request_votes" ("request_id");
