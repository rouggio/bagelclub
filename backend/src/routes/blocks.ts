import type { FastifyInstance } from "fastify";
import { blockSchema, blockingRuleSchema } from "../types/schemas.js";
import { blocks, blockingRules, bookings, courts } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { requireRequestClub } from "../services/club.js";

/** Live bookings of this club, optionally restricted to one court. */
async function clubBookings(db: any, clubId: string, courtId?: string | null) {
  if (courtId) {
    return db.select().from(bookings).where(and(eq(bookings.clubId, clubId), eq(bookings.courtId, courtId)));
  }
  return db.select().from(bookings).where(eq(bookings.clubId, clubId));
}

async function courtInClub(db: any, clubId: string, courtId: string | null | undefined): Promise<boolean> {
  if (!courtId) return true; // null = all courts of the club
  const rows = await db.select({ id: courts.id }).from(courts).where(and(eq(courts.id, courtId), eq(courts.clubId, clubId))).limit(1);
  return !!rows[0];
}

export default async function blockRoutes(fastify: FastifyInstance) {
  fastify.get("/api/blocks", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const db: any = (req as any).server.db;
    if (!db) return reply.send([]);
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    const rows = await db.select().from(blocks).where(eq(blocks.clubId, club.id)).orderBy(desc(blocks.startAt));
    return reply.send(rows);
  });
  fastify.post("/api/blocks", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const parsed = blockSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    const { court_id, start_at, end_at, reason } = parsed.data;
    if (!(await courtInClub(db, club.id, court_id))) return reply.status(404).send({ error: "Court not found" });
    const force = (req.query as any)?.force === "true";
    if (!force) {
      const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: club.timezone });
      const sAt = new Date(start_at), eAt = new Date(end_at);
      const sDate = sAt.toISOString().slice(0,10), eDate = eAt.toISOString().slice(0,10);
      // For simplicity check bookings on the block's start date (single day block assumption; for multi-day, check each day)
      // Query bookings that overlap the block's time window on relevant courts
      // If block for all courts (null), check all courts
      const allBookings: any[] = await clubBookings(db, club.id, court_id);
      const conflicts: any[] = [];
      for (const b of allBookings) {
        if (!["pending_approval","approved"].includes(b.status)) continue;
        if (b.date < todayStr) continue;
        // Block date range check: booking date must be within block's date range
        if (b.date < sDate || b.date > eDate) continue;
        // If block spans multiple days, we need to check time overlap only for the relevant day; for simplicity, if block is single day, check time
        // Get booking time as HH:MM
        const bStart = String(b.startTime).slice(0,5), bEnd = String(b.endTime).slice(0,5);
        const blkStart = sAt.toISOString().slice(11,16), blkEnd = eAt.toISOString().slice(11,16);
        // For multi-day blocks, we consider any booking on any day within range that overlaps time if block covers that day's time
        // Simplified: if booking date == block start date, check time overlap with blkStart-blkEnd
        // If block spans multiple days, it likely covers whole days, so any booking on intermediate days is conflict if court matches
        let overlap = false;
        if (sDate === eDate) {
          overlap = b.date === sDate && bStart < blkEnd && blkStart < bEnd;
        } else {
          // multi-day: if booking date equals start or end date, check partial, else if intermediate date, any booking on that court is conflict
          if (b.date === sDate) overlap = bStart < blkEnd && blkStart < bEnd;
          else if (b.date === eDate) overlap = bStart < blkEnd && blkStart < bEnd;
          else if (b.date > sDate && b.date < eDate) overlap = true;
        }
        if (overlap) {
          // also check court match already
          conflicts.push({ id: b.id, date: b.date, startTime: bStart, endTime: bEnd, courtId: b.courtId });
        }
      }
      if (conflicts.length) {
        return reply.status(409).send({ error: "Block would orphan live bookings", conflicts, hint: "cancel/move conflicting bookings first" });
      }
    }
    const [row] = await db.insert(blocks).values({ clubId: club.id, courtId: court_id ?? null, startAt: new Date(start_at), endAt: new Date(end_at), reason, createdBy: (req as any).user.id }).returning();
    return reply.status(201).send(row);
  });
  fastify.delete("/api/blocks/:id", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    const { id } = req.params as any;
    await db.delete(blocks).where(and(eq(blocks.id, id), eq(blocks.clubId, club.id)));
    return reply.status(204).send();
  });
  fastify.patch("/api/blocks/:id", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    const { id } = req.params as any;
    const body = (req as any).body as any;
    const force = (req.query as any)?.force === "true";
    // Fetch existing to compute final values for coherence check
    const existingRows = await db.select().from(blocks).where(and(eq(blocks.id, id), eq(blocks.clubId, club.id))).limit(1);
    if (!existingRows[0]) return reply.status(404).send({ error: "Not found" });
    const cur = existingRows[0];
    const finalCourtId = body.court_id !== undefined ? (body.court_id || null) : cur.courtId;
    if (!(await courtInClub(db, club.id, finalCourtId))) return reply.status(404).send({ error: "Court not found" });
    const finalStartAt = body.start_at !== undefined ? new Date(body.start_at) : cur.startAt;
    const finalEndAt = body.end_at !== undefined ? new Date(body.end_at) : cur.endAt;
    if (!force) {
      const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: club.timezone });
      const sAt = finalStartAt, eAt = finalEndAt;
      const sDate = sAt.toISOString().slice(0,10), eDate = eAt.toISOString().slice(0,10);
      const allBookings: any[] = await clubBookings(db, club.id, finalCourtId);
      const conflicts: any[] = [];
      for (const b of allBookings) {
        if (!["pending_approval","approved"].includes(b.status)) continue;
        if (b.date < todayStr) continue;
        if (b.date < sDate || b.date > eDate) continue;
        const bStart = String(b.startTime).slice(0,5), bEnd = String(b.endTime).slice(0,5);
        const blkStart = sAt.toISOString().slice(11,16), blkEnd = eAt.toISOString().slice(11,16);
        let overlap = false;
        if (sDate === eDate) overlap = b.date === sDate && bStart < blkEnd && blkStart < bEnd;
        else {
          if (b.date === sDate) overlap = bStart < blkEnd && blkStart < bEnd;
          else if (b.date === eDate) overlap = bStart < blkEnd && blkStart < bEnd;
          else if (b.date > sDate && b.date < eDate) overlap = true;
        }
        if (overlap) conflicts.push({ id: b.id, date: b.date, startTime: bStart, endTime: bEnd, courtId: b.courtId });
      }
      if (conflicts.length) return reply.status(409).send({ error: "Block would orphan live bookings", conflicts });
    }
    const updates: any = {};
    if (body.court_id !== undefined) updates.courtId = body.court_id || null;
    if (body.start_at !== undefined) updates.startAt = new Date(body.start_at);
    if (body.end_at !== undefined) updates.endAt = new Date(body.end_at);
    if (body.reason !== undefined) updates.reason = body.reason;
    if (Object.keys(updates).length === 0) return reply.status(400).send({ error: "No fields to update" });
    const [row] = await db.update(blocks).set(updates).where(and(eq(blocks.id, id), eq(blocks.clubId, club.id))).returning();
    if (!row) return reply.status(404).send({ error: "Not found" });
    return reply.send(row);
  });

  fastify.get("/api/blocking-rules", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const db: any = (req as any).server.db;
    if (!db) return reply.send([]);
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    const rows = await db.select().from(blockingRules).where(eq(blockingRules.clubId, club.id));
    return reply.send(rows);
  });
  fastify.post("/api/blocking-rules", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const parsed = blockingRuleSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    const { court_id, day_of_week, start_time, end_time, reason, valid_from, valid_until, is_active } = parsed.data;
    if (!(await courtInClub(db, club.id, court_id))) return reply.status(404).send({ error: "Court not found" });
    const force = (req.query as any)?.force === "true";
    const isActive = is_active ?? true;
    if (!force && isActive) {
      const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: club.timezone });
      const allBookings: any[] = await clubBookings(db, club.id, court_id);
      const conflicts: any[] = [];
      for (const b of allBookings) {
        if (!["pending_approval","approved"].includes(b.status)) continue;
        if (b.date < todayStr) continue;
        if (valid_from && b.date < valid_from) continue;
        if (valid_until && b.date > valid_until) continue;
        const dow = new Date(b.date + "T12:00:00Z").getUTCDay();
        if (dow !== day_of_week) continue;
        const s = String(b.startTime).slice(0,5), e = String(b.endTime).slice(0,5);
        const blkS = String(start_time).slice(0,5), blkE = String(end_time).slice(0,5);
        if (s < blkE && blkS < e) conflicts.push({ id: b.id, date: b.date, startTime: s, endTime: e, courtId: b.courtId });
      }
      if (conflicts.length) return reply.status(409).send({ error: "Recurring block would orphan live bookings", conflicts });
    }
    const [row] = await db.insert(blockingRules).values({ clubId: club.id, courtId: court_id ?? null, dayOfWeek: day_of_week, startTime: start_time, endTime: end_time, reason, validFrom: valid_from ?? null, validUntil: valid_until ?? null, isActive: isActive }).returning();
    return reply.status(201).send(row);
  });
  fastify.patch("/api/blocking-rules/:id", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    const { id } = req.params as any;
    const body = (req as any).body as any;
    const force = (req.query as any)?.force === "true";
    // Fetch existing for final values
    const existingRows = await db.select().from(blockingRules).where(and(eq(blockingRules.id, id), eq(blockingRules.clubId, club.id))).limit(1);
    const cur = existingRows[0];
    if (!cur) return reply.status(404).send({ error: "Not found" });
    const finalCourtId = body.court_id !== undefined ? (body.court_id || null) : cur.courtId;
    if (!(await courtInClub(db, club.id, finalCourtId))) return reply.status(404).send({ error: "Court not found" });
    const finalDow = body.day_of_week !== undefined ? body.day_of_week : cur.dayOfWeek;
    const finalStart = body.start_time !== undefined ? body.start_time : cur.startTime;
    const finalEnd = body.end_time !== undefined ? body.end_time : cur.endTime;
    const finalIsActive = body.is_active !== undefined ? body.is_active : cur.isActive;
    const finalValidFrom = (body.valid_from !== undefined ? body.valid_from : cur.validFrom) as any;
    const finalValidUntil = (body.valid_until !== undefined ? body.valid_until : cur.validUntil) as any;
    if (!force && finalIsActive) {
      const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: club.timezone });
      const allBookings: any[] = await clubBookings(db, club.id, finalCourtId);
      const conflicts: any[] = [];
      for (const b of allBookings) {
        if (!["pending_approval","approved"].includes(b.status)) continue;
        if (b.date < todayStr) continue;
        if (finalValidFrom && b.date < finalValidFrom) continue;
        if (finalValidUntil && b.date > finalValidUntil) continue;
        const dow = new Date(b.date + "T12:00:00Z").getUTCDay();
        if (dow !== finalDow) continue;
        const s = String(b.startTime).slice(0,5), e = String(b.endTime).slice(0,5);
        const blkS = String(finalStart).slice(0,5), blkE = String(finalEnd).slice(0,5);
        if (s < blkE && blkS < e) conflicts.push({ id: b.id, date: b.date, startTime: s, endTime: e, courtId: b.courtId });
      }
      if (conflicts.length) return reply.status(409).send({ error: "Recurring block would orphan live bookings", conflicts });
    }
    const updates: any = {};
    if (body.court_id !== undefined) updates.courtId = body.court_id || null;
    if (body.day_of_week !== undefined) updates.dayOfWeek = body.day_of_week;
    if (body.start_time !== undefined) updates.startTime = body.start_time;
    if (body.end_time !== undefined) updates.endTime = body.end_time;
    if (body.reason !== undefined) updates.reason = body.reason;
    if (body.is_active !== undefined) updates.isActive = body.is_active;
    if (body.valid_from !== undefined) updates.validFrom = body.valid_from || null;
    if (body.valid_until !== undefined) updates.validUntil = body.valid_until || null;
    const [row] = await db.update(blockingRules).set(updates).where(and(eq(blockingRules.id, id), eq(blockingRules.clubId, club.id))).returning();
    if (!row) return reply.status(404).send({ error: "Not found" });
    return reply.send(row);
  });
  fastify.delete("/api/blocking-rules/:id", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    const { id } = req.params as any;
    await db.delete(blockingRules).where(and(eq(blockingRules.id, id), eq(blockingRules.clubId, club.id)));
    return reply.status(204).send();
  });
}
