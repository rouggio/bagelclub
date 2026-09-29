import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { cleanSlate, buildTestApp, loginAs, authHeaders, testDb, seedClub } from "./helpers.js";
import { users, courts, telegramLinkTokens, appSettings, bookings } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";

const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

describe("cross-club isolation", () => {
  cleanSlate();
  let app: any;
  let adminA: any;
  let memberA: any;
  let courtA: string;
  beforeAll(async () => { app = await buildTestApp(); });
  beforeEach(async () => {
    const { db, pool } = await testDb();
    await seedClub(db, "beta", "Beta Club", "Europe/Rome");
    await pool.end();
    adminA = await loginAs(app, "green-village", "admin");
    memberA = await loginAs(app, "green-village", "member");
    const { db: db2, pool: pool2 } = await testDb();
    courtA = (await db2.select().from(courts))[0].id;
    await pool2.end();
  });
  afterAll(async () => { await app.close(); });

  it("public availability requires a slug and never leaks", async () => {
    const noSlug = await app.inject({ method: "GET", url: `/api/availability?court_id=${courtA}&date=${tomorrow()}` });
    expect(noSlug.statusCode).toBe(400);
    const ok = await app.inject({ method: "GET", url: `/api/availability?court_id=${courtA}&date=${tomorrow()}&slug=green-village` });
    expect(ok.statusCode).toBe(200);
  });

  it("courts of club B are invisible under slug A", async () => {
    const { db, pool } = await testDb();
    const betaCourts = await db.select().from(courts);
    const betaCourt = betaCourts.find((c: any) => c.clubId !== memberA.user.clubId);
    await pool.end();
    expect(betaCourt).toBeTruthy();
    const r = await app.inject({ method: "GET", url: `/api/availability?court_id=${betaCourt!.id}&date=${tomorrow()}&slug=green-village` });
    expect(r.statusCode).toBe(404);
  });

  it("telegram webhook routes by token club and uses the club bot", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", (async (url: string) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ ok: true, result: { username: "bot" } }) };
    }) as any);
    try {
      const { db, pool } = await testDb();
      const clubRows = await db.select().from((await import("../db/schema.js")).clubs);
      const clubA = clubRows.find((c: any) => c.slug === "green-village")!;
      await db.update(appSettings).set({ telegramBotToken: "tok-club-A" }).where(eq(appSettings.clubId, clubA.id));
      const memRows = await db.select().from(users).where(eq(users.username, "member"));
      const memA = memRows.find((u: any) => String(u.clubId) === String(clubA.id))!;
      await db.insert(telegramLinkTokens).values({ token: "a".repeat(32), clubId: clubA.id, userId: memA.id, expiresAt: new Date(Date.now() + 600000) });
      await pool.end();
      const res = await app.inject({
        method: "POST", url: "/api/telegram/webhook",
        payload: { message: { chat: { id: 999 }, text: `/start ${"a".repeat(32)}` } },
      });
      expect(res.statusCode).toBe(200);
      expect(calls.some((u) => u.includes("bottok-club-A"))).toBe(true);
      const { db: db2, pool: pool2 } = await testDb();
      const after = await db2.select().from(users).where(eq(users.id, memA.id));
      expect(String(after[0].telegramChatId)).toBe("999");
      await pool2.end();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("unknown webhook tokens stay silent (no club to bill the reply to)", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", (async (url: string) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ ok: true }) };
    }) as any);
    try {
      const res = await app.inject({
        method: "POST", url: "/api/telegram/webhook",
        payload: { message: { chat: { id: 1 }, text: `/start ${"b".repeat(32)}` } },
      });
      expect(res.statusCode).toBe(200);
      expect(calls.length).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("admin pending notify reaches only the booking club admins", async () => {
    const sent: Array<{ url: string; body: any }> = [];
    vi.stubGlobal("fetch", (async (url: string, init: any) => {
      sent.push({ url: String(url), body: JSON.parse(init?.body || "{}") });
      return { ok: true, json: async () => ({ ok: true }) };
    }) as any);
    try {
      const { db, pool } = await testDb();
      const hash = await bcrypt.hash("Test1234!", 10);
      const clubRows = await db.select().from((await import("../db/schema.js")).clubs);
      const clubA = clubRows.find((c: any) => c.slug === "green-village")!;
      const clubB = clubRows.find((c: any) => c.slug === "beta")!;
      await db.update(appSettings).set({ notificationsEnabled: true, telegramBotToken: "tok-A", telegramAdminChatId: "111" }).where(eq(appSettings.clubId, clubA.id));
      // Linked admins in both clubs.
      await db.insert(users).values({ clubId: clubA.id, username: "admA", email: "a@x.io", passwordHash: hash, firstName: "A", lastName: "A", role: "admin", telegramChatId: "222", isVerified: true });
      await db.insert(users).values({ clubId: clubB.id, username: "admB", email: "b@x.io", passwordHash: hash, firstName: "B", lastName: "B", role: "admin", telegramChatId: "333", isVerified: true });
      const memRows = await db.select().from(users).where(eq(users.username, "member"));
      const memA = memRows.find((u: any) => String(u.clubId) === String(clubA.id))!;
      const [booking] = await db.insert(bookings).values({ clubId: clubA.id, courtId: courtA, userId: memA.id, date: tomorrow(), startTime: "10:00", endTime: "11:00", status: "pending_approval" }).returning();
      await pool.end();
      const { notifyAdminPendingBooking } = await import("../services/notifications.js");
      const { db: db2, pool: pool2 } = await testDb();
      await notifyAdminPendingBooking(db2, booking);
      await pool2.end();
      // Telegram sends go through club A's bot…
      const tg = sent.filter((s) => !String(s.url).includes("api.brevo.com"));
      expect(tg.length).toBeGreaterThan(0);
      expect(tg.every((s) => s.url.includes("bottok-A"))).toBe(true);
      // …to the manual list (111) + club A linked admin (222), never club B (333).
      const chatIds = tg.map((s) => String(s.body.chat_id)).sort();
      expect(chatIds).toEqual(["111", "222"]);
      // …and the email leg stays inside club A too (a@x.io present, b@x.io absent).
      const mails = sent.filter((s) => String(s.url).includes("api.brevo.com"));
      const addrs = mails.flatMap((m: any) => (m.body.to || []).map((t: any) => t.email));
      expect(addrs).toContain("a@x.io");
      expect(addrs).not.toContain("b@x.io");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
