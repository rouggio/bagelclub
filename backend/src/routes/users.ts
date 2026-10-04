import type { FastifyInstance } from "fastify";
import { users, appSettings, auditLog } from "../db/schema.js";
import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { profileSchema, adminCreateUserSchema, inviteUserSchema } from "../types/schemas.js";
import { requireRequestClub, getClubSettings, getPlatformSetting, clubLocales, reqDb } from "../services/club.js";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";

const live = () => isNull(users.deletedAt);

function safeUser(r: any) {
  return {
    id: r.id, username: r.username, email: r.email, role: r.role,
    preferred_language: r.preferredLanguage, preferred_sport: r.preferredSport,
    first_name: r.firstName, last_name: r.lastName, mobile: r.mobile,
    telegram_chat_id: r.telegramChatId, gender: r.gender, birthdate: r.birthdate,
    fee_exempt: !!r.feeExempt,
    medical_cert: {
      expires_at: r.medicalCertExpiresAt ? String(r.medicalCertExpiresAt).slice(0, 10) : null,
    },
    notify_email: true, notify_push_master: r.notifyPushMaster ?? true,
    notify_whatsapp: r.notifyWhatsapp ?? true, notify_telegram: r.notifyTelegram ?? true,
  };
}

/** Load the caller's own live row (rejects logically deleted callers). */
async function liveSelf(db: any, authUser: any) {
  const rows = await db.select().from(users).where(and(eq(users.id, authUser.id), live())).limit(1);
  return rows[0] ?? null;
}

/**
 * Contact-change guard for club admins under enforced 2FA:
 * - with a valid OTP (two_fa_code against the target's live `contact`
 *   challenge): change applies, 2FA stays on;
 * - without: change applies but club 2FA is DISABLED (new channel unverified).
 * Returns { disabled } or { error } (caller replies 401).
 */
async function guardAdminContactChange(db: any, club: any, target: any, body: any, rawCode?: any): Promise<{ disabled: boolean; error?: string }> {
  const changing = body.mobile !== undefined || body.telegram_chat_id !== undefined;
  if (!changing || target.role !== "admin") return { disabled: false };
  const settings = await getClubSettings(db, club.id);
  if (!settings?.twoFaEnabled) return { disabled: false };
  const code = rawCode;
  if (code) {
    const { verifyChallenge } = await import("../services/twoFactor.js");
    const { loginChallenges } = await import("../db/schema.js");
    const { desc } = await import("drizzle-orm");
    const rows = await db.select().from(loginChallenges).where(
      and(eq(loginChallenges.userId, target.id), eq(loginChallenges.purpose, "contact"), isNull(loginChallenges.consumedAt))
    ).orderBy(desc(loginChallenges.createdAt)).limit(1);
    if (!rows[0]) return { disabled: false, error: "No pending code — request one first" };
    try {
      await verifyChallenge(db, target.id, rows[0].id, code, "contact");
    } catch {
      return { disabled: false, error: "Invalid or expired code" };
    }
    return { disabled: false };
  }
  await db.update(appSettings).set({ twoFaEnabled: false, updatedAt: new Date() }).where(eq(appSettings.clubId, club.id));
  return { disabled: true };
}

export default async function userRoutes(fastify: FastifyInstance) {
  fastify.get("/api/users/me", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const poolDb: any = (req as any).server.db ?? (req as any).server;
    const maybeDb = (req as any).server.db ?? (req as any).server["db"];
    const authUser = (req as any).user;
    if (maybeDb) {
      const club = await requireRequestClub(req, reply, poolDb);
      if (!club) return;
      const db = reqDb(req);
      if (authUser.imp) {
        // Impersonated superadmin: present the club-admin persona. The grant
        // row was already re-verified by requireRequestClub, so a live grant
        // is guaranteed here. Never leak the superadmin row into club UI
        // (role drives the admin menus; username stays traceable in audit).
        return {
          id: authUser.id, username: authUser.username, email: null, role: "admin",
          club_slug: club.slug, imp: true,
          preferred_language: null, preferred_sport: null,
          first_name: null, last_name: null, mobile: null,
          telegram_chat_id: null, gender: null, birthdate: null,
        };
      }
      const me = await liveSelf(db, authUser);
      if (me) return safeUser(me);
      return reply.status(401).send({ error: "User not found" });
    }
    return authUser;
  });

  fastify.patch("/api/users/me", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const poolDb: any = (req as any).server.db;
    if (!poolDb) return reply.send({ updated: true });
    const parsed = profileSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const body = parsed.data as any;
    const user = (req as any).user;
    const club = await requireRequestClub(req, reply, poolDb);
    if (!club) return;
    let db: any = reqDb(req);
    const { rejectImpSelfWrite } = await import("../services/club.js");
    if (await rejectImpSelfWrite(req, reply, db, club, "me")) return;
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
    if (body.notify_push_master !== undefined) updates.notifyPushMaster = body.notify_push_master;
    if (body.notify_whatsapp !== undefined) updates.notifyWhatsapp = body.notify_whatsapp;
    if (body.notify_telegram !== undefined) updates.notifyTelegram = body.notify_telegram;
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
      const guard = await guardAdminContactChange(db, club, me, body, (req as any).body?.two_fa_code);
      if (guard.error) return reply.status(401).send({ error: guard.error });
      const [row] = await db.update(users).set(updates).where(eq(users.id, user.id)).returning();
      const out: any = safeUser(row);
      if (guard.disabled) out.two_fa_disabled = true;
      return reply.send(out);
    } catch (e: any) {
      if (String(e.code) === "23505") return reply.status(409).send({ error: "username or email already taken" });
      throw e;
    }
  });

  // Self-service password change: current password must verify.
  // Impersonated sessions are blocked (the row would be the superadmin's).
  fastify.post("/api/users/me/password", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { current_password, new_password } = ((req as any).body as any) || {};
    if (typeof current_password !== "string" || typeof new_password !== "string" || new_password.length < 8 || new_password.length > 128) {
      return reply.status(400).send({ error: "password_invalid" });
    }
    const poolDb: any = (req as any).server.db;
    if (!poolDb) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, poolDb);
    if (!club) return;
    const db: any = reqDb(req);
    const { rejectImpSelfWrite } = await import("../services/club.js");
    if (await rejectImpSelfWrite(req, reply, db, club, "me/password")) return;
    const me = await liveSelf(db, (req as any).user);
    if (!me) return reply.status(401).send({ error: "User not found" });
    const ok = await bcrypt.compare(current_password, me.passwordHash);
    if (!ok) return reply.status(401).send({ error: "password_current_mismatch" });
    const passwordHash = await bcrypt.hash(new_password, 10);
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, me.id));
    return reply.send({ ok: true });
  });

  // Request an OTP on the CURRENT channel (needed to change contact while 2FA is on).
  fastify.post("/api/users/me/contact-challenge", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const poolDb: any = (req as any).server.db;
    if (!poolDb) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, poolDb);
    if (!club) return;
    const db: any = reqDb(req);
    const { rejectImpSelfWrite } = await import("../services/club.js");
    if (await rejectImpSelfWrite(req, reply, db, club, "me/contact-challenge")) return;
    const me = await liveSelf(db, (req as any).user);
    if (!me) return reply.status(401).send({ error: "User not found" });
    if (me.role !== "admin") return reply.status(400).send({ error: "Only club admins use 2FA" });
    const { startClubChallenge } = await import("../services/twoFactor.js");
    try {
      const { via, expiresAt } = await startClubChallenge(db, club, me, "contact");
      return reply.send({ sent_via: via, expires_at: expiresAt });
    } catch (e: any) {
      return reply.status(e.statusCode || 500).send({ error: e.message || "OTP failed" });
    }
  });

  // Notifications v2 (#23a–b): own channel state + per-event push prefs.
  // GET returns channels (connected/enabled), push master, and per-event prefs.
  fastify.get("/api/users/me/notify-prefs", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const poolDb: any = (req as any).server.db;
    if (!poolDb) return reply.send({ channels: {}, push_master: true, prefs: [] });
    const club = await requireRequestClub(req, reply, poolDb);
    if (!club) return;
    const db: any = reqDb(req);
    const me = await liveSelf(db, (req as any).user);
    if (!me) return reply.status(401).send({ error: "User not found" });
    const { userPushChannels, NOTIFY_EVENTS } = await import("../services/notifications.js");
    const { notifyEventPrefs } = await import("../db/schema.js");
    let rows: any[] = [];
    try { rows = await db.select().from(notifyEventPrefs).where(eq(notifyEventPrefs.userId, me.id)); } catch {}
    const prefs = (NOTIFY_EVENTS as readonly string[]).map((event) => ({
      event,
      push: rows.find((r: any) => String(r.event) === event)?.push ?? true,
    }));
    return reply.send({
      channels: {
        email: { connected: !!me.email, enabled: true, locked: true, address: me.email ?? null },
        whatsapp: { connected: !!me.mobile, enabled: me.notifyWhatsapp !== false, number: me.mobile ?? null },
        telegram: { connected: !!me.telegramChatId, enabled: me.notifyTelegram !== false },
      },
      usable: userPushChannels(me),
      push_master: me.notifyPushMaster !== false,
      prefs,
    });
  });

  // PUT one per-event push pref (upsert). Email has no pref (mandatory).
  fastify.put("/api/users/me/notify-prefs", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { notifyPrefSchema } = await import("../types/schemas.js");
    const parsed = notifyPrefSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const poolDb: any = (req as any).server.db;
    if (!poolDb) return reply.send({ ok: true });
    const club = await requireRequestClub(req, reply, poolDb);
    if (!club) return;
    const db: any = reqDb(req);
    const { rejectImpSelfWrite } = await import("../services/club.js");
    if (await rejectImpSelfWrite(req, reply, db, club, "me/notify-prefs")) return;
    const me = await liveSelf(db, (req as any).user);
    if (!me) return reply.status(401).send({ error: "User not found" });
    const { notifyEventPrefs } = await import("../db/schema.js");
    const { and } = await import("drizzle-orm");
    const { event, push } = parsed.data;
    try {
      const existing = await db.select().from(notifyEventPrefs)
        .where(and(eq(notifyEventPrefs.userId, me.id), eq(notifyEventPrefs.event, event))).limit(1);
      if (existing[0]) {
        await db.update(notifyEventPrefs).set({ push })
          .where(and(eq(notifyEventPrefs.userId, me.id), eq(notifyEventPrefs.event, event)));
      } else {
        await db.insert(notifyEventPrefs).values({ userId: me.id, clubId: me.clubId, event, push });
      }
    } catch (e: any) {
      return reply.status(500).send({ error: "prefs_unavailable" });
    }
    return reply.send({ ok: true, event, push });
  });

  fastify.get("/api/users", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    let db: any = (req as any).server.db;
    if (!db) return reply.send([]);
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const { q, role, search, include_deleted } = (req.query as any) || {};
    const term = (q || search || "").toLowerCase();
    const conds: any[] = [eq(users.clubId, club.id)];
    if (include_deleted !== "true") conds.push(live());
    let rows = await db.select().from(users).where(and(...conds));
    if (term) {
      rows = rows.filter((r: any) => [r.username, r.email, r.firstName, r.lastName, r.mobile].some((v: any) => v && String(v).toLowerCase().includes(term)));
    }
    if (role && ["associate","manager","admin"].includes(role)) {
      rows = rows.filter((r: any) => r.role === role);
    }
    return reply.send(rows.map(safeUser));
  });

  // #26b: member-visible participant search (any authenticated club member
  // picks players by username/email; minimal fields only — no email/mobile
  // leak, though email remains searchable).
  fastify.get("/api/users/search", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    let db: any = (req as any).server.db;
    if (!db) return reply.send([]);
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const { q } = (req.query as any) || {};
    const term = String(q || "").toLowerCase().trim();
    if (term.length < 2) return reply.status(400).send({ error: "q must be at least 2 characters" });
    const rows = await db.select().from(users).where(and(eq(users.clubId, club.id), live()));
    return reply.send(
      rows
        .filter((r: any) => [r.username, r.email, r.firstName, r.lastName].some((v: any) => v && String(v).toLowerCase().includes(term)))
        .slice(0, 20)
        .map((r: any) => ({ id: r.id, username: r.username, first_name: r.firstName, last_name: r.lastName }))
    );
  });

  fastify.patch("/api/users/:id/role", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    let db: any = (fastify as any).server.db ?? (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const { id } = req.params as any;
    const { role } = (req as any).body as any;
    if (!["associate", "manager", "admin"].includes(role)) return reply.status(400).send({ error: "Invalid role" });
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
    try {
      await db.insert(auditLog).values({ actorId: (req as any).user.id, clubId: club.id, action: (role === "admin" || (role === "manager" && target.role === "associate") ? "admin.role.grant" : "admin.role.revoke"), target: id, meta: JSON.stringify({ from: target.role, to: role, username: target.username }) });
    } catch {}
    return reply.send({ id: row.id, role: row.role });
  });

  fastify.post("/api/users", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const parsed = adminCreateUserSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    let db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const { password, ...data } = parsed.data as any;
    const role = (req.body as any).role && ["associate","manager","admin"].includes((req.body as any).role) ? (req.body as any).role : "associate";
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
      const [user] = await db.insert(users).values({ clubId: club.id, username: uname, email: emailVal, mobile: (data as any).mobile ?? null, passwordHash, firstName: data.first_name, lastName: data.last_name, role, preferredLanguage: data.preferred_language ?? "it", feeExempt: !!((req.body as any).fee_exempt) }).returning();
      return reply.status(201).send({ id: user.id, username: user.username, email: user.email, role: user.role });
    } catch (e: any) {
      if (String(e.code) === "23505") return reply.status(409).send({ error: "username or email already taken" });
      throw e;
    }
  });

  fastify.patch("/api/users/:id", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    let db: any = (fastify as any).server.db ?? (fastify as any).db ?? (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
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
    if (role && ["associate","manager","admin"].includes(role)) updates.role = role;
    // #32: per-user fee exemption (raw body, like role).
    if ((req.body as any).fee_exempt !== undefined) updates.feeExempt = !!((req.body as any).fee_exempt);
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
      const targetRows = await db.select().from(users).where(and(eq(users.id, id), eq(users.clubId, club.id), live())).limit(1);
      if (!targetRows[0]) return reply.status(404).send({ error: "Not found" });
      const guard = await guardAdminContactChange(db, club, targetRows[0], body, (req as any).body?.two_fa_code);
      if (guard.error) return reply.status(401).send({ error: guard.error });
      const prevRole = targetRows[0].role;
      const [row] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
      if (!row) return reply.status(404).send({ error: "Not found" });
      if ((updates as any).role && (updates as any).role !== prevRole) {
        try {
          await db.insert(auditLog).values({ actorId: (req as any).user.id, clubId: club.id, action: ((updates as any).role === "admin" || ((updates as any).role === "manager" && prevRole === "associate") ? "admin.role.grant" : "admin.role.revoke"), target: id, meta: JSON.stringify({ from: prevRole, to: (updates as any).role, username: row.username }) });
        } catch {}
      }
      const out: any = { id: row.id, username: row.username, email: row.email, role: row.role, fee_exempt: !!(row as any).feeExempt };
      if (guard.disabled) out.two_fa_disabled = true;
      return reply.send(out);
    } catch (e: any) {
      if (String(e.code) === "23505") return reply.status(409).send({ error: "username or email already taken" });
      throw e;
    }
  });

  fastify.delete("/api/users/:id", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    let db: any = (fastify as any).server.db ?? (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
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
    try {
      await db.insert(auditLog).values({ actorId: user.id, clubId: club.id, action: "admin.user.delete", target: id, meta: JSON.stringify({ username: target.username, role: target.role }) });
    } catch {}
    return reply.status(204).send();
  });

  fastify.post("/api/users/:id/restore", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    let db: any = (fastify as any).server.db ?? (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
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
    try {
      await db.insert(auditLog).values({ actorId: (req as any).user.id, clubId: club.id, action: "admin.user.restore", target: id, meta: JSON.stringify({ username: row.username }) });
    } catch {}
    return reply.send(safeUser(row));
  });

  // Welcome email for admin-created accounts: set-password link (7 days).
  // The account is unusable until the link is consumed (random password),
  // so receiving + clicking IS the forced password change. Admin sees
  // delivery failures (no enumeration concern inside the admin UI).
  const welcomeSubjects: Record<string, string> = {
    it: `Benvenuto su PLACEHOLDER — imposta la tua password`,
    en: `Welcome to PLACEHOLDER — set your password`,
    fr: `Bienvenue sur PLACEHOLDER — définissez votre mot de passe`,
    de: `Willkommen bei PLACEHOLDER — legen Sie Ihr Passwort fest`,
    es: `Bienvenido a PLACEHOLDER — establece tu contraseña`,
  };
  async function sendWelcomeEmail(db: any, club: any, target: any, base: string) {
    const { loginChallenges } = await import("../db/schema.js");
    await db.delete(loginChallenges).where(and(eq(loginChallenges.userId, target.id), eq(loginChallenges.purpose, "welcome")));
    const token = randomBytes(32).toString("hex");
    await db.insert(loginChallenges).values({
      userId: target.id, codeHash: createHash("sha256").update(token).digest("hex"),
      purpose: "welcome", expiresAt: new Date(Date.now() + 7 * 86400000),
    });
    const link = `${base}/club/${club.slug}/#reset-password?token=${token}`;
    const lang = ["it", "en", "fr", "de", "es"].includes(target.preferredLanguage) ? target.preferredLanguage : "en";
    const subject = (welcomeSubjects[lang] || welcomeSubjects.en).replace("PLACEHOLDER", club.name);
    const { sendEmail } = await import("../services/email.js");
    await sendEmail({ to: target.email, subject, text: `${subject}: ${link}`, html: `<p><a href="${link}">${subject}</a></p>` });
  }
  fastify.post("/api/users/:id/welcome", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    let db: any = (fastify as any).server.db ?? (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const { id } = req.params as any;
    const targetRows = await db.select().from(users).where(and(eq(users.id, id), eq(users.clubId, club.id), live())).limit(1);
    const target = targetRows[0];
    if (!target) return reply.status(404).send({ error: "Not found" });
    if (!target.email) return reply.status(400).send({ error: "welcome_no_email" });
    const base = ((await getPlatformSetting(db, "base_url")) || "").replace(/\/$/, "");
    if (!base) return reply.status(501).send({ error: "welcome_no_base_url" });
    try {
      await sendWelcomeEmail(db, club, target, base);
      return reply.send({ ok: true });
    } catch (e: any) {
      try {
        const { loginChallenges } = await import("../db/schema.js");
        await db.delete(loginChallenges).where(and(eq(loginChallenges.userId, target.id), eq(loginChallenges.purpose, "welcome")));
      } catch {}
      return reply.status(e.statusCode || 500).send({ error: e.message || "welcome_failed" });
    }
  });

  // Invite: create the account (random password, unusable) + send the
  // set-password email in one call. Username and email must be unique
  // within the club. Nothing dangles on failure (user + token removed).
  fastify.post("/api/users/invite", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const parsed = inviteUserSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    let db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const uname = parsed.data.username;
    const emailVal = parsed.data.email;
    const dupName = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.clubId, club.id), eq(users.username, uname), live())).limit(1);
    if (dupName[0]) return reply.status(409).send({ error: "username or email already taken", field: "username" });
    const dupMail = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.clubId, club.id), eq(users.email, emailVal), live())).limit(1);
    if (dupMail[0]) return reply.status(409).send({ error: "username or email already taken", field: "email" });
    const base = ((await getPlatformSetting(db, "base_url")) || "").replace(/\/$/, "");
    if (!base) return reply.status(501).send({ error: "welcome_no_base_url" });
    const settings = await getClubSettings(db, club.id);
    const lang = clubLocales(settings).def || "it";
    const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
    let created: any = null;
    try {
      [created] = await db.insert(users).values({
        clubId: club.id, username: uname, email: emailVal, passwordHash,
        firstName: uname, lastName: "", role: "associate", preferredLanguage: lang,
      }).returning();
    } catch (e: any) {
      if (String(e.code) === "23505") return reply.status(409).send({ error: "username or email already taken" });
      throw e;
    }
    try {
      await sendWelcomeEmail(db, club, created, base);
    } catch (e: any) {
      try {
        const { loginChallenges } = await import("../db/schema.js");
        await db.delete(loginChallenges).where(and(eq(loginChallenges.userId, created.id), eq(loginChallenges.purpose, "welcome")));
        await db.delete(users).where(eq(users.id, created.id));
      } catch {}
      return reply.status(e.statusCode || 500).send({ error: e.message || "welcome_failed" });
    }
    try {
      await db.insert(auditLog).values({ actorId: (req as any).user.id, clubId: club.id, action: "admin.user.invite", target: created.id, meta: JSON.stringify({ username: uname }) });
    } catch {}
    return reply.status(201).send({ id: created.id, username: created.username, email: created.email });
  });
}
