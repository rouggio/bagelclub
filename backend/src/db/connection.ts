import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  // Marker: this drizzle wraps a pool (RLS-scoped helpers may check out
  // per-request clients from it). Transaction clients lack the marker.
  (db as any).__isPool = true;
  (db as any).__pool = pool;
  return { db, pool };
}

export type Db = ReturnType<typeof createDb>["db"];
