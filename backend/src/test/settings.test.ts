import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanSlate, buildTestApp, loginAs, authHeaders } from "./helpers.js";

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
  });
});
