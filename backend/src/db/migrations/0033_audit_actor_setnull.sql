-- Audit actor survivability (#30 follow-up): club-side audit rows reference
-- club users (admins), which pinned those rows against hard deletes (test
-- cleanups, platform club wipe). History must survive the actor: SET NULL
-- instead, like announcements.created_by. The audit UI already renders null
-- actors.
ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_actor_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL;
