import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { cleanSlate, buildTestApp, authHeaders, testDb } from "./helpers.js";
import { users } from "../db/schema.js";
import bcrypt from "bcryptjs";

describe("superadmin 2fa (telegram otp)", () => {
  cleanSlate();
  let app: any;
  let sent: Array<{ url: string; body: any }>;
  beforeAll(async () => {
    process.env.SUPERADMIN_TELEGRAM_BOT_TOKEN = "test-bot-token";
    process.env.SUPERADMIN_TELEGRAM_CHAT_ID = "424242";
    sent = [];
    vi.stubGlobal("fetch", (async (url: string, init: any) => {
      sent.push({ url: String(url), body: JSON.parse(init?.body || "{}") });
      return { ok: true, json: async () => ({ ok: true }) };
    }) as any);
    app = await buildTestApp();
  });
  beforeEach(async () => {
    sent.length = 0;
    const { db, pool } = await testDb();
    await db.insert(users).values({
      clubId: null as any, username: "boss", email: "boss@t.local",
      passwordHash: await bcrypt.hash("Test1234!", 10),
      firstName: "B", lastName: "O", role: "superadmin", isVerified: true,
    }).onConflictDoNothing();
    await pool.end();
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    delete process.env.SUPERADMIN_TELEGRAM_BOT_TOKEN;
    delete process.env.SUPERADMIN_TELEGRAM_CHAT_ID;
    await app.close();
  });

  const codeFromLastSms = () => {
    const m = String(sent[sent.length - 1]?.body?.text || "").match(/\b(\d{6})\b/);
    return m ? m[1] : null;
  };

  it("password alone yields a challenge, not a session", async () => {
    const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "boss@t.local", password: "Test1234!" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().two_factor_required).toBe(true);
    expect(r.json().token).toBeUndefined();
    expect(r.json().challenge_id).toBeTruthy();
    // Delivered via the configured bot to the configured chat.
    expect(sent.length).toBe(1);
    expect(sent[0].url).toContain("test-bot-token");
    expect(String(sent[0].body.chat_id)).toBe("424242");
    expect(codeFromLastSms()).toMatch(/^\d{6}$/);
  });

  it("correct code completes login; replay fails", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "boss@t.local", password: "Test1234!" } });
    const code = codeFromLastSms();
    const ok = await app.inject({ method: "POST", url: "/api/auth/verify-2fa", payload: { challenge_id: login.json().challenge_id, code } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.role).toBe("superadmin");
    const clubs = await app.inject({ method: "GET", url: "/api/platform/clubs", headers: authHeaders(ok.json().token) });
    expect(clubs.statusCode).toBe(200);
    const replay = await app.inject({ method: "POST", url: "/api/auth/verify-2fa", payload: { challenge_id: login.json().challenge_id, code } });
    expect(replay.statusCode).toBe(401);
  });

  it("wrong codes fail and lock after max attempts", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "boss@t.local", password: "Test1234!" } });
    const cid = login.json().challenge_id;
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: "POST", url: "/api/auth/verify-2fa", payload: { challenge_id: cid, code: "000000" } });
      expect(r.statusCode).toBe(401);
    }
    // Even the right code is dead after lockout.
    const code = codeFromLastSms();
    const r = await app.inject({ method: "POST", url: "/api/auth/verify-2fa", payload: { challenge_id: cid, code } });
    expect(r.statusCode).toBe(401);
  });

  it("successful superadmin login is audited (failures are not)", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "boss@t.local", password: "Test1234!" } });
    await app.inject({ method: "POST", url: "/api/auth/verify-2fa", payload: { challenge_id: login.json().challenge_id, code: "000000" } });
    const ok = await app.inject({ method: "POST", url: "/api/auth/verify-2fa", payload: { challenge_id: login.json().challenge_id, code: codeFromLastSms() } });
    expect(ok.statusCode).toBe(200);
    const { db, pool } = await testDb();
    const { auditLog } = await import("../db/schema.js");
    const rows = await db.select().from(auditLog);
    await pool.end();
    const logins = rows.filter((a: any) => a.action === "platform.auth.login");
    expect(logins).toHaveLength(1);
    expect(String(logins[0].actorId)).toBe(String(ok.json().user.id));
  });
});
