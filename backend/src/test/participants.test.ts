import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanSlate, buildTestApp, loginAs, authHeaders, testDb, seedClub } from "./helpers.js";
import { courts } from "../db/schema.js";

const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function enableRequire(app: any, admin: any) {
  const res = await app.inject({
    method: "PUT", url: "/api/settings", headers: authHeaders(admin.token, "green-village"),
    payload: { require_participant_list: true },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().require_participant_list).toBe(true);
}

async function registerFriend(app: any, username = "friend") {
  const res = await app.inject({
    method: "POST", url: "/api/auth/register",
    headers: { "Content-Type": "application/json", "X-Club-Slug": "green-village" },
    payload: {
      club_slug: "green-village", username, email: `${username}@test.local`,
      mobile: "3339990001", password: "Test1234!", first_name: "Friend", last_name: "Test",
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().user;
}

describe("participants #26 (per-club participant lists)", () => {
  cleanSlate();
  let app: any;
  let member: any;
  let admin: any;
  let courtId: string;
  beforeAll(async () => { app = await buildTestApp(); });
  beforeEach(async () => {
    member = await loginAs(app, "green-village", "member");
    admin = await loginAs(app, "green-village", "admin");
    const { db, pool } = await testDb();
    const cs = await db.select().from(courts);
    courtId = cs.find((c: any) => c.type === "tennis")?.id ?? cs[0].id;
    await pool.end();
  });
  afterAll(async () => { await app.close(); });

  it("toggle defaults off: booking without a list succeeds", async () => {
    const info = await app.inject({ method: "GET", url: "/api/club-info?slug=green-village" });
    expect(info.json().require_participant_list).toBe(false);
    const res = await app.inject({
      method: "POST", url: "/api/bookings", headers: authHeaders(member.token, "green-village"),
      payload: { court_id: courtId, date: tomorrow(), start_time: "10:00" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().participant_ids).toEqual([]);
  });

  it("required: booking without a list is 400", async () => {
    await enableRequire(app, admin);
    const res = await app.inject({
      method: "POST", url: "/api/bookings", headers: authHeaders(member.token, "green-village"),
      payload: { court_id: courtId, date: tomorrow(), start_time: "10:00" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("required: wrong count, missing self, unknown id are 400", async () => {
    await enableRequire(app, admin);
    const friend = await registerFriend(app);
    const h = authHeaders(member.token, "green-village");
    const base = { court_id: courtId, date: tomorrow(), start_time: "11:00" };
    // Only self: length 1 !== players 2.
    expect((await app.inject({ method: "POST", url: "/api/bookings", headers: h, payload: { ...base, participant_ids: [member.user.id] } })).statusCode).toBe(400);
    // Friend only: missing the booker.
    expect((await app.inject({ method: "POST", url: "/api/bookings", headers: h, payload: { ...base, participant_ids: [friend.id, "00000000-0000-0000-0000-000000000001"] } })).statusCode).toBe(400);
    // Self + unknown id.
    expect((await app.inject({ method: "POST", url: "/api/bookings", headers: h, payload: { ...base, participant_ids: [member.user.id, "00000000-0000-0000-0000-000000000000"] } })).statusCode).toBe(400);
  });

  it("required: cross-club user is rejected as unknown", async () => {
    await enableRequire(app, admin);
    const { db: dbB, pool: poolB } = await testDb();
    await seedClub(dbB, "beta", "Beta Club", "Europe/Rome");
    await poolB.end();
    const betaMember = await loginAs(app, "beta", "member");
    const res = await app.inject({
      method: "POST", url: "/api/bookings", headers: authHeaders(member.token, "green-village"),
      payload: { court_id: courtId, date: tomorrow(), start_time: "12:00", participant_ids: [member.user.id, betaMember.user.id] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("required: valid list books and reads back with usernames", async () => {
    await enableRequire(app, admin);
    const friend = await registerFriend(app);
    const res = await app.inject({
      method: "POST", url: "/api/bookings", headers: authHeaders(member.token, "green-village"),
      payload: { court_id: courtId, date: tomorrow(), start_time: "13:00", participant_ids: [member.user.id, friend.id] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().participant_ids).toEqual(expect.arrayContaining([member.user.id, friend.id]));
    expect(res.json().participant_usernames).toEqual(expect.arrayContaining(["member", "friend"]));
    const id = res.json().id;
    expect(UUID_RE.test(id)).toBe(true);
    const list = await app.inject({ method: "GET", url: "/api/bookings?mine=true", headers: authHeaders(member.token, "green-village") });
    const row = list.json().find((b: any) => b.id === id);
    expect(row.participant_usernames).toEqual(expect.arrayContaining(["member", "friend"]));
    const one = await app.inject({ method: "GET", url: `/api/bookings/${id}`, headers: authHeaders(member.token, "green-village") });
    expect(one.json().participant_ids).toHaveLength(2);
  });

  it("admin bypass: booking without a list succeeds when required", async () => {
    await enableRequire(app, admin);
    const res = await app.inject({
      method: "POST", url: "/api/bookings", headers: authHeaders(admin.token, "green-village"),
      payload: { court_id: courtId, date: tomorrow(), start_time: "14:00" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("search: members can find users with minimal fields only", async () => {
    await registerFriend(app, "teammate");
    const res = await app.inject({ method: "GET", url: "/api/users/search?q=team", headers: authHeaders(member.token, "green-village") });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows.length).toBe(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["first_name", "id", "last_name", "username"]);
    expect(rows[0].username).toBe("teammate");
    expect((await app.inject({ method: "GET", url: "/api/users/search?q=x", headers: authHeaders(member.token, "green-village") })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/users/search?q=team" })).statusCode).toBe(401);
  });

  it("PATCH: list can be replaced; players change without a list is 400", async () => {
    await enableRequire(app, admin);
    const friend = await registerFriend(app);
    const friend2 = await registerFriend(app, "friend2");
    const created = await app.inject({
      method: "POST", url: "/api/bookings", headers: authHeaders(member.token, "green-village"),
      payload: { court_id: courtId, date: tomorrow(), start_time: "15:00", participant_ids: [member.user.id, friend.id] },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    const h = authHeaders(member.token, "green-village");
    // Players 2→4 without a new list: stored list no longer matches.
    expect((await app.inject({ method: "PATCH", url: `/api/bookings/${id}`, headers: h, payload: { players: 4 } })).statusCode).toBe(400);
    // Replace the list (self + 3 others not available — use players 2 swap).
    const swapped = await app.inject({ method: "PATCH", url: `/api/bookings/${id}`, headers: h, payload: { participant_ids: [member.user.id, friend2.id] } });
    expect(swapped.statusCode).toBe(200);
    expect(swapped.json().participant_usernames).toEqual(expect.arrayContaining(["member", "friend2"]));
  });
});
