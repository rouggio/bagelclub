import type { FastifyInstance } from "fastify";
import { settingsSchema } from "../types/schemas.js";
import { appSettings } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { maskSettingsForAdminResponse, getNotifyPolicy } from "../services/notifications.js";
import { resolveClubSlug, requireClub, requireRequestClub, getClubSettings, clubLocales, reqDb } from "../services/club.js";

const FALLBACK_INFO = { club_name: "Green Village", club_phone: "3923047417", club_address: "" };
const FALLBACK_SETTINGS = {
  default_slot_duration_minutes: 60,
  booking_hold_minutes: 30,
  max_advance_days: 14,
  min_cancel_hours: 2,
  auto_approve_bookings: false,
  club_name: "Green Village",
  club_phone: "3923047417",
  club_address: "",
  public_url: "https://empanadel.onrender.com",
  notify_policy: [],
};

export default async function settingsRoutes(fastify: FastifyInstance) {
  // Public club info for footer (no auth) — scoped by slug.
  fastify.get("/api/club-info", async (req, reply) => {
    const poolDb: any = (req as any).server.db ?? (req as any).db;
    if (!poolDb) return reply.send(FALLBACK_INFO);
    try {
      const club = await requireClub(req, reply, poolDb, resolveClubSlug(req));
      if (!club) return;
      const db = reqDb(req);
      const s = await getClubSettings(db, club.id);
      const { enabled, def } = clubLocales(s);
      return reply.send({
        club_name: s?.clubName || club.name,
        club_phone: s?.clubPhone || "",
        club_address: s?.clubAddress || "",
        slug: club.slug,
        timezone: club.timezone,
        currency: club.currency || "EUR",
        locales: enabled,
        default_locale: def,
        show_prices: s?.showPrices ?? true,
        allow_open_signup: s?.allowOpenSignup ?? true,
      });
    } catch {
      return reply.send(FALLBACK_INFO);
    }
  });

  fastify.get("/api/settings", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const poolDb: any = (req as any).server.db;
    if (!poolDb) return reply.send(FALLBACK_SETTINGS);
    const club = await requireRequestClub(req, reply, poolDb);
    if (!club) return;
    const db = reqDb(req);
    const s = await getClubSettings(db, club.id);
    if (!s) return reply.send(FALLBACK_SETTINGS);
    const policy = await getNotifyPolicy(db, club.id);
    return reply.send(maskSettingsForAdminResponse(s, policy));
  });

  fastify.put("/api/settings", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const parsed = settingsSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    if (parsed.data.two_fa_enabled !== undefined) {
      return reply.status(400).send({ error: "2FA changes require OTP: use POST /api/settings/2fa/code + /confirm" });
    }
    const db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    const qdb: any = reqDb(req);
    const updates: any = {};
    if (parsed.data.default_slot_duration_minutes !== undefined) updates.defaultSlotDurationMinutes = parsed.data.default_slot_duration_minutes;
    if (parsed.data.booking_hold_minutes !== undefined) updates.bookingHoldMinutes = parsed.data.booking_hold_minutes;
    if (parsed.data.max_advance_days !== undefined) updates.maxAdvanceDays = parsed.data.max_advance_days;
    if (parsed.data.min_cancel_hours !== undefined) updates.minCancelHours = parsed.data.min_cancel_hours;
    if (parsed.data.auto_approve_bookings !== undefined) updates.autoApproveBookings = parsed.data.auto_approve_bookings;
    if (parsed.data.flexible_slots !== undefined) updates.flexibleSlots = parsed.data.flexible_slots;
    if (parsed.data.show_prices !== undefined) updates.showPrices = parsed.data.show_prices;
    if (parsed.data.allow_open_signup !== undefined) updates.allowOpenSignup = parsed.data.allow_open_signup;
    if (parsed.data.club_name !== undefined) updates.clubName = parsed.data.club_name || null;
    if (parsed.data.club_phone !== undefined) updates.clubPhone = parsed.data.club_phone || null;
    if (parsed.data.club_address !== undefined) updates.clubAddress = parsed.data.club_address || null;
    if (parsed.data.notify_email_sender !== undefined) updates.notifyEmailSender = parsed.data.notify_email_sender || null;
    // v2 policy upsert (per event, users vs admins legs).
    if (parsed.data.notify_policy !== undefined) {
      const { notifyPolicy } = await import("../db/schema.js");
      const { ensureNotifyPolicy } = await import("../services/notifications.js");
      await ensureNotifyPolicy(qdb, club.id);
      const { and } = await import("drizzle-orm");
      for (const p of parsed.data.notify_policy) {
        await qdb.update(notifyPolicy).set({
          toUsersEmail: p.to_users_email, toUsersPush: p.to_users_push,
          toAdminsEmail: p.to_admins_email, toAdminsPush: p.to_admins_push,
        }).where(and(eq(notifyPolicy.clubId, club.id), eq(notifyPolicy.event, p.event)));
      }
    }
    // Tokens: if masked value (contains ***) or same as present, ignore to avoid overwriting with masked placeholder
    if (parsed.data.telegram_bot_token !== undefined) {
      const v = parsed.data.telegram_bot_token;
      if (v && v.includes("***")) { /* keep existing */ } else updates.telegramBotToken = v || null;
    }
    if (parsed.data.telegram_admin_chat_id !== undefined) updates.telegramAdminChatId = parsed.data.telegram_admin_chat_id || null;
    if (parsed.data.whatsapp_token !== undefined) {
      const v = parsed.data.whatsapp_token;
      if (v && v.includes("***")) { /* keep existing */ } else updates.whatsappToken = v || null;
    }
    if (parsed.data.whatsapp_phone_number_id !== undefined) updates.whatsappPhoneNumberId = parsed.data.whatsapp_phone_number_id ? String(parsed.data.whatsapp_phone_number_id).replace(/[^\d]/g,"") : null;
    if (parsed.data.whatsapp_admin_phone !== undefined) {
      let v: string | null = parsed.data.whatsapp_admin_phone ? String(parsed.data.whatsapp_admin_phone).replace(/[^\d]/g,"") : null;
      if (v?.startsWith("00")) v = v.slice(2);
      else if (v?.startsWith("0")) v = v.slice(1);
      updates.whatsappAdminPhone = v || null;
    }
    // Locales: default must stay inside the enabled set.
    if (parsed.data.enabled_locales !== undefined || parsed.data.default_locale !== undefined) {
      const current = await getClubSettings(qdb, club.id);
      const enabled = parsed.data.enabled_locales ?? current?.enabledLocales ?? ["it", "en", "fr", "de", "es"];
      let def = parsed.data.default_locale ?? current?.defaultLocale ?? enabled[0];
      if (!enabled.includes(def)) def = enabled[0];
      updates.enabledLocales = [...new Set(enabled)];
      updates.defaultLocale = def;
    }
    updates.updatedAt = new Date();
    const existing = await getClubSettings(qdb, club.id);
    const row = existing
      ? (await qdb.update(appSettings).set(updates).where(eq(appSettings.clubId, club.id)).returning())[0]
      : (await qdb.insert(appSettings).values({ clubId: club.id, ...updates }).returning())[0];
    const policy = await getNotifyPolicy(qdb, club.id);
    return reply.send(maskSettingsForAdminResponse(row, policy));
  });

  // Club-admin 2FA state changes (OTP-gated both ways).
  // POST /api/settings/2fa/code {action: enable|disable} → delivers OTP.
  fastify.post("/api/settings/2fa/code", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const { action } = ((req as any).body as any) || {};
    if (!["enable", "disable"].includes(action)) return reply.status(400).send({ error: "action must be enable|disable" });
    const poolDb: any = (fastify as any).db;
    if (!poolDb) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, poolDb);
    if (!club) return;
    const db: any = reqDb(req);
    const settings = await getClubSettings(db, club.id);
    const on = !!settings?.twoFaEnabled;
    if (action === "enable" && on) return reply.status(400).send({ error: "2FA already enabled" });
    if (action === "disable" && !on) return reply.status(400).send({ error: "2FA already disabled" });
    const { users } = await import("../db/schema.js");
    const { eq: eqU } = await import("drizzle-orm");
    const me = await db.select().from(users).where(eqU(users.id, (req as any).user.id)).limit(1).then((r: any) => r[0]);
    if (!me) return reply.status(401).send({ error: "User not found" });
    const { startClubChallenge } = await import("../services/twoFactor.js");
    try {
      const { via, challengeId, expiresAt } = await startClubChallenge(db, club, me, action === "enable" ? "activation" : "deactivation");
      return reply.send({ sent_via: via, challenge_id: challengeId, expires_at: expiresAt });
    } catch (e: any) {
      return reply.status(e.statusCode || 500).send({ error: e.message || "OTP failed" });
    }
  });

  // POST /api/settings/2fa/confirm {action, code} → applies the change.
  fastify.post("/api/settings/2fa/confirm", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const { action, code, challenge_id } = ((req as any).body as any) || {};
    if (!["enable", "disable"].includes(action) || !code) return reply.status(400).send({ error: "action + code required" });
    const poolDb: any = (fastify as any).db;
    if (!poolDb) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, poolDb);
    if (!club) return;
    const db: any = reqDb(req);
    const me = (req as any).user;
    const { verifyChallenge } = await import("../services/twoFactor.js");
    try {
      if (challenge_id) {
        await verifyChallenge(db, me.id, challenge_id, code, action === "enable" ? "activation" : "deactivation");
      } else {
        // Find the caller's live challenge for this purpose.
        const { loginChallenges } = await import("../db/schema.js");
        const { and, isNull, desc } = await import("drizzle-orm");
        const rows = await db.select().from(loginChallenges).where(
          and(eq(loginChallenges.userId, me.id), eq(loginChallenges.purpose, action === "enable" ? "activation" : "deactivation"), isNull(loginChallenges.consumedAt))
        ).orderBy(desc(loginChallenges.createdAt)).limit(1);
        if (!rows[0]) return reply.status(401).send({ error: "No pending code — request one first" });
        await verifyChallenge(db, me.id, rows[0].id, code, action === "enable" ? "activation" : "deactivation");
      }
    } catch (e: any) {
      return reply.status(401).send({ error: "Invalid or expired code" });
    }
    await db.update(appSettings).set({ twoFaEnabled: action === "enable", updatedAt: new Date() }).where(eq(appSettings.clubId, club.id));
    const s = await getClubSettings(db, club.id);
    return reply.send(maskSettingsForAdminResponse(s, await getNotifyPolicy(db, club.id)));
  });
}
