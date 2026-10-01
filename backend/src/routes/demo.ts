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
      // Club-side history (scoped: the public route carries no club GUC).
      try {
        const { withClubScope } = await import("../services/club.js");
        const { auditLog } = await import("../db/schema.js");
        await withClubScope(db, club.id, async (cx: any) => {
          await cx.insert(auditLog).values({ actorId: null, clubId: club.id, action: "demo.start", target: club.slug, meta: JSON.stringify({ name: club.name }) });
        });
      } catch {}
      // Platform pings (fire-and-forget): a prospect just created a club.
      // Email goes to SUPERADMIN_EMAIL; Telegram to the superadmin chat.
      // Each gated by its platform toggle. Skipped without addresses;
      // never fails the 201.
      try {
        const to = (process.env.SUPERADMIN_EMAIL || "").toLowerCase();
        const { getPlatformSetting } = await import("../services/club.js");
        const flag = async (k: string) => ((await getPlatformSetting(db, k).catch(() => null)) ?? "true") !== "false";
        const courtsTxt = d.courts.filter((c) => c.count > 0).map((c) => `${c.count} ${c.type}`).join(" + ") || "—";
        const base = ((await getPlatformSetting(db, "base_url").catch(() => null)) || "").replace(/\/$/, "");
        const link = `${base}/club/${club.slug}/`;
        const jobs: Promise<any>[] = [];
        if (to && (await flag("notify_demo_start"))) {
          const { sendEmail } = await import("../services/email.js");
          jobs.push(sendEmail({
            to,
            subject: `New demo club: ${club.name} (${club.slug})`,
            text: `A prospect just started a demo club.\nName: ${club.name}\nSlug: ${club.slug}\nCourts: ${courtsTxt}\nExpires: ${club.demoExpiresAt}\nOpen: ${link}`,
          }).catch(() => false));
        }
        if (await flag("notify_demo_start_telegram")) {
          const { sendTelegramMessage } = await import("../services/notifications.js");
          const botToken = process.env.SUPERADMIN_TELEGRAM_BOT_TOKEN || "";
          const chatId = process.env.SUPERADMIN_TELEGRAM_CHAT_ID || "";
          if (botToken && chatId) {
            jobs.push(sendTelegramMessage(botToken, chatId,
              `New demo club: ${club.name} (${club.slug}) — ${courtsTxt}. Open: ${link}`).catch(() => false));
          }
        }
        if (process.env.NODE_ENV === "test") await Promise.all(jobs);
        else for (const j of jobs) j.catch(() => {});
      } catch {}
      return reply.status(201).send({
        slug: club.slug,
        name: club.name,
        url: `/club/${club.slug}/`,
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
