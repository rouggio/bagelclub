import type { FastifyInstance } from "fastify";
import { timetableDaySchema, timetableCopySchema } from "../types/schemas.js";
import { timetableWindows, timetables, courts } from "../db/schema.js";
import { eq, and, asc } from "drizzle-orm";
import { resolveClubSlug, requireClub, requireRequestClub, reqDb } from "../services/club.js";

const hhmm = (t: any) => String(t).slice(0, 5);

function validateWindows(windows: Array<{ open_time: string; close_time: string }>): string | null {
  for (const w of windows) {
    if (hhmm(w.open_time) >= hhmm(w.close_time)) return "timetable_bad_order";
  }
  const sorted = [...windows].sort((a, b) => (hhmm(a.open_time) < hhmm(b.open_time) ? -1 : 1));
  for (let i = 1; i < sorted.length; i++) {
    if (hhmm(sorted[i].open_time) < hhmm(sorted[i - 1].close_time)) return "timetable_overlap";
  }
  return null;
}

/** Live bookings that would fall outside the new windows (orphans). */
async function orphanConflicts(db: any, club: any, courtId: string, dow: number, windows: Array<{ open_time: string; close_time: string }>) {
  const { bookings } = await import("../db/schema.js");
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: club.timezone });
  const allBookings: any[] = await db.select().from(bookings).where(and(eq(bookings.courtId, courtId), eq(bookings.clubId, club.id)));
  const conflicts: any[] = [];
  for (const b of allBookings) {
    if (!["pending_approval", "approved"].includes(b.status)) continue;
    if (b.date < todayStr) continue;
    if (new Date(b.date + "T12:00:00Z").getUTCDay() !== dow) continue;
    const s = String(b.startTime).slice(0, 5), e = String(b.endTime).slice(0, 5);
    const inside = windows.some((w) => hhmm(w.open_time) <= s && e <= hhmm(w.close_time));
    if (!inside) conflicts.push({ id: b.id, date: b.date, startTime: s, endTime: e, reason: "outside new windows" });
  }
  return conflicts;
}

/** Minutes of trailing stub dropped per window (informative hint on save). */
function stubHints(windows: Array<{ open_time: string; close_time: string; slot_duration_minutes: number }>) {
  const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const out: any[] = [];
  for (const w of windows) {
    const len = toMin(hhmm(w.close_time)) - toMin(hhmm(w.open_time));
    const stub = len % (w.slot_duration_minutes || 60);
    if (stub > 0) out.push({ open: hhmm(w.open_time), close: hhmm(w.close_time), dropped_minutes: stub });
  }
  return out;
}

async function writeDay(db: any, courtId: string, dow: number, windows: Array<{ open_time: string; close_time: string; slot_duration_minutes: number }>) {
  await db.delete(timetableWindows).where(and(eq(timetableWindows.courtId, courtId), eq(timetableWindows.dayOfWeek, dow)));
  // Migrate-on-write: this day now lives in windows — drop its legacy rows so
  // the fallback never resurrects them (empty windows = closed day).
  const { timetables } = await import("../db/schema.js");
  await db.delete(timetables).where(and(eq(timetables.courtId, courtId), eq(timetables.dayOfWeek, dow)));
  let pos = 0;
  for (const w of [...windows].sort((a, b) => (hhmm(a.open_time) < hhmm(b.open_time) ? -1 : 1))) {
    await db.insert(timetableWindows).values({
      courtId: courtId, dayOfWeek: dow,
      openTime: hhmm(w.open_time), closeTime: hhmm(w.close_time),
      slotDurationMinutes: w.slot_duration_minutes ?? 60, position: pos++,
    });
  }
}

export default async function timetableRoutes(fastify: FastifyInstance) {
  fastify.get("/api/timetable", async (req, reply) => {
    let db: any = (fastify as any).db;
    if (!db) return reply.send([]);
    const { court_id } = (req.query as any) || {};
    // Public read — scoped to the requested club.
    const club = await requireClub(req, reply, db, resolveClubSlug(req));
    if (!club) return;
    db = reqDb(req) as any;
    const clubCourts = await db.select({ id: courts.id }).from(courts).where(eq(courts.clubId, club.id));
    const ids = new Set(clubCourts.map((c: any) => String(c.id)));
    const targets: string[] = court_id ? [String(court_id)].filter((id) => ids.has(id)) : ([...ids] as string[]);
    const days: Record<string, any[]> = {};
    for (const id of targets) {
      const rows: any[] = await db.select().from(timetableWindows)
        .where(eq(timetableWindows.courtId, id)).orderBy(asc(timetableWindows.dayOfWeek), asc(timetableWindows.position));
      const have = new Set(rows.map((r: any) => r.dayOfWeek));
      // Legacy fallback: days never re-saved read the old table (first save migrates).
      const legacy: any[] = await db.select().from(timetables).where(eq(timetables.courtId, id));
      for (const r of legacy) {
        if (have.has(r.dayOfWeek) || r.isClosed || !r.openTime || !r.closeTime) continue;
        rows.push({ dayOfWeek: r.dayOfWeek, openTime: r.openTime, closeTime: r.closeTime, slotDurationMinutes: r.slotDurationMinutes, position: 0, legacy: true });
      }
      rows.sort((a: any, b: any) => a.dayOfWeek - b.dayOfWeek || a.position - b.position);
      days[id] = rows.map((r: any) => ({
        day_of_week: r.dayOfWeek,
        open_time: hhmm(r.openTime), close_time: hhmm(r.closeTime),
        slot_duration_minutes: r.slotDurationMinutes, position: r.position,
      }));
    }
    return reply.send({ days });
  });

  // Full-day replace (empty windows = closed day).
  fastify.put("/api/timetable", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const parsed = timetableDaySchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    let db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const { court_id, day_of_week, windows } = parsed.data;
    const own = await db.select({ id: courts.id }).from(courts).where(and(eq(courts.id, court_id), eq(courts.clubId, club.id))).limit(1);
    if (!own[0]) return reply.status(400).send({ error: "timetable_foreign_court" });
    const bad = validateWindows(windows);
    if (bad) return reply.status(400).send({ error: bad });
    const force = (req.query as any)?.force === "true";
    if (!force) {
      const conflicts = await orphanConflicts(db, club, court_id, day_of_week, windows);
      if (conflicts.length) {
        return reply.status(409).send({ error: "Timetable change would orphan live bookings", conflicts, dayOfWeek: day_of_week, courtId: court_id });
      }
    }
    await writeDay(db, court_id, day_of_week, windows);
    return reply.send({ updated: windows.length, stubs_dropped: stubHints(windows) });
  });

  // Copy one day's windows onto other weekdays (same court).
  fastify.post("/api/timetable/copy", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const parsed = timetableCopySchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    let db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const { court_id, from_dow, to_dows } = parsed.data;
    const own = await db.select({ id: courts.id }).from(courts).where(and(eq(courts.id, court_id), eq(courts.clubId, club.id))).limit(1);
    if (!own[0]) return reply.status(400).send({ error: "timetable_foreign_court" });
    const src: any[] = await db.select().from(timetableWindows)
      .where(and(eq(timetableWindows.courtId, court_id), eq(timetableWindows.dayOfWeek, from_dow)))
      .orderBy(asc(timetableWindows.position));
    const wins = src.map((r: any) => ({ open_time: hhmm(r.openTime), close_time: hhmm(r.closeTime), slot_duration_minutes: r.slotDurationMinutes }));
    const force = (req.query as any)?.force === "true";
    if (!force) {
      for (const dow of to_dows) {
        if (dow === from_dow) continue;
        const conflicts = await orphanConflicts(db, club, court_id, dow, wins);
        if (conflicts.length) {
          return reply.status(409).send({ error: "Timetable change would orphan live bookings", conflicts, dayOfWeek: dow, courtId: court_id });
        }
      }
    }
    let copied = 0;
    for (const dow of to_dows) {
      if (dow === from_dow) continue;
      await writeDay(db, court_id, dow, wins);
      copied++;
    }
    return reply.send({ copied });
  });
}
