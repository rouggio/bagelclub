import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import { cleanSlate, buildTestApp, testDb } from "./helpers.js";
import { clubs, users, courts, bookings, appSettings } from "../db/schema.js";
import { eq } from "drizzle-orm";

const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

describe("notification channels (#23)", () => {
  cleanSlate();
  let app: any;
  beforeAll(async () => { app = await buildTestApp(); });
  afterAll(async () => { await app.close(); });

  async function seed() {
    const { db, pool } = await testDb();
    const hash = await bcrypt.hash("Test1234!", 10);
    const [club] = await db.insert(clubs).values({ slug: "chan", name: "Chan Club", timezone: "Europe/Rome" }).returning();
    await db.insert(appSettings).values({ clubId: club.id, notificationsEnabled: true }).onConflictDoNothing();
    const [admin] = await db.insert(users).values({ clubId: club.id, username: "boss", email: "boss@chan.local", passwordHash: hash, firstName: "B", lastName: "O", role: "admin", isVerified: true }).returning();
    const [mem] = await db.insert(users).values({ clubId: club.id, username: "mem", email: "mem@chan.local", passwordHash: hash, firstName: "M", lastName: "E", role: "associate", isVerified: true }).returning();
    const [court] = await db.insert(courts).values({ clubId: club.id, number: 1, type: "tennis", name: "C1" }).returning();
    const [booking] = await db.insert(bookings).values({ clubId: club.id, courtId: court.id, userId: mem.id, date: tomorrow(), startTime: "10:00", endTime: "11:00", status: "pending_approval" }).returning();
    await pool.end();
    return { club, admin, mem, booking };
  }
  const brevoCalls = (sent: any[]) => sent.filter((s) => String(s.url).includes("api.brevo.com"));

  it("pending pings admin emails; user opt-out silences only them", async () => {
    const { club, admin, booking } = await seed();
    const sent: any[] = [];
    vi.stubGlobal("fetch", (async (url: string, init: any) => {
      sent.push({ url: String(url), body: JSON.parse(init?.body || "{}") });
      return { ok: true, text: async () => "", json: async () => ({}) };
    }) as any);
    try {
      const { notifyAdminPendingBooking } = await import("../services/notifications.js");
      const { db, pool } = await testDb();
      await notifyAdminPendingBooking(db, booking);
      await pool.end();
      const mails = brevoCalls(sent);
      expect(mails.length).toBe(1);
      expect(mails[0].body.to).toMatchObject([{ email: "boss@chan.local" }]);
      // Admin opts out of email → silence, others unaffected.
      const { db: db2, pool: pool2 } = await testDb();
      await db2.update(users).set({ notifyEmail: false }).where(eq(users.id, admin.id));
      await pool2.end();
      sent.length = 0;
      const { db: db3, pool: pool3 } = await testDb();
      await notifyAdminPendingBooking(db3, booking);
      await pool3.end();
      expect(brevoCalls(sent).length).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      const { db, pool } = await testDb();
      await db.delete(bookings).where(eq(bookings.clubId, club.id));
      await db.delete(users).where(eq(users.clubId, club.id));
      await db.delete(courts).where(eq(courts.clubId, club.id));
      await db.delete(appSettings).where(eq(appSettings.clubId, club.id));
      await db.delete(clubs).where(eq(clubs.id, club.id));
      await pool.end();
    }
  });

  it("retired master switch is ignored: push flows on matrix + channels alone", async () => {
    const { club, booking } = await seed();
    const sent: any[] = [];
    vi.stubGlobal("fetch", (async (url: string, init: any) => {
      sent.push({ url: String(url), body: JSON.parse(init?.body || "{}") });
      return { ok: true, text: async () => "", json: async () => ({}) };
    }) as any);
    try {
      const { notifyAdminPendingBooking } = await import("../services/notifications.js");
      const { db, pool } = await testDb();
      await db.update(appSettings).set({ notificationsEnabled: false, telegramBotToken: "tok", telegramAdminChatId: "111" }).where(eq(appSettings.clubId, club.id));
      await pool.end();
      const { db: db2, pool: pool2 } = await testDb();
      await notifyAdminPendingBooking(db2, booking);
      await pool2.end();
      const tg = sent.filter((s) => !String(s.url).includes("api.brevo.com"));
      expect(tg.length).toBeGreaterThan(0);
      expect(sent.filter((s) => String(s.url).includes("api.brevo.com")).length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
      const { db, pool } = await testDb();
      await db.delete(bookings).where(eq(bookings.clubId, club.id));
      await db.delete(users).where(eq(users.clubId, club.id));
      await db.delete(courts).where(eq(courts.clubId, club.id));
      await db.delete(appSettings).where(eq(appSettings.clubId, club.id));
      await db.delete(clubs).where(eq(clubs.id, club.id));
      await pool.end();
    }
  });

  it("club email channel off silences mail; admin event flag off silences all", async () => {
    const { club, booking } = await seed();
    const sent: any[] = [];
    vi.stubGlobal("fetch", (async (url: string, init: any) => {
      sent.push({ url: String(url), body: JSON.parse(init?.body || "{}") });
      return { ok: true, text: async () => "", json: async () => ({}) };
    }) as any);
    try {
      const { notifyAdminPendingBooking } = await import("../services/notifications.js");
      const { db, pool } = await testDb();
      await db.update(appSettings).set({ notifyRequestEmail: false }).where(eq(appSettings.clubId, club.id));
      await pool.end();
      const { db: db2, pool: pool2 } = await testDb();
      await notifyAdminPendingBooking(db2, booking);
      await pool2.end();
      expect(brevoCalls(sent).length).toBe(0);
      const { db: db3, pool: pool3 } = await testDb();
      await db3.update(appSettings).set({ notifyRequestEmail: false, notifyRequestPush: false }).where(eq(appSettings.clubId, club.id));
      await pool3.end();
      sent.length = 0;
      const { db: db4, pool: pool4 } = await testDb();
      await notifyAdminPendingBooking(db4, booking);
      await pool4.end();
      expect(sent.length).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      const { db, pool } = await testDb();
      await db.delete(bookings).where(eq(bookings.clubId, club.id));
      await db.delete(users).where(eq(users.clubId, club.id));
      await db.delete(courts).where(eq(courts.clubId, club.id));
      await db.delete(appSettings).where(eq(appSettings.clubId, club.id));
      await db.delete(clubs).where(eq(clubs.id, club.id));
      await pool.end();
    }
  });

  it("decision mails the booker, honoring their opt-out", async () => {
    const { club, mem, booking } = await seed();
    const sent: any[] = [];
    vi.stubGlobal("fetch", (async (url: string, init: any) => {
      sent.push({ url: String(url), body: JSON.parse(init?.body || "{}") });
      return { ok: true, text: async () => "", json: async () => ({}) };
    }) as any);
    try {
      const { notifyUserBookingDecision } = await import("../services/notifications.js");
      const { db, pool } = await testDb();
      await notifyUserBookingDecision(db, booking, "approved");
      await pool.end();
      const mails = brevoCalls(sent);
      expect(mails.length).toBe(1);
      expect(mails[0].body.to).toMatchObject([{ email: "mem@chan.local" }]);
      expect(mails[0].body.subject).toContain("Chan Club");
      const { db: db2, pool: pool2 } = await testDb();
      await db2.update(users).set({ notifyEmail: false }).where(eq(users.id, mem.id));
      await pool2.end();
      sent.length = 0;
      const { db: db3, pool: pool3 } = await testDb();
      await notifyUserBookingDecision(db3, booking, "approved");
      await pool3.end();
      expect(brevoCalls(sent).length).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      const { db, pool } = await testDb();
      await db.delete(bookings).where(eq(bookings.clubId, club.id));
      await db.delete(users).where(eq(users.clubId, club.id));
      await db.delete(courts).where(eq(courts.clubId, club.id));
      await db.delete(appSettings).where(eq(appSettings.clubId, club.id));
      await db.delete(clubs).where(eq(clubs.id, club.id));
      await pool.end();
    }
  });
});
