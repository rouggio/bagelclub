import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { cleanSlate, buildTestApp, loginAs, authHeaders, testDb } from "./helpers.js";
import { users, appSettings, auditLog } from "../db/schema.js";
import { eq } from "drizzle-orm";

describe("club-admin 2fa", () => {
  cleanSlate();
  let app: any;
  let admin: any;
  let sent: Array<{ url: string; body: any }>;
  const codeFromLastSms = () => {
    const m = String(sent[sent.length - 1]?.body?.text || "").match(/\b(\d{6})\b/);
    return m ? m[1] : null;
  };
  beforeAll(async () => {
    sent = [];
    vi.stubGlobal("fetch", (async (url: string, init: any) => {
      sent.push({ url: String(url), body: JSON.parse(init?.body || "{}") });
      return { ok: true, json: async () => ({ ok: true }) };
    }) as any);
    app = await buildTestApp();
  });
  beforeEach(async () => {
    sent.length = 0;
    admin = await loginAs(app, "green-village", "admin");
    // Deliverable channel: club bot + linked admin.
    const { db, pool } = await testDb();
    const clubs = (await db.select().from((await import("../db/schema.js")).clubs));
    const club = clubs.find((c: any) => c.slug === "green-village")!;
    await db.update(appSettings).set({ telegramBotToken: "tok-club" }).where(eq(appSettings.clubId, club.id));
    await db.update(users).set({ telegramChatId: "777" }).where(eq(users.id, admin.user.id));
    await pool.end();
  });
  afterAll(async () => { vi.unstubAllGlobals(); await app.close(); });
  const H = () => authHeaders(admin.token, "green-village");

  it("PUT cannot flip 2fa directly; enable needs verified OTP", async () => {
    const put = await app.inject({ method: "PUT", url: "/api/settings", headers: { ...H(), "Content-Type": "application/json" }, payload: { two_fa_enabled: true } });
    expect(put.statusCode).toBe(400);
    const code = await app.inject({ method: "POST", url: "/api/settings/2fa/code", headers: { ...H(), "Content-Type": "application/json" }, payload: { action: "enable" } });
    expect(code.statusCode).toBe(200);
    expect(sent.length).toBe(1);
    const otp = codeFromLastSms();
    const confirm = await app.inject({ method: "POST", url: "/api/settings/2fa/confirm", headers: { ...H(), "Content-Type": "application/json" }, payload: { action: "enable", code: otp, challenge_id: code.json().challenge_id } });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().two_fa_enabled).toBe(true);
    const { db: dbA, pool: poolA } = await testDb();
    const audits = await dbA.select().from(auditLog);
    await poolA.end();
    expect(audits.some((a: any) => a.action === "club.2fa.enabled" && String(a.actorId) === String(admin.user.id))).toBe(true);
  });

  it("admin login requires OTP while enforced", async () => {
    // Enable first.
    const code = await app.inject({ method: "POST", url: "/api/settings/2fa/code", headers: { ...H(), "Content-Type": "application/json" }, payload: { action: "enable" } });
    await app.inject({ method: "POST", url: "/api/settings/2fa/confirm", headers: { ...H(), "Content-Type": "application/json" }, payload: { action: "enable", code: codeFromLastSms(), challenge_id: code.json().challenge_id } });
    const login = await app.inject({ method: "POST", url: "/api/auth/login", headers: { "X-Club-Slug": "green-village" }, payload: { username: "admin", password: "Test1234!" } });
    expect(login.statusCode).toBe(200);
    expect(login.json().two_factor_required).toBe(true);
    expect(login.json().token).toBeUndefined();
    const otp = codeFromLastSms();
    const done = await app.inject({ method: "POST", url: "/api/auth/verify-2fa", payload: { challenge_id: login.json().challenge_id, code: otp } });
    expect(done.statusCode).toBe(200);
    expect(done.json().user.club_slug).toBe("green-village");
  });

  it("contact change without OTP disables club 2fa; with OTP keeps it", async () => {
    const code = await app.inject({ method: "POST", url: "/api/settings/2fa/code", headers: { ...H(), "Content-Type": "application/json" }, payload: { action: "enable" } });
    await app.inject({ method: "POST", url: "/api/settings/2fa/confirm", headers: { ...H(), "Content-Type": "application/json" }, payload: { action: "enable", code: codeFromLastSms(), challenge_id: code.json().challenge_id } });
    // No OTP → change applies, 2FA off.
    const ch = await app.inject({ method: "PATCH", url: "/api/users/me", headers: { ...H(), "Content-Type": "application/json" }, payload: { mobile: "39000111222" } });
    expect(ch.statusCode).toBe(200);
    expect(ch.json().two_fa_disabled).toBe(true);
    const s = await app.inject({ method: "GET", url: "/api/settings", headers: H() });
    expect(s.json().two_fa_enabled).toBe(false);
  });

  it("contact change with OTP keeps 2fa on", async () => {
    const code = await app.inject({ method: "POST", url: "/api/settings/2fa/code", headers: { ...H(), "Content-Type": "application/json" }, payload: { action: "enable" } });
    await app.inject({ method: "POST", url: "/api/settings/2fa/confirm", headers: { ...H(), "Content-Type": "application/json" }, payload: { action: "enable", code: codeFromLastSms(), challenge_id: code.json().challenge_id } });
    // Request a contact OTP (goes to the CURRENT channel)…
    const cc = await app.inject({ method: "POST", url: "/api/users/me/contact-challenge", headers: H() });
    expect(cc.statusCode).toBe(200);
    const otp = codeFromLastSms();
    const ch = await app.inject({ method: "PATCH", url: "/api/users/me", headers: { ...H(), "Content-Type": "application/json" }, payload: { mobile: "39000111222", two_fa_code: otp } });
    expect(ch.statusCode).toBe(200);
    expect(ch.json().two_fa_disabled).toBeUndefined();
    const s = await app.inject({ method: "GET", url: "/api/settings", headers: H() });
    expect(s.json().two_fa_enabled).toBe(true);
  });
});
