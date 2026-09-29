import type { FastifyInstance } from "fastify";
import { clubs, users, appSettings } from "../db/schema.js";
import { eq, and, isNull, desc } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { slugify, validateSlug, validTimezone } from "../services/club.js";
import { attachSuperadmin, reqDb } from "../services/club.js";
import { resetDemoShowcase, deleteIdleDemoRuns, wipeClubData, clubCounts } from "../services/demo.js";
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
});

async function audit(db: any, actorId: string, action: string, target: string, meta?: any, clubSlug?: string) {
  try {
    // Store clubId so the audit UI can show/filter by club; resolve from
    // target (usually a club slug) unless an explicit slug is given.
    let clubId: string | null = null;
    const slug = clubSlug || (/^[a-z0-9-]{3,50}$/.test(target || "") ? target : null);
    if (slug) {
      const rows: any[] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.slug, slug));
      if (rows[0]) clubId = rows[0].id;
    }
    await db.insert(auditLog).values({ actorId, clubId, action, target, meta: meta ? JSON.stringify(meta) : null });
  } catch {}
}

export default async function platformRoutes(fastify: FastifyInstance) {
  const pre = [fastify.authenticate, fastify.requireSuperadmin, async (req: any, _reply: any) => { await attachSuperadmin(req); }] as any;

  // Public: platform footer text for landing/directory/platform pages.
  fastify.get("/api/platform/public", async (req, reply) => {
    const db: any = (fastify as any).db;
    if (!db) return reply.send({ footer_text: "" });
    const { getPlatformSetting } = await import("../services/club.js");
    return reply.send({ footer_text: (await getPlatformSetting(db, "footer_text")) || "" });
  });

  fastify.get("/api/platform/clubs", { preHandler: pre }, async (req, reply) => {
    let db: any = reqDb(req);
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
    let db: any = reqDb(req);
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
    let db: any = reqDb(req);
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
    await audit(db, (req as any).user.id, "platform.club.patch", slug, d);
    return reply.send(row);
  });

  fastify.post("/api/platform/clubs/:slug/seed", { preHandler: pre }, async (req, reply) => {
    let db: any = reqDb(req);
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const { slug } = req.params as any;
    const rows = await db.select().from(clubs).where(eq(clubs.slug, slug)).limit(1);
    if (!rows[0]) return reply.status(404).send({ error: "Not found" });
    await db.insert(appSettings).values({ clubId: rows[0].id }).onConflictDoNothing();
    await audit(db, (req as any).user.id, "platform.club.seed", slug, {});
    return reply.send({ ok: true });
  });

  // Reset the public showcase (/club/demo/): create it if missing, then wipe
  // + reseed its content. Reports before/after counts.
  fastify.post("/api/platform/demo/ensure", { preHandler: pre }, async (req, reply) => {
    let db: any = reqDb(req);
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const countAll = async () => {
      const out: Record<string, number> = {};
      for (const [name, table] of [["users", users], ["clubs", clubs]] as any[]) {
        out[name] = (await db.select().from(table)).length;
      }
      return out;
    };
    const before = await countAll();
    const existing = await db.select().from(clubs).where(eq(clubs.slug, "demo")).limit(1);
    if (!existing[0]) {
      await db.insert(clubs).values({ slug: "demo", name: "Circolo Bagel", timezone: "Europe/Rome", plan: "free", isDemo: true, isListed: true });
    }
    const club = await resetDemoShowcase(db);
    const after = await countAll();
    await audit(db, (req as any).user.id, "platform.demo.ensure", "demo", { before, after });
    return reply.send({ ok: true, slug: club.slug, before, after });
  });

  // Idle sweeper: delete user-created demo runs idle for 60+ days (expired
  // runs included regardless of activity). Never touches the showcase.
  // Expired-run cleanup also runs daily via cron (deleteExpiredDemoRuns).
  fastify.post("/api/platform/demo/cleanup", { preHandler: pre }, async (req, reply) => {
    let db: any = reqDb(req);
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const deleted = await deleteIdleDemoRuns(db, 60);
    await audit(db, (req as any).user.id, "platform.demo.cleanup", "-", { deleted, idle_days: 60 });
    return reply.send({ ok: true, deleted, idle_days: 60 });
  });

  // Delete a whole club (tenant data wiped; audit history survives).
  // The public showcase is protected — reset it via ensure instead.
  fastify.delete("/api/platform/clubs/:slug", { preHandler: pre }, async (req, reply) => {
    let db: any = reqDb(req);
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const { slug } = req.params as any;
    if (slug === "demo") return reply.status(400).send({ error: "Showcase is protected — reset it via ensure" });
    const rows = await db.select().from(clubs).where(eq(clubs.slug, slug)).limit(1);
    const club = rows[0];
    if (!club) return reply.status(404).send({ error: "Not found" });
    const counts = await clubCounts(db, club.id);
    await wipeClubData(db, club.id);
    await db.delete(clubs).where(eq(clubs.id, club.id));
    await audit(db, (req as any).user.id, "platform.club.delete", slug, counts);
    return reply.send({ ok: true, slug, counts });
  });

  // Platform-wide reporting: totals + per-club breakdown (revenue from
  // approved-booking price snapshots).
  fastify.get("/api/platform/reports", { preHandler: pre }, async (req, reply) => {
    let db: any = reqDb(req);
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const { bookings, users } = await import("../db/schema.js");
    const allClubs = await db.select().from(clubs);
    const allBookings = await db.select().from(bookings);
    const allUsers = await db.select().from(users);
    const perClub = (allClubs as any[]).map((c: any) => {
      const cb = (allBookings as any[]).filter((b: any) => String(b.clubId) === String(c.id));
      const approved = cb.filter((b: any) => b.status === "approved");
      return {
        slug: c.slug,
        name: c.name,
        plan: c.plan,
        is_active: c.isActive,
        users: (allUsers as any[]).filter((u: any) => String(u.clubId) === String(c.id)).length,
        bookings: cb.length,
        approved: approved.length,
        revenue_cents: approved.reduce((s: number, b: any) => s + (Number(b.priceCents) || 0), 0),
      };
    });
    const totals = {
      clubs: (allClubs as any[]).length,
      users: (allUsers as any[]).length,
      bookings: (allBookings as any[]).length,
      revenue_cents: perClub.reduce((s: number, c: any) => s + c.revenue_cents, 0),
    };
    return reply.send({ totals, perClub });
  });

  fastify.get("/api/platform/audit", { preHandler: pre }, async (req, reply) => {    let db: any = reqDb(req);
    if (!db) return reply.send({ rows: [], total: 0 });
    const { users } = await import("../db/schema.js");
    const { gte, lte, sql } = await import("drizzle-orm");
    const q = (req.query as any) || {};
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const offset = Math.max(Number(q.offset) || 0, 0);
    const conds: any[] = [];
    if (q.from && /^\d{4}-\d{2}-\d{2}/.test(String(q.from))) conds.push(gte(auditLog.createdAt, new Date(String(q.from))));
    if (q.to && /^\d{4}-\d{2}-\d{2}/.test(String(q.to))) {
      const end = new Date(String(q.to));
      if (String(q.to).length <= 10) end.setDate(end.getDate() + 1); // inclusive day
      conds.push(lte(auditLog.createdAt, end));
    }
    if (q.club) {
      const crows = await db.select().from(clubs).where(eq(clubs.slug, String(q.club)));
      if (!crows[0]) return reply.send({ rows: [], total: 0, limit, offset });
      conds.push(eq(auditLog.clubId, crows[0].id));
    }
    const where = conds.length ? and(...conds) : undefined;
    const totalRows: any[] = await db.select({ n: sql`count(*)` }).from(auditLog).where(where);
    const total = Number(totalRows[0]?.n ?? 0);
    const rows = await db.select().from(auditLog).where(where).orderBy(desc(auditLog.createdAt)).limit(limit).offset(offset);
    const clubRows = await db.select().from(clubs);
    const slugById: Record<string, string> = {};
    const nameByClubId: Record<string, string> = {};
    for (const c of clubRows as any[]) { slugById[String(c.id)] = c.slug; nameByClubId[String(c.id)] = c.name; }
    const userRows = await db.select().from(users);
    const nameByUserId: Record<string, string> = {};
    for (const u of userRows as any[]) nameByUserId[String(u.id)] = u.username;
    return reply.send({
      rows: (rows as any[]).map((r: any) => ({
        id: r.id,
        created_at: r.createdAt,
        action: r.action,
        actor_username: r.actorId ? nameByUserId[String(r.actorId)] ?? null : null,
        club_slug: r.clubId ? slugById[String(r.clubId)] ?? null : null,
        club_name: r.clubId ? nameByClubId[String(r.clubId)] ?? null : null,
        target: r.target,
        meta: r.meta,
      })),
      total,
      limit,
      offset,
    });
  });

  // Platform settings (e.g. base_url — the single website for all clubs).
  fastify.get("/api/platform/settings", { preHandler: pre }, async (req, reply) => {
    const db: any = reqDb(req);
    const { getPlatformSetting } = await import("../services/club.js");
    return reply.send({
      base_url: (await getPlatformSetting(db, "base_url")) || "",
      footer_text: (await getPlatformSetting(db, "footer_text")) || "",
    });
  });

  fastify.put("/api/platform/settings", { preHandler: pre }, async (req, reply) => {
    const db: any = reqDb(req);
    const { base_url, footer_text } = (req as any).body as any;
    if (base_url !== undefined && base_url !== null && base_url !== "") {
      try {
        const u = new URL(String(base_url));
        if (!["http:", "https:"].includes(u.protocol)) return reply.status(400).send({ error: "base_url must be http(s)" });
      } catch {
        return reply.status(400).send({ error: "base_url must be a valid URL" });
      }
    }
    const { setPlatformSetting, getPlatformSetting } = await import("../services/club.js");
    const v = base_url ? String(base_url).replace(/\/$/, "") : null;
    await setPlatformSetting(db, "base_url", v);
    if (footer_text !== undefined) {
      await setPlatformSetting(db, "footer_text", String(footer_text).slice(0, 500) || null);
    }
    await audit(db, (req as any).user.id, "platform.settings", "base_url+footer_text", { base_url: v });
    return reply.send({
      base_url: (await getPlatformSetting(db, "base_url")) || "",
      footer_text: (await getPlatformSetting(db, "footer_text")) || "",
    });
  });

  // Abuse shield: list active IP blocks + unblock.
  fastify.get("/api/platform/abuse", { preHandler: pre }, async (req, reply) => {
    const db: any = reqDb(req);
    try {
      const { ipBlocks } = await import("../db/schema.js");
      const { desc } = await import("drizzle-orm");
      const rows = await db.select().from(ipBlocks).orderBy(desc(ipBlocks.createdAt)).limit(200);
      return reply.send(rows.filter((r: any) => new Date(r.expiresAt).getTime() > Date.now()));
    } catch (e: any) {
      return reply.send([]);
    }
  });

  fastify.delete("/api/platform/abuse/:ip", { preHandler: pre }, async (req, reply) => {
    const db: any = reqDb(req);
    const { unblockIp } = await import("../plugins/abuse.js");
    await unblockIp(db, String((req.params as any).ip));
    await audit(db, (req as any).user.id, "platform.abuse.unblock", String((req.params as any).ip), {});
    return reply.send({ ok: true });
  });

  // Email test-send (#28 verification): superadmin-only, audited.
  fastify.post("/api/platform/email/test", { preHandler: pre }, async (req, reply) => {
    const db: any = reqDb(req);
    const to = String((req as any).body?.to || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return reply.status(400).send({ error: "valid 'to' required" });
    try {
      const { sendEmail } = await import("../services/email.js");
      await sendEmail({ to, subject: "Bagel Club email test", text: "If you read this, Brevo delivery works." });
    } catch (e: any) {
      return reply.status(e.statusCode || 500).send({ error: e.message || "send failed" });
    }
    await audit(db, (req as any).user.id, "platform.email.test", to, {});
    return reply.send({ ok: true, to });
  });

  // Impersonation grants: brief superadmin-as-club-admin sessions (15 min,
  // one club, single active grant per superadmin). The issued JWT carries
  // role=admin + imp=grantId; club routes re-verify the grant row, so revoke
  // ends the session immediately. Grant create/revoke are audited.
  fastify.post("/api/platform/clubs/:slug/grant", { preHandler: pre }, async (req, reply) => {
    const db: any = reqDb(req);
    const { slug } = req.params as any;
    const actor = (req as any).user;
    const rows = await db.select().from(clubs).where(eq(clubs.slug, slug)).limit(1);
    const club = rows[0];
    if (!club || !club.isActive) return reply.status(404).send({ error: "Club not found or suspended" });
    const { impersonationGrants } = await import("../db/schema.js");
    const { and, isNull } = await import("drizzle-orm");
    // Single active grant: revoke any live ones first.
    await db.update(impersonationGrants).set({ revokedAt: new Date() }).where(
      and(eq(impersonationGrants.superadminId, actor.id), isNull(impersonationGrants.revokedAt))
    );
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const [grant] = await db.insert(impersonationGrants).values({
      clubId: club.id, superadminId: actor.id, expiresAt,
    }).returning();
    const token = fastify.jwt.sign(
      { id: actor.id, username: actor.username, role: "admin", clubId: club.id, imp: grant.id } as any,
      { expiresIn: "15m" } as any
    );
    await audit(db, actor.id, "platform.impersonate.grant", slug, { grant_id: grant.id });
    return reply.status(201).send({ token, expires_at: expiresAt.toISOString(), club_slug: club.slug });
  });

  fastify.delete("/api/platform/clubs/:slug/grant", { preHandler: pre }, async (req, reply) => {
    const db: any = reqDb(req);
    const { slug } = req.params as any;
    const actor = (req as any).user;
    const crows = await db.select().from(clubs).where(eq(clubs.slug, slug)).limit(1);
    if (!crows[0]) return reply.status(404).send({ error: "Not found" });
    const { impersonationGrants } = await import("../db/schema.js");
    const { and, isNull } = await import("drizzle-orm");
    await db.update(impersonationGrants).set({ revokedAt: new Date() }).where(
      and(
        eq(impersonationGrants.superadminId, actor.id),
        eq(impersonationGrants.clubId, crows[0].id),
        isNull(impersonationGrants.revokedAt)
      )
    );
    await audit(db, actor.id, "platform.impersonate.revoke", slug, {});
    return reply.send({ ok: true });
  });

  // Reset a club admin's password (support). Scoped: target must be a live
  // admin of the named club; new password returned once.
  fastify.post("/api/platform/clubs/:slug/reset-admin", { preHandler: pre }, async (req, reply) => {
    let db: any = reqDb(req);
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
