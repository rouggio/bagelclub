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

  it("slot_time_format round-trips via PUT and surfaces in club-info", async () => {
    const get1 = await app.inject({ method: "GET", url: "/api/settings", headers: H() });
    expect(get1.json().slot_time_format).toBe("start_end");
    const bad = await app.inject({ method: "PUT", url: "/api/settings", headers: H(), payload: { slot_time_format: "nope" } });
    expect(bad.statusCode).toBe(400);
    const put = await app.inject({ method: "PUT", url: "/api/settings", headers: H(), payload: { slot_time_format: "start" } });
    expect(put.statusCode).toBe(200);
    expect(put.json().slot_time_format).toBe("start");
    const info = await app.inject({ method: "GET", url: "/api/club-info?slug=green-village", headers: { "X-Club-Slug": "green-village" } });
    expect(info.json().slot_time_format).toBe("start");
  });
});
