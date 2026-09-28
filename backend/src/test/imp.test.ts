import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanSlate, buildTestApp, authHeaders, testDb, loginSuperadmin } from "./helpers.js";
import { users, impersonationGrants } from "../db/schema.js";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

describe("impersonation grants", () => {
  cleanSlate();
  let app: any;
  let boss: any;
  beforeAll(async () => { app = await buildTestApp(); });
  beforeEach(async () => {
    const { db, pool } = await testDb();
    await db.insert(users).values({
      clubId: null as any, username: "boss", email: "boss@t.local",
      passwordHash: await bcrypt.hash("Test1234!", 10),
      firstName: "B", lastName: "O", role: "superadmin", isVerified: true,
    }).onConflictDoNothing();
    await pool.end();
    boss = await loginSuperadmin(app, "boss@t.local");
  });
  afterAll(async () => { await app.close(); });
  const H = () => authHeaders(boss.token);

  it("superadmin has no implicit club access", async () => {
    const r = await app.inject({ method: "GET", url: "/api/users?slug=green-village", headers: H() });
    expect(r.statusCode).toBe(403);
  });

  it("grant issues an admin token that opens the club", async () => {
    const g = await app.inject({ method: "POST", url: "/api/platform/clubs/green-village/grant", headers: H() });
    expect(g.statusCode).toBe(201);
    expect(g.json().token).toBeTruthy();
    const courts = await app.inject({
      method: "GET", url: "/api/users?slug=green-village",
      headers: { Authorization: `Bearer ${g.json().token}`, "X-Club-Slug": "green-village" },
    });
    expect(courts.statusCode).toBe(200);
  });

  it("/me returns the club-admin persona for a live grant (never the superadmin row)", async () => {
    const g = await app.inject({ method: "POST", url: "/api/platform/clubs/green-village/grant", headers: H() });
    const me = await app.inject({
      method: "GET", url: "/api/users/me",
      headers: { Authorization: `Bearer ${g.json().token}`, "X-Club-Slug": "green-village" },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ role: "admin", club_slug: "green-village", imp: true });
  });

  it("second grant revokes the first; explicit revoke ends the session", async () => {
    const g1 = (await app.inject({ method: "POST", url: "/api/platform/clubs/green-village/grant", headers: H() })).json();
    const g2 = (await app.inject({ method: "POST", url: "/api/platform/clubs/green-village/grant", headers: H() })).json();
    const stale = await app.inject({
      method: "GET", url: "/api/users?slug=green-village",
      headers: { Authorization: `Bearer ${g1.token}`, "X-Club-Slug": "green-village" },
    });
    expect(stale.statusCode).toBe(403);
    const live = await app.inject({
      method: "GET", url: "/api/users?slug=green-village",
      headers: { Authorization: `Bearer ${g2.token}`, "X-Club-Slug": "green-village" },
    });
    expect(live.statusCode).toBe(200);
    const rev = await app.inject({ method: "DELETE", url: "/api/platform/clubs/green-village/grant", headers: H() });
    expect(rev.statusCode).toBe(200);
    const dead = await app.inject({
      method: "GET", url: "/api/users?slug=green-village",
      headers: { Authorization: `Bearer ${g2.token}`, "X-Club-Slug": "green-village" },
    });
    expect(dead.statusCode).toBe(403);
  });

  it("expired grants are rejected", async () => {
    const g = (await app.inject({ method: "POST", url: "/api/platform/clubs/green-village/grant", headers: H() })).json();
    const { db, pool } = await testDb();
    const rows = await db.select().from(impersonationGrants);
    await db.update(impersonationGrants).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(impersonationGrants.id, rows[0].id));
    await pool.end();
    const r = await app.inject({
      method: "GET", url: "/api/users?slug=green-village",
      headers: { Authorization: `Bearer ${g.token}`, "X-Club-Slug": "green-village" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("grant creation is audited with its club", async () => {
    await app.inject({ method: "POST", url: "/api/platform/clubs/green-village/grant", headers: H() });
    const audit = await app.inject({ method: "GET", url: "/api/platform/audit", headers: H() });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().total).toBeGreaterThan(0);
    const grants = (audit.json().rows as any[]).filter((a: any) => a.action === "platform.impersonate.grant");
    expect(grants.length).toBeGreaterThan(0);
    expect(grants[0].club_slug).toBe("green-village");
  });

  it("audit supports club + time filters and paging", async () => {
    await app.inject({ method: "POST", url: "/api/platform/clubs/green-village/grant", headers: H() });
    const filtered = await app.inject({ method: "GET", url: "/api/platform/audit?club=green-village&limit=1&offset=0", headers: H() });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().rows.length).toBeLessThanOrEqual(1);
    expect(filtered.json().rows.every((a: any) => a.club_slug === "green-village")).toBe(true);
    const empty = await app.inject({ method: "GET", url: "/api/platform/audit?club=no-such-club", headers: H() });
    expect(empty.json()).toMatchObject({ rows: [], total: 0 });
    const dated = await app.inject({ method: "GET", url: "/api/platform/audit?from=2000-01-01&to=2000-01-02", headers: H() });
    expect(dated.json()).toMatchObject({ rows: [], total: 0 });
  });
});
