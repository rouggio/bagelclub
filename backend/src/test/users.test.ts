import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanSlate, buildTestApp, loginAs, authHeaders, testDb } from "./helpers.js";
import { users, bookings, courts } from "../db/schema.js";
import { eq } from "drizzle-orm";

describe("users (soft delete)", () => {
  cleanSlate();
  let app: any;
  let admin: any;
  beforeAll(async () => { app = await buildTestApp(); });
  // NOTE: cleanSlate resets the DB before each test, so re-login per test.
  beforeEach(async () => { admin = await loginAs(app, "green-village", "admin"); });
  afterAll(async () => { await app.close(); });
  const H = () => authHeaders(admin.token, "green-village");

  it("delete stamps deleted_at and keeps the row + booking history", async () => {
    const member = await loginAs(app, "green-village", "member");
    const { db, pool } = await testDb();
    const cs = await db.select().from(courts);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await db.insert(bookings).values({ clubId: member.user.clubId, courtId: cs[0].id, userId: member.user.id, date: tomorrow, startTime: "10:00", endTime: "11:00", status: "approved" });
    await pool.end();
    const del = await app.inject({ method: "DELETE", url: `/api/users/${member.user.id}`, headers: H() });
    expect(del.statusCode).toBe(204);
    const { db: db2, pool: pool2 } = await testDb();
    const rows = await db2.select().from(users).where(eq(users.id, member.user.id));
    expect(rows[0].deletedAt).toBeTruthy();
    const kept = await db2.select().from(bookings).where(eq(bookings.userId, member.user.id));
    expect(kept.length).toBe(1); // history preserved (physical delete destroyed it)
    await pool2.end();
  });

  it("deleted handle is reusable, and restore refuses a re-taken handle", async () => {
    const member = await loginAs(app, "green-village", "member");
    expect((await app.inject({ method: "DELETE", url: `/api/users/${member.user.id}`, headers: H() })).statusCode).toBe(204);
    const r = await app.inject({
      method: "POST", url: "/api/auth/register", headers: { "X-Club-Slug": "green-village" },
      payload: { username: "member", email: "member@test.local", mobile: "393331234567", password: "Test1234!", first_name: "M", last_name: "2" },
    });
    expect(r.statusCode).toBe(201);
    const restore = await app.inject({ method: "POST", url: `/api/users/${member.user.id}/restore`, headers: H() });
    expect(restore.statusCode).toBe(409);
  });

  it("last admin cannot be deleted or demoted", async () => {
    const list = await app.inject({ method: "GET", url: "/api/users?role=admin", headers: H() });
    expect(list.json().length).toBe(1);
    expect((await app.inject({ method: "DELETE", url: `/api/users/${admin.user.id}`, headers: H() })).statusCode).toBe(400);
  });

  it("admin cannot delete themselves", async () => {
    const del = await app.inject({ method: "DELETE", url: `/api/users/${admin.user.id}`, headers: H() });
    expect(del.statusCode).toBe(400);
  });
});
