import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanSlate, buildTestApp, loginAs, authHeaders, testDb, seedClub } from "./helpers.js";
import { courts } from "../db/schema.js";

// Next Monday (YYYY-MM-DD) so weekday-1 grids apply deterministically.
const nextMonday = () => {
  const d = new Date();
  const diff = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
};

describe("timetable windows (#24)", () => {
  cleanSlate();
  let app: any;
  let admin: any;
  let member: any;
  let courtId: string;
  beforeAll(async () => { app = await buildTestApp(); });
  beforeEach(async () => {
    admin = await loginAs(app, "green-village", "admin");
    member = await loginAs(app, "green-village", "member");
    const { db, pool } = await testDb();
    const cs = await db.select().from(courts);
    courtId = cs[0].id;
    await pool.end();
  });
  afterAll(async () => { await app.close(); });
  const H = () => authHeaders(admin.token, "green-village");
  const putDay = (dow: number, windows: any[], force = false) => app.inject({
    method: "PUT", url: `/api/timetable${force ? "?force=true" : ""}`, headers: H(),
    payload: { court_id: courtId, day_of_week: dow, windows },
  });

  it("legacy rows serve availability until a day is re-saved", async () => {
    const r = await app.inject({ method: "GET", url: `/api/availability?court_id=${courtId}&date=${nextMonday()}`, headers: { "X-Club-Slug": "green-village" } });
    expect(r.statusCode).toBe(200);
    const starts = r.json().slots.map((s: any) => s.start);
    expect(starts).toContain("08:00");
    expect(starts).toContain("21:00");
  });

  it("midday gap: Massimo example 9-13 + 16-21 @60", async () => {
    const put = await putDay(1, [
      { open_time: "09:00", close_time: "13:00", slot_duration_minutes: 60 },
      { open_time: "16:00", close_time: "21:00", slot_duration_minutes: 60 },
    ]);
    expect(put.statusCode).toBe(200);
    expect(put.json().stubs_dropped).toEqual([]);
    const r = await app.inject({ method: "GET", url: `/api/availability?court_id=${courtId}&date=${nextMonday()}`, headers: { "X-Club-Slug": "green-village" } });
    const starts = r.json().slots.map((s: any) => s.start);
    expect(starts).toEqual(["09:00", "10:00", "11:00", "12:00", "16:00", "17:00", "18:00", "19:00", "20:00"]);
  });

  it("rejects overlapping and inverted windows", async () => {
    const overlap = await putDay(2, [
      { open_time: "09:00", close_time: "13:00", slot_duration_minutes: 60 },
      { open_time: "12:00", close_time: "18:00", slot_duration_minutes: 60 },
    ]);
    expect(overlap.statusCode).toBe(400);
    expect(overlap.json()).toMatchObject({ error: "timetable_overlap" });
    const inverted = await putDay(2, [{ open_time: "18:00", close_time: "09:00", slot_duration_minutes: 60 }]);
    expect(inverted.statusCode).toBe(400);
    expect(inverted.json()).toMatchObject({ error: "timetable_bad_order" });
  });

  it("empty windows close the day", async () => {
    expect((await putDay(3, [])).statusCode).toBe(200);
    const r = await app.inject({ method: "GET", url: `/api/availability?court_id=${courtId}&date=${nextMonday()}`, headers: { "X-Club-Slug": "green-village" } });
    // nextMonday is a Monday; also verify a Wednesday is empty
    const wed = new Date(nextMonday() + "T12:00:00Z"); wed.setDate(wed.getDate() + 2);
    const w = wed.toISOString().slice(0, 10);
    const r2 = await app.inject({ method: "GET", url: `/api/availability?court_id=${courtId}&date=${w}`, headers: { "X-Club-Slug": "green-village" } });
    expect(r2.json().slots).toEqual([]);
    expect(r.json().slots.length).toBeGreaterThan(0);
  });

  it("copy Monday onto Tue-Fri", async () => {
    await putDay(1, [{ open_time: "09:00", close_time: "13:00", slot_duration_minutes: 60 }]);
    const cp = await app.inject({
      method: "POST", url: "/api/timetable/copy", headers: H(),
      payload: { court_id: courtId, from_dow: 1, to_dows: [2, 3, 4, 5] },
    });
    expect(cp.statusCode).toBe(200);
    expect(cp.json()).toMatchObject({ copied: 4 });
    const g = await app.inject({ method: "GET", url: `/api/timetable?court_id=${courtId}`, headers: { "X-Club-Slug": "green-village" } });
    expect(g.json().days[courtId].filter((w: any) => w.day_of_week === 4)).toHaveLength(1);
  });

  it("orphaning a live booking 409s unless forced", async () => {
    await putDay(1, [{ open_time: "08:00", close_time: "22:00", slot_duration_minutes: 60 }]);
    const bk = await app.inject({
      method: "POST", url: "/api/bookings", headers: authHeaders(admin.token, "green-village"),
      payload: { court_id: courtId, date: nextMonday(), start_time: "10:00" },
    });
    expect(bk.statusCode).toBe(201);
    const narrow = await putDay(1, [{ open_time: "16:00", close_time: "22:00", slot_duration_minutes: 60 }]);
    expect(narrow.statusCode).toBe(409);
    expect(narrow.json().conflicts.length).toBeGreaterThan(0);
    expect((await putDay(1, [{ open_time: "16:00", close_time: "22:00", slot_duration_minutes: 60 }], true)).statusCode).toBe(200);
  });

  it("booking duration comes from the containing window", async () => {
    await putDay(1, [
      { open_time: "08:00", close_time: "12:00", slot_duration_minutes: 90 },
      { open_time: "16:00", close_time: "22:00", slot_duration_minutes: 60 },
    ]);
    const bk = await app.inject({
      method: "POST", url: "/api/bookings", headers: authHeaders(member.token, "green-village"),
      payload: { court_id: courtId, date: nextMonday(), start_time: "16:00" },
    });
    expect(bk.statusCode).toBe(201);
    expect(bk.json().endTime.slice(0, 5)).toBe("17:00");
  });

  it("availability slots carry the window price", async () => {
    await putDay(1, [
      { open_time: "09:00", close_time: "13:00", slot_duration_minutes: 60, price_cents: 2500 },
      { open_time: "16:00", close_time: "21:00", slot_duration_minutes: 60 },
    ]);
    const r = await app.inject({ method: "GET", url: `/api/availability?court_id=${courtId}&date=${nextMonday()}`, headers: { "X-Club-Slug": "green-village" } });
    const byStart: Record<string, any> = {};
    for (const s of r.json().slots) byStart[s.start] = s;
    expect(byStart["09:00"].price_cents).toBe(2500);
    expect(byStart["16:00"].price_cents).toBe(1000); // inherits court price
  });

  it("booking price snapshots the window price, else the court price", async () => {
    await putDay(1, [
      { open_time: "08:00", close_time: "12:00", slot_duration_minutes: 60, price_cents: 2500 },
      { open_time: "16:00", close_time: "22:00", slot_duration_minutes: 60 },
    ]);
    const h = authHeaders(member.token, "green-village");
    const eve = await app.inject({
      method: "POST", url: "/api/bookings", headers: h,
      payload: { court_id: courtId, date: nextMonday(), start_time: "09:00" },
    });
    expect(eve.statusCode).toBe(201);
    expect(eve.json().priceCents).toBe(2500);
    const night = await app.inject({
      method: "POST", url: "/api/bookings", headers: h,
      payload: { court_id: courtId, date: nextMonday(), start_time: "16:00" },
    });
    expect(night.statusCode).toBe(201);
    expect(night.json().priceCents).toBe(1000); // seeded tennis court price
  });

  it("cross-club writes are rejected", async () => {
    const { db, pool } = await testDb();
    await seedClub(db, "beta", "Beta Club", "Europe/Rome");
    await pool.end();
    const beta = await loginAs(app, "beta", "admin");
    const r = await app.inject({
      method: "PUT", url: "/api/timetable", headers: authHeaders(beta.token, "beta"),
      payload: { court_id: courtId, day_of_week: 1, windows: [] },
    });
    expect(r.statusCode).toBe(400);
  });
});
