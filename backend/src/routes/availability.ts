import type { FastifyInstance } from "fastify";
import { splitIntoSlots, overlaps } from "../services/availability.js";
import { timetables, timetableWindows, bookings, blocks, blockingRules, courts, users } from "../db/schema.js";
import { eq, and, asc, inArray } from "drizzle-orm";
import { resolveClubSlug, requireClub, getClubSettings, reqDb } from "../services/club.js";

export default async function availabilityRoutes(fastify: FastifyInstance) {
  fastify.get("/api/availability", async (req, reply) => {
    const { court_id, date } = (req.query as any) || {};
    if (!court_id || !date) return reply.status(400).send({ error: "court_id and date required (YYYY-MM-DD)" });
    // Batch: court_id may be a comma-separated list (one shot for all courts).
    const ids = String(court_id).split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
    if (!ids.length) return reply.status(400).send({ error: "court_id and date required (YYYY-MM-DD)" });
    // Window: days=N returns N consecutive days from date (capped, one shot).
    const rawDays = Number((req.query as any)?.days ?? NaN);
    const nDays = Number.isFinite(rawDays) ? Math.min(Math.max(Math.floor(rawDays), 1), 14) : 1;
    const dayList: string[] = [];
    {
      const [y, m, d] = String(date).split("-").map(Number);
      if (!y || !m || !d) return reply.status(400).send({ error: "date must be YYYY-MM-DD" });
      const base = Date.UTC(y, m - 1, d);
      for (let i = 0; i < nDays; i++) {
        dayList.push(new Date(base + i * 86400000).toISOString().slice(0, 10));
      }
    }

    let db: any = (fastify as any).db;
    if (!db) {
      // Demo without DB
      const demoSlots = splitIntoSlots("08:00", "22:00", 60).map((s) => ({ ...s, status: "available" as const }));
      if (ids.length === 1 && dayList.length === 1 && !Number.isFinite(Number((req.query as any)?.days))) {
        return reply.send({ court_id: ids[0], date, slots: demoSlots });
      }
      const demoGrids: Record<string, Record<string, any[]>> = {};
      for (const id of ids) demoGrids[id] = Object.fromEntries(dayList.map((d) => [d, demoSlots]));
      return reply.send({ date_from: dayList[0], days: dayList.length, courts: demoGrids });
    }

    // Public read — club slug is mandatory (never leak another club's slots).
    const club = await requireClub(req, reply, db, resolveClubSlug(req));
    if (!club) return;
    db = reqDb(req) as any;
    const courtRows = await db.select().from(courts).where(and(eq(courts.clubId, club.id), inArray(courts.id, ids)));
    if (!courtRows.length) return reply.status(404).send({ error: "Court not found" });

    // Hoisted (club-wide, fetched once): settings, username map, blocks,
    // rules, timetables, and all bookings in the window.
    const settings = await getClubSettings(db, club.id);
    const fallbackDur = settings?.defaultSlotDurationMinutes ?? 60;
    let usernameById: Record<string, string> = {};
    try {
      const userRows = await db.select().from(users).where(eq(users.clubId, club.id));
      for (const u of userRows as any[]) usernameById[String(u.id)] = u.username;
    } catch {}
    const blockRows = await db.select().from(blocks).where(eq(blocks.clubId, club.id));
    const ruleRows = await db.select().from(blockingRules).where(and(eq(blockingRules.clubId, club.id), eq(blockingRules.isActive, true)));
    const allTimetables: any[] = await db.select().from(timetables);
    const { gte, lte } = await import("drizzle-orm");
    const windowBookings: any[] = await db.select().from(bookings).where(and(
      eq(bookings.clubId, club.id),
      inArray(bookings.courtId, (courtRows as any[]).map((c: any) => c.id)),
      gte(bookings.date, dayList[0] as any),
      lte(bookings.date, dayList[dayList.length - 1] as any),
    ));
    const isActiveHold = (b: any) => ["pending_registration", "pending_approval", "approved"].includes(b.status) && !(b.status === "pending_registration" && b.expiresAt && new Date(b.expiresAt) < new Date());

    // grids[courtId][date] = slots.
    const grids: Record<string, Record<string, any[]>> = {};
    for (const day of dayList) {
      const dayOfWeek = new Date(day + "T12:00:00Z").getUTCDay();
      const dayStart = new Date(day + "T00:00:00Z");
      const dayEnd = new Date(day + "T23:59:59Z");
      for (const court of courtRows as any[]) {
        const court_id = court.id;
        // Slot windows for this court+day (ordered). Closed day = zero windows.
        // Legacy fallback: courts never re-saved since #24 still read `timetables`.
        const wins = (await db.select().from(timetableWindows)
          .where(and(eq(timetableWindows.courtId, court_id), eq(timetableWindows.dayOfWeek, dayOfWeek)))
          .orderBy(asc(timetableWindows.position)) as any[]);
        let baseSlots: Array<{ start: string; end: string; price_cents?: number }> = [];
        if (wins.length) {
          for (const w of wins) {
            const dur = w.slotDurationMinutes || fallbackDur;
            const price = w.priceCents ?? court.basePriceCents ?? 0;
            baseSlots.push(...splitIntoSlots(String(w.openTime).slice(0, 5), String(w.closeTime).slice(0, 5), dur).map((s) => ({ ...s, price_cents: price })));
          }
        } else {
          let tt = allTimetables.find((r: any) => String(r.courtId) === String(court_id) && r.dayOfWeek === dayOfWeek);
          if (!tt) tt = allTimetables.find((r: any) => r.courtId === null && r.dayOfWeek === dayOfWeek);
          if (tt && !tt.isClosed && tt.openTime && tt.closeTime) {
            const duration = tt.slotDurationMinutes || fallbackDur;
            baseSlots = splitIntoSlots(tt.openTime.slice(0, 5), tt.closeTime.slice(0, 5), duration)
              .map((s) => ({ ...s, price_cents: court.basePriceCents ?? 0 }));
          }
        }

        const activeBookings = windowBookings.filter((b: any) => String(b.courtId) === String(court_id) && String(b.date).slice(0, 10) === day && isActiveHold(b));
        const relevantBlocks = blockRows.filter((bl: any) => {
          const s = new Date(bl.startAt);
          const e = new Date(bl.endAt);
          return s <= dayEnd && e >= dayStart && (!bl.courtId || String(bl.courtId) === String(court_id));
        });
        const relevantRules = ruleRows.filter((ru: any) => ru.dayOfWeek === dayOfWeek && (!ru.courtId || String(ru.courtId) === String(court_id)));

        (grids[String(court_id)] ??= {})[day] = baseSlots.map((slot) => {
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
      }
    }

    // Legacy shape: single court, single day, no days param.
    if (courtRows.length === 1 && ids.length === 1 && dayList.length === 1 && !Number.isFinite(Number((req.query as any)?.days))) {
      return reply.send({ court_id: ids[0], date, slots: grids[String(courtRows[0].id)][dayList[0]] });
    }
    return reply.send({ date_from: dayList[0], days: dayList.length, courts: grids });
  });
}
