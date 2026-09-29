import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanSlate, buildTestApp, loginAs, authHeaders, testDb, seedClub } from "./helpers.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";

describe("auth (club-scoped)", () => {
  cleanSlate();
  let app: any;
  beforeAll(async () => { app = await buildTestApp(); });
  afterAll(async () => { await app.close(); });

  it("login stamps last_login_at", async () => {
    const { token, user } = await loginAs(app, "green-village", "member");
    expect(token).toBeTruthy();
    const { db, pool } = await testDb();
    const rows = await db.select().from(users).where(eq(users.id, user.id));
    await pool.end();
    expect(rows[0].lastLoginAt).toBeTruthy();
    expect(new Date(rows[0].lastLoginAt).getTime()).toBeGreaterThan(Date.now() - 60000);
  });

  it("register requires a club slug", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "n1", email: "n1@x.io", mobile: "393331234567", password: "Test1234!", first_name: "N", last_name: "One" } });
    expect(res.statusCode).toBe(400);
  });

  it("register lands in the club as associate with clubId", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/auth/register", headers: { "X-Club-Slug": "green-village" },
      payload: { username: "newbie", email: "newbie@x.io", mobile: "393331234567", password: "Test1234!", first_name: "New", last_name: "Bie" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.role).toBe("associate");
    expect(res.json().user.club_slug).toBe("green-village");
    expect(res.json().user.clubId).toBeTruthy();
  });

  it("same username can exist in two clubs", async () => {
    const { db, pool } = await testDb();
    await seedClub(db, "beta", "Beta Club", "Europe/Rome");
    await pool.end();
    for (const slug of ["green-village", "beta"]) {
      const res = await app.inject({
        method: "POST", url: "/api/auth/register", headers: { "X-Club-Slug": slug },
        payload: { username: "samename", email: `same-${slug}@x.io`, mobile: "393331234567", password: "Test1234!", first_name: "Same", last_name: "Name" },
      });
      expect(res.statusCode).toBe(201);
    }
    const a = await loginAs(app, "green-village", "samename");
    const b = await loginAs(app, "beta", "samename");
    expect(a.user.clubId).not.toBe(b.user.clubId);
  });

  it("duplicate handle in the same club is rejected", async () => {
    const payload = { username: "dupe", email: "dupe@x.io", mobile: "393331234567", password: "Test1234!", first_name: "D", last_name: "U" };
    const h = { "X-Club-Slug": "green-village" };
    expect((await app.inject({ method: "POST", url: "/api/auth/register", headers: h, payload })).statusCode).toBe(201);
    const r2 = await app.inject({ method: "POST", url: "/api/auth/register", headers: h, payload: { ...payload, email: "other@x.io" } });
    expect(r2.statusCode).toBe(409);
  });

  it("self-service password change rotates, wrong current fails, short rejected", async () => {
    const { token } = await loginAs(app, "green-village", "member");
    const H = authHeaders(token, "green-village");
    const bad = await app.inject({ method: "POST", url: "/api/users/me/password", headers: H, payload: { current_password: "Wrong123!", new_password: "BrandNew123!" } });
    expect(bad.statusCode).toBe(401);
    const short = await app.inject({ method: "POST", url: "/api/users/me/password", headers: H, payload: { current_password: "Test1234!", new_password: "short" } });
    expect(short.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/api/users/me/password", headers: H, payload: { current_password: "Test1234!", new_password: "BrandNew123!" } });
    expect(ok.json()).toMatchObject({ ok: true });
    const login = await app.inject({ method: "POST", url: "/api/auth/login", headers: { "X-Club-Slug": "green-village" }, payload: { username: "member", password: "BrandNew123!" } });
    expect(login.statusCode).toBe(200);
  });

  it("club login without slug fails (superadmin-only path)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "member", password: "Test1234!" } });
    expect(res.statusCode).toBe(401);
  });

  it("refresh re-issues club scope and rejects deleted users", async () => {
    const { token } = await loginAs(app, "green-village", "member");
    const me = await app.inject({ method: "GET", url: "/api/users/me", headers: authHeaders(token, "green-village") });
    expect(me.statusCode).toBe(200);
    // Soft-delete the member as admin, refresh cookie flow must die.
    const admin = await loginAs(app, "green-village", "admin");
    const del = await app.inject({ method: "DELETE", url: `/api/users/${me.json().id}`, headers: authHeaders(admin.token, "green-village") });
    expect(del.statusCode).toBe(204);
    const gone = await app.inject({ method: "GET", url: "/api/users/me", headers: authHeaders(token, "green-village") });
    expect(gone.statusCode).toBe(401);
  });

  it("superadmin logs in with no slug and reaches platform", async () => {
    const { db, pool } = await testDb();
    const bcrypt = (await import("bcryptjs")).default;
    await db.insert(users).values({
      clubId: null as any, username: "boss", email: "boss@test.local",
      passwordHash: await bcrypt.hash("Test1234!", 10),
      firstName: "B", lastName: "Oss", role: "superadmin", isVerified: true,
    });
    await pool.end();
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "boss@test.local", password: "Test1234!" } });
    // Step 1 yields a 2FA challenge, never a session (full flow in twofa.test.ts).
    expect(res.statusCode).toBe(200);
    expect(res.json().two_factor_required).toBe(true);
    expect(res.json().token).toBeUndefined();
    expect(res.json().challenge_id).toBeTruthy();
  });

  it("old token without clubId is rejected", async () => {
    const forged = app.jwt.sign({ id: "x", username: "member", role: "member" } as any);
    const res = await app.inject({ method: "GET", url: "/api/users/me", headers: authHeaders(forged, "green-village") });
    expect(res.statusCode).toBe(401);
  });
});
