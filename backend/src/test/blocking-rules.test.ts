import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanSlate, buildTestApp, loginAs, authHeaders, testDb } from "./helpers.js";
import { blockingRules } from "../db/schema.js";

describe("blocking-rules multi-day create", () => {
  cleanSlate();
  let app: any;
  let admin: any;
  beforeAll(async () => { app = await buildTestApp(); });
  beforeEach(async () => { admin = await loginAs(app, "green-village", "admin"); });
  afterAll(async () => { await app.close(); });
  const H = () => ({ ...authHeaders(admin.token, "green-village"), "Content-Type": "application/json" });

  it("array day_of_week creates one rule per day; single still works", async () => {
    const multi = await app.inject({ method: "POST", url: "/api/blocking-rules", headers: H(), payload: { day_of_week: [1, 3, 5], start_time: "15:00", end_time: "17:00", reason: "School" } });
    expect(multi.statusCode).toBe(201);
    expect(multi.json()).toHaveLength(3);
    const single = await app.inject({ method: "POST", url: "/api/blocking-rules", headers: H(), payload: { day_of_week: 2, start_time: "15:00", end_time: "17:00", reason: "Solo" } });
    expect(single.statusCode).toBe(201);
    expect(Array.isArray(single.json())).toBe(true);
    const bad = await app.inject({ method: "POST", url: "/api/blocking-rules", headers: H(), payload: { day_of_week: [1, 9], start_time: "15:00", end_time: "17:00", reason: "Bad" } });
    expect(bad.statusCode).toBe(400);
    const { db, pool } = await testDb();
    const rows = await db.select().from(blockingRules);
    await pool.end();
    expect(rows.map((r: any) => r.dayOfWeek).sort()).toEqual([1, 2, 3, 5]);
  });
});
