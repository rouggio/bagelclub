import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanSlate, buildTestApp, authHeaders, testDb, loginSuperadmin } from "./helpers.js";
import { isProbe, shouldBlock, LIMITS } from "../plugins/abuse.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

describe("abuse shield", () => {
  cleanSlate();
  let app: any;
  beforeAll(async () => { app = await buildTestApp(); });
  afterAll(async () => { await app.close(); });

  it("recognises scanner / mangling probes", () => {
    expect(isProbe("/api/wp-login.php")).toBe(true);
    expect(isProbe("/api/courts?x=..%2f..%2fetc%2fpasswd")).toBe(true);
    expect(isProbe("/api/.env")).toBe(true);
    expect(isProbe("/api/courts?court_id=1&date=2026-01-01")).toBe(false);
    expect(isProbe("/api/auth/login")).toBe(false);
  });

  it("shouldBlock trips at the limit inside the window", () => {
    const now = Date.now();
    const at = (n: number) => Array.from({ length: n }, (_, i) => now - i * 1000);
    expect(shouldBlock(at(LIMITS.loginFail.max), LIMITS.loginFail.max, LIMITS.loginFail.windowMs, now)).toBe(true);
    expect(shouldBlock(at(LIMITS.loginFail.max - 1), LIMITS.loginFail.max, LIMITS.loginFail.windowMs, now)).toBe(false);
    expect(shouldBlock(at(LIMITS.loginFail.max).map((t) => t - LIMITS.loginFail.windowMs - 1000), LIMITS.loginFail.max, LIMITS.loginFail.windowMs, now)).toBe(false);
  });

  it("blocks an IP after repeated login failures, superadmin can unblock", async () => {
    // Unique IP per run: hermetic against stale blocks from earlier runs.
    const ip = `10.99.${1 + Math.floor(Math.random() * 200)}.${1 + Math.floor(Math.random() * 200)}`;
    const H = { "X-Forwarded-For": ip };
    // 10 bad logins are 401s; the 11th trips the block.
    for (let i = 0; i < LIMITS.loginFail.max; i++) {
      const r = await app.inject({
        method: "POST", url: "/api/auth/login", headers: H,
        payload: { username: "member", password: "wrong" },
      });
      expect(r.statusCode).toBe(401);
    }
    const blocked = await app.inject({
      method: "POST", url: "/api/auth/login", headers: H,
      payload: { username: "member", password: "wrong" },
    });
    expect(blocked.statusCode).toBe(403);
    // A different IP is unaffected.
    const other = await app.inject({
      method: "POST", url: "/api/auth/login", headers: { "X-Forwarded-For": "10.98.98.98" },
      payload: { username: "member", password: "wrong" },
    });
    expect(other.statusCode).toBe(401);
    // Superadmin sees the block and lifts it.
    const { db, pool } = await testDb();
    await db.insert(users).values({
      clubId: null as any, username: "boss", email: "boss@t.local",
      passwordHash: await bcrypt.hash("Test1234!", 10),
      firstName: "B", lastName: "O", role: "superadmin", isVerified: true,
    });
    await pool.end();
    const boss = await loginSuperadmin(app, "boss@t.local");
    const list = await app.inject({ method: "GET", url: "/api/platform/abuse", headers: authHeaders(boss.token) });
    expect(list.statusCode).toBe(200);
    expect((list.json() as any[]).some((b: any) => b.ip === ip)).toBe(true);
    const un = await app.inject({ method: "DELETE", url: `/api/platform/abuse/${ip}`, headers: authHeaders(boss.token) });
    expect(un.statusCode).toBe(200);
    const again = await app.inject({
      method: "POST", url: "/api/auth/login", headers: H,
      payload: { username: "member", password: "wrong" },
    });
    expect(again.statusCode).toBe(401);
  });
});
