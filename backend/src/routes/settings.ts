import type { FastifyInstance } from "fastify";
import { settingsSchema } from "../types/schemas.js";
import { appSettings } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { maskSettingsForAdminResponse } from "../services/notifications.js";
import { resolveClubSlug, requireClub, requireRequestClub, getClubSettings, clubLocales } from "../services/club.js";

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
  notifications_enabled: false,
  notify_on_auto_approved: false,
  notify_on_approval: true,
  notify_on_rejection: true,
  notify_via_telegram: true,
  notify_via_whatsapp: true,
};

export default async function settingsRoutes(fastify: FastifyInstance) {
  // Public club info for footer (no auth) — scoped by slug.
  fastify.get("/api/club-info", async (req, reply) => {
    const db: any = (req as any).server.db ?? (req as any).db;
    if (!db) return reply.send(FALLBACK_INFO);
    try {
      const club = await requireClub(req, reply, db, resolveClubSlug(req));
      if (!club) return;
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
      });
    } catch {
      return reply.send(FALLBACK_INFO);
    }
  });

  fastify.get("/api/settings", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const db: any = (req as any).server.db;
    if (!db) return reply.send(FALLBACK_SETTINGS);
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    const s = await getClubSettings(db, club.id);
    if (!s) return reply.send(FALLBACK_SETTINGS);
    return reply.send(maskSettingsForAdminResponse(s));
  });

  fastify.put("/api/settings", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const parsed = settingsSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    const updates: any = {};
    if (parsed.data.default_slot_duration_minutes !== undefined) updates.defaultSlotDurationMinutes = parsed.data.default_slot_duration_minutes;
    if (parsed.data.booking_hold_minutes !== undefined) updates.bookingHoldMinutes = parsed.data.booking_hold_minutes;
    if (parsed.data.max_advance_days !== undefined) updates.maxAdvanceDays = parsed.data.max_advance_days;
    if (parsed.data.min_cancel_hours !== undefined) updates.minCancelHours = parsed.data.min_cancel_hours;
    if (parsed.data.auto_approve_bookings !== undefined) updates.autoApproveBookings = parsed.data.auto_approve_bookings;
    if (parsed.data.club_name !== undefined) updates.clubName = parsed.data.club_name || null;
    if (parsed.data.club_phone !== undefined) updates.clubPhone = parsed.data.club_phone || null;
    if (parsed.data.club_address !== undefined) updates.clubAddress = parsed.data.club_address || null;
    if (parsed.data.public_url !== undefined) updates.publicUrl = parsed.data.public_url ? parsed.data.public_url.replace(/\/$/, "") : null;
    if (parsed.data.notifications_enabled !== undefined) updates.notificationsEnabled = parsed.data.notifications_enabled;
    if (parsed.data.notify_on_auto_approved !== undefined) updates.notifyOnAutoApproved = parsed.data.notify_on_auto_approved;
    if (parsed.data.notify_on_approval !== undefined) updates.notifyOnApproval = parsed.data.notify_on_approval;
    if (parsed.data.notify_on_rejection !== undefined) updates.notifyOnRejection = parsed.data.notify_on_rejection;
    if (parsed.data.notify_via_telegram !== undefined) updates.notifyViaTelegram = parsed.data.notify_via_telegram;
    if (parsed.data.notify_via_whatsapp !== undefined) updates.notifyViaWhatsapp = parsed.data.notify_via_whatsapp;
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
      const current = await getClubSettings(db, club.id);
      const enabled = parsed.data.enabled_locales ?? current?.enabledLocales ?? ["it", "en", "fr", "de", "es"];
      let def = parsed.data.default_locale ?? current?.defaultLocale ?? enabled[0];
      if (!enabled.includes(def)) def = enabled[0];
      updates.enabledLocales = [...new Set(enabled)];
      updates.defaultLocale = def;
    }
    updates.updatedAt = new Date();
    const existing = await getClubSettings(db, club.id);
    const row = existing
      ? (await db.update(appSettings).set(updates).where(eq(appSettings.clubId, club.id)).returning())[0]
      : (await db.insert(appSettings).values({ clubId: club.id, ...updates }).returning())[0];
    return reply.send(maskSettingsForAdminResponse(row));
  });
}
