import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
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

describe("demo start platform ping", () => {
  cleanSlate();
  let app: any;
  let sent: Array<{ url: string; body: any }>;
  const keep: Record<string, string | undefined> = {};
  beforeAll(async () => { app = await buildTestApp(); });
  beforeEach(() => {
    sent = [];
    vi.stubGlobal("fetch", (async (url: string, init: any) => {
      sent.push({ url: String(url), body: JSON.parse(init?.body || "{}") });
      return { ok: true, json: async () => ({}) };
    }) as any);
    for (const k of ["SUPERADMIN_EMAIL", "BREVO_API_KEY", "BREVO_VERIFIED_EMAIL", "SUPERADMIN_TELEGRAM_BOT_TOKEN", "SUPERADMIN_TELEGRAM_CHAT_ID"]) keep[k] = process.env[k];
    delete process.env.PLATFORM_ADMIN_EMAIL; // legacy name: must stay dead
    process.env.SUPERADMIN_EMAIL = "boss@t.local";
    process.env.BREVO_API_KEY = "dummy";
    process.env.BREVO_VERIFIED_EMAIL = "from@test.local";
    process.env.SUPERADMIN_TELEGRAM_BOT_TOKEN = "test-bot";
    process.env.SUPERADMIN_TELEGRAM_CHAT_ID = "424242";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ["SUPERADMIN_EMAIL", "BREVO_API_KEY", "BREVO_VERIFIED_EMAIL", "SUPERADMIN_TELEGRAM_BOT_TOKEN", "SUPERADMIN_TELEGRAM_CHAT_ID"]) {
      if (keep[k] !== undefined) process.env[k] = keep[k] as string;
      else delete process.env[k];
    }
  });
  afterAll(async () => { await app.close(); });

  it("mails the platform admin on every user-created demo club", async () => {
    const { db: db0, pool: pool0 } = await testDb();
    const { platformSettings: ps0 } = await import("../db/schema.js");
    const { eq: eq0 } = await import("drizzle-orm");
    await db0.insert(ps0).values({ key: "notify_demo_start", value: "true" }).onConflictDoUpdate({ target: [ps0.key], set: { value: "true" } });
    await pool0.end();
    const r = await app.inject({
      method: "POST", url: "/api/demo/start",
      payload: { display_name: "Ping Me", courts: [{ type: "tennis", count: 1 }] },
    });
    expect(r.statusCode).toBe(201);
    const mails = sent.filter((s) => String(s.url).includes("api.brevo.com"));
    expect(mails).toHaveLength(1);
    expect(mails[0].body.to).toEqual([{ email: "boss@t.local" }]);
    expect(mails[0].body.subject).toContain(r.json().slug);
    expect(mails[0].body.textContent).toContain("Ping Me");
    const pings = sent.filter((s) => String(s.url).includes("api.telegram.org"));
    expect(pings).toHaveLength(1);
    expect(pings[0].body.chat_id).toBe("424242");
    expect(pings[0].body.text).toContain(r.json().slug);
    const { db, pool } = await testDb();
    const { auditLog } = await import("../db/schema.js");
    const rows = await db.select().from(auditLog);
    await pool.end();
    expect(rows.some((a: any) => a.action === "demo.start" && String(a.target) === String(r.json().slug))).toBe(true);
  });

  it("email toggle off silences the mail (telegram still fires) but keeps audit + 201", async () => {
    const { db, pool } = await testDb();
    const { platformSettings } = await import("../db/schema.js");
    const { eq: eqT } = await import("drizzle-orm");
    await db.insert(platformSettings).values({ key: "notify_demo_start", value: "false" }).onConflictDoUpdate({ target: [platformSettings.key], set: { value: "false" } });
    await pool.end();
    const r = await app.inject({
      method: "POST", url: "/api/demo/start",
      payload: { courts: [{ type: "padel", count: 2 }] },
    });
    expect(r.statusCode).toBe(201);
    expect(sent.filter((s) => String(s.url).includes("api.brevo.com"))).toHaveLength(0);
    expect(sent.filter((s) => String(s.url).includes("api.telegram.org"))).toHaveLength(1);
    const { db: db2, pool: pool2 } = await testDb();
    const { auditLog } = await import("../db/schema.js");
    const rows = await db2.select().from(auditLog);
    await pool2.end();
    expect(rows.some((a: any) => a.action === "demo.start")).toBe(true);
    // platform_settings survives cleanSlate: restore the default for later tests.
    const { db: db3, pool: pool3 } = await testDb();
    const { eq } = await import("drizzle-orm");
    await db3.delete(platformSettings).where(eq(platformSettings.key, "notify_demo_start"));
    await pool3.end();
  });

  it("telegram toggle off silences the ping (email still fires)", async () => {
    const { db, pool } = await testDb();
    const { platformSettings } = await import("../db/schema.js");
    const { eq: eqG } = await import("drizzle-orm");
    await db.insert(platformSettings).values({ key: "notify_demo_start_telegram", value: "false" }).onConflictDoUpdate({ target: [platformSettings.key], set: { value: "false" } });
    await pool.end();
    const r = await app.inject({
      method: "POST", url: "/api/demo/start",
      payload: { courts: [{ type: "tennis", count: 1 }] },
    });
    expect(r.statusCode).toBe(201);
    expect(sent.filter((s) => String(s.url).includes("api.telegram.org"))).toHaveLength(0);
    expect(sent.filter((s) => String(s.url).includes("api.brevo.com"))).toHaveLength(1);
    const { db: db2, pool: pool2 } = await testDb();
    await db2.delete(platformSettings).where(eqG(platformSettings.key, "notify_demo_start_telegram"));
    await pool2.end();
  });

  it("platform audit actions filter narrows the feed", async () => {
    const { db, pool } = await testDb();
    await db.insert(users).values({
      clubId: null as any, username: "boss", email: "boss@t.local",
      passwordHash: await bcrypt.hash("Test1234!", 10),
      firstName: "B", lastName: "O", role: "superadmin", isVerified: true,
    }).onConflictDoNothing();
    await pool.end();
    const boss = await loginSuperadmin(app, "boss@t.local");
    const H = () => authHeaders(boss.token);
    await app.inject({ method: "POST", url: "/api/demo/start", payload: { courts: [{ type: "tennis", count: 1 }] } });
    const all = await app.inject({ method: "GET", url: "/api/platform/audit?limit=50", headers: H() });
    expect(all.statusCode).toBe(200);
    expect(all.json().rows.length).toBeGreaterThanOrEqual(1);
    const feed = await app.inject({ method: "GET", url: "/api/platform/audit?actions=demo.start", headers: H() });
    expect(feed.statusCode).toBe(200);
    expect(feed.json().rows.length).toBeGreaterThanOrEqual(1);
    expect(feed.json().rows.every((r: any) => r.action === "demo.start")).toBe(true);
  });

  it("platform settings toggle round-trips and gates the mail", async () => {
    const { db, pool } = await testDb();
    await db.insert(users).values({
      clubId: null as any, username: "boss", email: "boss@t.local",
      passwordHash: await bcrypt.hash("Test1234!", 10),
      firstName: "B", lastName: "O", role: "superadmin", isVerified: true,
    }).onConflictDoNothing();
    await pool.end();
    const boss = await loginSuperadmin(app, "boss@t.local");
    const H = () => ({ ...authHeaders(boss.token), "Content-Type": "application/json" });
    const get = await app.inject({ method: "GET", url: "/api/platform/settings", headers: H() });
    expect(get.json().notify_demo_start).toBe(true);
    expect(get.json().notify_demo_start_telegram).toBe(true);
    const off = await app.inject({ method: "PUT", url: "/api/platform/settings", headers: H(), payload: { notify_demo_start: false } });
    expect(off.json().notify_demo_start).toBe(false);
    const r1 = await app.inject({ method: "POST", url: "/api/demo/start", payload: { courts: [{ type: "tennis", count: 1 }] } });
    expect(r1.statusCode).toBe(201);
    expect(sent.filter((s) => String(s.url).includes("api.brevo.com"))).toHaveLength(0);
    const on = await app.inject({ method: "PUT", url: "/api/platform/settings", headers: H(), payload: { notify_demo_start: true } });
    expect(on.json().notify_demo_start).toBe(true);
    const tgOff = await app.inject({ method: "PUT", url: "/api/platform/settings", headers: H(), payload: { notify_demo_start_telegram: false } });
    expect(tgOff.json().notify_demo_start_telegram).toBe(false);
    const tgOn = await app.inject({ method: "PUT", url: "/api/platform/settings", headers: H(), payload: { notify_demo_start_telegram: true } });
    expect(tgOn.json().notify_demo_start_telegram).toBe(true);
    const r2 = await app.inject({ method: "POST", url: "/api/demo/start", payload: { courts: [{ type: "tennis", count: 1 }] } });
    expect(r2.statusCode).toBe(201);
    expect(sent.filter((s) => String(s.url).includes("api.brevo.com"))).toHaveLength(1);
  });

  it("still 201s silently without an admin address (no mail, no 501)", async () => {
    delete process.env.SUPERADMIN_EMAIL;
    const r = await app.inject({
      method: "POST", url: "/api/demo/start",
      payload: { courts: [{ type: "padel", count: 2 }] },
    });
    expect(r.statusCode).toBe(201);
    expect(sent.filter((s) => String(s.url).includes("api.brevo.com"))).toHaveLength(0);
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
