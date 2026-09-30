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

/** Per-club notify context: settings + club (slug/name) + platform base URL. */
export async function getClubNotifyContext(db: Db, clubId: string) {
  const settings = await getNotificationSettings(db, clubId);
  let club: any = null;
  try {
    const { clubs } = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(clubs).where(eq(clubs.id, clubId)).limit(1);
    club = rows[0] ?? null;
  } catch {}
  let platformBase: string | null = null;
  try {
    const { getPlatformSetting } = await import("./club.js");
    platformBase = await getPlatformSetting(db, "base_url");
  } catch {}
  return { settings, club, platformBase };
}

// Fire-and-forget safety (Phase 4 RLS): notifications outlive the request
// transaction, so they check out their own club-scoped client. Pool drizzles
// (createDb flag) get a scoped client; anything else passes through
// (tests run owner-side and bypass RLS by design).
async function scopedDb(poolDb: any, clubId: string | null | undefined) {
  if (!poolDb?.__isPool || !clubId) return { cx: poolDb, done: async () => {} };
  const pool = poolDb.__pool;
  const client = await pool.connect();
  await client.query("BEGIN");
  await client.query(`SET LOCAL app.club_id = '${String(clubId).replace(/'/g, "''")}'`);
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("../db/schema.js");
  const cx = drizzle(client, { schema });
  return {
    cx,
    done: async () => {
      try { await client.query("COMMIT"); } catch { try { await client.query("ROLLBACK"); } catch {} }
      try { client.release(); } catch {}
    },
  };
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

function bookingAdminUrl(bookingId: string, platformBase: string | null, slug?: string | null): string {
  // Platform base URL (superadmin-maintained) + club slug. No per-club URL,
  // no env fallback. Without a base URL there is no absolute link, so callers
  // omit the CTA.
  const base = (platformBase || "").replace(/\/$/, "");
  if (!base || !slug) return "";
  return `${base}/club/${slug}/#admin-bookings?highlight=${bookingId}`;
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

function buildAdminPendingMessage(b: any, user: any, court: any, clubName: string, platformBase: string | null, lang: Lang, slug?: string | null): string {
  const T = NOTIF[normalizeLang(lang)];
  const courtLabel = court?.name ? `${court.name} · ${court.type}` : `Court #${court?.number ?? b.courtId?.slice(0, 6)}`;
  const when = `${b.date} ${String(b.startTime).slice(0, 5)}–${String(b.endTime).slice(0, 5)}`;
  const who = user ? `${user.username} (${user.firstName ?? ""} ${user.lastName ?? ""})`.trim() : b.userId;
  const rent = b.rentRacquets ? ` · ${b.rentRacquets} racquets` : "";
  const players = b.players ? ` · ${b.players} players` : "";
  const url = bookingAdminUrl(b.id, platformBase, slug);
  const cta = url ? `\n${T.manage(url)}` : "";
  return `🔔 <b>${clubName}</b> ${T.dash} ${T.adminPendingTitle}\n${T.court}: ${courtLabel}\n${T.when}: ${when}${players}${rent}\n${T.user}: ${who}\n${T.notes}: ${b.notes || "-"}${cta}`;
}
function buildAdminPendingPlain(b: any, user: any, court: any, clubName: string, platformBase: string | null, lang: Lang, slug?: string | null): string {
  const T = NOTIF[normalizeLang(lang)];
  const courtLabel = court?.name ? `${court.name} · ${court.type}` : `Court #${court?.number ?? b.courtId?.slice(0, 6)}`;
  const when = `${b.date} ${String(b.startTime).slice(0, 5)}–${String(b.endTime).slice(0, 5)}`;
  const who = user ? `${user.username} (${user.firstName ?? ""} ${user.lastName ?? ""})`.trim() : b.userId;
  const rent = b.rentRacquets ? ` · ${b.rentRacquets} racquets` : "";
  const players = b.players ? ` · ${b.players} players` : "";
  const url = bookingAdminUrl(b.id, platformBase, slug);
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

// Email variants (#23): subjects + html/text reusing the localized builders.
export function buildAdminPendingEmail(b: any, user: any, court: any, clubName: string, platformBase: string | null, lang: Lang, slug?: string | null, autoApproved = false) {
  const T = NOTIF[normalizeLang(lang)];
  const title = autoApproved ? T.adminAutoTitle : T.adminPendingTitle;
  const html = autoApproved ? buildAdminAutoMessage(b, user, court, clubName, lang) : buildAdminPendingMessage(b, user, court, clubName, platformBase, lang, slug);
  const text = autoApproved ? buildAdminAutoPlain(b, user, court, clubName, lang) : buildAdminPendingPlain(b, user, court, clubName, platformBase, lang, slug);
  return { subject: `${clubName} — ${title}`, html: `<div>${html.replace(/\n/g, "<br/>")}</div>`, text };
}

export function buildUserDecisionEmail(b: any, court: any, clubName: string, decision: "approved" | "rejected", lang: Lang) {
  const T = NOTIF[normalizeLang(lang)];
  const verb = decision === "approved" ? T.approved : T.rejected;
  const html = buildUserDecisionMessage(b, court, clubName, decision, lang);
  return { subject: `${clubName} — ${T.yourBookingWas} ${verb}`, html: `<div>${html.replace(/\n/g, "<br/>")}</div>`, text: html.replace(/<[^>]*>/g, "") };
}

// ---- Notifications v2: policy + prefs ------------------------------------
// Events: request (booking needs approval → admins), auto (auto-approved →
// admins info + user decision), approval/rejection (manual decision → user).
// Send iff admin policy AND recipient subscription AND channel connected.
export const NOTIFY_EVENTS = ["request", "auto", "approval", "rejection"] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

const POLICY_DEFAULTS: Record<NotifyEvent, { toUsersEmail: boolean; toUsersPush: boolean; toAdminsEmail: boolean; toAdminsPush: boolean }> = {
  request: { toUsersEmail: false, toUsersPush: false, toAdminsEmail: true, toAdminsPush: true },
  auto: { toUsersEmail: true, toUsersPush: true, toAdminsEmail: false, toAdminsPush: false },
  approval: { toUsersEmail: true, toUsersPush: true, toAdminsEmail: false, toAdminsPush: false },
  rejection: { toUsersEmail: true, toUsersPush: true, toAdminsEmail: false, toAdminsPush: false },
};

function normalizeEvent(v: any): NotifyEvent | null {
  const s = String(v || "");
  return (NOTIFY_EVENTS as readonly string[]).includes(s) ? (s as NotifyEvent) : null;
}

/** Ensure the 4 policy rows exist for a club (idempotent; covers new clubs). */
export async function ensureNotifyPolicy(db: Db, clubId: string) {
  try {
    const { notifyPolicy } = await import("../db/schema.js");
    const rows = (NOTIFY_EVENTS as readonly NotifyEvent[]).map((event) => ({ clubId, event, ...POLICY_DEFAULTS[event] }));
    await db.insert(notifyPolicy).values(rows as any).onConflictDoNothing();
  } catch {}
}

export async function getNotifyPolicy(db: Db, clubId: string): Promise<Array<{ event: string; to_users_email: boolean; to_users_push: boolean; to_admins_email: boolean; to_admins_push: boolean }>> {
  await ensureNotifyPolicy(db, clubId);
  try {
    const { notifyPolicy } = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(notifyPolicy).where(eq(notifyPolicy.clubId, clubId));
    const byEvent = new Map((rows as any[]).map((r: any) => [r.event, r]));
    return (NOTIFY_EVENTS as readonly NotifyEvent[]).map((event) => {
      const r: any = byEvent.get(event);
      const d = POLICY_DEFAULTS[event];
      return {
        event,
        to_users_email: r?.toUsersEmail ?? d.toUsersEmail,
        to_users_push: r?.toUsersPush ?? d.toUsersPush,
        to_admins_email: r?.toAdminsEmail ?? d.toAdminsEmail,
        to_admins_push: r?.toAdminsPush ?? d.toAdminsPush,
      };
    });
  } catch {
    return (NOTIFY_EVENTS as readonly NotifyEvent[]).map((event) => {
      const d = POLICY_DEFAULTS[event];
      return { event, to_users_email: d.toUsersEmail, to_users_push: d.toUsersPush, to_admins_email: d.toAdminsEmail, to_admins_push: d.toAdminsPush };
    });
  }
}

function policyFor(policy: Array<{ event: string; [k: string]: any }>, event: NotifyEvent) {
  const d = POLICY_DEFAULTS[event];
  const found = policy.find((p) => p.event === event);
  if (!found) return { event, to_users_email: d.toUsersEmail, to_users_push: d.toUsersPush, to_admins_email: d.toAdminsEmail, to_admins_push: d.toAdminsPush };
  return {
    event,
    to_users_email: found.to_users_email ?? found.toUsersEmail ?? d.toUsersEmail,
    to_users_push: found.to_users_push ?? found.toUsersPush ?? d.toUsersPush,
    to_admins_email: found.to_admins_email ?? found.toAdminsEmail ?? d.toAdminsEmail,
    to_admins_push: found.to_admins_push ?? found.toAdminsPush ?? d.toAdminsPush,
  };
}

/** Per-user push prefs as a map (absent = on). */
async function getUserPushPrefs(db: Db, userId: string): Promise<Map<string, boolean>> {
  const m = new Map<string, boolean>();
  try {
    const { notifyEventPrefs } = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(notifyEventPrefs).where(eq(notifyEventPrefs.userId, userId));
    for (const r of rows as any[]) m.set(String(r.event), r.push !== false);
  } catch {}
  return m;
}

/** User push leg: master AND per-event pref AND ≥1 usable channel (checked by caller). */
function userPushSubscribed(user: any, event: NotifyEvent, prefs: Map<string, boolean>) {
  if (!user) return false;
  if (user.notifyPushMaster === false) return false;
  if (prefs.get(event) === false) return false;
  return true;
}

/** Push channel usability: connected (chatId/mobile) AND enabled (opt-out flag). */
export function userPushChannels(user: any): { telegram: boolean; whatsapp: boolean } {
  return {
    telegram: !!user?.telegramChatId && user?.notifyTelegram !== false,
    whatsapp: !!user?.mobile && user?.notifyWhatsapp !== false,
  };
}

export async function notifyAdminPendingBooking(poolDb: Db, booking: any, opts?: { autoApproved?: boolean }) {
  const autoApproved = !!opts?.autoApproved;
  try {
    if (!booking?.clubId) return;
    const { cx: db, done } = await scopedDb(poolDb, booking.clubId);
    try {
    const { settings, club, platformBase } = await getClubNotifyContext(db, booking.clubId);
    if (!settings) return;
    // v2 policy legs for this event (request | auto).
    const event: NotifyEvent = autoApproved ? "auto" : "request";
    const policy = policyFor(await getNotifyPolicy(db, booking.clubId), event);
    const pushOn = !!policy.to_admins_push;
    const emailOn = !!policy.to_admins_email;
    const emailSender = (settings as any).notifyEmailSender || undefined;
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
    // Admin alerts go to ALL admins: only the channel master + connected state
    // gate delivery (no per-event personal prefs on the admin side).
    if (pushOn && telegramBotToken && (telegramAdminChatId || true)) {
      const manualIds = telegramAdminChatId ? String(telegramAdminChatId).split(",").map((s: string) => s.trim()).filter(Boolean) : [];
      let linkedAdminIds: string[] = [];
      try {
        const adminRows = await db.select().from(users).where(and(eq(users.clubId, booking.clubId), eq(users.role, "admin"), isNull(users.deletedAt)));
      linkedAdminIds = (adminRows as any[])
        .filter((u: any) => u.telegramChatId && u.notifyTelegram !== false && u.notifyPushMaster !== false)
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
          : buildAdminPendingMessage(booking, user, court, clubName, platformBase, lang, slug);
        sendTelegramMessage(telegramBotToken, chatId, text).catch(() => {});
      }
    }
    // WhatsApp to admin phone (single) — per-recipient language via mobile lookup (this club)
    if (pushOn && whatsappToken && whatsappPhoneNumberId && whatsappAdminPhone) {
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
        : buildAdminPendingPlain(booking, user, court, clubName, platformBase, lang, slug);
      sendWhatsAppMessage(whatsappPhoneNumberId, whatsappToken, whatsappAdminPhone, waText).catch(() => {});
    }
    // Email to admin users with an address (email is mandatory — opt-out not offered).
    if (emailOn) {
      let adminRows: any[] = [];
      try {
        adminRows = await db.select().from(users).where(and(eq(users.clubId, booking.clubId), eq(users.role, "admin"), isNull(users.deletedAt)));
      } catch {}
      const seen = new Set<string>();
      const { sendEmail } = await import("./email.js");
      for (const a of adminRows as any[]) {
        if (!a.email || a.notifyEmail === false) continue;
        const key = String(a.email).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const alang: Lang = normalizeLang(a.preferredLanguage);
        const mail = buildAdminPendingEmail(booking, user, court, clubName, platformBase, alang, slug, autoApproved);
        sendEmail({ to: a.email, subject: mail.subject, html: mail.html, text: mail.text, senderEmail: emailSender }).catch(() => {});
      }
    }
    } finally {
      await done();
    }
  } catch (e) {
    console.warn("[notify] notifyAdminPendingBooking error", e);
  }
}

export async function notifyUserBookingDecision(poolDb: Db, booking: any, decision: "approved" | "rejected", opts?: { event?: string }) {
  try {
    if (!booking?.clubId) return;
    const { cx: db, done } = await scopedDb(poolDb, booking.clubId);
    try {
    const { settings, club, platformBase } = await getClubNotifyContext(db, booking.clubId);
    if (!settings) return;
    // v2 policy legs: manual approve/reject use their own event; the
    // auto-approve path passes event "auto" (its to_users legs were backfilled
    // from the approval matrix, preserving behaviour).
    const event: NotifyEvent = normalizeEvent(opts?.event) ?? (decision === "approved" ? "approval" : "rejection");
    const policy = policyFor(await getNotifyPolicy(db, booking.clubId), event);
    const emailOn = !!policy.to_users_email;
    const pushOn = !!policy.to_users_push;
    const emailSender = (settings as any).notifyEmailSender || undefined;
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
    const prefs = await getUserPushPrefs(db, booking.userId);
    const subscribed = userPushSubscribed(user, event, prefs);
    const channels = userPushChannels(user);
    if (pushOn && subscribed && channels.telegram && telegramBotToken) {
      promises.push(sendTelegramMessage(telegramBotToken, user.telegramChatId, text));
    }
    if (pushOn && subscribed && channels.whatsapp && whatsappToken && whatsappPhoneNumberId) {
      promises.push(sendWhatsAppMessage(whatsappPhoneNumberId, whatsappToken, user.mobile, waText));
    }
    if (emailOn && user?.email) {
      const { sendEmail } = await import("./email.js");
      const mail = buildUserDecisionEmail(booking, court, clubName, decision, lang);
      promises.push(sendEmail({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text, senderEmail: emailSender }));
    }
    if (promises.length === 0) {
      console.warn(`[notify] user ${booking.userId} has no telegramChatId/mobile or channels disabled — no channel to notify for ${decision}`);
      return;
    }
    await Promise.allSettled(promises);
    } finally {
      await done();
    }
  } catch (e) {
    console.warn("[notify] notifyUserBookingDecision error", e);
  }
}

export function maskSettingsForAdminResponse(s: any, policy: any[] | null = null) {
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
    notify_email_sender: (s as any).notifyEmailSender ?? null,
    notify_policy: policy,
    telegram_bot_token: s.telegramBotToken ? maskToken(s.telegramBotToken) : null,
    telegram_bot_token_present: !!s.telegramBotToken,
    telegram_admin_chat_id: s.telegramAdminChatId,
    whatsapp_token_present: !!s.whatsappToken,
    whatsapp_phone_number_id: s.whatsappPhoneNumberId,
    whatsapp_admin_phone: s.whatsappAdminPhone,
    enabled_locales: s.enabledLocales ?? ["it", "en", "fr", "de", "es"],
    default_locale: s.defaultLocale ?? "it",
    two_fa_enabled: s.twoFaEnabled ?? false,
    flexible_slots: s.flexibleSlots ?? false,
    show_prices: s.showPrices ?? true,
    allow_open_signup: s.allowOpenSignup ?? true,
    require_participant_list: (s as any).requireParticipantList ?? false,
  };
}
