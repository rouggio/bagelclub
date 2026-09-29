import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import { cleanSlate, buildTestApp, testDb, loginAs, authHeaders } from "./helpers.js";
import { clubs, users, courts, bookings, appSettings, notifyPolicy } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

describe("notification channels v2 (#23)", () => {
  cleanSlate();
  let app: any;
  beforeAll(async () => { app = await buildTestApp(); });
  afterAll(async () => { await app.close(); });

  async function seed() {
    const { db, pool } = await testDb();
    const hash = await bcrypt.hash("Test1234!", 10);
    const [club] = await db.insert(clubs).values({ slug: "chan", name: "Chan Club", timezone: "Europe/Rome" }).returning();
    await db.insert(appSettings).values({ clubId: club.id }).onConflictDoNothing();
    const [admin] = await db.insert(users).values({ clubId: club.id, username: "boss", email: "boss@chan.local", passwordHash: hash, firstName: "B", lastName: "O", role: "admin", isVerified: true }).returning();
    const [mem] = await db.insert(users).values({ clubId: club.id, username: "mem", email: "mem@chan.local", passwordHash: hash, firstName: "M", lastName: "E", role: "associate", isVerified: true }).returning();
    const [court] = await db.insert(courts).values({ clubId: club.id, number: 1, type: "tennis", name: "C1" }).returning();
    const [booking] = await db.insert(bookings).values({ clubId: club.id, courtId: court.id, userId: mem.id, date: tomorrow(), startTime: "10:00", endTime: "11:00", status: "pending_approval" }).returning();
    await pool.end();
    return { club, admin, mem, booking };
  }
  async function cleanup(clubId: string) {
    const { db, pool } = await testDb();
    await db.delete(bookings).where(eq(bookings.clubId, clubId));
    await db.delete(users).where(eq(users.clubId, clubId));
    await db.delete(courts).where(eq(courts.clubId, clubId));
    await db.delete(appSettings).where(eq(appSettings.clubId, clubId));
    await db.delete(clubs).where(eq(clubs.id, clubId));
    await pool.end();
  }
  const brevoCalls = (sent: any[]) => sent.filter((s) => String(s.url).includes("api.brevo.com"));
  const tgCalls = (sent: any[]) => sent.filter((s) => String(s.url).includes("api.telegram.org"));
  function stubFetch(sent: any[]) {
    vi.stubGlobal("fetch", (async (url: string, init: any) => {
      sent.push({ url: String(url), body: JSON.parse(init?.body || "{}") });
      return { ok: true, text: async () => "", json: async () => ({}) };
    }) as any);
  }

  it("pending pings admin emails; policy off silences", async () => {
    const { club, booking } = await seed();
    const sent: any[] = [];
    stubFetch(sent);
    try {
      const { notifyAdminPendingBooking } = await import("../services/notifications.js");
      const { db, pool } = await testDb();
      await notifyAdminPendingBooking(db, booking);
      await pool.end();
      const mails = brevoCalls(sent);
      expect(mails.length).toBe(1);
      expect(mails[0].body.to).toMatchObject([{ email: "boss@chan.local" }]);
      // Admin policy email leg off → silence.
      const { db: db2, pool: pool2 } = await testDb();
      await db2.update(notifyPolicy)
        .set({ toAdminsEmail: false })
        .where(and(eq(notifyPolicy.clubId, club.id), eq(notifyPolicy.event, "request")));
      await pool2.end();
      sent.length = 0;
      const { db: db3, pool: pool3 } = await testDb();
      await notifyAdminPendingBooking(db3, booking);
      await pool3.end();
      expect(brevoCalls(sent).length).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      await cleanup(club.id);
    }
  });

  it("admin push respects channel master; user push respects per-event pref", async () => {
    const { club, admin, mem, booking } = await seed();
    const sent: any[] = [];
    stubFetch(sent);
    try {
      const { db, pool } = await testDb();
      await db.update(appSettings).set({ telegramBotToken: "tok", telegramAdminChatId: "111" }).where(eq(appSettings.clubId, club.id));
      await db.update(users).set({ telegramChatId: "222" }).where(eq(users.id, admin.id));
      await db.update(users).set({ telegramChatId: "333" }).where(eq(users.id, mem.id));
      await pool.end();
      const { notifyAdminPendingBooking, notifyUserBookingDecision } = await import("../services/notifications.js");
      const { db: db2, pool: pool2 } = await testDb();
      await notifyAdminPendingBooking(db2, booking);
      await pool2.end();
      // manual 111 + linked admin 222
      expect(tgCalls(sent).length).toBe(2);
      // Admin kills their push master → linked 222 drops, manual 111 stays.
      const { db: db3, pool: pool3 } = await testDb();
      await db3.update(users).set({ notifyPushMaster: false }).where(eq(users.id, admin.id));
      await pool3.end();
      sent.length = 0;
      const { db: db4, pool: pool4 } = await testDb();
      await notifyAdminPendingBooking(db4, booking);
      await pool4.end();
      expect(tgCalls(sent).length).toBe(1);
      // User decision: push + email both fire.
      sent.length = 0;
      const { db: db5, pool: pool5 } = await testDb();
      await notifyUserBookingDecision(db5, booking, "approved");
      await pool5.end();
      expect(tgCalls(sent).length).toBe(1);
      expect(brevoCalls(sent).length).toBe(1);
      // User mutes approval push → TG gone, mandatory email stays.
      const { db: db6, pool: pool6 } = await testDb();
      const { notifyEventPrefs } = await import("../db/schema.js");
      await db6.insert(notifyEventPrefs).values({ userId: mem.id, clubId: club.id, event: "approval", push: false });
      await pool6.end();
      sent.length = 0;
      const { db: db7, pool: pool7 } = await testDb();
      await notifyUserBookingDecision(db7, booking, "approved");
      await pool7.end();
      expect(tgCalls(sent).length).toBe(0);
      expect(brevoCalls(sent).length).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      await cleanup(club.id);
    }
  });

  it("policy + prefs endpoints round-trip", async () => {
    await seed();
    try {
      const { token: adminTok } = await loginAs(app, "chan", "boss");
      const { token: memTok } = await loginAs(app, "chan", "mem");
      const H = authHeaders(adminTok, "chan");
      // Settings GET carries the 4-row policy.
      const g = await app.inject({ method: "GET", url: "/api/settings", headers: H });
      expect(g.statusCode).toBe(200);
      expect(g.json().notify_policy).toHaveLength(4);
      // Flip approval push off via PUT.
      const put = await app.inject({ method: "PUT", url: "/api/settings", headers: H,
        payload: { notify_policy: [{ event: "approval", to_users_email: true, to_users_push: false, to_admins_email: false, to_admins_push: false }] } });
      expect(put.statusCode).toBe(200);
      const row = put.json().notify_policy.find((p: any) => p.event === "approval");
      expect(row.to_users_push).toBe(false);
      // Other events untouched.
      expect(put.json().notify_policy.find((p: any) => p.event === "rejection").to_users_push).toBe(true);
      // Prefs GET shape.
      const pg = await app.inject({ method: "GET", url: "/api/users/me/notify-prefs", headers: authHeaders(memTok, "chan") });
      expect(pg.statusCode).toBe(200);
      expect(pg.json().push_master).toBe(true);
      expect(pg.json().channels.email.locked).toBe(true);
      // Prefs PUT upsert.
      const pp = await app.inject({ method: "PUT", url: "/api/users/me/notify-prefs", headers: authHeaders(memTok, "chan"),
        payload: { event: "rejection", push: false } });
      expect(pp.statusCode).toBe(200);
      const pg2 = await app.inject({ method: "GET", url: "/api/users/me/notify-prefs", headers: authHeaders(memTok, "chan") });
      expect(pg2.json().prefs.find((p: any) => p.event === "rejection").push).toBe(false);
      // Bad event rejected.
      const bad = await app.inject({ method: "PUT", url: "/api/users/me/notify-prefs", headers: authHeaders(memTok, "chan"),
        payload: { event: "nope", push: false } });
      expect(bad.statusCode).toBe(400);
    } finally {
      const { db, pool } = await testDb();
      const cs = await db.select().from(clubs);
      await pool.end();
      const c = cs.find((x: any) => x.slug === "chan");
      if (c) await cleanup(c.id);
    }
  });
});
