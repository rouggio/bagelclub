-- Abuse shield (#13): persistent IP blocks (in-memory windows feed this table).
-- Platform-only access via superadmin routes; no RLS (never tenant data).
CREATE TABLE IF NOT EXISTS "ip_blocks" (
  "ip" varchar(64) PRIMARY KEY,
  "reason" varchar(100) NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "ip_blocks_expires_idx" ON "ip_blocks" USING btree ("expires_at");
DELETE FROM "ip_blocks" WHERE "expires_at" < now();
