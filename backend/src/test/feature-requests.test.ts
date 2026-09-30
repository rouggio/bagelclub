import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { cleanSlate, buildTestApp, loginAs, loginSuperadmin, authHeaders, testDb, seedClub } from "./helpers.js";
import { users } from "../db/schema.js";

const ADMIN_ANON_KEYS = ["id", "title", "body", "status", "reply", "votes", "mine", "voted", "created_at", "updated_at"];

async function seedBoss() {
  const { db, pool } = await testDb();
  await db.insert(users).values({
    clubId: null as any, username: "boss", email: "boss@t.local",
    passwordHash: await bcrypt.hash("Test1234!", 10),
    firstName: "B", lastName: "O", role: "superadmin", isVerified: true,
  }).onConflictDoNothing();
  await pool.end();
}

describe("feature requests #30 (shared anonymized board)", () => {
  cleanSlate();
  let app: any;
  let admin: any;
  let member: any;
  let betaAdmin: any;
  let boss: any;
  beforeAll(async () => { app = await buildTestApp(); });
  beforeEach(async () => {
    admin = await loginAs(app, "green-village", "admin");
    member = await loginAs(app, "green-village", "member");
    const { db: dbB, pool: poolB } = await testDb();
    await seedClub(dbB, "beta", "Beta Club", "Europe/Rome");
    await poolB.end();
    betaAdmin = await loginAs(app, "beta", "admin");
    await seedBoss();
    boss = await loginSuperadmin(app, "boss@t.local");
  });
  afterAll(async () => { await app.close(); });

  const bossH = () => ({ Authorization: `Bearer ${boss.token}` });

  it("admin submits; validation + roles enforced", async () => {
    const h = authHeaders(admin.token, "green-village");
    const res = await app.inject({
      method: "POST", url: "/api/feature-requests", headers: h,
      payload: { title: "Night lights", body: "Courts need lights after 20:00." },
    });
    expect(res.statusCode).toBe(201);
    expect(Object.keys(res.json()).sort()).toEqual([...ADMIN_ANON_KEYS].sort());
    expect(res.json().mine).toBe(true);
    expect(res.json().votes).toBe(0);
    expect((await app.inject({ method: "POST", url: "/api/feature-requests", headers: h, payload: { title: "", body: "x" } })).statusCode).toBe(400);
    expect((await app.inject({
      method: "POST", url: "/api/feature-requests", headers: authHeaders(member.token, "green-village"),
      payload: { title: "Hi", body: "member cannot submit" },
    })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/feature-requests", payload: { title: "Hi", body: "anon" } })).statusCode).toBe(401);
  });

  it("board is shared across clubs and anonymized", async () => {
    await app.inject({
      method: "POST", url: "/api/feature-requests", headers: authHeaders(admin.token, "green-village"),
      payload: { title: "Floodlights", body: "First idea body." },
    });
    await app.inject({
      method: "POST", url: "/api/feature-requests", headers: authHeaders(betaAdmin.token, "beta"),
      payload: { title: "Ball machine", body: "Second idea body." },
    });
    const res = await app.inject({ method: "GET", url: "/api/feature-requests", headers: authHeaders(admin.token, "green-village") });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
    for (const r of res.json()) {
      expect(Object.keys(r).sort()).toEqual([...ADMIN_ANON_KEYS].sort());
      expect(JSON.stringify(r)).not.toMatch(/green-village|beta/i);
    }
    const mine = res.json().filter((r: any) => r.mine);
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe("Floodlights");
  });

  it("edit own open only; others 403; shipped 400", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/feature-requests", headers: authHeaders(admin.token, "green-village"),
      payload: { title: "Fix me", body: "v1" },
    });
    const id = created.json().id;
    const betaH = authHeaders(betaAdmin.token, "beta");
    expect((await app.inject({ method: "PATCH", url: `/api/feature-requests/${id}`, headers: betaH, payload: { body: "hijack" } })).statusCode).toBe(403);
    const ok = await app.inject({
      method: "PATCH", url: `/api/feature-requests/${id}`, headers: authHeaders(admin.token, "green-village"),
      payload: { body: "v2" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().body).toBe("v2");
    await app.inject({
      method: "PATCH", url: `/api/platform/feature-requests/${id}`, headers: bossH(),
      payload: { status: "shipped" },
    });
    expect((await app.inject({
      method: "PATCH", url: `/api/feature-requests/${id}`, headers: authHeaders(admin.token, "green-village"),
      payload: { body: "v3" },
    })).statusCode).toBe(400);
  });

  it("votes: other clubs toggle, own club 403", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/feature-requests", headers: authHeaders(admin.token, "green-village"),
      payload: { title: "Vote me", body: "please" },
    });
    const id = created.json().id;
    const betaH = authHeaders(betaAdmin.token, "beta");
    const v1 = await app.inject({ method: "POST", url: `/api/feature-requests/${id}/vote`, headers: betaH });
    expect(v1.json()).toEqual({ voted: true, votes: 1 });
    const v2 = await app.inject({ method: "POST", url: `/api/feature-requests/${id}/vote`, headers: betaH });
    expect(v2.json()).toEqual({ voted: false, votes: 0 });
    expect((await app.inject({
      method: "POST", url: `/api/feature-requests/${id}/vote`, headers: authHeaders(admin.token, "green-village"),
    })).statusCode).toBe(403);
    expect((await app.inject({
      method: "POST", url: "/api/feature-requests/00000000-0000-0000-0000-000000000000/vote", headers: betaH,
    })).statusCode).toBe(404);
  });

  it("platform inbox shows origin; status+reply flow back to the board", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/feature-requests", headers: authHeaders(admin.token, "green-village"),
      payload: { title: "Lights", body: "More lights." },
    });
    const id = created.json().id;
    expect((await app.inject({ method: "GET", url: "/api/platform/feature-requests", headers: authHeaders(admin.token, "green-village") })).statusCode).toBe(403);
    const inbox = await app.inject({ method: "GET", url: "/api/platform/feature-requests", headers: bossH() });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json()).toHaveLength(1);
    expect(inbox.json()[0].club_slug).toBe("green-village");
    expect(inbox.json()[0].author).toBe("admin");
    expect((await app.inject({
      method: "PATCH", url: `/api/platform/feature-requests/${id}`, headers: bossH(),
      payload: { status: "sometimes" },
    })).statusCode).toBe(400);
    const upd = await app.inject({
      method: "PATCH", url: `/api/platform/feature-requests/${id}`, headers: bossH(),
      payload: { status: "planned", reply: "Q1 roadmap." },
    });
    expect(upd.statusCode).toBe(200);
    const board = await app.inject({ method: "GET", url: "/api/feature-requests", headers: authHeaders(betaAdmin.token, "beta") });
    expect(board.json()[0].status).toBe("planned");
    expect(board.json()[0].reply).toBe("Q1 roadmap.");
    const audit = await app.inject({ method: "GET", url: "/api/platform/audit?limit=50", headers: bossH() });
    expect(audit.statusCode).toBe(200);
    expect(JSON.stringify(audit.json())).toContain("platform.featurereq.status");
  });
});
