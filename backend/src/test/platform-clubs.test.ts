import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { cleanSlate, buildTestApp, loginSuperadmin, authHeaders, testDb } from "./helpers.js";
import { clubs, users, auditLog } from "../db/schema.js";
import { eq } from "drizzle-orm";

describe("platform club slug edit", () => {
  cleanSlate();
  let app: any;
  let boss: any;
  const H = () => ({ ...authHeaders(boss.token), "Content-Type": "application/json" });
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

  it("renames the slug (normalized), validates, rejects taken, audits", async () => {
    const r = await app.inject({ method: "PATCH", url: "/api/platform/clubs/green-village", headers: H(), payload: { slug: "Verdant Valley!" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().slug).toBe("verdant-valley");
    const bad = await app.inject({ method: "PATCH", url: "/api/platform/clubs/verdant-valley", headers: H(), payload: { slug: "api" } });
    expect(bad.statusCode).toBe(400);
    const { db, pool } = await testDb();
    await db.insert(clubs).values({ slug: "taken-club", name: "Taken", timezone: "Europe/Rome" });
    await pool.end();
    const dup = await app.inject({ method: "PATCH", url: "/api/platform/clubs/verdant-valley", headers: H(), payload: { slug: "taken-club" } });
    expect(dup.statusCode).toBe(409);
    const { db: db2, pool: pool2 } = await testDb();
    const audits = await db2.select().from(auditLog);
    await pool2.end();
    const hit = audits.find((a: any) => a.action === "platform.club.patch");
    expect(hit).toBeTruthy();
    expect(JSON.parse(hit.meta)).toMatchObject({ slug_from: "green-village", slug_to: "verdant-valley" });
  });
});
