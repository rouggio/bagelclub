import type { FastifyInstance } from "fastify";
import { featureRequests, featureRequestVotes, auditLog } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { featureRequestSchema, featureRequestPatchSchema } from "../types/schemas.js";
import { requireRequestClub, reqDb } from "../services/club.js";

// Feature requests (#30): shared cross-club board. Club admins see every
// request ANONYMIZED (no origin club/author); origin is platform-only.
// Open requests sort first, then most-voted, then newest.

async function voteCounts(db: any) {
  const all: any[] = await db.select().from(featureRequestVotes);
  const counts: Record<string, number> = {};
  const byRequest: Record<string, any[]> = {};
  for (const v of all) {
    const k = String(v.requestId);
    counts[k] = (counts[k] ?? 0) + 1;
    (byRequest[k] ??= []).push(v);
  }
  return { counts, byRequest };
}

function pubRow(r: any, clubId: string, userId: string, counts: Record<string, number>, byRequest: Record<string, any[]>) {
  const voters = byRequest[String(r.id)] ?? [];
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    status: r.status,
    reply: r.reply,
    votes: counts[String(r.id)] ?? 0,
    mine: String(r.clubId) === String(clubId),
    voted: voters.some((v: any) => String(v.userId) === String(userId)),
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

function sortBoard(rows: any[]) {
  return [...rows].sort((a, b) => {
    const ao = a.status === "open" ? 0 : 1;
    const bo = b.status === "open" ? 0 : 1;
    if (ao !== bo) return ao - bo;
    if (b.votes !== a.votes) return b.votes - a.votes;
    return String(b.created_at).localeCompare(String(a.created_at));
  });
}

export default async function featureRequestRoutes(fastify: FastifyInstance) {
  fastify.post("/api/feature-requests", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const parsed = featureRequestSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    let db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const user = (req as any).user;
    const [row] = await db.insert(featureRequests).values({
      clubId: club.id, authorId: user.id, title: parsed.data.title.trim(), body: parsed.data.body.trim(), status: "open" as any,
    }).returning();
    try {
      await db.insert(auditLog).values({ actorId: user.id, clubId: club.id, action: "featurereq.create", target: row.id, meta: JSON.stringify({ title: row.title }) });
    } catch {}
    return reply.status(201).send({ ...pubRow(row, club.id, user.id, {}, {}), votes: 0, mine: true, voted: false });
  });

  fastify.get("/api/feature-requests", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    let db: any = (fastify as any).db;
    if (!db) return reply.send([]);
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const user = (req as any).user;
    const rows: any[] = await db.select().from(featureRequests);
    const { counts, byRequest } = await voteCounts(db);
    return reply.send(sortBoard(rows.map((r: any) => pubRow(r, club.id, user.id, counts, byRequest))));
  });

  fastify.patch("/api/feature-requests/:id", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const parsed = featureRequestPatchSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    let db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const user = (req as any).user;
    const { id } = req.params as any;
    const rows: any[] = await db.select().from(featureRequests).where(eq(featureRequests.id, id)).limit(1);
    const row = rows[0];
    if (!row) return reply.status(404).send({ error: "Not found" });
    if (String(row.clubId) !== String(club.id)) return reply.status(403).send({ error: "Only the requesting club can edit" });
    if (row.status !== "open") return reply.status(400).send({ error: "Only open requests can be edited" });
    const updates: any = { updatedAt: new Date() };
    if (parsed.data.title !== undefined) updates.title = parsed.data.title.trim();
    if (parsed.data.body !== undefined) updates.body = parsed.data.body.trim();
    const [next] = await db.update(featureRequests).set(updates).where(eq(featureRequests.id, id)).returning();
    try {
      await db.insert(auditLog).values({ actorId: user.id, clubId: club.id, action: "featurereq.edit", target: id, meta: null });
    } catch {}
    const { counts, byRequest } = await voteCounts(db);
    return reply.send(pubRow(next, club.id, user.id, counts, byRequest));
  });

  fastify.post("/api/feature-requests/:id/vote", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    let db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const user = (req as any).user;
    const { id } = req.params as any;
    const rows: any[] = await db.select().from(featureRequests).where(eq(featureRequests.id, id)).limit(1);
    const row = rows[0];
    if (!row) return reply.status(404).send({ error: "Not found" });
    if (String(row.clubId) === String(club.id)) return reply.status(403).send({ error: "Cannot vote your own club's request" });
    const existing: any[] = await db.select().from(featureRequestVotes)
      .where(and(eq(featureRequestVotes.requestId, id), eq(featureRequestVotes.userId, user.id))).limit(1);
    let voted: boolean;
    if (existing[0]) {
      await db.delete(featureRequestVotes).where(and(eq(featureRequestVotes.requestId, id), eq(featureRequestVotes.userId, user.id)));
      voted = false;
    } else {
      await db.insert(featureRequestVotes).values({ requestId: id, userId: user.id, clubId: club.id });
      voted = true;
    }
    const { counts } = await voteCounts(db);
    return reply.send({ voted, votes: counts[String(id)] ?? 0 });
  });
}
