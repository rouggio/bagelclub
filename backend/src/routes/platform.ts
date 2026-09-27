import type { FastifyInstance } from "fastify";
import { clubs, users, appSettings } from "../db/schema.js";
import { eq, and, isNull, desc } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { slugify, validateSlug, validTimezone } from "../services/club.js";
import { resetDemoShowcase, deleteExpiredDemoRuns, clubCounts } from "../services/demo.js";
import { auditLog } from "../db/schema.js";

const createClubSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(3).max(50).regex(/^[a-z0-9-]+$/).optional(),
  timezone: z.string().min(1).max(50),
  plan: z.enum(["free", "starter", "pro"]).optional(),
  currency: z.string().length(3).optional(),
  admin_username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_.-]+$/),
  admin_email: z.string().email().toLowerCase(),
  admin_password: z.string().min(8).max(128),
});

const patchClubSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  timezone: z.string().min(1).max(50).optional(),
  plan: z.enum(["free", "starter", "pro"]).optional(),
  is_active: z.boolean().optional(),
  is_listed: z.boolean().optional(),
  max_courts: z.number().int().min(0).nullable().optional(),
  public_url: z.string().url().max(255).nullable().optional().or(z.literal("")),
});

async function audit(db: any, actorId: string, action: string, target: string, meta?: any) {
  try {
    await db.insert(auditLog).values({ actorId, action, target, meta: meta ? JSON.stringify(meta) : null });
  } catch {}
}

export default async function platformRoutes(fastify: FastifyInstance) {
  const pre = [fastify.authenticate, fastify.requireSuperadmin] as any;

  fastify.get("/api/platform/clubs", { preHandler: pre }, async (req, reply) => {
    const db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const rows = await db.select().from(clubs);
    const out: any[] = [];
    for (const c of rows as any[]) {
      out.push({ ...c, counts: await clubCounts(db, c.id) });
    }
    return reply.send(out);
  });

  fastify.post("/api/platform/clubs", { preHandler: pre }, async (req, reply) => {
    const parsed = createClubSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const d = parsed.data;
    if (!validTimezone(d.timezone)) return reply.status(400).send({ error: "Invalid IANA timezone" });
    let slug = (d.slug || slugify(d.name)).toLowerCase();
    const slugErr = validateSlug(slug);
    if (slugErr) return reply.status(400).send({ error: slugErr });
    const actor = (req as any).user;
    try {
      const [club] = await db.insert(clubs).values({
        slug, name: d.name, timezone: d.timezone,
        plan: d.plan ?? "starter", currency: (d.currency ?? "EUR").toUpperCase(),
      }).returning();
      await db.insert(appSettings).values({ clubId: club.id }).onConflictDoNothing();
      const passwordHash = await bcrypt.hash(d.admin_password, 10);
      const [admin] = await db.insert(users).values({
        clubId: club.id, username: d.admin_username, email: d.admin_email,
        passwordHash, firstName: "Admin", lastName: d.name, role: "admin", isVerified: true,
      }).returning();
      await audit(db, actor.id, "platform.club.create", slug, { name: d.name, timezone: d.timezone });
      return reply.status(201).send({ club, admin: { id: admin.id, username: admin.username, email: admin.email } });
    } catch (e: any) {
      if (String(e.code) === "23505") return reply.status(409).send({ error: "slug, username or email already taken" });
      throw e;
    }
  });

  fastify.patch("/api/platform/clubs/:slug", { preHandler: pre }, async (req, reply) => {
    const parsed = patchClubSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const { slug } = req.params as any;
    const rows = await db.select().from(clubs).where(eq(clubs.slug, slug)).limit(1);
    const club = rows[0];
    if (!club) return reply.status(404).send({ error: "Not found" });
    const d = parsed.data as any;
    if (d.timezone !== undefined && !validTimezone(d.timezone)) return reply.status(400).send({ error: "Invalid IANA timezone" });
    const updates: any = { updatedAt: new Date() };
    if (d.name !== undefined) updates.name = d.name;
    if (d.timezone !== undefined) updates.timezone = d.timezone;
    if (d.plan !== undefined) updates.plan = d.plan;
    if (d.is_active !== undefined) updates.isActive = d.is_active;
    if (d.is_listed !== undefined) updates.isListed = d.is_listed;
    if (d.max_courts !== undefined) updates.maxCourts = d.max_courts;
    const [row] = await db.update(clubs).set(updates).where(eq(clubs.id, club.id)).returning();
    if (d.public_url !== undefined) {
      const v = d.public_url ? String(d.public_url).replace(/\/$/, "") : null;
      const srows = await db.select().from(appSettings).where(eq(appSettings.clubId, club.id)).limit(1);
      if (srows[0]) await db.update(appSettings).set({ publicUrl: v, updatedAt: new Date() }).where(eq(appSettings.clubId, club.id));
      else await db.insert(appSettings).values({ clubId: club.id, publicUrl: v }).onConflictDoNothing();
    }
    await audit(db, (req as any).user.id, "platform.club.patch", slug, d);
    return reply.send(row);
  });

  fastify.post("/api/platform/clubs/:slug/seed", { preHandler: pre }, async (req, reply) => {
    const db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const { slug } = req.params as any;
    const rows = await db.select().from(clubs).where(eq(clubs.slug, slug)).limit(1);
    if (!rows[0]) return reply.status(404).send({ error: "Not found" });
    await db.insert(appSettings).values({ clubId: rows[0].id }).onConflictDoNothing();
    await audit(db, (req as any).user.id, "platform.club.seed", slug, {});
    return reply.send({ ok: true });
  });

  // Provision the public showcase (/club/demo/) if missing, then reset its content.
  fastify.post("/api/platform/demo/ensure", { preHandler: pre }, async (req, reply) => {
    const db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const existing = await db.select().from(clubs).where(eq(clubs.slug, "demo")).limit(1);
    if (!existing[0]) {
      await db.insert(clubs).values({ slug: "demo", name: "Demo Club", timezone: "Europe/Rome", plan: "free", isDemo: true, isListed: true });
    }
    const club = await resetDemoShowcase(db);
    await audit(db, (req as any).user.id, "platform.demo.ensure", "demo", {});
    return reply.send({ ok: true, slug: club.slug });
  });

  fastify.post("/api/platform/clubs/demo/reset", { preHandler: pre }, async (req, reply) => {    const db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const countAll = async () => {
      const out: Record<string, number> = {};
      for (const [name, table] of [["users", users], ["clubs", clubs]] as any[]) {
        out[name] = (await db.select().from(table)).length;
      }
      return out;
    };
    const before = await countAll();
    const club = await resetDemoShowcase(db);
    const after = await countAll();
    await audit(db, (req as any).user.id, "platform.demo.reset", "demo", { before, after });
    return reply.send({ ok: true, slug: club.slug, before, after });
  });

  fastify.post("/api/platform/demo/cleanup", { preHandler: pre }, async (req, reply) => {
    const db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const deleted = await deleteExpiredDemoRuns(db);
    await audit(db, (req as any).user.id, "platform.demo.cleanup", "-", { deleted });
    return reply.send({ ok: true, deleted });
  });

  fastify.get("/api/platform/audit", { preHandler: pre }, async (req, reply) => {
    const db: any = (fastify as any).db;
    if (!db) return reply.send([]);
    const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(100);
    const clubRows = await db.select().from(clubs);
    const slugById: Record<string, string> = {};
    for (const c of clubRows as any[]) slugById[String(c.id)] = c.slug;
    return reply.send((rows as any[]).map((r: any) => ({ ...r, club_slug: r.clubId ? slugById[String(r.clubId)] ?? null : null })));
  });

  // Reset a club admin's password (support). Scoped: target must be a live
  // admin of the named club; new password returned once.
  fastify.post("/api/platform/clubs/:slug/reset-admin", { preHandler: pre }, async (req, reply) => {
    const db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const { slug } = req.params as any;
    const { user_id, new_password } = (req as any).body as any;
    if (!user_id || !new_password || String(new_password).length < 8) {
      return reply.status(400).send({ error: "user_id + new_password (min 8) required" });
    }
    const crows = await db.select().from(clubs).where(eq(clubs.slug, slug)).limit(1);
    if (!crows[0]) return reply.status(404).send({ error: "Not found" });
    const urows = await db.select().from(users)
      .where(and(eq(users.id, user_id), eq(users.clubId, crows[0].id), isNull(users.deletedAt))).limit(1);
    if (!urows[0] || urows[0].role !== "admin") return reply.status(404).send({ error: "Live admin not found in this club" });
    const passwordHash = await bcrypt.hash(String(new_password), 10);
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user_id));
    await audit(db, (req as any).user.id, "platform.admin.reset-password", slug, { user_id });
    return reply.send({ ok: true });
  });
}
