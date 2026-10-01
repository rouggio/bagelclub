-- Audit club survivability (#30 follow-up): same pin as 0033 but on clubs —
-- audit rows carry the club, blocking platform club deletion. SET NULL
-- instead; NULL-club rows stay superadmin-visible per the 0016 policy.
ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_club_id_clubs_id_fk";--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE SET NULL;
