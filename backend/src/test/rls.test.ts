import { describe, it, expect } from "vitest";
import pg from "pg";
import { cleanSlate, testDb, seedClub } from "./helpers.js";
import { TEST_APP_URL } from "./global-setup.js";

/**
 * Phase 4 RLS, tested as the least-privilege app role (non-owner):
 * - no GUC → tenant tables deny everything (fail-closed)
 * - app.club_id set → own club only, cross-club writes blocked
 * - app.superadmin set → everything visible
 * - clubs registry stays publicly readable; demo inserts allowed
 */
async function asApp(fn: (q: (text: string, params?: any[]) => Promise<any>) => Promise<void>) {
  const client = new pg.Client({ connectionString: TEST_APP_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await fn(client.query.bind(client));
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
}

describe("rls (non-owner role)", () => {
  cleanSlate();

  it("denies tenant reads with no GUC (fail-closed)", async () => {
    const { db, pool } = await testDb();
    await seedClub(db, "beta", "Beta", "Europe/Rome");
    await pool.end();
    await asApp(async (q) => {
      for (const t of ["users", "courts", "bookings", "app_settings"]) {
        const r = await q(`SELECT count(*)::int AS n FROM ${t}`);
        expect(r.rows[0].n).toBe(0);
      }
    });
  });

  it("scopes reads and writes to app.club_id", async () => {
    const { db, pool } = await testDb();
    const betaId: string = await seedClub(db, "beta", "Beta", "Europe/Rome");
    const gId: string = (await pool.query("SELECT id FROM clubs WHERE slug='green-village'")).rows[0].id;
    await pool.end();
    await asApp(async (q) => {
      await q(`SET LOCAL app.club_id = '${gId}'`);
      const u = await q("SELECT username, club_id FROM users");
      expect(u.rows.length).toBeGreaterThan(0);
      expect(new Set(u.rows.map((r: any) => r.club_id)).size).toBe(1);
      // Cross-club write blocked (savepoint keeps the txn usable)…
      await q("SAVEPOINT s1");
      await expect(q("INSERT INTO courts (club_id, number, type) VALUES ($1, 99, 'tennis')", [betaId])).rejects.toThrow();
      await q("ROLLBACK TO SAVEPOINT s1");
      // …own-club write allowed (rolled back afterwards).
      await q("INSERT INTO courts (club_id, number, type) VALUES ($1, 99, 'tennis')", [gId]);
    });
  });

  it("superadmin flag sees everything", async () => {
    await asApp(async (q) => {
      await q("SET LOCAL app.superadmin = '1'");
      const u = await q("SELECT count(*)::int AS n FROM users");
      expect(u.rows[0].n).toBeGreaterThan(0);
    });
  });

  it("clubs registry stays publicly readable; demo inserts allowed", async () => {
    await asApp(async (q) => {
      const c = await q("SELECT slug FROM clubs");
      expect(c.rows.length).toBeGreaterThan(0);
      await q("INSERT INTO clubs (slug, name, timezone, is_demo) VALUES ('demo-rls', 'RLS', 'Europe/Rome', true)");
      await expect(q("INSERT INTO clubs (slug, name, timezone) VALUES ('evil', 'Evil', 'Europe/Rome')")).rejects.toThrow();
    });
  });

  it("global timetable rows readable with club set, cross-club court rows hidden", async () => {
    const { db, pool } = await testDb();
    await seedClub(db, "beta", "Beta", "Europe/Rome");
    const gId: string = (await pool.query("SELECT id FROM clubs WHERE slug='green-village'")).rows[0].id;
    const betaCourts: any[] = (await pool.query("SELECT id FROM courts WHERE club_id <> $1", [gId])).rows;
    await pool.query("INSERT INTO timetables (court_id, day_of_week) VALUES (NULL, 0)").catch(() => {});
    await pool.end();
    await asApp(async (q) => {
      await q(`SET LOCAL app.club_id = '${gId}'`);
      const t = await q("SELECT * FROM timetables");
      const rows = t.rows as any[];
      expect(rows.length).toBeGreaterThan(0);
      // Legacy global defaults visible…
      expect(rows.some((r: any) => r.court_id === null)).toBe(true);
      // …but no timetable of another club's courts leaks in.
      expect(rows.some((r: any) => betaCourts.some((c: any) => String(c.id) === String(r.court_id)))).toBe(false);
    });
  });
});
