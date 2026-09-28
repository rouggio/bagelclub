import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
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

const pool = new pg.Pool({ connectionString: url });
const db = drizzle(pool);

await migrate(db, { migrationsFolder: path.join(__dirname, "./migrations") });
console.log("Migrations complete");
await pool.end();
