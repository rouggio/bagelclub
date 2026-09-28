-- Superadmin 2FA login challenges (Telegram OTP, single-use, short-lived).
CREATE TABLE IF NOT EXISTS "login_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "code_hash" varchar(64) NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "login_challenges_user_idx" ON "login_challenges" USING btree ("user_id");
DELETE FROM "login_challenges" WHERE "expires_at" < now() - interval '1 day';
