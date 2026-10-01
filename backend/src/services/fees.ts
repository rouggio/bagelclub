// Associate fees (#32): calendar-anchored periods, collection rows, overdue
// reminders, booking gate. Periods are date strings (YYYY-MM-DD, PG date).
import { clubs, users, appSettings, feePayments, auditLog } from "../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";

export const FEE_CADENCES = ["monthly", "bimonthly", "semestral", "yearly"] as const;
export type FeeCadence = (typeof FEE_CADENCES)[number];
/** Reminder + hard-block kick in past this many days after period end. */
export const FEE_GRACE_DAYS = 7;
/** How many past periods to scan for unpaid rows (bounded lookback). */
const LOOKBACK_PERIODS = 12;

const CADENCE_MONTHS: Record<FeeCadence, number> = { monthly: 1, bimonthly: 2, semestral: 6, yearly: 12 };

export function todayInTz(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

function parts(day: string): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d];
}
function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
export function addMonths(day: string, n: number): string {
  const [y, m] = parts(day);
  const total = (y * 12 + (m - 1)) + n;
  return fmt(Math.floor(total / 12), (total % 12) + 1, 1);
}

/** Start of the period containing `day` (calendar-anchored per cadence). */
export function periodStartFor(day: string, cadence: string): string {
  const c = (FEE_CADENCES as readonly string[]).includes(cadence) ? (cadence as FeeCadence) : "monthly";
  const [y, m] = parts(day);
  const len = CADENCE_MONTHS[c];
  const startM = Math.floor((m - 1) / len) * len + 1;
  return fmt(y, startM, 1);
}
/** Exclusive end of the period starting at `start`. */
export function periodEndExclusive(start: string, cadence: string): string {
  const c = (FEE_CADENCES as readonly string[]).includes(cadence) ? (cadence as FeeCadence) : "monthly";
  return addMonths(start, CADENCE_MONTHS[c]);
}
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
export function periodEnded(start: string, cadence: string, today: string): boolean {
  return periodEndExclusive(start, cadence) <= today;
}
/** Days since period end (0 while running). */
export function daysOverdue(start: string, cadence: string, today: string): number {
  if (!periodEnded(start, cadence, today)) return 0;
  return Math.max(0, dayDiff(periodEndExclusive(start, cadence), today));
}
/** Candidate period starts: current + lookback, newest first. */
export function recentPeriods(cadence: string, today: string, count = LOOKBACK_PERIODS): string[] {
  const out: string[] = [];
  let s = periodStartFor(today, cadence);
  for (let i = 0; i < count; i++) {
    out.push(s);
    const [y, m] = parts(s);
    const total = y * 12 + (m - 1) - CADENCE_MONTHS[(FEE_CADENCES as readonly string[]).includes(cadence) ? (cadence as FeeCadence) : "monthly"];
    s = fmt(Math.floor(total / 12), (total % 12) + 1, 1);
  }
  return out;
}

export function feeActive(settings: any): boolean {
  const cents = (settings as any)?.feeCents ?? null;
  return cents !== null && Number(cents) > 0;
}
export function feeCadenceOf(settings: any): FeeCadence {
  const c = String((settings as any)?.feeCadence || "monthly");
  return (FEE_CADENCES as readonly string[]).includes(c) ? (c as FeeCadence) : "monthly";
}

/** Live associates that owe the fee (admins never owe; exempt flag respected). */
export async function owingUsers(db: any, clubId: string): Promise<any[]> {
  return db.select({
    id: users.id, username: users.username, firstName: users.firstName, lastName: users.lastName,
    email: users.email, preferredLanguage: users.preferredLanguage, feeExempt: users.feeExempt,
  }).from(users).where(and(eq(users.clubId, clubId), eq(users.role, "associate"), isNull(users.deletedAt)));
}

/** period_start strings with a collection row, for one user. */
export async function paidPeriods(db: any, userId: string): Promise<Set<string>> {
  const rows: any[] = await db.select({ periodStart: feePayments.periodStart }).from(feePayments).where(eq(feePayments.userId, userId));
  return new Set(rows.map((r: any) => String(r.periodStart).slice(0, 10)));
}

/** Ended + unpaid periods for a user; `beyondGrace` filters to >7 days past end. */
export async function unpaidPeriods(db: any, settings: any, userId: string, today: string, beyondGrace: boolean): Promise<Array<{ period_start: string; days_overdue: number }>> {
  const cadence = feeCadenceOf(settings);
  const paid = await paidPeriods(db, userId);
  const out: Array<{ period_start: string; days_overdue: number }> = [];
  for (const s of recentPeriods(cadence, today)) {
    if (paid.has(s)) continue;
    const d = daysOverdue(s, cadence, today);
    if (d <= 0) continue;
    if (beyondGrace && d <= FEE_GRACE_DAYS) continue;
    out.push({ period_start: s, days_overdue: d });
  }
  return out;
}

/** Subset of userIds blocked from booking/joining (fee set + toggle on + grace-passed debt). */
export async function feeBlockedUserIds(db: any, club: any, settings: any, userIds: string[], today: string): Promise<string[]> {
  if (!feeActive(settings) || !(settings as any)?.feeBlockBooking) return [];
  if (!userIds.length) return [];
  const rows: any[] = await db.select({ id: users.id, role: users.role, feeExempt: users.feeExempt })
    .from(users).where(and(eq(users.clubId, club.id), isNull(users.deletedAt)));
  const byId = new Map(rows.map((r: any) => [String(r.id), r]));
  const blocked: string[] = [];
  for (const uid of userIds) {
    const u = byId.get(String(uid));
    if (!u || u.role !== "associate" || u.feeExempt) continue;
    const unpaid = await unpaidPeriods(db, settings, String(uid), today, true);
    if (unpaid.length) blocked.push(String(uid));
  }
  return blocked;
}

type Lang = "it" | "en" | "fr" | "de" | "es";
function normalizeLang(v: any): Lang {
  const s = String(v || "it").toLowerCase();
  return (["it", "en", "fr", "de", "es"] as string[]).includes(s) ? (s as Lang) : "it";
}
const FEE_MAIL: Record<Lang, { subject: (club: string) => string; body: (club: string, amount: string, period: string) => string }> = {
  it: {
    subject: (c) => `Quota associativa in sospeso — ${c}`,
    body: (c, a, p) => `Ciao,\nla quota associativa di ${c} per il periodo ${p} (${a}) risulta ancora da pagare.\nEffettua il pagamento e contatta la segreteria per dubbi.\nGrazie!`,
  },
  en: {
    subject: (c) => `Membership fee overdue — ${c}`,
    body: (c, a, p) => `Hi,\nyour ${c} membership fee for ${p} (${a}) is still unpaid.\nPlease pay and contact the club office with any questions.\nThanks!`,
  },
  fr: {
    subject: (c) => `Cotisation en retard — ${c}`,
    body: (c, a, p) => `Bonjour,\nvotre cotisation ${c} pour la période ${p} (${a}) est toujours impayée.\nMerci de régulariser et de contacter le club en cas de question.`,
  },
  de: {
    subject: (c) => `Mitgliedsbeitrag überfällig — ${c}`,
    body: (c, a, p) => `Hallo,\ndein Mitgliedsbeitrag für ${c} im Zeitraum ${p} (${a}) ist noch offen.\nBitte begleiche ihn und melde dich bei Fragen beim Club.`,
  },
  es: {
    subject: (c) => `Cuota pendiente — ${c}`,
    body: (c, a, p) => `Hola,\ntu cuota de ${c} para el período ${p} (${a}) sigue pendiente.\nPágala y contacta al club si tienes dudas.\n¡Gracias!`,
  },
};

export function formatFee(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency || "EUR"}`;
}

/**
 * Nightly core: mail owing users whose oldest unpaid period is past the
 * 7-day grace, once per (user, period) — tracked via fee.reminder audits.
 */
export async function sendFeeReminders(db: any, club: any, settings: any): Promise<number> {
  if (!feeActive(settings) || (settings as any)?.notifyFeeOverdue === false) return 0;
  const today = todayInTz(club.timezone);
  const cadence = feeCadenceOf(settings);
  const amount = formatFee(Number((settings as any).feeCents), club.currency);
  const clubName = (settings as any)?.clubName || club.name;
  const sender = (settings as any)?.notifyEmailSender || undefined;
  const { sendEmail } = await import("./email.js");
  const owing = (await owingUsers(db, club.id)).filter((u: any) => !u.feeExempt && u.email);
  let sent = 0;
  for (const u of owing) {
    const unpaid = await unpaidPeriods(db, settings, String(u.id), today, true);
    if (!unpaid.length) continue;
    const oldest = unpaid[unpaid.length - 1];
    const prior: any[] = await db.select({ meta: auditLog.meta }).from(auditLog)
      .where(and(eq(auditLog.clubId, club.id), eq(auditLog.action, "fee.reminder"), eq(auditLog.target, String(u.id))));
    if (prior.some((r: any) => String(r.meta || "").includes(oldest.period_start))) continue;
    const lang = normalizeLang(u.preferredLanguage);
    const T = FEE_MAIL[lang];
    const end = periodEndExclusive(oldest.period_start, cadence);
    const ok = await sendEmail({
      to: u.email, senderEmail: sender,
      subject: T.subject(clubName),
      text: T.body(clubName, amount, `${oldest.period_start} → ${end}`),
    }).then(() => true).catch(() => false);
    await db.insert(auditLog).values({
      actorId: null, clubId: club.id, action: "fee.reminder", target: String(u.id),
      meta: JSON.stringify({ period_start: oldest.period_start, days_overdue: oldest.days_overdue, mailed: ok }),
    }).catch(() => {});
    if (ok) sent++;
  }
  return sent;
}
