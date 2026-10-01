// Associate fees (#32): admin overview + mark collected/uncollected.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { feePayments, auditLog, users } from "../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";
import { requireRequestClub, getClubSettings, reqDb } from "../services/club.js";
import {
  feeActive, feeCadenceOf, owingUsers, paidPeriods, periodStartFor,
  periodEndExclusive, daysOverdue, periodEnded, formatFee,
} from "../services/fees.js";

const collectSchema = z.object({
  user_id: z.string().min(1).max(50),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(200).optional().nullable(),
});

export default async function feeRoutes(fastify: FastifyInstance) {
  const admin = [fastify.authenticate, fastify.requireRole(["admin"])] as any;

  // Admin: fee status for one period (default: current). Unpaid + ended =
  // overdue; >7 days past end also counts for reminders/hard-block.
  fastify.get("/api/fees/overview", { preHandler: admin }, async (req, reply) => {
    const poolDb: any = (req as any).server.db;
    if (!poolDb) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, poolDb);
    if (!club) return;
    const db = reqDb(req) as any;
    const settings = await getClubSettings(db, club.id);
    const { todayInTz } = await import("../services/fees.js");
    const today = todayInTz(club.timezone);
    const cadence = feeCadenceOf(settings);
    const q = (req.query as any)?.period;
    const period = periodStartFor(typeof q === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : today, cadence);
    const end = periodEndExclusive(period, cadence);
    const ended = periodEnded(period, cadence, today);
    const rows = await owingUsers(db, club.id);
    const out: any[] = [];
    for (const u of rows as any[]) {
      const paid = (await paidPeriods(db, String(u.id))).has(period);
      const d = paid || !ended ? 0 : daysOverdue(period, cadence, today);
      out.push({
        id: u.id, username: u.username,
        name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.username,
        email: u.email, exempt: !!u.feeExempt, paid,
        overdue: !paid && ended, days_overdue: paid ? 0 : d,
      });
    }
    return reply.send({
      fee_cents: (settings as any)?.feeCents ?? null, fee_cadence: cadence, currency: club.currency || "EUR",
      fee_active: feeActive(settings),
      fee_display: feeActive(settings) ? formatFee(Number((settings as any).feeCents), club.currency) : null,
      notify_fee_overdue: (settings as any)?.notifyFeeOverdue ?? true,
      fee_block_booking: (settings as any)?.feeBlockBooking ?? false,
      period_start: period, period_end_exclusive: end, period_ended: ended,
      users: out,
      totals: {
        owing: out.filter((u) => !u.exempt).length,
        paid: out.filter((u) => !u.exempt && u.paid).length,
        overdue: out.filter((u) => !u.exempt && u.overdue).length,
      },
    });
  });

  // Admin: mark one user-period collected (idempotent).
  fastify.post("/api/fees/collect", { preHandler: admin }, async (req, reply) => {
    const parsed = collectSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const poolDb: any = (fastify as any).db;
    if (!poolDb) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, poolDb);
    if (!club) return;
    const db = reqDb(req) as any;
    const feeSettings = await getClubSettings(db, club.id);
    if (!feeActive(feeSettings)) return reply.status(400).send({ error: "No fee configured for this club" });
    const period = periodStartFor(parsed.data.period_start, feeCadenceOf(feeSettings));
    const target: any[] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.id, parsed.data.user_id), eq(users.clubId, club.id), isNull(users.deletedAt))).limit(1);
    if (!target[0]) return reply.status(404).send({ error: "User not found in this club" });
    await db.insert(feePayments).values({
      clubId: club.id, userId: target[0].id, periodStart: period,
      note: parsed.data.note || null, collectedBy: (req as any).user.id,
    }).onConflictDoNothing();
    try {
      await db.insert(auditLog).values({ actorId: (req as any).user.id, clubId: club.id, action: "fee.collected", target: target[0].id, meta: JSON.stringify({ period_start: period }) });
    } catch {}
    return reply.send({ ok: true, period_start: period });
  });

  // Admin: unmark (mistakes happen).
  fastify.post("/api/fees/uncollect", { preHandler: admin }, async (req, reply) => {
    const parsed = collectSchema.omit({ note: true }).safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const poolDb: any = (fastify as any).db;
    if (!poolDb) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, poolDb);
    if (!club) return;
    const db = reqDb(req) as any;
    const period = periodStartFor(parsed.data.period_start, feeCadenceOf(await getClubSettings(db, club.id)));
    await db.delete(feePayments).where(and(eq(feePayments.clubId, club.id), eq(feePayments.userId, parsed.data.user_id), eq(feePayments.periodStart, period)));
    try {
      await db.insert(auditLog).values({ actorId: (req as any).user.id, clubId: club.id, action: "fee.uncollected", target: parsed.data.user_id, meta: JSON.stringify({ period_start: period }) });
    } catch {}
    return reply.send({ ok: true, period_start: period });
  });
}
