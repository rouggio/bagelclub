import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanSlate, buildTestApp, loginAs, testDb } from "./helpers.js";
import { users, loginChallenges } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";

describe("password reset (#27)", () => {
  cleanSlate();
  let app: any;
  beforeAll(async () => { app = await buildTestApp(); });
  afterAll(async () => { await app.close(); });

  it("request is enumeration-safe (unknown user, no slug)", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/auth/password/request",
      payload: { email: "nobody@nowhere.local", club_slug: "green-village" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true });
  });

  it("request accepts a username identifier (same path as email)", async () => {
    const keepKey = process.env.BREVO_API_KEY;
    const keepFrom = process.env.BREVO_VERIFIED_EMAIL;
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_VERIFIED_EMAIL;
    try {
      const { db, pool } = await testDb();
      const { platformSettings } = await import("../db/schema.js");
      await db.insert(platformSettings).values({ key: "base_url", value: "https://example.local" }).onConflictDoNothing();
      await pool.end();
      const r = await app.inject({
        method: "POST", url: "/api/auth/password/request",
        headers: { "X-Club-Slug": "green-village" },
        payload: { username: "member" },
      });
      expect(r.json()).toMatchObject({ ok: true });
      const { db: db2, pool: pool2 } = await testDb();
      const rows = await db2.select().from(loginChallenges);
      await pool2.end();
      expect(rows.filter((c: any) => c.purpose === "reset").length).toBe(0);
    } finally {
      if (keepKey !== undefined) process.env.BREVO_API_KEY = keepKey;
      if (keepFrom !== undefined) process.env.BREVO_VERIFIED_EMAIL = keepFrom;
    }
  });

  it("request without mail config leaves no dangling token", async () => {
    const keepKey = process.env.BREVO_API_KEY;
    const keepFrom = process.env.BREVO_VERIFIED_EMAIL;
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_VERIFIED_EMAIL;
    try {
      const r = await app.inject({
        method: "POST", url: "/api/auth/password/request",
        headers: { "X-Club-Slug": "green-village" },
        payload: { username: "member" },
      });
      expect(r.json()).toMatchObject({ ok: true });
      const { db, pool } = await testDb();
      const rows = await db.select().from(loginChallenges);
      await pool.end();
      expect(rows.filter((c: any) => c.purpose === "reset").length).toBe(0);
    } finally {
      if (keepKey !== undefined) process.env.BREVO_API_KEY = keepKey;
      if (keepFrom !== undefined) process.env.BREVO_VERIFIED_EMAIL = keepFrom;
    }
  });

  it("confirm rotates password, consumes token, rejects reuse and garbage", async () => {
    const { db, pool } = await testDb();
    const member = (await db.select().from(users).where(eq(users.username, "member")))[0];
    const token = randomBytes(32).toString("hex");
    await db.insert(loginChallenges).values({
      userId: member.id,
      codeHash: createHash("sha256").update(token).digest("hex"),
      purpose: "reset",
      expiresAt: new Date(Date.now() + 3600000),
    });
    await pool.end();
    const ok = await app.inject({
      method: "POST", url: "/api/auth/password/confirm",
      payload: { token, new_password: "BrandNew123!" },
    });
    expect(ok.json()).toMatchObject({ ok: true });
    // New password logs in (scoped to the club).
    const login = await app.inject({
      method: "POST", url: "/api/auth/login",
      headers: { "X-Club-Slug": "green-village" },
      payload: { username: "member", password: "BrandNew123!" },
    });
    expect(login.statusCode).toBe(200);
    // Replay and garbage both fail identically.
    for (const t of [token, "deadbeef"]) {
      const r = await app.inject({
        method: "POST", url: "/api/auth/password/confirm",
        payload: { token: t, new_password: "Another123!" },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toMatchObject({ error: "Invalid or expired link" });
    }
  });
});
