import type { FastifyInstance } from "fastify";
import { splitIntoSlots, overlaps } from "../services/availability.js";
import { timetables, timetableWindows, bookings, blocks, blockingRules, courts, users } from "../db/schema.js";
import { eq, and, asc } from "drizzle-orm";
import { resolveClubSlug, requireClub, getClubSettings, reqDb } from "../services/club.js";

export default async function availabilityRoutes(fastify: FastifyInstance) {
  fastify.get("/api/availability", async (req, reply) => {
    const { court_id, date } = (req.query as any) || {};
    if (!court_id || !date) return reply.status(400).send({ error: "court_id and date required (YYYY-MM-DD)" });

    let db: any = (fastify as any).db;
    if (!db) {
      // Demo without DB
      const demoSlots = splitIntoSlots("08:00", "22:00", 60).map((s) => ({ ...s, status: "available" as const }));
      return reply.send({ court_id, date, slots: demoSlots });
    }

    // Public read — club slug is mandatory (never leak another club's slots).
    const club = await requireClub(req, reply, db, resolveClubSlug(req));
    if (!club) return;
    db = reqDb(req) as any;
    const courtRows = await db.select().from(courts).where(and(eq(courts.id, court_id), eq(courts.clubId, club.id))).limit(1);
    if (!courtRows[0]) return reply.status(404).send({ error: "Court not found" });

    const dayOfWeek = new Date(date + "T12:00:00Z").getUTCDay();
    // Slot windows for this court+day (ordered). Closed day = zero windows.
    // Legacy fallback: courts never re-saved since #24 still read `timetables`.
    const wins = (await db.select().from(timetableWindows)
      .where(and(eq(timetableWindows.courtId, court_id), eq(timetableWindows.dayOfWeek, dayOfWeek)))
      .orderBy(asc(timetableWindows.position)) as any[]);
    let baseSlots: Array<{ start: string; end: string }> = [];
    if (wins.length) {
      const settings = await getClubSettings(db, club.id);
      const fallbackDur = settings?.defaultSlotDurationMinutes ?? 60;
      for (const w of wins) {
        const dur = w.slotDurationMinutes || fallbackDur;
        baseSlots.push(...splitIntoSlots(String(w.openTime).slice(0, 5), String(w.closeTime).slice(0, 5), dur));
      }
    } else {
      let timetableRows = await db.select().from(timetables).where(eq(timetables.courtId, court_id));
      let tt = timetableRows.find((r: any) => r.dayOfWeek === dayOfWeek);
      if (!tt) {
        const all = await db.select().from(timetables);
        tt = all.find((r: any) => r.courtId === null && r.dayOfWeek === dayOfWeek);
      }
      if (tt && !tt.isClosed && tt.openTime && tt.closeTime) {
        let duration = tt.slotDurationMinutes;
        if (!duration) {
          const settings = await getClubSettings(db, club.id);
          duration = settings?.defaultSlotDurationMinutes ?? 60;
        }
        baseSlots = splitIntoSlots(tt.openTime.slice(0, 5), tt.closeTime.slice(0, 5), duration);
      }
    }

    // Bookings for that club+court+date (active holds)
    const bookingRows = await db.select().from(bookings).where(and(eq(bookings.clubId, club.id), eq(bookings.courtId, court_id), eq(bookings.date, date)));
    const activeBookings = bookingRows.filter((b: any) => ["pending_registration", "pending_approval", "approved"].includes(b.status) && !(b.status === "pending_registration" && b.expiresAt && new Date(b.expiresAt) < new Date()));
    // Username map for admin display [username] — club users only.
    let usernameById: Record<string, string> = {};
    try {
      const userRows = await db.select().from(users).where(eq(users.clubId, club.id));
      for (const u of userRows as any[]) usernameById[String(u.id)] = u.username;
    } catch {}

    // Ad-hoc blocks (this club only)
    const dayStart = new Date(date + "T00:00:00Z");
    const dayEnd = new Date(date + "T23:59:59Z");
    const blockRows = await db.select().from(blocks).where(eq(blocks.clubId, club.id));
    const relevantBlocks = blockRows.filter((bl: any) => {
      const s = new Date(bl.startAt);
      const e = new Date(bl.endAt);
      return s <= dayEnd && e >= dayStart && (!bl.courtId || String(bl.courtId) === String(court_id));
    });

    // Recurring rules (this club only)
    const ruleRows = await db.select().from(blockingRules).where(and(eq(blockingRules.clubId, club.id), eq(blockingRules.isActive, true)));
    const relevantRules = ruleRows.filter((ru: any) => ru.dayOfWeek === dayOfWeek && (!ru.courtId || String(ru.courtId) === String(court_id)));

    const slots = baseSlots.map((slot) => {
      const slotRange = { start: slot.start, end: slot.end };
      // Check ad-hoc blocks
      for (const bl of relevantBlocks) {
        const blStart = new Date(bl.startAt).toISOString().slice(11, 16);
        const blEnd = new Date(bl.endAt).toISOString().slice(11, 16);
        if (overlaps(slotRange, { start: blStart, end: blEnd })) return { ...slot, status: "blocked" as const, bookingId: null, label: (bl as any).reason || "blocked" } as any;
      }
      for (const ru of relevantRules) {
        const rs = ru.startTime.slice(0, 5);
        const re = ru.endTime.slice(0, 5);
        if (overlaps(slotRange, { start: rs, end: re })) return { ...slot, status: "lesson" as const, bookingId: null, label: ru.reason } as any;
      }
      for (const b of activeBookings) {
        const bs = b.startTime.slice(0, 5);
        const be = b.endTime.slice(0, 5);
        if (overlaps(slotRange, { start: bs, end: be })) {
          const uname = usernameById[String(b.userId)] || null;
          if (b.status === "pending_approval") return { ...slot, status: "pending_approval" as const, bookingId: b.id, bookingNotes: b.notes, bookingUserId: b.userId, bookingUsername: uname };
          return { ...slot, status: "booked" as const, bookingId: b.id, bookingUserId: b.userId, bookingUsername: uname };
        }
      }
      return { ...slot, status: "available" as const, bookingId: null };
    });

    return reply.send({ court_id, date, slots });
  });
}
