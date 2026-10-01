import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { cleanSlate, buildTestApp, loginAs, authHeaders, testDb } from "./helpers.js";
import { clubs, courts, auditLog, feePayments } from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  periodStartFor, periodEndExclusive, daysOverdue, addMonths,
  todayInTz, sendFeeReminders,
} from "../services/fees.js";

const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

async function putSettings(app: any, token: string, body: any) {
  const r = await app.inject({
    method: "PUT", url: "/api/settings",
    headers: { ...authHeaders(token, "green-village"), "Content-Type": "application/json" },
    payload: body,
  });
  expect(r.statusCode).toBe(200);
  return r.json();
}

describe("associate fees #32", () => {
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

  it("period math: calendar-anchored starts, exclusive ends, grace boundary", () => {
    expect(periodStartFor("2026-10-15", "monthly")).toBe("2026-10-01");
    expect(periodStartFor("2026-02-10", "bimonthly")).toBe("2026-01-01");
    expect(periodStartFor("2026-03-10", "bimonthly")).toBe("2026-03-01");
    expect(periodStartFor("2026-08-10", "semestral")).toBe("2026-07-01");
    expect(periodStartFor("2026-08-10", "yearly")).toBe("2026-01-01");
    expect(periodEndExclusive("2026-10-01", "monthly")).toBe("2026-11-01");
    expect(periodEndExclusive("2026-01-01", "yearly")).toBe("2027-01-01");
    // October period ends 2026-11-01: 7 days later is still grace, day 8 is not.
    expect(daysOverdue("2026-10-01", "monthly", "2026-11-08")).toBe(7);
    expect(daysOverdue("2026-10-01", "monthly", "2026-11-09")).toBe(8);
    expect(daysOverdue("2026-10-01", "monthly", "2026-10-15")).toBe(0);
    expect(addMonths("2026-12-01", 2)).toBe("2027-02-01");
  });

  it("settings PUT persists fee config; masked GET returns it", async () => {
    const saved: any = await putSettings(app, admin.token, { fee_cents: 1000, fee_cadence: "monthly", notify_fee_overdue: true, fee_block_booking: false });
    expect(saved.fee_cents).toBe(1000);
    expect(saved.fee_cadence).toBe("monthly");
    expect(saved.notify_fee_overdue).toBe(true);
    expect(saved.fee_block_booking).toBe(false);
    const got = await app.inject({ method: "GET", url: "/api/settings", headers: authHeaders(admin.token, "green-village") });
    expect(got.json().fee_cents).toBe(1000);
  });

  it("overview + collect (idempotent) + uncollect", async () => {
    await putSettings(app, admin.token, { fee_cents: 1000, fee_cadence: "monthly" });
    const ah = { ...authHeaders(admin.token, "green-village"), "Content-Type": "application/json" };
    const ov1 = await app.inject({ method: "GET", url: "/api/fees/overview", headers: authHeaders(admin.token, "green-village") });
    expect(ov1.statusCode).toBe(200);
    const body1 = ov1.json();
    expect(body1.fee_active).toBe(true);
    expect(body1.fee_display).toBe("10.00 EUR");
    const row = body1.users.find((u: any) => u.username === "member");
    expect(row.paid).toBe(false);
    const col = await app.inject({ method: "POST", url: "/api/fees/collect", headers: ah, payload: { user_id: member.user.id, period_start: body1.period_start } });
    expect(col.statusCode).toBe(200);
    const col2 = await app.inject({ method: "POST", url: "/api/fees/collect", headers: ah, payload: { user_id: member.user.id, period_start: body1.period_start } });
    expect(col2.statusCode).toBe(200);
    const { db, pool } = await testDb();
    const rows = await db.select().from(feePayments);
    await pool.end();
    expect(rows).toHaveLength(1);
    const un = await app.inject({ method: "POST", url: "/api/fees/uncollect", headers: ah, payload: { user_id: member.user.id, period_start: body1.period_start } });
    expect(un.statusCode).toBe(200);
    const ov2 = await app.inject({ method: "GET", url: "/api/fees/overview", headers: authHeaders(admin.token, "green-village") });
    expect(ov2.json().users.find((u: any) => u.username === "member").paid).toBe(false);
  });

  it("reminder mails once per period past grace; skips paid + exempt", async () => {
    await putSettings(app, admin.token, { fee_cents: 1000, fee_cadence: "monthly", notify_fee_overdue: true });
    const { db, pool } = await testDb();
    const clubRows = await db.select().from(clubs);
    const club = clubRows[0];
    const { withClubScope } = await import("../services/club.js");
    const { getClubSettings } = await import("../services/club.js");
    const run = () => withClubScope(db, club.id, async (cx: any) => sendFeeReminders(cx, club, await getClubSettings(cx, club.id)));
    const n1 = await run();
    expect(n1).toBe(1);
    expect(sent.filter((s) => s.url.includes("brevo") && s.body.to?.[0]?.email === "member@test.local")).toHaveLength(1);
    const n2 = await run();
    expect(n2).toBe(0);
    expect(sent.filter((s) => s.url.includes("brevo"))).toHaveLength(1);
    const audits = await db.select().from(auditLog);
    await pool.end();
    expect(audits.filter((a: any) => a.action === "fee.reminder")).toHaveLength(1);
  });

  it("hard-block: overdue member 403s, clear/exempt/admin pass", async () => {
    await putSettings(app, admin.token, { fee_cents: 1000, fee_cadence: "monthly", fee_block_booking: true });
    const mh = { ...authHeaders(member.token, "green-village"), "Content-Type": "application/json" };
    // Member owes an old period (no payments at all) → blocked.
    const blocked = await app.inject({ method: "POST", url: "/api/bookings", headers: mh, payload: { court_id: courtId, date: tomorrow(), start_time: "10:00" } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ error: "fee_overdue" });
    // Toggle off → passes.
    await putSettings(app, admin.token, { fee_block_booking: false });
    const ok = await app.inject({ method: "POST", url: "/api/bookings", headers: mh, payload: { court_id: courtId, date: tomorrow(), start_time: "12:00" } });
    expect(ok.statusCode).toBe(201);
    // Exempt member passes even with the block on.
    await putSettings(app, admin.token, { fee_block_booking: true });
    const ah = { ...authHeaders(admin.token, "green-village"), "Content-Type": "application/json" };
    const ex = await app.inject({ method: "PATCH", url: `/api/users/${member.user.id}`, headers: ah, payload: { fee_exempt: true } });
    expect(ex.statusCode).toBe(200);
    expect(ex.json().fee_exempt).toBe(true);
    const ok2 = await app.inject({ method: "POST", url: "/api/bookings", headers: mh, payload: { court_id: courtId, date: tomorrow(), start_time: "14:00" } });
    expect(ok2.statusCode).toBe(201);
  });

  it("join path: adding an overdue participant 403s", async () => {
    await putSettings(app, admin.token, { fee_cents: 1000, fee_cadence: "monthly", fee_block_booking: true, require_participant_list: true });
    const ah = { ...authHeaders(admin.token, "green-village"), "Content-Type": "application/json" };
    // Second associate, also overdue (nothing paid anywhere).
    const mk = await app.inject({ method: "POST", url: "/api/users", headers: ah, payload: { username: "member2", email: "m2@test.local", password: "Test1234!", first_name: "M2", last_name: "T", role: "associate" } });
    expect(mk.statusCode).toBe(201);
    const member2 = mk.json();
    // Booker clears their own old periods so only the join is at fault.
    const { db, pool } = await testDb();
    const clubRows = await db.select().from(clubs);
    const today = todayInTz(clubRows[0].timezone);
    const cur = periodStartFor(today, "monthly");
    await pool.end();
    const mh = { ...authHeaders(member.token, "green-village"), "Content-Type": "application/json" };
    // Booker clears the whole lookback so only the join is at fault.
    for (let i = 1; i <= 11; i++) {
      const p = addMonths(cur, -i);
      const c = await app.inject({ method: "POST", url: "/api/fees/collect", headers: ah, payload: { user_id: member.user.id, period_start: p } });
      expect(c.statusCode).toBe(200);
    }
    const b = await app.inject({ method: "POST", url: "/api/bookings", headers: mh, payload: { court_id: courtId, date: tomorrow(), start_time: "10:00", players: 2, participant_ids: [member.user.id, member2.id] } });
    expect(b.statusCode).toBe(403);
    expect(b.json()).toMatchObject({ error: "fee_overdue" });
  });
});
