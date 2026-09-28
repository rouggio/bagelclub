-- Impersonation grants: a superadmin may act as a club admin for one club in a
-- brief time-boxed session. No RLS (platform-issued, superadmin-checked in
-- code like ip_blocks/platform_settings).
CREATE TABLE IF NOT EXISTS "club_impersonation_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "club_id" uuid NOT NULL REFERENCES "clubs"("id") ON DELETE CASCADE,
  "superadmin_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "club_grants_lookup_idx" ON "club_impersonation_grants" USING btree ("superadmin_id","club_id","expires_at");
