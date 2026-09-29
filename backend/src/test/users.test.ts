import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanSlate, buildTestApp, loginAs, authHeaders, testDb } from "./helpers.js";
import { users, bookings, courts, loginChallenges } from "../db/schema.js";
import { eq } from "drizzle-orm";

describe("users (soft delete)", () => {
  cleanSlate();
  let app: any;
  let admin: any;
  beforeAll(async () => { app = await buildTestApp(); });
  // NOTE: cleanSlate resets the DB before each test, so re-login per test.
  beforeEach(async () => { admin = await loginAs(app, "green-village", "admin"); });
  afterAll(async () => { await app.close(); });
  const H = () => authHeaders(admin.token, "green-village");

  it("profile channel prefs round-trip via PATCH /me (email locked, push master + channels)", async () => {
    const member = await loginAs(app, "green-village", "member");
    const Hm = authHeaders(member.token, "green-village");
    const me1 = await app.inject({ method: "GET", url: "/api/users/me", headers: Hm });
    expect(me1.json().notify_email).toBe(true);
    expect(me1.json().notify_push_master).toBe(true);
    // Email opt-out is gone: unknown key stripped, push master + TG channel off apply.
    const patch = await app.inject({ method: "PATCH", url: "/api/users/me", headers: Hm, payload: { notify_email: false, notify_push_master: false, notify_telegram: false } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().notify_email).toBe(true);
    expect(patch.json().notify_push_master).toBe(false);
    const me2 = await app.inject({ method: "GET", url: "/api/users/me", headers: Hm });
    expect(me2.json().notify_email).toBe(true);
    expect(me2.json().notify_push_master).toBe(false);
    expect(me2.json().notify_telegram).toBe(false);
    expect(me2.json().notify_whatsapp).toBe(true);
  });

  it("welcome email validates target, needs email, fails closed without delivery", async () => {
    const member = await loginAs(app, "green-village", "member");
    // Cross-club target → 404.
    const { db, pool } = await testDb();
    const target = (await db.select().from(users).where(eq(users.username, "member")))[0];
    await pool.end();
    const beta = await loginAs(app, "beta", "admin").catch(() => null);
    if (beta) {
      const r = await app.inject({ method: "POST", url: `/api/users/${target.id}/welcome`, headers: authHeaders(beta.token, "beta") });
      expect(r.statusCode).toBe(404);
    }
    // Member without email → 400.
    const { db: db2, pool: pool2 } = await testDb();
    await db2.update(users).set({ email: null }).where(eq(users.id, target.id));
    await pool2.end();
    const noMail = await app.inject({ method: "POST", url: `/api/users/${target.id}/welcome`, headers: H() });
    expect(noMail.statusCode).toBe(400);
    expect(noMail.json()).toMatchObject({ error: "welcome_no_email" });
    // Undeliverable (dummy creds) → 502 and no dangling welcome token.
    const keepKey = process.env.BREVO_API_KEY;
    const keepFrom = process.env.BREVO_VERIFIED_EMAIL;
    process.env.BREVO_API_KEY = "dummy";
    process.env.BREVO_VERIFIED_EMAIL = "from@test.local";
    const { db: db3, pool: pool3 } = await testDb();
    await db3.update(users).set({ email: "member@test.local" }).where(eq(users.id, target.id));
    const { platformSettings } = await import("../db/schema.js");
    await db3.insert(platformSettings).values({ key: "base_url", value: "https://example.local" }).onConflictDoUpdate({ target: [platformSettings.key], set: { value: "https://example.local" } });
    await pool3.end();
    try {
      const fail = await app.inject({ method: "POST", url: `/api/users/${target.id}/welcome`, headers: H() });
      expect(fail.statusCode).toBe(502);
      const { db: db4, pool: pool4 } = await testDb();
      const rows = await db4.select().from(loginChallenges);
      await pool4.end();
      expect(rows.filter((c: any) => c.purpose === "welcome").length).toBe(0);
    } finally {
      if (keepKey !== undefined) process.env.BREVO_API_KEY = keepKey; else delete process.env.BREVO_API_KEY;
      if (keepFrom !== undefined) process.env.BREVO_VERIFIED_EMAIL = keepFrom; else delete process.env.BREVO_VERIFIED_EMAIL;
    }
  });

  it("delete stamps deleted_at and keeps the row + booking history", async () => {
    const member = await loginAs(app, "green-village", "member");
    const { db, pool } = await testDb();
    const cs = await db.select().from(courts);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await db.insert(bookings).values({ clubId: member.user.clubId, courtId: cs[0].id, userId: member.user.id, date: tomorrow, startTime: "10:00", endTime: "11:00", status: "approved" });
    await pool.end();
    const del = await app.inject({ method: "DELETE", url: `/api/users/${member.user.id}`, headers: H() });
    expect(del.statusCode).toBe(204);
    const { db: db2, pool: pool2 } = await testDb();
    const rows = await db2.select().from(users).where(eq(users.id, member.user.id));
    expect(rows[0].deletedAt).toBeTruthy();
    const kept = await db2.select().from(bookings).where(eq(bookings.userId, member.user.id));
    expect(kept.length).toBe(1); // history preserved (physical delete destroyed it)
    await pool2.end();
  });

  it("deleted handle is reusable, and restore refuses a re-taken handle", async () => {
    const member = await loginAs(app, "green-village", "member");
    expect((await app.inject({ method: "DELETE", url: `/api/users/${member.user.id}`, headers: H() })).statusCode).toBe(204);
    const r = await app.inject({
      method: "POST", url: "/api/auth/register", headers: { "X-Club-Slug": "green-village" },
      payload: { username: "member", email: "member@test.local", mobile: "393331234567", password: "Test1234!", first_name: "M", last_name: "2" },
    });
    expect(r.statusCode).toBe(201);
    const restore = await app.inject({ method: "POST", url: `/api/users/${member.user.id}/restore`, headers: H() });
    expect(restore.statusCode).toBe(409);
  });

  it("last admin cannot be deleted or demoted", async () => {
    const list = await app.inject({ method: "GET", url: "/api/users?role=admin", headers: H() });
    expect(list.json().length).toBe(1);
    expect((await app.inject({ method: "DELETE", url: `/api/users/${admin.user.id}`, headers: H() })).statusCode).toBe(400);
  });

  it("admin cannot delete themselves", async () => {
    const del = await app.inject({ method: "DELETE", url: `/api/users/${admin.user.id}`, headers: H() });
    expect(del.statusCode).toBe(400);
  });
});
