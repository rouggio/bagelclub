import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const url = process.env.OWNER_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("OWNER_DATABASE_URL (or DATABASE_URL) not set");
  process.exit(1);
}

// NOTE: this must run as a DDL-capable (owner) role. The restricted app role
// cannot CREATE/ALTER, and IF NOT EXISTS silently succeeds while doing
// nothing — so a boot under the app role would report success on a
// half-migrated DB (prod incident 2026-09-28: missing login_challenges).
// The post-migrate verification below fails the deploy loudly instead.

const pool = new pg.Pool({ connectionString: url });
const db = drizzle(pool);

let migrateHost = "?";
try { migrateHost = new URL(url).host; } catch {}
console.log(`Migrating database at ${migrateHost} ...`);

await migrate(db, { migrationsFolder: path.join(__dirname, "./migrations") });
console.log("Migrations complete");

// Post-migrate self-verify: every relation/column the current code requires
// must exist, or the deploy must go red (never boot half-migrated).
const requiredTables = ["users", "clubs", "audit_log", "club_impersonation_grants", "login_challenges", "timetable_windows"];
const requiredColumns: Array<[string, string]> = [
  ["login_challenges", "purpose"],
  ["app_settings", "two_fa_enabled"],
  ["app_settings", "flexible_slots"],
  ["timetable_windows", "price_cents"],
  ["users", "last_login_at"],
];
const missing: string[] = [];
for (const t of requiredTables) {
  const r: any = await db.execute(sql`SELECT to_regclass(${`public.${t}`}) AS r`);
  if (!r?.rows?.[0]?.r) missing.push(`table public.${t}`);
}
for (const [t, c] of requiredColumns) {
  const r: any = await db.execute(
    sql`SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${t} AND column_name = ${c}`
  );
  if (!r?.rows?.[0]?.ok) missing.push(`column public.${t}.${c}`);
}
await pool.end();
if (missing.length) {
  console.error(`MIGRATION VERIFY FAILED [${migrateHost}] — missing: ${missing.join(", ")}. Run migrations as a DDL-capable owner role.`);
  process.exit(1);
}
console.log(`Migration verify ok [${migrateHost}]`);
