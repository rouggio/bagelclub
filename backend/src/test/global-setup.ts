import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://postgres:postgres@localhost:5432/empanadel_test";

export async function ensureTestDatabase() {
  const admin = new pg.Client({ connectionString: "postgres://postgres:postgres@localhost:5432/postgres" });
  await admin.connect();
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'empanadel_test' AND pid <> pg_backend_pid()");
  await admin.query("CREATE DATABASE empanadel_test").catch((e: any) => {
    if (!String(e.message).includes("already exists")) throw e;
  });
  await admin.end();
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: path.join(__dirname, "../db/migrations") });
  await pool.end();
}

export default async function globalSetup() {
  await ensureTestDatabase();
}
