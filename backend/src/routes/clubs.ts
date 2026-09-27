import type { FastifyInstance } from "fastify";
import { clubs } from "../db/schema.js";
import { eq, and, asc } from "drizzle-orm";

export default async function clubRoutes(fastify: FastifyInstance) {
  // Public directory: listed + active clubs only (slug + name).
  // Suspended, hidden and demo-expired runs never appear here.
  fastify.get("/api/clubs", async (req, reply) => {
    const db: any = (fastify as any).db;
    if (!db) return reply.send([]);
    const rows = await db
      .select({ slug: clubs.slug, name: clubs.name, demoExpiresAt: clubs.demoExpiresAt })
      .from(clubs)
      .where(and(eq(clubs.isListed, true), eq(clubs.isActive, true)))
      .orderBy(asc(clubs.name));
    const now = Date.now();
    return reply.send(
      rows
        .filter((r: any) => !r.demoExpiresAt || new Date(r.demoExpiresAt).getTime() > now)
        .map((r: any) => ({ slug: r.slug, name: r.name }))
    );
  });
}
