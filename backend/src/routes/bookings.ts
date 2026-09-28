import type { FastifyInstance } from "fastify";
import { bookingIntentSchema } from "../types/schemas.js";
import { randomUUID } from "crypto";
import { bookings, timetables, courts } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { requireRequestClub, getClubSettings, reqDb } from "../services/club.js";

function computeEnd(startTime: string, durationMin: number): string {
  const [h, m] = startTime.split(":").map(Number);
  const total = h * 60 + m + durationMin;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}:00`;
}

export default async function bookingRoutes(fastify: FastifyInstance) {
  fastify.post("/api/bookings/intent", async (_req, reply) => {
    // Deprecated: visitor intent is now stored only locally, booking created only after auth
    return reply.status(410).send({ error: "Intent endpoint deprecated — booking is created only after registration via POST /api/bookings" });
  });

  fastify.post("/api/bookings", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const parsed = bookingIntentSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const { court_id, date, start_time, notes, rent_racquets, players } = parsed.data as any;
    let db: any = (fastify as any).db;
    const user = (req as any).user;
    if (!db) return reply.status(201).send({ id: randomUUID(), status: "pending_approval", ...parsed.data, players: players ?? 2 });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    // Court must belong to the caller's club.
    const courtRows = await db.select().from(courts).where(and(eq(courts.id, court_id), eq(courts.clubId, club.id))).limit(1);
    const court = courtRows[0];
    if (!court) return reply.status(404).send({ error: "Court not found" });
    // Prevent booking in the past (club timezone — mandatory per club, no default).
    const tz = club.timezone;
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: tz });
    if (date < todayStr) return reply.status(400).send({ error: "Cannot book in the past" });
    if (date === todayStr) {
      const nowTime = new Date().toLocaleTimeString("en-GB", { timeZone: tz, hour12: false }).slice(0, 5);
      if (start_time.slice(0, 5) < nowTime) return reply.status(400).send({ error: "Cannot book a time slot in the past" });
    }
    // Default players per court type if not provided: tennis 2 (single), padel 4 (double)
    const playersVal = players ?? (court.type === "padel" ? 4 : 2);

    let duration = 60;
    const dayOfWeek = new Date(date + "T12:00:00Z").getUTCDay();
    const allTT = await db.select().from(timetables);
    let tt = allTT.find((r: any) => String(r.courtId) === String(court_id) && r.dayOfWeek === dayOfWeek);
    if (!tt) tt = allTT.find((r: any) => r.courtId === null && r.dayOfWeek === dayOfWeek);
    if (tt?.slotDurationMinutes) duration = tt.slotDurationMinutes;
    else {
      const s = await getClubSettings(db, club.id);
      duration = s?.defaultSlotDurationMinutes ?? 60;
    }
    const endTime = computeEnd(start_time, duration);

    const normStart = start_time.length === 5 ? `${start_time}:00` : start_time;
    const existing = await db.select().from(bookings).where(and(eq(bookings.clubId, club.id), eq(bookings.courtId, court_id), eq(bookings.date, date)));
    const overlaps = existing.filter(
      (b: any) =>
        ["pending_registration", "pending_approval", "approved"].includes(b.status) &&
        !(b.status === "pending_registration" && b.expiresAt && new Date(b.expiresAt) < new Date()) &&
        b.startTime < endTime &&
        normStart < b.endTime
    );
    if (overlaps.length) {
      console.warn(`[bookings 409] court=${court_id} date=${date} req=${normStart}-${endTime} duration=${duration} existing=${JSON.stringify(existing.map((b:any)=>({s:b.startTime,e:b.endTime,status:b.status})))} overlaps=${JSON.stringify(overlaps.map((b:any)=>({s:b.startTime,e:b.endTime})))}`);
      return reply.status(409).send({ error: "Slot already booked or held" });
    }

    const settings = await getClubSettings(db, club.id);
    const autoApprove = settings?.autoApproveBookings ?? false;
    // Admin bookings are auto-approved (no need to approve own booking)
    const status = user.role === "admin" || autoApprove ? "approved" : "pending_approval";

    const [row] = await db
      .insert(bookings)
      .values({ clubId: club.id, courtId: court_id, userId: user.id, date, startTime: start_time, endTime, status: status as any, notes: notes ?? null, rentRacquets: rent_racquets ?? 0, players: playersVal, priceCents: court.basePriceCents ?? 0, reviewedBy: user.role === "admin" ? user.id : null })
      .returning();
    // Notifications (fire-and-forget, localized per recipient)
    if (status === "pending_approval") {
      try {
        const { notifyAdminPendingBooking } = await import("../services/notifications.js");
        notifyAdminPendingBooking((fastify as any).db, row).catch(() => {});
      } catch {}
    } else if (status === "approved") {
      const s = settings as any;
      if (s?.notifyOnAutoApproved) {
        try {
          const { notifyAdminPendingBooking } = await import("../services/notifications.js");
          notifyAdminPendingBooking((fastify as any).db, row, { autoApproved: true }).catch(() => {});
        } catch {}
      }
      // User auto-approved — localized to user's language (skip admin self-bookings)
      if (user.role !== "admin") {
        try {
          const { notifyUserBookingDecision } = await import("../services/notifications.js");
          notifyUserBookingDecision((fastify as any).db, row, "approved").catch(() => {});
        } catch {}
      }
    }
    return reply.status(201).send(row);
  });

  fastify.get("/api/bookings", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    let db: any = (fastify as any).db;
    const user = (req as any).user;
    if (!db) return reply.send([]);
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const { mine, status, court_id, date_from, date_to } = (req.query as any) || {};
    let rows = await db.select().from(bookings).where(eq(bookings.clubId, club.id)).orderBy(desc(bookings.createdAt));
    if (user.role !== "admin" || mine === "true") {
      rows = rows.filter((r: any) => String(r.userId) === String(user.id));
    }
    if (status) rows = rows.filter((r: any) => r.status === status);
    if (court_id) rows = rows.filter((r: any) => String(r.courtId) === String(court_id));
    // Booking date filter (YYYY-MM-DD, club-local; slice guards datetime serializations)
    if (date_from) rows = rows.filter((r: any) => String(r.date).slice(0, 10) >= String(date_from).slice(0, 10));
    if (date_to) rows = rows.filter((r: any) => String(r.date).slice(0, 10) <= String(date_to).slice(0, 10));
    // Enrich with username for admin display (instead of hash) — club users only.
    try {
      const { users } = await import("../db/schema.js");
      const userRows = await db.select().from(users).where(eq(users.clubId, club.id));
      const usernameById: Record<string, string> = {};
      for (const u of userRows as any[]) usernameById[String(u.id)] = u.username;
      rows = rows.map((r: any) => ({ ...r, username: usernameById[String(r.userId)] || null }));
    } catch {}
    return reply.send(rows);
  });

  async function scopedBooking(db: any, clubId: string, id: string) {
    const rows = await db.select().from(bookings).where(and(eq(bookings.id, id), eq(bookings.clubId, clubId))).limit(1);
    return rows[0] ?? null;
  }

  fastify.get("/api/bookings/:id", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    let db: any = (fastify as any).db;
    if (!db) return reply.send({ id: (req.params as any).id });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const { id } = req.params as any;
    const booking = await scopedBooking(db, club.id, id);
    if (!booking) return reply.status(404).send({ error: "Not found" });
    const user = (req as any).user;
    if (user.role !== "admin" && String(booking.userId) !== String(user.id)) return reply.status(403).send({ error: "Forbidden" });
    return reply.send(booking);
  });

  fastify.post("/api/bookings/:id/approve", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    let db: any = (fastify as any).db;
    if (!db) return reply.send({ id: (req.params as any).id, status: "approved" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const { id } = req.params as any;
    const [row] = await db.update(bookings).set({ status: "approved" as any, reviewedBy: (req as any).user.id }).where(and(eq(bookings.id, id), eq(bookings.clubId, club.id))).returning();
    if (!row) return reply.status(404).send({ error: "Not found" });
    try {
      const { notifyUserBookingDecision } = await import("../services/notifications.js");
      notifyUserBookingDecision((fastify as any).db, row, "approved").catch(() => {});
    } catch {}
    return reply.send(row);
  });

  fastify.post("/api/bookings/:id/reject", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    let db: any = (fastify as any).db;
    if (!db) return reply.send({ id: (req.params as any).id, status: "rejected" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const { id } = req.params as any;
    const [row] = await db.update(bookings).set({ status: "rejected" as any, reviewedBy: (req as any).user.id }).where(and(eq(bookings.id, id), eq(bookings.clubId, club.id))).returning();
    if (!row) return reply.status(404).send({ error: "Not found" });
    try {
      const { notifyUserBookingDecision } = await import("../services/notifications.js");
      notifyUserBookingDecision((fastify as any).db, row, "rejected").catch(() => {});
    } catch {}
    return reply.send(row);
  });

  fastify.patch("/api/bookings/:id", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    let db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const { id } = req.params as any;
    const user = (req as any).user;
    const booking = await scopedBooking(db, club.id, id);
    if (!booking) return reply.status(404).send({ error: "Not found" });
    if (String(booking.userId) !== String(user.id) && user.role !== "admin") return reply.status(403).send({ error: "Forbidden" });
    if (!["pending_approval", "approved"].includes(booking.status)) return reply.status(400).send({ error: "Only pending or approved bookings can be edited" });
    const body = (req as any).body as any;
    const updates: any = {};
    if (body.notes !== undefined) {
      if (body.notes !== null && String(body.notes).length > 1000) return reply.status(400).send({ error: "notes max 1000" });
      updates.notes = body.notes || null;
    }
    if (body.rent_racquets !== undefined) {
      const v = Number(body.rent_racquets);
      if (!Number.isInteger(v) || v < 0 || v > 4) return reply.status(400).send({ error: "rent_racquets must be 0-4" });
      updates.rentRacquets = v;
    }
    if (body.players !== undefined) {
      const v = Number(body.players);
      if (v !== 2 && v !== 4) return reply.status(400).send({ error: "players must be 2 or 4" });
      updates.players = v;
    }
    if (Object.keys(updates).length === 0) return reply.status(400).send({ error: "No editable fields (notes, rent_racquets, players)" });
    updates.updatedAt = new Date();
    const [row] = await db.update(bookings).set(updates).where(and(eq(bookings.id, id), eq(bookings.clubId, club.id))).returning();
    return reply.send(row);
  });

  fastify.post("/api/bookings/:id/cancel", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    let db: any = (fastify as any).db;
    if (!db) return reply.send({ id: (req.params as any).id, status: "cancelled" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const { id } = req.params as any;
    const booking = await scopedBooking(db, club.id, id);
    if (!booking) return reply.status(404).send({ error: "Not found" });
    const user = (req as any).user;
    if (user.role !== "admin" && String(booking.userId) !== String(user.id)) return reply.status(403).send({ error: "Forbidden" });
    const [row] = await db.update(bookings).set({ status: "cancelled" as any }).where(and(eq(bookings.id, id), eq(bookings.clubId, club.id))).returning();
    return reply.send(row);
  });
}
