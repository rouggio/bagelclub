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
  });

  // DB — attach to fastify instance if DATABASE_URL present (Render PG or local docker)
  if (process.env.DATABASE_URL) {
    const { db, pool } = createDb(process.env.DATABASE_URL);
    (app as any).db = db;
    (app as any).pool = pool;
    app.addHook("onClose", async () => {
      await pool.end();
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
          const { deleteExpiredDemoRuns } = await import("./services/demo.js");
          const gone = await deleteExpiredDemoRuns((app as any).db);
          if (gone.length) app.log.info({ gone }, "expired demo runs cleaned");
        } catch (e) {
          app.log.error(e, "demo cleanup cron failed");
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
