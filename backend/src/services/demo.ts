import { clubs, courts, timetables, users, bookings, blocks, blockingRules, announcements, telegramLinkTokens, appSettings } from "../db/schema.js";
import { eq, and, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";

async function demoClubSeed(db: any, clubId: string, courtSpecs: Array<{ type: "tennis" | "padel"; count: number }>, adminPassword: string) {
  // Settings
  await db.insert(appSettings).values({ clubId }).onConflictDoNothing();
  // Courts
  const created: any[] = [];
  for (const spec of courtSpecs) {
    for (let i = 1; i <= spec.count; i++) {
      const label = spec.type === "padel" ? `Padel ${i}` : `Tennis ${i}`;
      const [c] = await db.insert(courts).values({ clubId, number: created.length + 1, type: spec.type, name: label, surface: "synthetic", basePriceCents: 0, isActive: true }).returning();
      created.push(c);
    }
  }
  // Timetable 08:00-22:00 (padel 90, tennis 60)
  for (const court of created) {
    const slot = court.type === "padel" ? 90 : 60;
    for (let dow = 0; dow <= 6; dow++) {
      await db.insert(timetables).values({ courtId: court.id, dayOfWeek: dow, openTime: "08:00", closeTime: "22:00", slotDurationMinutes: slot, isClosed: false }).onConflictDoNothing();
    }
  }
  // Demo admin
  const hash = await bcrypt.hash(adminPassword, 10);
  await db.insert(users).values({ clubId, username: "demo-admin", email: null, passwordHash: hash, firstName: "Demo", lastName: "Admin", role: "admin", isVerified: true }).onConflictDoNothing();
  return created;
}

async function wipeClubData(db: any, clubId: string) {
  // Children first (NO ACTION FKs), translations cascade from announcements.
  await db.delete(telegramLinkTokens).where(eq(telegramLinkTokens.clubId, clubId));
  await db.delete(bookings).where(eq(bookings.clubId, clubId));
  await db.delete(blocks).where(eq(blocks.clubId, clubId));
  await db.delete(blockingRules).where(eq(blockingRules.clubId, clubId));
  await db.delete(announcements).where(eq(announcements.clubId, clubId));
  // Timetables hang off courts — delete courts after clearing their timetables.
  const cs = await db.select({ id: courts.id }).from(courts).where(eq(courts.clubId, clubId));
  for (const c of cs) await db.delete(timetables).where(eq(timetables.courtId, c.id));
  await db.delete(courts).where(eq(courts.clubId, clubId));
  await db.delete(users).where(eq(users.clubId, clubId));
  await db.delete(appSettings).where(eq(appSettings.clubId, clubId));
}

async function assertDemo(db: any, slug: string) {
  const rows = await db.select().from(clubs).where(eq(clubs.slug, slug)).limit(1);
  const club = rows[0];
  if (!club || !club.isDemo) throw Object.assign(new Error("Not a demo club"), { statusCode: 404 });
  return club;
}

/** Nightly showcase reset: wipe + reseed the public /c/demo/ club. */
export async function resetDemoShowcase(db: any) {
  const club = await assertDemo(db, "demo");
  await wipeClubData(db, club.id);
  await demoClubSeed(db, club.id, [{ type: "tennis", count: 2 }, { type: "padel", count: 2 }], "demo1234!");
  // One sample lesson rule so prospects see a "lesson" slot.
  const cs = await db.select().from(courts).where(eq(courts.clubId, club.id));
  const first = cs[0];
  if (first) {
    await db.insert(blockingRules).values({ clubId: club.id, courtId: first.id, dayOfWeek: 1, startTime: "09:00", endTime: "11:00", reason: "Scuola tennis", isActive: true });
  }
  return club;
}

/** Delete expired personal demo runs (never the showcase). Returns deleted slugs. */
export async function deleteExpiredDemoRuns(db: any): Promise<string[]> {
  const now = new Date();
  const rows = await db.select().from(clubs).where(eq(clubs.isDemo, true));
  const gone: string[] = [];
  for (const c of rows as any[]) {
    if (c.slug === "demo") continue;
    if (!c.demoExpiresAt || new Date(c.demoExpiresAt) > now) continue;
    await wipeClubData(db, c.id);
    await db.delete(clubs).where(and(eq(clubs.id, c.id), eq(clubs.isDemo, true), ne(clubs.slug, "demo")));
    gone.push(c.slug);
  }
  return gone;
}

/** Provision a personal ephemeral demo run. Returns club + one-time admin password. */
export async function startDemoRun(db: any, opts: { displayName?: string | null; courts: Array<{ type: "tennis" | "padel"; count: number }> }) {
  const { randomBytes } = await import("crypto");
  const total = opts.courts.reduce((n, c) => n + c.count, 0);
  if (total < 1 || total > 10) throw Object.assign(new Error("courts total must be 1-10"), { statusCode: 400 });
  for (const c of opts.courts) {
    if (!["tennis", "padel"].includes(c.type) || !Number.isInteger(c.count) || c.count < 0 || c.count > 6) {
      throw Object.assign(new Error("invalid courts spec"), { statusCode: 400 });
    }
  }
  const name = (opts.displayName || "").trim().slice(0, 100) || `Demo Club ${randomBytes(2).toString("hex").toUpperCase()}`;
  let slug = "";
  for (let i = 0; i < 5; i++) {
    const cand = `demo-${randomBytes(2).toString("hex")}`;
    const exists = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.slug, cand)).limit(1);
    if (!exists[0]) { slug = cand; break; }
  }
  if (!slug) throw Object.assign(new Error("slug collision, retry"), { statusCode: 503 });
  const [club] = await db.insert(clubs).values({
    slug, name, timezone: "Europe/Rome", plan: "free",
    isDemo: true, isListed: false,
    demoExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  }).returning();
  const adminPassword = randomBytes(6).toString("hex");
  await demoClubSeed(db, club.id, opts.courts.filter((c) => c.count > 0), adminPassword);
  return { club, adminUsername: "demo-admin", adminPassword };
}

// Row counts per table for one club (used by platform list + danger assertions).
export async function clubCounts(db: any, clubId: string) {
  const n = async (t: any, col: any) => (await db.select().from(t).where(eq(col, clubId))).length;
  return {
    courts: await n(courts, courts.clubId),
    users: await n(users, users.clubId),
    bookings: await n(bookings, bookings.clubId),
  };
}
