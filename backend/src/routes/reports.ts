import type { FastifyInstance } from "fastify";
import { bookings, users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireRequestClub, reqDb } from "../services/club.js";

export default async function reportsRoutes(fastify: FastifyInstance) {
  fastify.get("/api/reports/bookings", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    let db: any = (fastify as any).db ?? (fastify as any).server?.db;
    if (!db) return reply.send({ period: "weekly", overall: 0, byUser: [], cancellationsByUser: [], timeline: [] });

    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const { period, date } = (req.query as any) || {};
    const p = ["weekly", "monthly", "yearly"].includes(period) ? period : "weekly";
    const tz = club.timezone;
    const refStr = (date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toLocaleDateString("en-CA", { timeZone: tz }));
    let startStr: string;
    let endStr: string;
    if (p === "weekly") {
      // Monday-Sunday week containing refStr
      const d = new Date(refStr + "T12:00:00Z");
      const day = d.getUTCDay(); // 0 Sun .. 6 Sat
      const diffToMon = (day + 6) % 7; // days since Monday
      const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - diffToMon);
      const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
      startStr = mon.toISOString().slice(0, 10);
      endStr = sun.toISOString().slice(0, 10);
    } else if (p === "monthly") {
      startStr = refStr.slice(0, 7) + "-01";
      const y = Number(refStr.slice(0, 4)); const m = Number(refStr.slice(5, 7));
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      endStr = `${refStr.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
    } else {
      startStr = refStr.slice(0, 4) + "-01-01";
      endStr = refStr.slice(0, 4) + "-12-31";
    }

    const allBookings: any[] = await db.select().from(bookings).where(eq(bookings.clubId, club.id));
    const periodBookings = allBookings.filter((b: any) => b.date >= startStr && b.date <= endStr);

    // Timeline for chart: last N periods ending at ref period
    let timeline: Array<{ label: string; startDate: string; endDate: string; count: number }> = [];
    if (p === "weekly") {
      const refMon = new Date(startStr + "T12:00:00Z");
      for (let i = 7; i >= 0; i--) {
        const mon = new Date(refMon); mon.setUTCDate(refMon.getUTCDate() - i * 7);
        const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
        const s = mon.toISOString().slice(0, 10); const e = sun.toISOString().slice(0, 10);
        const cnt = allBookings.filter((b: any) => b.date >= s && b.date <= e).length;
        timeline.push({ label: s.slice(5), startDate: s, endDate: e, count: cnt }); // label MM-DD
      }
    } else if (p === "monthly") {
      const [ry, rm] = refStr.slice(0, 7).split("-").map(Number);
      for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(ry, rm - 1 - i, 1));
        const y = d.getUTCFullYear(); const m = d.getUTCMonth() + 1;
        const s = `${y}-${String(m).padStart(2, "0")}-01`;
        const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const e = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        const cnt = allBookings.filter((b: any) => b.date >= s && b.date <= e).length;
        timeline.push({ label: s.slice(0, 7), startDate: s, endDate: e, count: cnt });
      }
    } else {
      const ry = Number(refStr.slice(0, 4));
      for (let i = 3; i >= 0; i--) {
        const y = ry - i;
        const s = `${y}-01-01`; const e = `${y}-12-31`;
        const cnt = allBookings.filter((b: any) => b.date >= s && b.date <= e).length;
        timeline.push({ label: String(y), startDate: s, endDate: e, count: cnt });
      }
    }

    const overall = periodBookings.length;
    // Revenue from price snapshots (approved bookings only).
    const revenue_cents = periodBookings
      .filter((b: any) => b.status === "approved")
      .reduce((sum: number, b: any) => sum + (Number(b.priceCents) || 0), 0);
    const byUserMap: Record<string, { count: number; username?: string }> = {};
    const cancellationsMap: Record<string, { count: number; username?: string }> = {};

    // Build username map (club users only)
    let usernameById: Record<string, string> = {};
    try {
      const userRows: any[] = await db.select().from(users).where(eq(users.clubId, club.id));
      for (const u of userRows) usernameById[String(u.id)] = u.username;
    } catch {}

    for (const b of periodBookings) {
      const uid = String(b.userId);
      const uname = usernameById[uid] || String(b.userId).slice(0, 8);
      if (!byUserMap[uid]) byUserMap[uid] = { count: 0, username: uname };
      byUserMap[uid].count++;
      if (b.status === "cancelled") {
        if (!cancellationsMap[uid]) cancellationsMap[uid] = { count: 0, username: uname };
        cancellationsMap[uid].count++;
      }
    }

    const byUser = Object.entries(byUserMap)
      .map(([userId, v]) => ({ userId, username: v.username, count: v.count }))
      .sort((a, b) => b.count - a.count);
    const cancellationsByUser = Object.entries(cancellationsMap)
      .map(([userId, v]) => ({ userId, username: v.username, count: v.count }))
      .sort((a, b) => b.count - a.count);

    return reply.send({ period: p, refDate: refStr, startDate: startStr, endDate: endStr, overall, revenue_cents, byUser, cancellationsByUser, timeline });
  });
}
