import { BRAND_NAME } from "../config/brand.js";

type Db = any;

function maskToken(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.length <= 8) return "***";
  return v.slice(0, 4) + "***" + v.slice(-4);
}

export async function getNotificationSettings(db: Db, clubId?: string) {
  if (!db) return null;
  try {
    const { appSettings } = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");
    if (!clubId) return null;
    const rows = await db.select().from(appSettings).where(eq(appSettings.clubId, clubId));
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/** Per-club notify context: settings + club (slug/name for deep links). */
export async function getClubNotifyContext(db: Db, clubId: string) {
  const settings = await getNotificationSettings(db, clubId);
  let club: any = null;
  try {
    const { clubs } = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(clubs).where(eq(clubs.id, clubId)).limit(1);
    club = rows[0] ?? null;
  } catch {}
  return { settings, club };
}

export async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<boolean> {
  if (!botToken || !chatId) return false;
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[notify] telegram failed ${res.status} ${body.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[notify] telegram error", e);
    return false;
  }
}

export async function sendWhatsAppMessage(phoneNumberId: string, token: string, to: string, text: string): Promise<boolean> {
  if (!phoneNumberId || !token || !to) return false;
  // Normalize "to": keep digits, strip leading 00/0 (Meta expects E.164 without +/00, e.g. 393923047417 not 00393...)
  let normalized = to.replace(/[^\d]/g, "");
  if (normalized.startsWith("00")) normalized = normalized.slice(2);
  else if (normalized.startsWith("0")) normalized = normalized.slice(1);
  if (!normalized) return false;
  try {
    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalized,
        type: "text",
        text: { preview_url: false, body: text },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[notify] whatsapp failed ${res.status} ${body.slice(0, 500)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[notify] whatsapp error", e);
    return false;
  }
}

function bookingAdminUrl(bookingId: string, settings: any, slug?: string | null): string {
  // Strictly per-club: no env fallback (removed — shared fallback is a crosstalk gun).
  // Without a public_url there is no absolute link, so callers omit the CTA.
  const base = (settings?.publicUrl || "").replace(/\/$/, "");
  if (!base || !slug) return "";
  return `${base}/c/${slug}/#admin-bookings?highlight=${bookingId}`;
}

type Lang = "it" | "en" | "fr" | "de" | "es";
const LANGS: Lang[] = ["it","en","fr","de","es"];
function normalizeLang(v: any): Lang {
  const s = String(v || "it").toLowerCase();
  return (LANGS as string[]).includes(s) ? (s as Lang) : "it";
}
const NOTIF = {
  it: {
    adminPendingTitle: "Nuova prenotazione in attesa di approvazione",
    adminAutoTitle: "Nuova prenotazione",
    court: "Campo",
    when: "Quando",
    user: "Utente",
    notes: "Note",
    manage: (url: string) => `per gestire la prenotazione, clicca <a href="${url}">qui</a>`,
    managePlain: (url: string) => `per gestire la prenotazione, clicca qui: ${url}`,
    yourBookingWas: "La tua prenotazione è stata",
    status: "Stato",
    approved: "approvata",
    rejected: "rifiutata",
    dash: "—",
  },
  en: {
    adminPendingTitle: "New booking pending approval",
    adminAutoTitle: "New booking",
    court: "Court",
    when: "When",
    user: "User",
    notes: "Notes",
    manage: (url: string) => `to manage booking, click <a href="${url}">here</a>`,
    managePlain: (url: string) => `to manage booking, click here: ${url}`,
    yourBookingWas: "Your booking was",
    status: "Status",
    approved: "approved",
    rejected: "rejected",
    dash: "—",
  },
  fr: {
    adminPendingTitle: "Nouvelle réservation en attente d'approbation",
    adminAutoTitle: "Nouvelle réservation",
    court: "Terrain",
    when: "Quand",
    user: "Utilisateur",
    notes: "Notes",
    manage: (url: string) => `pour gérer la réservation, cliquez <a href="${url}">ici</a>`,
    managePlain: (url: string) => `pour gérer la réservation, cliquez ici : ${url}`,
    yourBookingWas: "Votre réservation a été",
    status: "Statut",
    approved: "approuvée",
    rejected: "rejetée",
    dash: "—",
  },
  de: {
    adminPendingTitle: "Neue Buchung ausstehend — Genehmigung erforderlich",
    adminAutoTitle: "Neue Buchung",
    court: "Platz",
    when: "Wann",
    user: "Nutzer",
    notes: "Notizen",
    manage: (url: string) => `um die Buchung zu verwalten, klicke <a href="${url}">hier</a>`,
    managePlain: (url: string) => `um die Buchung zu verwalten, klicke hier: ${url}`,
    yourBookingWas: "Deine Buchung wurde",
    status: "Status",
    approved: "genehmigt",
    rejected: "abgelehnt",
    dash: "—",
  },
  es: {
    adminPendingTitle: "Nueva reserva pendiente de aprobación",
    adminAutoTitle: "Nueva reserva",
    court: "Pista",
    when: "Cuándo",
    user: "Usuario",
    notes: "Notas",
    manage: (url: string) => `para gestionar la reserva, haz clic <a href="${url}">aquí</a>`,
    managePlain: (url: string) => `para gestionar la reserva, haz clic aquí: ${url}`,
    yourBookingWas: "Tu reserva fue",
    status: "Estado",
    approved: "aprobada",
    rejected: "rechazada",
    dash: "—",
  },
} as const;

function buildAdminPendingMessage(b: any, user: any, court: any, clubName: string, settings: any, lang: Lang, slug?: string | null): string {
  const T = NOTIF[normalizeLang(lang)];
  const courtLabel = court?.name ? `${court.name} · ${court.type}` : `Court #${court?.number ?? b.courtId?.slice(0, 6)}`;
  const when = `${b.date} ${String(b.startTime).slice(0, 5)}–${String(b.endTime).slice(0, 5)}`;
  const who = user ? `${user.username} (${user.firstName ?? ""} ${user.lastName ?? ""})`.trim() : b.userId;
  const rent = b.rentRacquets ? ` · ${b.rentRacquets} racquets` : "";
  const players = b.players ? ` · ${b.players} players` : "";
  const url = bookingAdminUrl(b.id, settings, slug);
  const cta = url ? `\n${T.manage(url)}` : "";
  return `🔔 <b>${clubName}</b> ${T.dash} ${T.adminPendingTitle}\n${T.court}: ${courtLabel}\n${T.when}: ${when}${players}${rent}\n${T.user}: ${who}\n${T.notes}: ${b.notes || "-"}${cta}`;
}
function buildAdminPendingPlain(b: any, user: any, court: any, clubName: string, settings: any, lang: Lang, slug?: string | null): string {
  const T = NOTIF[normalizeLang(lang)];
  const courtLabel = court?.name ? `${court.name} · ${court.type}` : `Court #${court?.number ?? b.courtId?.slice(0, 6)}`;
  const when = `${b.date} ${String(b.startTime).slice(0, 5)}–${String(b.endTime).slice(0, 5)}`;
  const who = user ? `${user.username} (${user.firstName ?? ""} ${user.lastName ?? ""})`.trim() : b.userId;
  const rent = b.rentRacquets ? ` · ${b.rentRacquets} racquets` : "";
  const players = b.players ? ` · ${b.players} players` : "";
  const url = bookingAdminUrl(b.id, settings, slug);
  const cta = url ? `\n${T.managePlain(url)}` : "";
  return `🔔 ${clubName} ${T.dash} ${T.adminPendingTitle}\n${T.court}: ${courtLabel}\n${T.when}: ${when}${players}${rent}\n${T.user}: ${who}\n${T.notes}: ${b.notes || "-"}${cta}`;
}
// Auto-approved bookings: info only — nothing to approve, so no manage CTA.
export function buildAdminAutoMessage(b: any, user: any, court: any, clubName: string, lang: Lang): string {
  const T = NOTIF[normalizeLang(lang)];
  const courtLabel = court?.name ? `${court.name} · ${court.type}` : `Court #${court?.number ?? b.courtId?.slice(0, 6)}`;
  const when = `${b.date} ${String(b.startTime).slice(0, 5)}–${String(b.endTime).slice(0, 5)}`;
  const who = user ? `${user.username} (${user.firstName ?? ""} ${user.lastName ?? ""})`.trim() : b.userId;
  const rent = b.rentRacquets ? ` · ${b.rentRacquets} racquets` : "";
  const players = b.players ? ` · ${b.players} players` : "";
  return `🔔 <b>${clubName}</b> ${T.dash} ${T.adminAutoTitle}\n${T.court}: ${courtLabel}\n${T.when}: ${when}${players}${rent}\n${T.user}: ${who}\n${T.notes}: ${b.notes || "-"}`;
}
export function buildAdminAutoPlain(b: any, user: any, court: any, clubName: string, lang: Lang): string {
  const T = NOTIF[normalizeLang(lang)];
  const courtLabel = court?.name ? `${court.name} · ${court.type}` : `Court #${court?.number ?? b.courtId?.slice(0, 6)}`;
  const when = `${b.date} ${String(b.startTime).slice(0, 5)}–${String(b.endTime).slice(0, 5)}`;
  const who = user ? `${user.username} (${user.firstName ?? ""} ${user.lastName ?? ""})`.trim() : b.userId;
  const rent = b.rentRacquets ? ` · ${b.rentRacquets} racquets` : "";
  const players = b.players ? ` · ${b.players} players` : "";
  return `🔔 ${clubName} ${T.dash} ${T.adminAutoTitle}\n${T.court}: ${courtLabel}\n${T.when}: ${when}${players}${rent}\n${T.user}: ${who}\n${T.notes}: ${b.notes || "-"}`;
}

function buildUserDecisionMessage(b: any, court: any, clubName: string, decision: "approved" | "rejected", lang: Lang): string {
  const T = NOTIF[normalizeLang(lang)];
  const courtLabel = court?.name ? `${court.name} · ${court.type}` : `Court #${court?.number ?? b.courtId?.slice(0, 6)}`;
  const when = `${b.date} ${String(b.startTime).slice(0, 5)}–${String(b.endTime).slice(0, 5)}`;
  const icon = decision === "approved" ? "✅" : "❌";
  const verb = decision === "approved" ? T.approved : T.rejected;
  return `${icon} <b>${clubName}</b> ${T.dash} ${T.yourBookingWas} ${verb}\n${T.court}: ${courtLabel}\n${T.when}: ${when}\n${T.status}: ${verb}`;
}

export async function notifyAdminPendingBooking(db: Db, booking: any, opts?: { autoApproved?: boolean }) {
  const autoApproved = !!opts?.autoApproved;
  try {
    if (!booking?.clubId) return;
    const { settings, club } = await getClubNotifyContext(db, booking.clubId);
    if (!settings || !settings.notificationsEnabled) return;
    // respect channel toggles
    const viaTelegram = (settings as any).notifyViaTelegram ?? true;
    const viaWhatsapp = (settings as any).notifyViaWhatsapp ?? true;
    const clubName = settings.clubName || club?.name || BRAND_NAME;
    const slug = club?.slug ?? null;
    const { users, courts } = await import("../db/schema.js");
    const { eq, and, isNull } = await import("drizzle-orm");
    let user: any = null;
    let court: any = null;
    try {
      const uRows = await db.select().from(users).where(eq(users.id, booking.userId)).limit(1);
      user = uRows[0] ?? null;
    } catch {}
    try {
      const cRows = await db.select().from(courts).where(eq(courts.id, booking.courtId)).limit(1);
      court = cRows[0] ?? null;
    } catch {}
    // Strictly per-club credentials — env fallbacks removed (crosstalk gun).
    const telegramBotToken = settings.telegramBotToken || "";
    const telegramAdminChatId = settings.telegramAdminChatId || "";
    const whatsappToken = settings.whatsappToken || "";
    const whatsappPhoneNumberId = settings.whatsappPhoneNumberId || "";
    const whatsappAdminPhone = settings.whatsappAdminPhone || "";

    // Telegram to admin(s) — per-recipient language
    // Union: manual telegramAdminChatId list + all linked admin users of THIS club
    // (role=admin AND telegramChatId set AND live) so admin can subscribe via
    // Admin → Notifications → Connect Telegram just like regular users in Profile.
    if (viaTelegram && telegramBotToken && (telegramAdminChatId || true)) {
      const manualIds = telegramAdminChatId ? String(telegramAdminChatId).split(",").map((s: string) => s.trim()).filter(Boolean) : [];
      let linkedAdminIds: string[] = [];
      try {
        const adminRows = await db.select().from(users).where(and(eq(users.clubId, booking.clubId), eq(users.role, "admin"), isNull(users.deletedAt)));
        linkedAdminIds = (adminRows as any[])
          .filter((u: any) => u.telegramChatId)
          .map((u: any) => String(u.telegramChatId).trim())
          .filter(Boolean);
      } catch {}
      const chatIds = [...new Set([...manualIds, ...linkedAdminIds])];
      if (chatIds.length === 0) console.warn("[notify] no telegram admin recipients (manual list empty + no linked admins)");
      for (const chatId of chatIds) {
        let lang: Lang = "it";
        try {
          const aRows = await db.select().from(users).where(and(eq(users.clubId, booking.clubId), eq(users.telegramChatId, chatId))).limit(1);
          if (aRows[0]?.preferredLanguage) lang = normalizeLang(aRows[0].preferredLanguage);
        } catch {}
        const text = autoApproved
          ? buildAdminAutoMessage(booking, user, court, clubName, lang)
          : buildAdminPendingMessage(booking, user, court, clubName, settings, lang, slug);
        sendTelegramMessage(telegramBotToken, chatId, text).catch(() => {});
      }
    }
    // WhatsApp to admin phone (single) — per-recipient language via mobile lookup (this club)
    if (viaWhatsapp && whatsappToken && whatsappPhoneNumberId && whatsappAdminPhone) {
      let lang: Lang = "it";
      try {
        let norm = whatsappAdminPhone.replace(/[^\d]/g,"");
        if (norm.startsWith("00")) norm = norm.slice(2); else if (norm.startsWith("0")) norm = norm.slice(1);
        const aRows = await db.select().from(users).where(and(eq(users.clubId, booking.clubId), eq(users.mobile, norm))).limit(1);
        if (!aRows[0]) {
          const all = await db.select().from(users).where(eq(users.clubId, booking.clubId));
          const found = (all as any[]).find((u:any)=> {
            let m = String(u.mobile||"").replace(/[^\d]/g,"");
            if (m.startsWith("00")) m=m.slice(2); else if (m.startsWith("0")) m=m.slice(1);
            return m===norm;
          });
          if (found?.preferredLanguage) lang = normalizeLang(found.preferredLanguage);
        } else if (aRows[0]?.preferredLanguage) lang = normalizeLang(aRows[0].preferredLanguage);
      } catch {}
      const waText = autoApproved
        ? buildAdminAutoPlain(booking, user, court, clubName, lang)
        : buildAdminPendingPlain(booking, user, court, clubName, settings, lang, slug);
      sendWhatsAppMessage(whatsappPhoneNumberId, whatsappToken, whatsappAdminPhone, waText).catch(() => {});
    }
  } catch (e) {
    console.warn("[notify] notifyAdminPendingBooking error", e);
  }
}

export async function notifyUserBookingDecision(db: Db, booking: any, decision: "approved" | "rejected") {
  try {
    if (!booking?.clubId) return;
    const { settings, club } = await getClubNotifyContext(db, booking.clubId);
    if (!settings || !settings.notificationsEnabled) return;
    if (decision === "approved" && (settings as any).notifyOnApproval === false) return;
    if (decision === "rejected" && (settings as any).notifyOnRejection === false) return;
    const viaTelegram = (settings as any).notifyViaTelegram ?? true;
    const viaWhatsapp = (settings as any).notifyViaWhatsapp ?? true;
    const clubName = settings.clubName || club?.name || BRAND_NAME;
    const { users, courts } = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");
    let user: any = null;
    let court: any = null;
    try {
      const uRows = await db.select().from(users).where(eq(users.id, booking.userId)).limit(1);
      user = uRows[0] ?? null;
    } catch {}
    try {
      const cRows = await db.select().from(courts).where(eq(courts.id, booking.courtId)).limit(1);
      court = cRows[0] ?? null;
    } catch {}
    const lang = normalizeLang(user?.preferredLanguage || user?.preferred_language || "it");
    const text = buildUserDecisionMessage(booking, court, clubName, decision, lang);
    const waText = text.replace(/<[^>]*>/g, "");
    const telegramBotToken = settings.telegramBotToken || "";
    const whatsappToken = settings.whatsappToken || "";
    const whatsappPhoneNumberId = settings.whatsappPhoneNumberId || "";

    const promises: Promise<boolean>[] = [];
    if (viaTelegram && user?.telegramChatId && telegramBotToken) {
      promises.push(sendTelegramMessage(telegramBotToken, user.telegramChatId, text));
    }
    if (viaWhatsapp && user?.mobile && whatsappToken && whatsappPhoneNumberId) {
      promises.push(sendWhatsAppMessage(whatsappPhoneNumberId, whatsappToken, user.mobile, waText));
    }
    if (promises.length === 0) {
      console.warn(`[notify] user ${booking.userId} has no telegramChatId/mobile or channels disabled — no channel to notify for ${decision}`);
      return;
    }
    await Promise.allSettled(promises);
  } catch (e) {
    console.warn("[notify] notifyUserBookingDecision error", e);
  }
}

export function maskSettingsForAdminResponse(s: any) {
  if (!s) return s;
  return {
    default_slot_duration_minutes: s.defaultSlotDurationMinutes,
    booking_hold_minutes: s.bookingHoldMinutes,
    max_advance_days: s.maxAdvanceDays,
    min_cancel_hours: s.minCancelHours,
    auto_approve_bookings: s.autoApproveBookings,
    club_name: s.clubName,
    club_phone: s.clubPhone,
    club_address: s.clubAddress,
    public_url: s.publicUrl || "https://empanadel.onrender.com",
    notifications_enabled: s.notificationsEnabled,
    notify_on_auto_approved: s.notifyOnAutoApproved ?? false,
    notify_on_approval: s.notifyOnApproval ?? true,
    notify_on_rejection: s.notifyOnRejection ?? true,
    notify_via_telegram: s.notifyViaTelegram ?? true,
    notify_via_whatsapp: s.notifyViaWhatsapp ?? true,
    telegram_bot_token: s.telegramBotToken ? maskToken(s.telegramBotToken) : null,
    telegram_bot_token_present: !!s.telegramBotToken,
    telegram_admin_chat_id: s.telegramAdminChatId,
    whatsapp_token_present: !!s.whatsappToken,
    whatsapp_phone_number_id: s.whatsappPhoneNumberId,
    whatsapp_admin_phone: s.whatsappAdminPhone,
    enabled_locales: s.enabledLocales ?? ["it", "en", "fr", "de", "es"],
    default_locale: s.defaultLocale ?? "it",
  };
}
