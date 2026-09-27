import type { FastifyInstance } from "fastify";
import { users } from "../db/schema.js";
import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { profileSchema, adminCreateUserSchema } from "../types/schemas.js";
import { requireRequestClub, getClubSettings, clubLocales } from "../services/club.js";
import bcrypt from "bcryptjs";

const live = () => isNull(users.deletedAt);

function safeUser(r: any) {
  return {
    id: r.id, username: r.username, email: r.email, role: r.role,
    preferred_language: r.preferredLanguage, preferred_sport: r.preferredSport,
    first_name: r.firstName, last_name: r.lastName, mobile: r.mobile,
    telegram_chat_id: r.telegramChatId, gender: r.gender, birthdate: r.birthdate,
  };
}

/** Load the caller's own live row (rejects logically deleted callers). */
async function liveSelf(db: any, authUser: any) {
  const rows = await db.select().from(users).where(and(eq(users.id, authUser.id), live())).limit(1);
  return rows[0] ?? null;
}

export default async function userRoutes(fastify: FastifyInstance) {
  fastify.get("/api/users/me", { preHandler: [fastify.authenticate] }, async (req, _reply) => {
    const db: any = (req as any).server.db ?? (req as any).server;
    const maybeDb = (req as any).server.db ?? (req as any).server["db"];
    const authUser = (req as any).user;
    if (maybeDb) {
      const me = await liveSelf(maybeDb, authUser);
      if (me) return safeUser(me);
      return { error: "User not found" };
    }
    return authUser;
  });

  fastify.patch("/api/users/me", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const db: any = (req as any).server.db;
    if (!db) return reply.send({ updated: true });
    const parsed = profileSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const body = parsed.data as any;
    const user = (req as any).user;
    const me = await liveSelf(db, user);
    if (!me) return reply.status(401).send({ error: "User not found" });
    if (body.preferred_language) {
      const settings = await getClubSettings(db, me.clubId);
      if (!clubLocales(settings).enabled.includes(body.preferred_language)) {
        return reply.status(400).send({ error: "preferred_language not enabled for this club" });
      }
    }
    const updates: any = {};
    if (body.username) updates.username = body.username;
    if (body.first_name) updates.firstName = body.first_name;
    if (body.last_name) updates.lastName = body.last_name;
    if (body.email !== undefined) updates.email = body.email ? body.email.toLowerCase() : null;
    if (body.preferred_language) updates.preferredLanguage = body.preferred_language;
    if (body.preferred_sport !== undefined) updates.preferredSport = body.preferred_sport || null;
    if (body.mobile !== undefined) updates.mobile = body.mobile || null;
    if (body.telegram_chat_id !== undefined) updates.telegramChatId = body.telegram_chat_id || null;
    if (body.gender !== undefined) updates.gender = body.gender;
    if (body.birthdate !== undefined) updates.birthdate = body.birthdate || null;
    if (Object.keys(updates).length === 0) return reply.status(400).send({ error: "No fields to update" });
    updates.updatedAt = new Date();
    if (updates.username) {
      const dup = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.clubId, me.clubId), eq(users.username, updates.username), live())).limit(1);
      if (dup[0] && String(dup[0].id) !== String(user.id)) return reply.status(409).send({ error: "username or email already taken" });
    }
    if (updates.email) {
      const dup = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.clubId, me.clubId), eq(users.email, updates.email), live())).limit(1);
      if (dup[0] && String(dup[0].id) !== String(user.id)) return reply.status(409).send({ error: "username or email already taken" });
    }
    try {
      const [row] = await db.update(users).set(updates).where(eq(users.id, user.id)).returning();
      return reply.send(safeUser(row));
    } catch (e: any) {
      if (String(e.code) === "23505") return reply.status(409).send({ error: "username or email already taken" });
      throw e;
    }
  });

  fastify.get("/api/users", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const db: any = (req as any).server.db;
    if (!db) return reply.send([]);
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    const { q, role, search, include_deleted } = (req.query as any) || {};
    const term = (q || search || "").toLowerCase();
    const conds: any[] = [eq(users.clubId, club.id)];
    if (include_deleted !== "true") conds.push(live());
    let rows = await db.select().from(users).where(and(...conds));
    if (term) {
      rows = rows.filter((r: any) => [r.username, r.email, r.firstName, r.lastName, r.mobile].some((v: any) => v && String(v).toLowerCase().includes(term)));
    }
    if (role && ["visitor","associate","admin"].includes(role)) {
      rows = rows.filter((r: any) => r.role === role);
    }
    return reply.send(rows.map(safeUser));
  });

  fastify.patch("/api/users/:id/role", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const db: any = (fastify as any).server.db ?? (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    const { id } = req.params as any;
    const { role } = (req as any).body as any;
    if (!["visitor", "associate", "admin"].includes(role)) return reply.status(400).send({ error: "Invalid role" });
    const targetRows = await db.select().from(users).where(and(eq(users.id, id), eq(users.clubId, club.id), live())).limit(1);
    const target = targetRows[0];
    if (!target) return reply.status(404).send({ error: "Not found" });
    // Prevent demoting the last live admin of the club
    if (role !== "admin" && target.role === "admin") {
      const admins = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.clubId, club.id), eq(users.role, "admin"), live()));
      if (admins.length <= 1) return reply.status(400).send({ error: "Cannot demote the last admin" });
    }
    const [row] = await db.update(users).set({ role }).where(eq(users.id, id)).returning();
    if (!row) return reply.status(404).send({ error: "Not found" });
    return reply.send({ id: row.id, role: row.role });
  });

  fastify.post("/api/users", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const parsed = adminCreateUserSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    const { password, ...data } = parsed.data as any;
    const role = (req.body as any).role && ["visitor","associate","admin"].includes((req.body as any).role) ? (req.body as any).role : "visitor";
    const passwordHash = await bcrypt.hash(password, 10);
    const emailVal = (data.email as string | null | undefined) ? String(data.email).toLowerCase() : null;
    const uname = String(data.username);
    const dupName = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.clubId, club.id), eq(users.username, uname), live())).limit(1);
    if (dupName[0]) return reply.status(409).send({ error: "username or email already taken" });
    if (emailVal) {
      const dup = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.clubId, club.id), eq(users.email, emailVal), live())).limit(1);
      if (dup[0]) return reply.status(409).send({ error: "username or email already taken" });
    }
    if (data.preferred_language) {
      const settings = await getClubSettings(db, club.id);
      if (!clubLocales(settings).enabled.includes(data.preferred_language)) {
        return reply.status(400).send({ error: "preferred_language not enabled for this club" });
      }
    }
    try {
      const [user] = await db.insert(users).values({ clubId: club.id, username: uname, email: emailVal, mobile: (data as any).mobile ?? null, passwordHash, firstName: data.first_name, lastName: data.last_name, role, preferredLanguage: data.preferred_language ?? "it" }).returning();
      return reply.status(201).send({ id: user.id, username: user.username, email: user.email, role: user.role });
    } catch (e: any) {
      if (String(e.code) === "23505") return reply.status(409).send({ error: "username or email already taken" });
      throw e;
    }
  });

  fastify.patch("/api/users/:id", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const db: any = (fastify as any).server.db ?? (fastify as any).db ?? (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    const { id } = req.params as any;
    const parsed = profileSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const body = parsed.data as any;
    const targetRows = await db.select().from(users).where(and(eq(users.id, id), eq(users.clubId, club.id), live())).limit(1);
    if (!targetRows[0]) return reply.status(404).send({ error: "Not found" });
    // allow role via same endpoint
    const role = (req.body as any).role;
    // Prevent demoting the last live admin of the club via this endpoint
    if (role && role !== "admin" && targetRows[0].role === "admin") {
      const admins = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.clubId, club.id), eq(users.role, "admin"), live()));
      if (admins.length <= 1) return reply.status(400).send({ error: "Cannot demote the last admin" });
    }
    const updates: any = {};
    if (body.username) updates.username = body.username;
    if (body.first_name) updates.firstName = body.first_name;
    if (body.last_name) updates.lastName = body.last_name;
    if (body.email !== undefined) updates.email = body.email ? body.email.toLowerCase() : null;
    if (body.preferred_language) {
      const settings = await getClubSettings(db, club.id);
      if (!clubLocales(settings).enabled.includes(body.preferred_language)) {
        return reply.status(400).send({ error: "preferred_language not enabled for this club" });
      }
      updates.preferredLanguage = body.preferred_language;
    }
    if (body.preferred_sport !== undefined) updates.preferredSport = body.preferred_sport || null;
    if (body.mobile !== undefined) updates.mobile = body.mobile || null;
    if (body.telegram_chat_id !== undefined) updates.telegramChatId = body.telegram_chat_id || null;
    if (body.gender !== undefined) updates.gender = body.gender;
    if (body.birthdate !== undefined) updates.birthdate = body.birthdate || null;
    if (role && ["visitor","associate","admin"].includes(role)) updates.role = role;
    if ((req.body as any).password) updates.passwordHash = await bcrypt.hash((req.body as any).password, 10);
    if (Object.keys(updates).length === 0) return reply.status(400).send({ error: "No fields to update" });
    updates.updatedAt = new Date();
    if (updates.username) {
      const dup = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.clubId, club.id), eq(users.username, updates.username), live())).limit(1);
      if (dup[0] && String(dup[0].id) !== String(id)) return reply.status(409).send({ error: "username or email already taken" });
    }
    if (updates.email) {
      const dup = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.clubId, club.id), eq(users.email, updates.email), live())).limit(1);
      if (dup[0] && String(dup[0].id) !== String(id)) return reply.status(409).send({ error: "username or email already taken" });
    }
    try {
      const [row] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
      if (!row) return reply.status(404).send({ error: "Not found" });
      return reply.send({ id: row.id, username: row.username, email: row.email, role: row.role });
    } catch (e: any) {
      if (String(e.code) === "23505") return reply.status(409).send({ error: "username or email already taken" });
      throw e;
    }
  });

  fastify.delete("/api/users/:id", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const db: any = (fastify as any).server.db ?? (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    const { id } = req.params as any;
    const user = (req as any).user;
    if (String(id) === String(user.id)) return reply.status(400).send({ error: "Cannot delete yourself" });
    // Logical delete: stamp deleted_at/deleted_by, keep booking history intact.
    const targetRows = await db.select().from(users).where(and(eq(users.id, id), eq(users.clubId, club.id), live())).limit(1);
    const target = targetRows[0];
    if (!target) return reply.status(404).send({ error: "Not found" });
    if (target.role === "admin") {
      const admins = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.clubId, club.id), eq(users.role, "admin"), live()));
      if (admins.length <= 1) return reply.status(400).send({ error: "Cannot delete the last admin" });
    }
    await db.update(users).set({ deletedAt: new Date(), deletedBy: user.id, updatedAt: new Date() }).where(eq(users.id, id));
    return reply.status(204).send();
  });

  fastify.post("/api/users/:id/restore", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const db: any = (fastify as any).server.db ?? (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    const { id } = req.params as any;
    const targetRows = await db.select().from(users)
      .where(and(eq(users.id, id), eq(users.clubId, club.id), isNotNull(users.deletedAt))).limit(1);
    const target = targetRows[0];
    if (!target) return reply.status(404).send({ error: "Not found" });
    // Refuse if a live row re-took the handle or email.
    const clashName = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.clubId, club.id), eq(users.username, target.username), live())).limit(1);
    if (clashName[0]) return reply.status(409).send({ error: "username already taken by an active user" });
    if (target.email) {
      const clashMail = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.clubId, club.id), eq(users.email, target.email), live())).limit(1);
      if (clashMail[0]) return reply.status(409).send({ error: "email already taken by an active user" });
    }
    const [row] = await db.update(users).set({ deletedAt: null, deletedBy: null, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    return reply.send(safeUser(row));
  });
}
