import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanSlate, buildTestApp, loginAs, authHeaders, testDb } from "./helpers.js";
import { auditLog } from "../db/schema.js";

describe("club settings toggles", () => {
  cleanSlate();
  let app: any;
  let admin: any;
  beforeAll(async () => { app = await buildTestApp(); });
  beforeEach(async () => { admin = await loginAs(app, "green-village", "admin"); });
  afterAll(async () => { await app.close(); });
  const H = () => authHeaders(admin.token, "green-village");

  it("show_prices defaults true and toggles via PUT", async () => {
    const get1 = await app.inject({ method: "GET", url: "/api/settings", headers: H() });
    expect(get1.json().show_prices).toBe(true);
    const put = await app.inject({ method: "PUT", url: "/api/settings", headers: H(), payload: { show_prices: false } });
    expect(put.statusCode).toBe(200);
    const get2 = await app.inject({ method: "GET", url: "/api/settings", headers: H() });
    expect(get2.json().show_prices).toBe(false);
    const info = await app.inject({ method: "GET", url: "/api/club-info?slug=green-village", headers: { "X-Club-Slug": "green-village" } });
    expect(info.json().show_prices).toBe(false);
    const { db, pool } = await testDb();
    const rows = await db.select().from(auditLog);
    await pool.end();
    const logged = rows.find((a: any) => a.action === "club.settings");
    expect(logged).toBeTruthy();
    expect(JSON.parse(logged.meta).keys).toContain("show_prices");
  });

  it("closed signup 403s public registration, open allows it", async () => {
    const reg = (payload: any) => app.inject({
      method: "POST", url: "/api/auth/register", headers: { "X-Club-Slug": "green-village" }, payload,
    });
    const body = { username: "gated1", email: "gated1@x.io", mobile: "393331234567", password: "Test1234!", first_name: "Gated", last_name: "One" };
    const shut = await app.inject({ method: "PUT", url: "/api/settings", headers: H(), payload: { allow_open_signup: false } });
    expect(shut.statusCode).toBe(200);
    const denied = await reg(body);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: "signup_closed" });
    const open = await app.inject({ method: "PUT", url: "/api/settings", headers: H(), payload: { allow_open_signup: true } });
    expect(open.statusCode).toBe(200);
    const allowed = await reg(body);
    expect(allowed.statusCode).toBe(201);
    const info = await app.inject({ method: "GET", url: "/api/club-info?slug=green-village", headers: { "X-Club-Slug": "green-village" } });
    expect(info.json().allow_open_signup).toBe(true);
  });

  it("slot_time_format round-trips via PUT and surfaces in club-info", async () => {    const get1 = await app.inject({ method: "GET", url: "/api/settings", headers: H() });
    expect(get1.json().slot_time_format).toBe("start_end");
    const bad = await app.inject({ method: "PUT", url: "/api/settings", headers: H(), payload: { slot_time_format: "nope" } });
    expect(bad.statusCode).toBe(400);
    const put = await app.inject({ method: "PUT", url: "/api/settings", headers: H(), payload: { slot_time_format: "start" } });
    expect(put.statusCode).toBe(200);
    expect(put.json().slot_time_format).toBe("start");
    const info = await app.inject({ method: "GET", url: "/api/club-info?slug=green-village", headers: { "X-Club-Slug": "green-village" } });
    expect(info.json().slot_time_format).toBe("start");
  });

  it("participant names tooltip flag round-trips; availability attaches names only when on", async () => {
    const put = await app.inject({ method: "PUT", url: "/api/settings", headers: H(), payload: { show_participant_names: true } });
    expect(put.statusCode).toBe(200);
    expect(put.json().show_participant_names).toBe(true);
    const info = await app.inject({ method: "GET", url: "/api/club-info?slug=green-village", headers: { "X-Club-Slug": "green-village" } });
    expect(info.json().show_participant_names).toBe(true);
    const { db, pool } = await testDb();
    const { courts, bookings, bookingParticipants, users } = await import("../db/schema.js");
    const cs = await db.select().from(courts);
    const mem = (await db.select().from(users)).find((u: any) => u.username === "member");
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const [b] = await db.insert(bookings).values({ clubId: mem.clubId, courtId: cs[0].id, userId: mem.id, date: tomorrow, startTime: "10:00", endTime: "11:00", status: "approved" }).returning();
    await db.insert(bookingParticipants).values({ bookingId: b.id, clubId: mem.clubId, userId: mem.id });
    await pool.end();
    const on = await app.inject({ method: "GET", url: `/api/availability?court_id=${cs[0].id}&date=${tomorrow}&days=1`, headers: { "X-Club-Slug": "green-village" } });
    const slotsOn = on.json().courts[cs[0].id][tomorrow];
    expect(slotsOn.find((s: any) => s.status === "booked").participant_usernames).toContain("member");
    await app.inject({ method: "PUT", url: "/api/settings", headers: H(), payload: { show_participant_names: false } });
    const off = await app.inject({ method: "GET", url: `/api/availability?court_id=${cs[0].id}&date=${tomorrow}&days=1`, headers: { "X-Club-Slug": "green-village" } });
    expect(off.json().courts[cs[0].id][tomorrow].find((s: any) => s.status === "booked").participant_usernames).toBeUndefined();
  });
});
