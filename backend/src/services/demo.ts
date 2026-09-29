import { clubs, courts, timetableWindows, timetables, users, bookings, blocks, blockingRules, announcements, announcementTranslations, telegramLinkTokens, appSettings } from "../db/schema.js";
import { eq, and, ne, sql } from "drizzle-orm";
import { withClubScope } from "./club.js";
import bcrypt from "bcryptjs";

async function demoClubSeed(db: any, clubId: string, courtSpecs: Array<{ type: "tennis" | "padel"; count: number; names?: string[]; surface?: string }>, adminPassword: string) {
  // Settings
  await db.insert(appSettings).values({ clubId }).onConflictDoNothing();
  // Courts
  const created: any[] = [];
  for (const spec of courtSpecs) {
    for (let i = 1; i <= spec.count; i++) {
      const label = spec.names?.[i - 1] || (spec.type === "padel" ? `Padel ${i}` : `Tennis ${i}`);
      const surface = spec.surface || "synthetic";
      const [c] = await db.insert(courts).values({ clubId, number: created.length + 1, type: spec.type, name: label, surface, basePriceCents: 0, isActive: true }).returning();
      created.push(c);
    }
  }
  // Timetable 08:00-22:00 (padel 90, tennis 60) as single windows.
  for (const court of created) {
    const slot = court.type === "padel" ? 90 : 60;
    for (let dow = 0; dow <= 6; dow++) {
      await db.insert(timetableWindows).values({ courtId: court.id, dayOfWeek: dow, openTime: "08:00", closeTime: "22:00", slotDurationMinutes: slot, position: 0 }).onConflictDoNothing();
    }
  }
  // Demo admin
  const hash = await bcrypt.hash(adminPassword, 10);
  await db.insert(users).values({ clubId, username: "demo-admin", email: null, passwordHash: hash, firstName: "Demo", lastName: "Admin", role: "admin", isVerified: true }).onConflictDoNothing();
  return created;
}

/** Full wipe of one club's tenant data (audit + grants survive: audit is
 *  platform history, grants cascade on club delete). Exported for the
 *  platform club-delete endpoint. */
export async function wipeClubData(db: any, clubId: string) {
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

/** Nightly showcase reset: wipe + reseed the public /club/demo/ club. */
export async function resetDemoShowcase(db: any) {
  const club = await assertDemo(db, "demo");
  await wipeClubData(db, club.id);
  await demoClubSeed(db, club.id, [
    { type: "tennis", count: 2, names: ["Centrale", "Pietrangeli"], surface: "clay" },
    { type: "padel", count: 2, names: ["Chatrier", "Ashe"] },
  ], "demo1234!");
  // One sample lesson rule so prospects see a "lesson" slot.
  const cs = await db.select().from(courts).where(eq(courts.clubId, club.id));
  const first = cs[0];
  if (first) {
    await db.insert(blockingRules).values({ clubId: club.id, courtId: first.id, dayOfWeek: 1, startTime: "09:00", endTime: "11:00", reason: "Scuola tennis", isActive: true });
  }
  await seedShowcaseExtras(db, club.id);
  return club;
}

/**
 * Showcase extras: three pre-configured demo players + a PUBLIC announcement
 * with all credentials in clear (admin + players). Runs on every reset, so
 * the announcement survives the wipe. Personal runs don't get these.
 */
export async function seedShowcaseExtras(db: any, clubId: string) {
  const hash = await bcrypt.hash("demo1234!", 10);
  for (const n of [1, 2, 3]) {
    await db.insert(users).values({
      clubId, username: `demo${n}`, email: null, passwordHash: hash,
      firstName: "Demo", lastName: `Player ${n}`, role: "associate", isVerified: true,
    }).onConflictDoNothing();
  }
  const body = [
    "Welcome! Play with this club or create your own demo from the home page.",
    "This demo resets every 3 hours — everything here is public test data.",
    "",
    "Admin: demo-admin / demo1234!",
    "Players: demo1 / demo1234! · demo2 / demo1234! · demo3 / demo1234!",
    "",
    "Benvenuti! Gioca con questo club o crea la tua demo dalla home.",
    "Questa demo si azzera ogni 3 ore — tutto qui è pubblico.",
  ].join("\n");
  // Idempotent standalone (no wipe required): exactly one creds card per club.
  await db.delete(announcements).where(
    and(eq(announcements.clubId, clubId), eq(announcements.title, "Demo access / Accesso demo"))
  );
  const [card] = await db.insert(announcements).values({
    clubId, title: "Demo access / Accesso demo", body,
    visibility: "public", position: 0,
  }).returning();
  // Localised card in every supported locale (public visitors read their own).
  const localized: Record<string, { title: string; body: string }> = {
    it: {
      title: "Accesso demo",
      body: [
        "Benvenuti! Gioca con questo club o crea la tua demo dalla home.",
        "Questa demo si azzera ogni 3 ore — tutto qui è pubblico.",
        "",
        "Admin: demo-admin / demo1234!",
        "Giocatori: demo1 / demo1234! · demo2 / demo1234! · demo3 / demo1234!",
      ].join("\n"),
    },
    en: {
      title: "Demo access",
      body: [
        "Welcome! Play with this club or create your own demo from the home page.",
        "This demo resets every 3 hours — everything here is public test data.",
        "",
        "Admin: demo-admin / demo1234!",
        "Players: demo1 / demo1234! · demo2 / demo1234! · demo3 / demo1234!",
      ].join("\n"),
    },
    fr: {
      title: "Accès démo",
      body: [
        "Bienvenue ! Jouez avec ce club ou créez votre propre démo depuis la page d'accueil.",
        "Cette démo est réinitialisée toutes les 3 heures — tout ici est public.",
        "",
        "Admin : demo-admin / demo1234!",
        "Joueurs : demo1 / demo1234! · demo2 / demo1234! · demo3 / demo1234!",
      ].join("\n"),
    },
    de: {
      title: "Demo-Zugang",
      body: [
        "Willkommen! Spielen Sie mit diesem Club oder erstellen Sie Ihre eigene Demo von der Startseite.",
        "Diese Demo wird alle 3 Stunden zurückgesetzt — alles hier ist öffentlich.",
        "",
        "Admin: demo-admin / demo1234!",
        "Spieler: demo1 / demo1234! · demo2 / demo1234! · demo3 / demo1234!",
      ].join("\n"),
    },
    es: {
      title: "Acceso demo",
      body: [
        "¡Bienvenidos! Jueguen con este club o creen su propia demo desde la página principal.",
        "Esta demo se restablece cada 3 horas — todo aquí es público.",
        "",
        "Admin: demo-admin / demo1234!",
        "Jugadores: demo1 / demo1234! · demo2 / demo1234! · demo3 / demo1234!",
      ].join("\n"),
    },
  };
  for (const [lang, tr] of Object.entries(localized)) {
    await db.insert(announcementTranslations).values({ announcementId: card.id, lang, title: tr.title, body: tr.body }).onConflictDoUpdate({
      target: [announcementTranslations.announcementId, announcementTranslations.lang],
      set: { title: tr.title, body: tr.body },
    });
  }
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

/**
 * Idle sweeper for user-created demos: deletes personal demo runs whose last
 * activity (latest login of any member, newest member, newest booking, or
 * club creation) is older than `idleDays`. Never touches the showcase.
 * Expired runs are included regardless of activity (garbage by definition).
 */
export async function deleteIdleDemoRuns(db: any, idleDays = 60): Promise<string[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - idleDays * 86400000);
  const latestIn = async (table: any, col: "createdAt" | "lastLoginAt", clubId: string): Promise<Date | null> => {
    const r: any[] = await db.select({ m: sql`max(${table[col]})` }).from(table).where(eq(table.clubId, clubId));
    return r[0]?.m ? new Date(r[0].m) : null;
  };
  const rows = await db.select().from(clubs).where(eq(clubs.isDemo, true));
  const gone: string[] = [];
  for (const c of rows as any[]) {
    if (c.slug === "demo") continue;
    const expired = c.demoExpiresAt && new Date(c.demoExpiresAt) <= now;
    let last: Date = new Date(c.createdAt);
    for (const [t, col] of [[users, "createdAt"], [bookings, "createdAt"], [users, "lastLoginAt"]] as any) {
      const m = await latestIn(t, col, c.id);
      if (m && m > last) last = m;
    }
    if (!expired && last > cutoff) continue;
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
  // Seed under RLS with the fresh club's own scope (clubs INSERT of a demo
  // row is policy-allowed; the rest matches the new club_id).
  await withClubScope(db, club.id, async (cx: any) => {
    await demoClubSeed(cx, club.id, opts.courts.filter((c) => c.count > 0), adminPassword);
  });
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
