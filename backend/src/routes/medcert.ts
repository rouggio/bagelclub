// Medical certificates (#33): admin sets/removes per-player expiry dates.
// Gates live in bookings.ts; reminders in jobs/medcertReminders.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { users, auditLog } from "../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";
import { requireRequestClub, reqDb } from "../services/club.js";

const setSchema = z.object({
  expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export default async function medcertRoutes(fastify: FastifyInstance) {
  const admin = [fastify.authenticate, fastify.requireRole(["admin"])] as any;

  // Admin: set (or replace) a player's cert expiry.
  fastify.post("/api/users/:id/medical-cert", { preHandler: admin }, async (req, reply) => {
    const parsed = setSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const poolDb: any = (fastify as any).db;
    if (!poolDb) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, poolDb);
    if (!club) return;
    const db = reqDb(req) as any;
    const { id } = req.params as any;
    const target: any[] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.id, id), eq(users.clubId, club.id), isNull(users.deletedAt))).limit(1);
    if (!target[0]) return reply.status(404).send({ error: "User not found in this club" });
    const d = parsed.data;
    const [row] = await db.update(users).set({
      medicalCertExpiresAt: d.expires_at as any,
      medicalCertVerifiedBy: (req as any).user.id,
      medicalCertVerifiedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(users.id, target[0].id)).returning();
    if (!row) return reply.status(404).send({ error: "Not found" });
    try {
      await db.insert(auditLog).values({ actorId: (req as any).user.id, clubId: club.id, action: "medcert.set", target: target[0].id, meta: JSON.stringify({ expires_at: d.expires_at }) });
    } catch {}
    return reply.send({ ok: true, expires_at: d.expires_at });
  });

  // Admin: remove a player's cert.
  fastify.delete("/api/users/:id/medical-cert", { preHandler: admin }, async (req, reply) => {
    const poolDb: any = (fastify as any).db;
    if (!poolDb) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, poolDb);
    if (!club) return;
    const db = reqDb(req) as any;
    const { id } = req.params as any;
    const [row] = await db.update(users).set({
      medicalCertExpiresAt: null,
      medicalCertVerifiedBy: null, medicalCertVerifiedAt: null, updatedAt: new Date(),
    }).where(and(eq(users.id, id), eq(users.clubId, club.id))).returning();
    if (!row) return reply.status(404).send({ error: "Not found" });
    try {
      await db.insert(auditLog).values({ actorId: (req as any).user.id, clubId: club.id, action: "medcert.remove", target: id, meta: null });
    } catch {}
    return reply.send({ ok: true });
  });
}
