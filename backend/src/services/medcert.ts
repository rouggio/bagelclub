// Medical certificates (#33): per-player expiry + scan, club opt-in gate on
// booking/joining, 30-day reminder to player + club admins (once per expiry).
import { users, appSettings, auditLog } from "../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";

export { todayInTz } from "./fees.js";

/** Days before expiry the reminder goes out. */
export const MEDCERT_REMINDER_DAYS = 30;

export type CertStatus = "missing" | "expired" | "expiring" | "valid";

export function certStatus(expiresAt: string | null | undefined, today: string): CertStatus {
  if (!expiresAt) return "missing";
  const exp = String(expiresAt).slice(0, 10);
  if (exp <= today) return "expired";
  const end = Date.parse(exp + "T00:00:00Z");
  const now = Date.parse(today + "T00:00:00Z");
  if (end - now <= MEDCERT_REMINDER_DAYS * 86400000) return "expiring";
  return "valid";
}

export function medcertRequired(settings: any): boolean {
  return !!(settings as any)?.requireMedicalCert;
}

/** Subset of userIds that may not book/join (no valid cert). Admins bypass. */
export async function medcertBlockedUserIds(db: any, club: any, settings: any, userIds: string[], today: string): Promise<string[]> {
  if (!medcertRequired(settings) || !userIds.length) return [];
  const rows: any[] = await db.select({ id: users.id, role: users.role, medicalCertExpiresAt: users.medicalCertExpiresAt })
    .from(users).where(and(eq(users.clubId, club.id), isNull(users.deletedAt)));
  const byId = new Map(rows.map((r: any) => [String(r.id), r]));
  const blocked: string[] = [];
  for (const uid of userIds) {
    const u = byId.get(String(uid));
    if (!u || u.role === "admin") continue;
    const exp = u.medicalCertExpiresAt ? String(u.medicalCertExpiresAt).slice(0, 10) : null;
    if (certStatus(exp, today) !== "valid") blocked.push(String(uid));
  }
  return blocked;
}

type Lang = "it" | "en" | "fr" | "de" | "es";
function normalizeLang(v: any): Lang {
  const s = String(v || "it").toLowerCase();
  return (["it", "en", "fr", "de", "es"] as string[]).includes(s) ? (s as Lang) : "it";
}
const MED_MAIL: Record<Lang, { subject: (club: string) => string; body: (club: string, exp: string, who: string) => string }> = {
  it: {
    subject: (c) => `Certificato medico in scadenza — ${c}`,
    body: (c, e, w) => `Ciao${w ? " " + w : ""},\nil tuo certificato medico per ${c} scade il ${e}.\nCarica il nuovo certificato in segreteria per continuare a prenotare.\nGrazie!`,
  },
  en: {
    subject: (c) => `Medical certificate expiring — ${c}`,
    body: (c, e, w) => `Hi${w ? " " + w : ""},\nyour ${c} medical certificate expires on ${e}.\nPlease file the new certificate with the club office to keep booking.\nThanks!`,
  },
  fr: {
    subject: (c) => `Certificat médical expirant — ${c}`,
    body: (c, e, w) => `Bonjour${w ? " " + w : ""},\nvotre certificat médical pour ${c} expire le ${e}.\nMerci de déposer le nouveau certificat au club pour continuer à réserver.`,
  },
  de: {
    subject: (c) => `Attest läuft ab — ${c}`,
    body: (c, e, w) => `Hallo${w ? " " + w : ""},\ndein ärztliches Attest für ${c} läuft am ${e} ab.\nBitte reiche das neue Attest im Club ein, um weiter buchen zu können.`,
  },
  es: {
    subject: (c) => `Certificado médico por vencer — ${c}`,
    body: (c, e, w) => `Hola${w ? " " + w : ""},\ntu certificado médico de ${c} vence el ${e}.\nEntrega el nuevo certificado en el club para seguir reservando.\n¡Gracias!`,
  },
};

/**
 * Nightly core: mail players whose cert expires within 30 days (once per
 * user+expiry, tracked via medcert.reminder audits) + notify all club admins.
 */
export async function sendMedcertReminders(db: any, club: any, settings: any): Promise<number> {
  if (!medcertRequired(settings)) return 0;
  const { todayInTz } = await import("./fees.js");
  const today = todayInTz(club.timezone);
  const clubName = (settings as any)?.clubName || club.name;
  const sender = (settings as any)?.notifyEmailSender || undefined;
  const { sendEmail } = await import("./email.js");
  const rows: any[] = await db.select({
    id: users.id, firstName: users.firstName, email: users.email,
    preferredLanguage: users.preferredLanguage, medicalCertExpiresAt: users.medicalCertExpiresAt,
  }).from(users).where(and(eq(users.clubId, club.id), eq(users.role, "associate"), isNull(users.deletedAt)));
  const admins: any[] = await db.select({ email: users.email, preferredLanguage: users.preferredLanguage })
    .from(users).where(and(eq(users.clubId, club.id), eq(users.role, "admin"), isNull(users.deletedAt)));
  let sent = 0;
  for (const u of rows as any[]) {
    const exp = u.medicalCertExpiresAt ? String(u.medicalCertExpiresAt).slice(0, 10) : null;
    if (certStatus(exp, today) !== "expiring" || !u.email) continue;
    const prior: any[] = await db.select({ meta: auditLog.meta }).from(auditLog)
      .where(and(eq(auditLog.clubId, club.id), eq(auditLog.action, "medcert.reminder"), eq(auditLog.target, String(u.id))));
    if (prior.some((r: any) => String(r.meta || "").includes(String(exp)))) continue;
    const T = MED_MAIL[normalizeLang(u.preferredLanguage)];
    const who = [u.firstName].filter(Boolean).join(" ");
    const ok = await sendEmail({ to: u.email, senderEmail: sender, subject: T.subject(clubName), text: T.body(clubName, String(exp), who) })
      .then(() => true).catch(() => false);
    for (const a of admins as any[]) {
      if (!a.email) continue;
      const AT = MED_MAIL[normalizeLang(a.preferredLanguage)];
      await sendEmail({ to: a.email, senderEmail: sender, subject: AT.subject(clubName), text: AT.body(clubName, String(exp), u.email) })
        .catch(() => false);
    }
    await db.insert(auditLog).values({
      actorId: null, clubId: club.id, action: "medcert.reminder", target: String(u.id),
      meta: JSON.stringify({ expires_at: exp, mailed: ok }),
    }).catch(() => {});
    if (ok) sent++;
  }
  return sent;
}
