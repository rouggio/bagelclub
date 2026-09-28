-- Phase 4: row-level security as second layer behind app-level scoping.
--
-- Enforcement model (see MULTITENANT.md Phase 4):
--   - Runtime connects as a NON-OWNER app role (see runbook: roles/rls-runbook.md).
--     Table owners (migrations, seeds, dashboard) bypass RLS by design (no FORCE).
--   - Each request sets app.club_id (tenant) or app.superadmin=1 (platform) via
--     SET LOCAL inside a per-request transaction (services/club.ts attach).
--   - Trust-root exceptions use the owner pool explicitly and are reviewed:
--     auth login/register/refresh, telegram webhook token bootstrap,
--     public directory (/api/clubs), demo provisioning (demo-only rows, asserted).
--
-- With no GUC set, tenant tables deny everything (fail-closed).

-- ============ tenant tables (have club_id) ============
DO $$ BEGIN
  ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "users_tenant_isolation" ON "users";
  CREATE POLICY "users_tenant_isolation" ON "users" FOR ALL
    USING ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1')
    WITH CHECK ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1');

  ALTER TABLE "courts" ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "courts_tenant_isolation" ON "courts";
  CREATE POLICY "courts_tenant_isolation" ON "courts" FOR ALL
    USING ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1')
    WITH CHECK ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1');

  ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "bookings_tenant_isolation" ON "bookings";
  CREATE POLICY "bookings_tenant_isolation" ON "bookings" FOR ALL
    USING ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1')
    WITH CHECK ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1');

  ALTER TABLE "blocks" ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "blocks_tenant_isolation" ON "blocks";
  CREATE POLICY "blocks_tenant_isolation" ON "blocks" FOR ALL
    USING ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1')
    WITH CHECK ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1');

  ALTER TABLE "blocking_rules" ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "blocking_rules_tenant_isolation" ON "blocking_rules";
  CREATE POLICY "blocking_rules_tenant_isolation" ON "blocking_rules" FOR ALL
    USING ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1')
    WITH CHECK ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1');

  ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "app_settings_tenant_isolation" ON "app_settings";
  CREATE POLICY "app_settings_tenant_isolation" ON "app_settings" FOR ALL
    USING ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1')
    WITH CHECK ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1');

  ALTER TABLE "announcements" ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "announcements_tenant_isolation" ON "announcements";
  CREATE POLICY "announcements_tenant_isolation" ON "announcements" FOR ALL
    USING ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1')
    WITH CHECK ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1');

  ALTER TABLE "telegram_link_tokens" ENABLE ROW LEVEL SECURITY;
END $$;--> statement-breakpoint
DROP POLICY IF EXISTS "telegram_link_tokens_tenant_isolation" ON "telegram_link_tokens";--> statement-breakpoint
CREATE POLICY "telegram_link_tokens_tenant_isolation" ON "telegram_link_tokens" FOR ALL
  USING ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1')
  WITH CHECK ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1');--> statement-breakpoint
-- audit_log: club nullable (platform rows have NULL) — NULL rows visible to superadmin only.
DO $$ BEGIN
  ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "audit_log_tenant_isolation" ON "audit_log";
  CREATE POLICY "audit_log_tenant_isolation" ON "audit_log" FOR ALL
    USING ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1')
    WITH CHECK ("club_id"::text = current_setting('app.club_id', true) OR current_setting('app.superadmin', true) = '1');
END $$;--> statement-breakpoint
-- timetables inherit scope via courts; legacy court-less (global) rows stay
-- readable as shared defaults but are no longer writable (code forbids too).
DO $$ BEGIN
  ALTER TABLE "timetables" ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "timetables_scope_via_court" ON "timetables";
  CREATE POLICY "timetables_scope_via_court" ON "timetables" FOR ALL
    USING (
      current_setting('app.superadmin', true) = '1'
      OR ("court_id" IS NULL AND current_setting('app.club_id', true) <> '')
      OR EXISTS (
        SELECT 1 FROM "courts"
        WHERE "courts"."id" = "timetables"."court_id"
        AND "courts"."club_id"::text = current_setting('app.club_id', true)
      )
    )
    WITH CHECK (
      current_setting('app.superadmin', true) = '1'
      OR EXISTS (
        SELECT 1 FROM "courts"
        WHERE "courts"."id" = "timetables"."court_id"
        AND "courts"."club_id"::text = current_setting('app.club_id', true)
      )
    );
END $$;--> statement-breakpoint
-- announcement_translations inherit scope via the parent announcement.
DO $$ BEGIN
  ALTER TABLE "announcement_translations" ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "announcement_translations_scope_via_parent" ON "announcement_translations";
  CREATE POLICY "announcement_translations_scope_via_parent" ON "announcement_translations" FOR ALL
    USING (
      current_setting('app.superadmin', true) = '1'
      OR EXISTS (
        SELECT 1 FROM "announcements"
        WHERE "announcements"."id" = "announcement_translations"."announcement_id"
        AND "announcements"."club_id"::text = current_setting('app.club_id', true)
      )
    )
    WITH CHECK (
      current_setting('app.superadmin', true) = '1'
      OR EXISTS (
        SELECT 1 FROM "announcements"
        WHERE "announcements"."id" = "announcement_translations"."announcement_id"
        AND "announcements"."club_id"::text = current_setting('app.club_id', true)
      )
    );
END $$;--> statement-breakpoint
-- clubs registry: public readable (directory), writes superadmin-only,
-- except demo provisioning which may insert demo clubs.
DO $$ BEGIN
  ALTER TABLE "clubs" ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "clubs_public_read" ON "clubs";
  CREATE POLICY "clubs_public_read" ON "clubs" FOR SELECT USING (true);
  DROP POLICY IF EXISTS "clubs_write_platform" ON "clubs";
  CREATE POLICY "clubs_write_platform" ON "clubs" FOR UPDATE
    USING (current_setting('app.superadmin', true) = '1')
    WITH CHECK (current_setting('app.superadmin', true) = '1');
  DROP POLICY IF EXISTS "clubs_delete_platform" ON "clubs";
  CREATE POLICY "clubs_delete_platform" ON "clubs" FOR DELETE
    USING (current_setting('app.superadmin', true) = '1');
  DROP POLICY IF EXISTS "clubs_insert_platform_or_demo" ON "clubs";
  CREATE POLICY "clubs_insert_platform_or_demo" ON "clubs" FOR INSERT
    WITH CHECK ("is_demo" = true OR current_setting('app.superadmin', true) = '1');
END $$;
