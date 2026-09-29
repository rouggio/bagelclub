import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanSlate, buildTestApp, authHeaders, testDb, loginSuperadmin } from "./helpers.js";
import { resetDemoShowcase, startDemoRun, seedShowcaseExtras } from "../services/demo.js";
import { clubs, users, announcements } from "../db/schema.js";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

describe("demo showcase", () => {
  cleanSlate();

  it("reset seeds admin + 3 players + public creds announcement", async () => {
    const { db, pool } = await testDb();
    await db.insert(clubs).values({ slug: "demo", name: "Demo", timezone: "Europe/Rome", isDemo: true, isListed: true });
    await resetDemoShowcase(db);
    const demoClub = (await db.select().from(clubs).where(eq(clubs.slug, "demo")))[0];
    const members = await db.select().from(users).where(eq(users.clubId, demoClub.id));
    const names = members.map((u: any) => u.username).sort();
    expect(names).toEqual(["demo-admin", "demo1", "demo2", "demo3"]);
    const anns = await db.select().from(announcements).where(eq(announcements.visibility, "public"));
    expect(anns.length).toBe(1);
    expect(anns[0].body).toContain("demo-admin / demo1234!");
    expect(anns[0].body).toContain("demo1 / demo1234!");
    await pool.end();
  });

  it("showcase courts carry famous names", async () => {
    const { db, pool } = await testDb();
    await db.insert(clubs).values({ slug: "demo", name: "Demo", timezone: "Europe/Rome", isDemo: true, isListed: true });
    await resetDemoShowcase(db);
    const demoClub = (await db.select().from(clubs).where(eq(clubs.slug, "demo")))[0];
    const { courts } = await import("../db/schema.js");
    const cs = await db.select().from(courts).where(eq(courts.clubId, demoClub.id));
    expect(cs.map((c: any) => c.name).sort()).toEqual(["Ashe", "Centrale", "Chatrier", "Pietrangeli"]);
    await pool.end();
  });

  it("creds announcement is idempotent without a wipe (exactly one card)", async () => {
    const { db, pool } = await testDb();
    const [c] = await db.insert(clubs).values({ slug: "demo-solo1", name: "Solo", timezone: "Europe/Rome", isDemo: true }).returning();
    await seedShowcaseExtras(db, c.id);
    await seedShowcaseExtras(db, c.id);
    const anns = await db.select().from(announcements).where(eq(announcements.clubId, c.id));
    expect(anns.length).toBe(1);
    expect(anns[0].visibility).toBe("public");
    expect(anns[0].body).toContain("demo-admin / demo1234!");
    const { announcementTranslations } = await import("../db/schema.js");
    const trs = await db.select().from(announcementTranslations).where(eq(announcementTranslations.announcementId, anns[0].id));
    expect(trs.map((r: any) => r.lang).sort()).toEqual(["de", "en", "es", "fr", "it"]);
    expect(trs.every((r: any) => r.body.includes("demo1234!"))).toBe(true);
    await pool.end();
  });

  it("personal runs stay private (no creds announcement)", async () => {
    const { db, pool } = await testDb();
    const { club } = await startDemoRun(db, { displayName: "Mine", courts: [{ type: "tennis", count: 1 }] });
    expect(club.slug.startsWith("demo-")).toBe(true);
    const anns = await db.select().from(announcements).where(eq(announcements.clubId, club.id));
    expect(anns.length).toBe(0);
    const members = await db.select().from(users).where(eq(users.clubId, club.id));
    expect(members.map((u: any) => u.username)).toEqual(["demo-admin"]);
    await pool.end();
  });
});

describe("platform demo hygiene endpoints", () => {
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
    await db.insert(clubs).values({ slug: "demo", name: "Demo", timezone: "Europe/Rome", isDemo: true, isListed: true }).onConflictDoNothing();
    await pool.end();
    boss = await loginSuperadmin(app, "boss@t.local");
  });
  afterAll(async () => { await app.close(); });
  const H = () => authHeaders(boss.token);

  it("ensure reports counts; old reset route is gone", async () => {
    const r = await app.inject({ method: "POST", url: "/api/platform/demo/ensure", headers: H() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, slug: "demo" });
    expect(r.json().before).toBeDefined();
    expect(r.json().after.users).toBeGreaterThan(r.json().before.users);
    const gone = await app.inject({ method: "POST", url: "/api/platform/clubs/demo/reset", headers: H() });
    expect(gone.statusCode).toBe(404);
  });

  it("cleanup deletes idle 61-day demos, keeps fresh ones and the showcase", async () => {
    const { db, pool } = await testDb();
    const old = new Date(Date.now() - 61 * 86400000);
    await db.insert(clubs).values({ slug: "demo-old1", name: "Old", timezone: "Europe/Rome", isDemo: true, createdAt: old, updatedAt: old });
    await db.insert(clubs).values({ slug: "demo-fresh1", name: "Fresh", timezone: "Europe/Rome", isDemo: true });
    const [lc] = await db.insert(clubs).values({ slug: "demo-oldlogin1", name: "OldLogin", timezone: "Europe/Rome", isDemo: true, createdAt: old, updatedAt: old }).returning();
    await db.insert(users).values({ clubId: lc.id, username: "returning", passwordHash: "x", firstName: "R", lastName: "E", role: "associate", isVerified: true, createdAt: old, lastLoginAt: new Date() });
    await pool.end();
    const r = await app.inject({ method: "POST", url: "/api/platform/demo/cleanup", headers: H() });
    expect(r.statusCode).toBe(200);
    expect(r.json().deleted).toContain("demo-old1");
    expect(r.json().deleted).not.toContain("demo-fresh1");
    expect(r.json().deleted).not.toContain("demo-oldlogin1");
    expect(r.json().deleted).not.toContain("demo");
    const { db: db2, pool: pool2 } = await testDb();
    expect((await db2.select().from(clubs).where(eq(clubs.slug, "demo-old1"))).length).toBe(0);
    expect((await db2.select().from(clubs).where(eq(clubs.slug, "demo-fresh1"))).length).toBe(1);
    expect((await db2.select().from(clubs).where(eq(clubs.slug, "demo-oldlogin1"))).length).toBe(1);
    await pool2.end();
  });

  it("club delete refuses the showcase and wipes personal demos", async () => {
    const no = await app.inject({ method: "DELETE", url: "/api/platform/clubs/demo", headers: H() });
    expect(no.statusCode).toBe(400);
    const { db, pool } = await testDb();
    const [c] = await db.insert(clubs).values({ slug: "demo-doom1", name: "Doom", timezone: "Europe/Rome", isDemo: true }).returning();
    await db.insert(users).values({ clubId: c.id, username: "someone", passwordHash: "x", firstName: "S", lastName: "O", role: "associate", isVerified: true });
    await pool.end();
    const r = await app.inject({ method: "DELETE", url: "/api/platform/clubs/demo-doom1", headers: H() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, slug: "demo-doom1" });
    const { db: db2, pool: pool2 } = await testDb();
    expect((await db2.select().from(clubs).where(eq(clubs.slug, "demo-doom1"))).length).toBe(0);
    expect((await db2.select().from(users).where(eq(users.clubId, c.id))).length).toBe(0);
    await pool2.end();
    const audit = await app.inject({ method: "GET", url: "/api/platform/audit?limit=50", headers: H() });
    expect((audit.json().rows as any[]).some((a: any) => a.action === "platform.club.delete" && a.target === "demo-doom1")).toBe(true);
  });
});
