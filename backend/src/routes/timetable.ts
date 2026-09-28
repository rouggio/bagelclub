import type { FastifyInstance } from "fastify";
import { timetableBulkSchema } from "../types/schemas.js";
import { timetables, courts } from "../db/schema.js";
import { eq, and, asc } from "drizzle-orm";
import { resolveClubSlug, requireClub, requireRequestClub, reqDb } from "../services/club.js";

export default async function timetableRoutes(fastify: FastifyInstance) {
  fastify.get("/api/timetable", async (req, reply) => {
    let db: any = (fastify as any).db;
    if (!db) return reply.send([]);
    const { court_id } = (req.query as any) || {};
    // Public read — scoped to the requested club. courtId-null rows are legacy
    // shared fallbacks (read-only); writes are always per-court (see PUT).
    const club = await requireClub(req, reply, db, resolveClubSlug(req));
    if (!club) return;
    db = reqDb(req) as any;
    const clubCourts = await db.select({ id: courts.id }).from(courts).where(eq(courts.clubId, club.id));
    const ids = new Set(clubCourts.map((c: any) => String(c.id)));
    const rows = await db.select().from(timetables).orderBy(asc(timetables.dayOfWeek));
    const scoped = rows.filter((r: any) => r.courtId === null || ids.has(String(r.courtId)));
    const filtered = court_id ? scoped.filter((r: any) => String(r.courtId) === String(court_id) || r.courtId === null) : scoped;
    return reply.send(filtered);
  });

  fastify.put("/api/timetable", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const parsed = timetableBulkSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    let db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const force = (req.query as any)?.force === "true";
    const tz = club.timezone;
    // Every entry must target a court of this club — global (null) writes are
    // forbidden: they would leak one club's hours into every other club.
    const clubCourts = await db.select({ id: courts.id }).from(courts).where(eq(courts.clubId, club.id));
    const ids = new Set(clubCourts.map((c: any) => String(c.id)));
    for (const entry of parsed.data) {
      if (!entry.court_id || !ids.has(String(entry.court_id))) {
        return reply.status(400).send({ error: "court_id must be a court of this club" });
      }
    }
    // Coherence check: prevent orphaning live bookings unless force
    if (!force) {
      const { bookings } = await import("../db/schema.js");
      const { and: and2, eq: eq2 } = await import("drizzle-orm");
      const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: tz });
      for (const entry of parsed.data) {
        const open = entry.open_time ?? null;
        const close = entry.close_time ?? null;
        const isClosed = !!entry.is_closed;
        const courtId = entry.court_id ?? null;
        if (courtId === null) continue;
        const allBookings: any[] = await db.select().from(bookings).where(and2(eq2(bookings.courtId, courtId), eq2(bookings.clubId, club.id)));
        const conflicts: any[] = [];
        for (const b of allBookings) {
          if (!["pending_approval","approved"].includes(b.status)) continue;
          if (b.date < todayStr) continue;
          const dow = new Date(b.date + "T12:00:00Z").getUTCDay();
          if (dow !== entry.day_of_week) continue;
          if (isClosed) { conflicts.push({ id: b.id, date: b.date, startTime: b.startTime, endTime: b.endTime, reason: "day closed" }); continue; }
          if (!open || !close) continue;
          const o = open.slice(0,5), c = close.slice(0,5);
          const s = String(b.startTime).slice(0,5), e = String(b.endTime).slice(0,5);
          if (s < o || e > c) conflicts.push({ id: b.id, date: b.date, startTime: s, endTime: e, reason: `outside ${o}-${c}` });
          // duration change is tolerated — existing bookings keep their endTime, just warn if not aligned? not blocking
        }
        if (conflicts.length) {
          return reply.status(409).send({ error: "Timetable change would orphan live bookings", conflicts, dayOfWeek: entry.day_of_week, courtId });
        }
      }
    }
    for (const entry of parsed.data) {
      await db
        .insert(timetables)
        .values({
          courtId: entry.court_id ?? null,
          dayOfWeek: entry.day_of_week,
          openTime: entry.open_time ?? null,
          closeTime: entry.close_time ?? null,
          slotDurationMinutes: entry.slot_duration_minutes ?? 60,
          isClosed: entry.is_closed ?? false,
        })
        .onConflictDoUpdate({
          target: [timetables.courtId, timetables.dayOfWeek],
          set: {
            openTime: entry.open_time ?? null,
            closeTime: entry.close_time ?? null,
            slotDurationMinutes: entry.slot_duration_minutes ?? 60,
            isClosed: entry.is_closed ?? false,
          },
        });
    }
    return reply.send({ updated: parsed.data.length });
  });
}
