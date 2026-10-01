import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { cleanSlate, buildTestApp, loginAs, authHeaders, testDb } from "./helpers.js";
import { clubs, courts, users, auditLog } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { certStatus, sendMedcertReminders, MEDCERT_REMINDER_DAYS } from "../services/medcert.js";
import { todayInTz } from "../services/fees.js";

const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function putSettings(app: any, token: string, body: any) {
  const r = await app.inject({
    method: "PUT", url: "/api/settings",
    headers: { ...authHeaders(token, "green-village"), "Content-Type": "application/json" },
    payload: body,
  });
  expect(r.statusCode).toBe(200);
  return r.json();
}

describe("medical certificates #33", () => {
  cleanSlate();
  let app: any;
  let admin: any;
  let member: any;
  let courtId: string;
  let sent: Array<{ url: string; body: any }>;
  const keep: Record<string, string | undefined> = {};
  beforeAll(async () => { app = await buildTestApp(); });
  beforeEach(async () => {
    admin = await loginAs(app, "green-village", "admin");
    member = await loginAs(app, "green-village", "member");
    const { db, pool } = await testDb();
    const cs = await db.select().from(courts);
    courtId = cs[0].id;
    await pool.end();
    sent = [];
    vi.stubGlobal("fetch", (async (url: string, init: any) => {
      sent.push({ url: String(url), body: JSON.parse(init?.body || "{}") });
      return { ok: true, json: async () => ({}), text: async () => "" };
    }) as any);
    for (const k of ["BREVO_API_KEY", "BREVO_VERIFIED_EMAIL"]) keep[k] = process.env[k];
    process.env.BREVO_API_KEY = "dummy";
    process.env.BREVO_VERIFIED_EMAIL = "from@test.local";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ["BREVO_API_KEY", "BREVO_VERIFIED_EMAIL"]) {
      if (keep[k] !== undefined) process.env[k] = keep[k] as string;
      else delete process.env[k];
    }
  });
  afterAll(async () => { await app.close(); });

  it("status buckets: missing/expired/expiring/valid", () => {
    const t = "2026-10-01";
    expect(certStatus(null, t)).toBe("missing");
    expect(certStatus("2026-09-30", t)).toBe("expired");
    expect(certStatus("2026-10-01", t)).toBe("expired");
    expect(certStatus("2026-10-20", t)).toBe("expiring");
    expect(certStatus("2026-10-31", t)).toBe("expiring");
    expect(certStatus("2026-11-15", t)).toBe("valid");
    expect(MEDCERT_REMINDER_DAYS).toBe(30);
  });

  it("admin sets/removes/downloads; validation rejects junk", async () => {
    const ah = { ...authHeaders(admin.token, "green-village"), "Content-Type": "application/json" };
    const badMime = await app.inject({ method: "POST", url: `/api/users/${member.user.id}/medical-cert`, headers: ah, payload: { expires_at: plusDays(300), scan_base64: "aGk=", mime: "text/plain" } });
    expect(badMime.statusCode).toBe(400);
    const badB64 = await app.inject({ method: "POST", url: `/api/users/${member.user.id}/medical-cert`, headers: ah, payload: { expires_at: plusDays(300), scan_base64: "!!!not-base64!!!", mime: "application/pdf" } });
    expect(badB64.statusCode).toBe(400);
    const set = await app.inject({ method: "POST", url: `/api/users/${member.user.id}/medical-cert`, headers: ah, payload: { expires_at: plusDays(300), scan_base64: "aGk=", mime: "application/pdf" } });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ ok: true, has_scan: true });
    const dl = await app.inject({ method: "GET", url: `/api/users/${member.user.id}/medical-cert/scan`, headers: authHeaders(admin.token, "green-village") });
    expect(dl.statusCode).toBe(200);
    const rm = await app.inject({ method: "DELETE", url: `/api/users/${member.user.id}/medical-cert`, headers: authHeaders(admin.token, "green-village") });
    expect(rm.statusCode).toBe(200);
    const dl2 = await app.inject({ method: "GET", url: `/api/users/${member.user.id}/medical-cert/scan`, headers: authHeaders(admin.token, "green-village") });
    expect(dl2.statusCode).toBe(404);
    // Associate cannot touch certs.
    const mh = { ...authHeaders(member.token, "green-village"), "Content-Type": "application/json" };
    expect((await app.inject({ method: "POST", url: `/api/users/${member.user.id}/medical-cert`, headers: mh, payload: { expires_at: plusDays(300) } })).statusCode).toBe(403);
  });

  it("gate: missing → required, expired → expired, valid passes, off passes, admin bypasses", async () => {
    await putSettings(app, admin.token, { require_medical_cert: true });
    const mh = { ...authHeaders(member.token, "green-village"), "Content-Type": "application/json" };
    const ah = { ...authHeaders(admin.token, "green-village"), "Content-Type": "application/json" };
    const book = (h: any, t: string) => app.inject({ method: "POST", url: "/api/bookings", headers: h, payload: { court_id: courtId, date: tomorrow(), start_time: t } });
    expect((await book(mh, "10:00")).json()).toMatchObject({ error: "medical_cert_required" });
    await app.inject({ method: "POST", url: `/api/users/${member.user.id}/medical-cert`, headers: ah, payload: { expires_at: plusDays(-1) } });
    expect((await book(mh, "10:00")).json()).toMatchObject({ error: "medical_cert_expired" });
    await app.inject({ method: "POST", url: `/api/users/${member.user.id}/medical-cert`, headers: ah, payload: { expires_at: plusDays(300) } });
    expect((await book(mh, "10:00")).statusCode).toBe(201);
    // Admin bypasses the gate.
    await app.inject({ method: "DELETE", url: `/api/users/${admin.user.id}/medical-cert`, headers: authHeaders(admin.token, "green-village") }).catch(() => {});
    expect((await book({ ...authHeaders(admin.token, "green-village"), "Content-Type": "application/json" }, "12:00")).statusCode).toBe(201);
    // Toggle off lifts the gate.
    await putSettings(app, admin.token, { require_medical_cert: false });
    await app.inject({ method: "DELETE", url: `/api/users/${member.user.id}/medical-cert`, headers: authHeaders(admin.token, "green-village") });
    expect((await book(mh, "14:00")).statusCode).toBe(201);
  });

  it("reminder mails player + admins once inside 30 days; skips expired/valid/off", async () => {
    await putSettings(app, admin.token, { require_medical_cert: true });
    const ah = { ...authHeaders(admin.token, "green-village"), "Content-Type": "application/json" };
    await app.inject({ method: "POST", url: `/api/users/${member.user.id}/medical-cert`, headers: ah, payload: { expires_at: plusDays(20) } });
    const { db, pool } = await testDb();
    const club = (await db.select().from(clubs))[0];
    const { withClubScope } = await import("../services/club.js");
    const { getClubSettings } = await import("../services/club.js");
    const run = () => withClubScope(db, club.id, async (cx: any) => sendMedcertReminders(cx, club, await getClubSettings(cx, club.id)));
    expect(await run()).toBe(1);
    expect(sent.filter((s) => s.url.includes("brevo") && s.body.to?.[0]?.email === "member@test.local")).toHaveLength(1);
    expect(sent.filter((s) => s.url.includes("brevo") && s.body.to?.[0]?.email === "admin@test.local")).toHaveLength(1);
    expect(await run()).toBe(0);
    const audits = await db.select().from(auditLog);
    await pool.end();
    expect(audits.filter((a: any) => a.action === "medcert.reminder")).toHaveLength(1);
  });

  it("cert status surfaces in the admin user list", async () => {
    const ah = { ...authHeaders(admin.token, "green-village"), "Content-Type": "application/json" };
    await app.inject({ method: "POST", url: `/api/users/${member.user.id}/medical-cert`, headers: ah, payload: { expires_at: plusDays(300) } });
    const list = await app.inject({ method: "GET", url: "/api/users", headers: authHeaders(admin.token, "green-village") });
    const row = list.json().find((u: any) => u.username === "member");
    expect(row.medical_cert).toMatchObject({ has_scan: false });
    expect(row.medical_cert.expires_at).toBeTruthy();
  });
});
