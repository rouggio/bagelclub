// Medical certificates (#33): admin sets/removes per-player expiry dates.
// Gates live in bookings.ts; reminders in jobs/medcertReminders.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { users, auditLog } from "../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";
import { requireRequestClub, getClubSettings, reqDb } from "../services/club.js";
import { certStatus } from "../services/medcert.js";

const setSchema = z.object({
  expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export default async function medcertRoutes(fastify: FastifyInstance) {
  const admin = [fastify.authenticate, fastify.requireRole(["admin"])] as any;

  // Admin: expiry report — every non-admin member with cert status,
  // expired first. Shown under Reporting.
  fastify.get("/api/medcert/overview", { preHandler: admin }, async (req, reply) => {
    const poolDb: any = (req as any).server.db;
    if (!poolDb) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, poolDb);
    if (!club) return;
    const db = reqDb(req) as any;
    const settings = await getClubSettings(db, club.id);
    const { todayInTz } = await import("../services/medcert.js");
    const today = todayInTz(club.timezone);
    const rows: any[] = await db.select({
      id: users.id, username: users.username, firstName: users.firstName,
      lastName: users.lastName, email: users.email, role: users.role,
      expiresAt: users.medicalCertExpiresAt,
    }).from(users).where(and(eq(users.clubId, club.id), isNull(users.deletedAt)));
    const rank: Record<string, number> = { expired: 0, expiring: 1, missing: 2, valid: 3 };
    const out = (rows as any[])
      .filter((u: any) => u.role !== "admin")
      .map((u: any) => {
        const exp = u.expiresAt ? String(u.expiresAt).slice(0, 10) : null;
        return {
          id: u.id, username: u.username,
          name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.username,
          email: u.email, role: u.role, expires_at: exp,
          status: certStatus(exp, today),
        };
      })
      .sort((a: any, b: any) => (rank[a.status] - rank[b.status]) || (String(a.expires_at || "9999") < String(b.expires_at || "9999") ? -1 : 1));
    return reply.send({
      required: !!(settings as any)?.requireMedicalCert,
      users: out,
      totals: {
        expired: out.filter((u: any) => u.status === "expired").length,
        expiring: out.filter((u: any) => u.status === "expiring").length,
        missing: out.filter((u: any) => u.status === "missing").length,
      },
    });
  });

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
