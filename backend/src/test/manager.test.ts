import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanSlate, buildTestApp, loginAs, authHeaders, testDb } from "./helpers.js";
import { courts, auditLog } from "../db/schema.js";

const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

describe("booking manager #35", () => {
  cleanSlate();
  let app: any;
  let admin: any;
  let member: any;
  let manager: any;
  let courtId: string;
  beforeAll(async () => { app = await buildTestApp(); });
  beforeEach(async () => {
    admin = await loginAs(app, "green-village", "admin");
    member = await loginAs(app, "green-village", "member");
    const { db, pool } = await testDb();
    const cs = await db.select().from(courts);
    courtId = cs[0].id;
    await pool.end();
    const ah = { ...authHeaders(admin.token, "green-village"), "Content-Type": "application/json" };
    const mk = await app.inject({ method: "POST", url: "/api/users", headers: ah, payload: { username: "mog", email: "mog@test.local", password: "Test1234!", first_name: "M", last_name: "O", role: "manager" } });
    expect(mk.statusCode).toBe(201);
    manager = await loginAs(app, "green-village", "mog");
    expect(manager.user.role).toBe("manager");
  });
  afterAll(async () => { await app.close(); });

  it("manager sees the full queue and approves/rejects", async () => {
    const mh = { ...authHeaders(member.token, "green-village"), "Content-Type": "application/json" };
    const b1 = await app.inject({ method: "POST", url: "/api/bookings", headers: mh, payload: { court_id: courtId, date: tomorrow(), start_time: "10:00" } });
    expect(b1.statusCode).toBe(201);
    const q = await app.inject({ method: "GET", url: "/api/bookings", headers: authHeaders(manager.token, "green-village") });
    expect(q.statusCode).toBe(200);
    expect(q.json().some((b: any) => String(b.userId || b.user_id) === String(member.user.id))).toBe(true);
    const ap = await app.inject({ method: "POST", url: `/api/bookings/${b1.json().id}/approve`, headers: authHeaders(manager.token, "green-village") });
    expect(ap.statusCode).toBe(200);
    expect(ap.json().status).toBe("approved");
    const b2 = await app.inject({ method: "POST", url: "/api/bookings", headers: mh, payload: { court_id: courtId, date: tomorrow(), start_time: "12:00" } });
    const rj = await app.inject({ method: "POST", url: `/api/bookings/${b2.json().id}/reject`, headers: authHeaders(manager.token, "green-village") });
    expect(rj.statusCode).toBe(200);
    expect(rj.json().status).toBe("rejected");
  });

  it("manager is locked out of everything else; associates cannot moderate", async () => {
    const mAuth = authHeaders(manager.token, "green-village");
    const mJson = { ...mAuth, "Content-Type": "application/json" };
    expect((await app.inject({ method: "GET", url: "/api/users", headers: mAuth })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/api/settings", headers: mJson, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/reports/bookings", headers: mAuth })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/courts", headers: mJson, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/fees/overview", headers: mAuth })).statusCode).toBe(403);
    const mh = { ...authHeaders(member.token, "green-village"), "Content-Type": "application/json" };
    const b = await app.inject({ method: "POST", url: "/api/bookings", headers: mh, payload: { court_id: courtId, date: tomorrow(), start_time: "10:00" } });
    // Bodyless POSTs carry no Content-Type (else the JSON parser 400s).
    expect((await app.inject({ method: "POST", url: `/api/bookings/${b.json().id}/approve`, headers: authHeaders(member.token, "green-village") })).statusCode).toBe(403);
    // Manager cannot edit someone else's booking either.
    expect((await app.inject({ method: "PATCH", url: `/api/bookings/${b.json().id}`, headers: mJson, payload: { notes: "x" } })).statusCode).toBe(403);
    const ah = { ...authHeaders(admin.token, "green-village"), "Content-Type": "application/json" };
    expect((await app.inject({ method: "POST", url: `/api/bookings/${b.json().id}/approve`, headers: authHeaders(admin.token, "green-village") })).statusCode).toBe(200);
  });

  it("manager is assignable/filterable, audited as grant, excluded from fees", async () => {
    const ah = { ...authHeaders(admin.token, "green-village"), "Content-Type": "application/json" };
    const pr = await app.inject({ method: "PATCH", url: `/api/users/${member.user.id}/role`, headers: ah, payload: { role: "manager" } });
    expect(pr.statusCode).toBe(200);
    const { db, pool } = await testDb();
    const audits = await db.select().from(auditLog);
    await pool.end();
    expect(audits.some((a: any) => a.action === "admin.role.grant" && String(a.target) === String(member.user.id))).toBe(true);
    const filt = await app.inject({ method: "GET", url: "/api/users?role=manager", headers: authHeaders(admin.token, "green-village") });
    expect(filt.statusCode).toBe(200);
    expect(filt.json().length).toBeGreaterThanOrEqual(2);
    const ov = await app.inject({ method: "GET", url: "/api/fees/overview", headers: authHeaders(admin.token, "green-village") });
    expect(ov.statusCode).toBe(200);
    expect(ov.json().users.some((u: any) => u.username === "mog")).toBe(false);
  });
});
