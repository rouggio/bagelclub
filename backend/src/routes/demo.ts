import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { startDemoRun } from "../services/demo.js";

const startSchema = z.object({
  display_name: z.string().max(100).optional().nullable(),
  courts: z.array(z.object({ type: z.enum(["tennis", "padel"]), count: z.number().int().min(0).max(6) })).min(1).max(2),
});

const RANDOM_NAMES = ["Sunset Smash Club", "Bagel Baseline", "Topspin Terrace", "Volley Vineyard", "Deuce Dunes", "Ace Alley"];

export default async function demoRoutes(fastify: FastifyInstance) {
  // Public: provision a personal ephemeral demo run (no signup).
  fastify.post("/api/demo/start", async (req, reply) => {
    const parsed = startSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const d = parsed.data;
    let displayName = (d.display_name || "").trim() || null;
    if (!displayName) displayName = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
    try {
      const { club, adminUsername, adminPassword } = await startDemoRun(db, { displayName, courts: d.courts });
      return reply.status(201).send({
        slug: club.slug,
        name: club.name,
        url: `/c/${club.slug}/`,
        admin_username: adminUsername,
        admin_password: adminPassword,
        expires_at: club.demoExpiresAt,
      });
    } catch (e: any) {
      return reply.status(e.statusCode || 500).send({ error: e.message || "Demo start failed" });
    }
  });

  // Public: random club-name ideas for the wizard's "Surprise me".
  fastify.get("/api/demo/names", async (_req, reply) => {
    return reply.send({ names: RANDOM_NAMES });
  });
}
