import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanSlate, buildTestApp, loginAs, authHeaders, testDb, seedClub } from "./helpers.js";
import { courts, auditLog } from "../db/schema.js";

const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

describe("bookings (club-scoped)", () => {
  cleanSlate();
  let app: any;
  let member: any;
  let admin: any;
  let courtId: string;
  beforeAll(async () => { app = await buildTestApp(); });
  // NOTE: cleanSlate resets the DB before each test, so identities are re-logged per test.
  beforeEach(async () => {
    member = await loginAs(app, "green-village", "member");
    admin = await loginAs(app, "green-village", "admin");
    const { db, pool } = await testDb();
    const cs = await db.select().from(courts);
    courtId = cs[0].id;
    await pool.end();
  });
  afterAll(async () => { await app.close(); });

  it("creates a booking with price snapshot from the court", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/bookings", headers: authHeaders(member.token, "green-village"),
      payload: { court_id: courtId, date: tomorrow(), start_time: "10:00" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().clubId).toBe(member.user.clubId);
    expect(res.json().priceCents).toBe(1000); // seeded tennis price
  });

  it("rejects overlapping bookings with 409", async () => {
    const payload = { court_id: courtId, date: tomorrow(), start_time: "12:00" };
    const h = authHeaders(member.token, "green-village");
    expect((await app.inject({ method: "POST", url: "/api/bookings", headers: h, payload })).statusCode).toBe(201);
    const r2 = await app.inject({ method: "POST", url: "/api/bookings", headers: h, payload });
    expect(r2.statusCode).toBe(409);
  });

  it("rejects a court from another club", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/bookings", headers: authHeaders(member.token, "green-village"),
      payload: { court_id: "00000000-0000-0000-0000-000000000000", date: tomorrow(), start_time: "10:00" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("booking detail is invisible cross-club", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/bookings", headers: authHeaders(member.token, "green-village"),
      payload: { court_id: courtId, date: tomorrow(), start_time: "14:00" },
    });
    const id = created.json().id;
    // A beta-scoped request (even by an admin) must not see green-village rows.
    const { db: dbB, pool: poolB } = await testDb();
    await seedClub(dbB, "beta", "Beta Club", "Europe/Rome");
    await poolB.end();
    const betaAdmin = await loginAs(app, "beta", "admin");
    const r = await app.inject({ method: "GET", url: `/api/bookings/${id}?slug=beta`, headers: authHeaders(betaAdmin.token) });
    expect(r.statusCode).toBe(404);
    // And a green admin poking at the beta scope is rejected, not leaked.
    const r2 = await app.inject({ method: "GET", url: `/api/bookings/${id}?slug=beta`, headers: authHeaders(admin.token) });
    expect(r2.statusCode).toBe(403);
  });

  it("past guard uses the club timezone", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/bookings", headers: authHeaders(member.token, "green-village"),
      payload: { court_id: courtId, date: "2020-01-01", start_time: "10:00" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("admin approve/reject are audited", async () => {
    const mh = authHeaders(member.token, "green-village");
    const ah = authHeaders(admin.token, "green-village");
    const mk = (t: string) => app.inject({ method: "POST", url: "/api/bookings", headers: mh, payload: { court_id: courtId, date: tomorrow(), start_time: t } });
    const b1 = (await mk("10:00")).json().id;
    const b2 = (await mk("12:00")).json().id;
    expect((await app.inject({ method: "POST", url: `/api/bookings/${b1}/approve`, headers: ah })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/bookings/${b2}/reject`, headers: ah })).statusCode).toBe(200);
    const { db, pool } = await testDb();
    const rows = await db.select().from(auditLog);
    await pool.end();
    const byTarget = (id: string) => rows.filter((a: any) => String(a.target) === String(id)).map((a: any) => a.action);
    expect(byTarget(b1)).toContain("booking.approve");
    expect(byTarget(b2)).toContain("booking.reject");
  });
});
