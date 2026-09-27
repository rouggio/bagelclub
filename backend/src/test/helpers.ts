import { beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { buildApp } from "../app.js";
import { createDb } from "../db/connection.js";
import { clubs, courts, timetables, users, appSettings } from "../db/schema.js";
import { TEST_DATABASE_URL } from "./global-setup.js";

export async function testDb() {
  return createDb(TEST_DATABASE_URL);
}

/** Wipe all tenant data and seed one club (green-village) with admin + member + courts. */
export async function resetDb() {
  const { db, pool } = createDb(TEST_DATABASE_URL);
  await pool.query(
    "TRUNCATE telegram_link_tokens, announcement_translations, bookings, blocks, blocking_rules, timetables, announcements, audit_log, users, courts, app_settings, clubs CASCADE"
  );
  const clubId = await seedClub(db, "green-village", "Green Village", "Europe/Rome");
  await pool.end();
  return clubId;
}

export async function seedClub(db: any, slug: string, name: string, timezone: string) {
  const [club] = await db.insert(clubs).values({ slug, name, timezone }).returning();
  await db.insert(appSettings).values({ clubId: club.id }).onConflictDoNothing();
  const hash = await bcrypt.hash("Test1234!", 10);
  await db.insert(users).values({
    clubId: club.id, username: "admin", email: "admin@test.local", passwordHash: hash,
    firstName: "Admin", lastName: "Test", role: "admin", isVerified: true,
  });
  await db.insert(users).values({
    clubId: club.id, username: "member", email: "member@test.local", passwordHash: hash,
    firstName: "Member", lastName: "Test", role: "associate", isVerified: true,
  });
  const c1 = (await db.insert(courts).values({ clubId: club.id, number: 1, type: "tennis", name: "T1", basePriceCents: 1000 }).returning())[0];
  const c2 = (await db.insert(courts).values({ clubId: club.id, number: 2, type: "padel", name: "P1", basePriceCents: 1500 }).returning())[0];
  for (const c of [c1, c2]) {
    for (let dow = 0; dow <= 6; dow++) {
      await db.insert(timetables).values({ courtId: c.id, dayOfWeek: dow, openTime: "08:00", closeTime: "22:00", slotDurationMinutes: 60, isClosed: false }).onConflictDoNothing();
    }
  }
  return club.id;
}

export async function buildTestApp() {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.NODE_ENV = "test";
  return buildApp();
}

export async function loginAs(app: any, slug: string | null, username: string, password = "Test1234!") {
  const body: any = { password };
  if (username.includes("@")) body.email = username;
  else body.username = username;
  if (slug) body.club_slug = slug;
  const headers: any = { "Content-Type": "application/json" };
  if (slug) headers["X-Club-Slug"] = slug;
  const res = await app.inject({ method: "POST", url: "/api/auth/login", headers, payload: body });
  if (res.statusCode !== 200) throw new Error(`login failed ${res.statusCode}: ${res.body}`);
  return res.json();
}

export function authHeaders(token: string, slug?: string) {
  const h: any = { Authorization: `Bearer ${token}` };
  if (slug) h["X-Club-Slug"] = slug;
  return h;
}

/** Every suite starts from a clean seeded DB. */
export function cleanSlate() {
  beforeEach(async () => {
    await resetDb();
  });
}
