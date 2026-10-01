import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import cookie from "@fastify/cookie";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import authPlugin from "./plugins/auth.js";
import abusePlugin from "./plugins/abuse.js";
import healthRoutes from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import courtRoutes from "./routes/courts.js";
import bookingRoutes from "./routes/bookings.js";
import availabilityRoutes from "./routes/availability.js";
import timetableRoutes from "./routes/timetable.js";
import blockRoutes from "./routes/blocks.js";
import settingsRoutes from "./routes/settings.js";
import userRoutes from "./routes/users.js";
import reportsRoutes from "./routes/reports.js";
import notificationRoutes from "./routes/notifications.js";
import telegramRoutes from "./routes/telegram.js";
import announcementRoutes from "./routes/announcements.js";
import featureRequestRoutes from "./routes/feature-requests.js";
import feeRoutes from "./routes/fees.js";
import medcertRoutes from "./routes/medcert.js";
import clubRoutes from "./routes/clubs.js";
import platformRoutes from "./routes/platform.js";
import demoRoutes from "./routes/demo.js";
import { createDb } from "./db/connection.js";
import { BRAND_NAME } from "./config/brand.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL || "info" },
    trustProxy: true, // behind Render proxy: req.ip honors X-Forwarded-For (abuse shield)
  });

  // DB — attach to fastify instance if DATABASE_URL present (Render PG or local docker)
  // Runtime pool (RLS-enforced app role in prod) + owner pool for trust-root
  // paths (auth credential checks, webhook token bootstrap). AUTH_DATABASE_URL
  // falls back to DATABASE_URL for single-role dev setups.
  if (process.env.DATABASE_URL) {
    const { db, pool } = createDb(process.env.DATABASE_URL);
    (app as any).db = db;
    (app as any).pool = pool;
    const { db: dbOwner } = createDb(process.env.AUTH_DATABASE_URL || process.env.DATABASE_URL);
    (app as any).dbOwner = dbOwner;
    if (!process.env.AUTH_DATABASE_URL && process.env.NODE_ENV === "production") {
      app.log.warn("AUTH_DATABASE_URL unset — trust-root paths share the runtime pool");
    }
    app.addHook("onClose", async () => {
      await pool.end();
    });
    // Phase 4 RLS: commit + release the per-request scoped client.
    app.addHook("onResponse", async (req) => {
      const client = (req as any).clubClient;
      if (!client) return;
      try {
        await client.query("COMMIT");
      } catch {
        try { await client.query("ROLLBACK"); } catch {}
      }
      try { client.release(); } catch {}
      (req as any).clubDb = null;
      (req as any).clubClient = null;
    });
  }

  // CORS — same-origin in single-service mode; if CORS_ORIGIN set, use it (split Static Site)
  const corsOrigin = process.env.CORS_ORIGIN;
  await app.register(cors, {
    origin: corsOrigin || true,
    credentials: true,
  });

  await app.register(cookie);
  await app.register(jwt, {
    secret: process.env.JWT_SECRET || "dev-secret-change-me-32chars!!",
    sign: { expiresIn: process.env.JWT_EXPIRES_IN || "15m" },
  });

  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await app.register(authPlugin);
  await app.register(abusePlugin);

  // Routes
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(courtRoutes);
  await app.register(bookingRoutes);
  await app.register(availabilityRoutes);
  await app.register(timetableRoutes);
  await app.register(blockRoutes);
  await app.register(settingsRoutes);
  await app.register(userRoutes);
  await app.register(reportsRoutes);
  await app.register(notificationRoutes);
  await app.register(telegramRoutes);
  await app.register(announcementRoutes);
  await app.register(featureRequestRoutes);
  await app.register(feeRoutes);
  await app.register(medcertRoutes);
  await app.register(clubRoutes);
  await app.register(platformRoutes);
  await app.register(demoRoutes);

  // Static — serve pre-built frontend (Vite dist) if present
  // In dev, frontend runs on Vite dev server; in production (Render single service) backend serves it.
  const frontendDist = path.resolve(__dirname, "../../frontend/dist");
  if (fs.existsSync(frontendDist)) {
    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: "/",
      wildcard: false,
      decorateReply: true,
    });

    // SPA fallback: any non-/api route that is not a file → index.html
    // Return 404 for missing assets (so browser doesn't get text/html for JS/CSS)
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/") || req.url.startsWith("/health")) {
        return reply.status(404).send({ error: "Not found" });
      }
      if (req.url.startsWith("/assets/") || req.url.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff2?)$/)) {
        return reply.status(404).send({ error: "Not found" });
      }
      return (reply as any).sendFile("index.html");
    });
  }

  // Expire holds via in-process cron (MVP single instance)
  if (process.env.NODE_ENV !== "test") {
    try {
      const cron = await import("node-cron");
      cron.default.schedule("*/5 * * * *", async () => {
        if (!process.env.DATABASE_URL) return;
        try {
          const { expireHolds } = await import("./jobs/expireHolds.js");
          await expireHolds();
        } catch (e) {
          app.log.error(e, "expireHolds cron failed");
        }
      });
      // Demo hygiene, daily 03:00: delete expired personal demo runs.
      cron.default.schedule("0 3 * * *", async () => {
        if (!process.env.DATABASE_URL) return;
        try {
          const { withSuperadminScope } = await import("./services/club.js");
          const { deleteExpiredDemoRuns } = await import("./services/demo.js");
          const gone = await withSuperadminScope((app as any).db, async (cx: any) => deleteExpiredDemoRuns(cx));
          if (gone.length) app.log.info({ gone }, "expired demo runs cleaned");
        } catch (e) {
          app.log.error(e, "demo cleanup cron failed");
        }
      });
      // Showcase reset every 3 hours: the public demo club (credentials in a
      // public announcement) is wiped + reseeded so prospects always find it fresh.
      cron.default.schedule("0 */3 * * *", async () => {
        if (!process.env.DATABASE_URL) return;
        try {
          const { withSuperadminScope } = await import("./services/club.js");
          const { resetDemoShowcase } = await import("./services/demo.js");
          await withSuperadminScope((app as any).db, async (cx: any) => resetDemoShowcase(cx));
          app.log.info("demo showcase reset");
        } catch (e) {
          app.log.error(e, "demo reset cron failed");
        }
      });
      // #32: associate-fee overdue reminders, daily 07:00.
      cron.default.schedule("0 7 * * *", async () => {
        if (!process.env.DATABASE_URL) return;
        try {
          const { runFeeReminders } = await import("./jobs/feeReminders.js");
          await runFeeReminders();
        } catch (e) {
          app.log.error(e, "fee reminders cron failed");
        }
      });
      // #33: medical-cert expiry reminders, daily 07:30.
      cron.default.schedule("30 7 * * *", async () => {
        if (!process.env.DATABASE_URL) return;
        try {
          const { runMedcertReminders } = await import("./jobs/medcertReminders.js");
          await runMedcertReminders();
        } catch (e) {
          app.log.error(e, "medcert reminders cron failed");
        }
      });
    } catch {
      // node-cron not essential in dev without DB
    }
  }

  return app;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (process.env.NODE_ENV !== "test" && isMain) {
  const app = await buildApp();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";
  try {
    await app.listen({ port, host });
    console.log(`${BRAND_NAME} API listening on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
