import type { FastifyInstance } from "fastify";
import { courtSchema } from "../types/schemas.js";
import { courts } from "../db/schema.js";
import { eq, and, asc } from "drizzle-orm";
import { resolveClubSlug, requireClub, requireRequestClub, reqDb } from "../services/club.js";

export default async function courtRoutes(fastify: FastifyInstance) {
  fastify.get("/api/courts", async (req, reply) => {
    let db: any = (fastify as any).db;
    const { type, active } = (req.query as any) || {};
    if (!db) {
      // Fallback demo when no DB
      return reply.send([
        { id: "c1", number: 1, type: "tennis", name: "Central Tennis", surface: "clay", is_active: true },
        { id: "c2", number: 2, type: "tennis", surface: "synthetic", is_active: true },
        { id: "c3", number: 3, type: "padel", name: "Padel 1", is_active: true },
        { id: "c4", number: 4, type: "padel", name: "Padel 2", is_active: true },
      ]);
    }
    const club = await requireClub(req, reply, db, resolveClubSlug(req));
    if (!club) return;
    db = reqDb(req) as any;
    let rows = await db.select().from(courts).where(eq(courts.clubId, club.id)).orderBy(asc(courts.number));
    if (type) rows = rows.filter((r: any) => r.type === type);
    if (active !== undefined) {
      const want = active === "true" || active === true;
      rows = rows.filter((r: any) => r.isActive === want);
    }
    // Map snake_case for frontend
    return reply.send(rows.map((r: any) => ({ id: r.id, number: r.number, type: r.type, name: r.name, surface: r.surface, base_price_cents: r.basePriceCents ?? 0, is_active: r.isActive })));
  });

  fastify.post("/api/courts", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const parsed = courtSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    let db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const { number, type, name, surface, base_price_cents, is_active } = parsed.data;
    try {
      const [row] = await db
        .insert(courts)
        .values({ clubId: club.id, number, type: type as any, name: name ?? null, surface: surface ?? null, basePriceCents: base_price_cents ?? 0, isActive: is_active ?? true })
        .returning();
      return reply.status(201).send(row);
    } catch (e: any) {
      if (String(e.code) === "23505") return reply.status(409).send({ error: "Court number already exists" });
      throw e;
    }
  });

  fastify.patch("/api/courts/:id", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    let db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const { id } = req.params as any;
    const body = (req as any).body as any;
    const updates: any = {};
    if (body.number !== undefined) updates.number = body.number;
    if (body.type !== undefined) updates.type = body.type;
    if (body.name !== undefined) updates.name = body.name;
    if (body.surface !== undefined) updates.surface = body.surface;
    if (body.base_price_cents !== undefined) {
      const v = Number(body.base_price_cents);
      if (!Number.isInteger(v) || v < 0) return reply.status(400).send({ error: "base_price_cents must be >= 0" });
      updates.basePriceCents = v;
    }
    if (body.is_active !== undefined) updates.isActive = body.is_active;
    updates.updatedAt = new Date();
    const [row] = await db.update(courts).set(updates).where(and(eq(courts.id, id), eq(courts.clubId, club.id))).returning();
    if (!row) return reply.status(404).send({ error: "Not found" });
    return reply.send(row);
  });

  fastify.delete("/api/courts/:id", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    let db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const { id } = req.params as any;
    // Soft-disable: set isActive false instead of delete to keep history
    await db.update(courts).set({ isActive: false }).where(and(eq(courts.id, id), eq(courts.clubId, club.id)));
    return reply.status(204).send();
  });
}
