import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

// Abuse shield (#13): brute-force logins, URL-mangling probes, 404 scans,
// request bursts. In-memory sliding windows feed a persistent ip_blocks table
// (survives restarts, visible to platform admin). Single-instance MVP:
// windows are per-process; DB blocks are shared.

// URL-mangling / scanner probes (matched against the raw URL, case-insensitive).
const PROBE_PATTERNS = [
  /\.\.\//, /\.\.(%2f|%5c|\\|\/)/i, /%2e%2e/i, /%252e/i,
  /wp-admin/i, /wp-login/i, /wordpress/i, /xmlrpc/i,
  /\.php($|\?)/i, /\.env($|\/)/i, /\.git\//i,
  /\/etc\/passwd/i, /proc\/self/i,
  /<script/i, /union\s+select/i, /boot\.ini/i,
];

export function isProbe(url: string): boolean {
  const u = String(url || "");
  return PROBE_PATTERNS.some((p) => p.test(u));
}

// Thresholds: [maxEvents, windowMs, blockMs].
export const LIMITS = {
  loginFail: { max: 10, windowMs: 10 * 60 * 1000, blockMs: 60 * 60 * 1000 },
  probe: { max: 5, windowMs: 5 * 60 * 1000, blockMs: 60 * 60 * 1000 },
  notFound: { max: 30, windowMs: 5 * 60 * 1000, blockMs: 30 * 60 * 1000 },
  burst: { max: 300, windowMs: 60 * 1000, blockMs: 10 * 60 * 1000 },
};

type Buckets = { loginFail: number[]; probe: number[]; notFound: number[]; burst: number[] };
const windows = new Map<string, Buckets>();
const memoryBlocks = new Map<string, number>(); // ip -> expiresAt ms

function bucket(ip: string): Buckets {
  let b = windows.get(ip);
  if (!b) {
    b = { loginFail: [], probe: [], notFound: [], burst: [] };
    windows.set(ip, b);
  }
  return b;
}

function prune(list: number[], windowMs: number, now: number): number[] {
  return list.filter((t) => now - t < windowMs);
}

/** Pure: given event timestamps, is the limit hit? (unit-tested) */
export function shouldBlock(events: number[], max: number, windowMs: number, now = Date.now()): boolean {
  return prune(events, windowMs, now).length >= max;
}

async function dbBlocked(db: any, ip: string): Promise<string | null> {
  if (!db) return null;
  try {
    const { ipBlocks } = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(ipBlocks).where(eq(ipBlocks.ip, ip)).limit(1);
    const row = rows[0];
    if (!row) return null;
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      try { await db.delete(ipBlocks).where(eq(ipBlocks.ip, ip)); } catch {}
      return null;
    }
    return row.reason;
  } catch {
    return null; // table missing (pre-0017 DB) → memory only
  }
}

export async function isBlocked(db: any, ip: string): Promise<string | null> {
  const mem = memoryBlocks.get(ip);
  if (mem && mem > Date.now()) return "memory";
  if (mem) memoryBlocks.delete(ip);
  return dbBlocked(db, ip);
}

async function block(db: any, ip: string, reason: string, blockMs: number) {
  memoryBlocks.set(ip, Date.now() + blockMs);
  if (!db) return;
  try {
    const { ipBlocks } = await import("../db/schema.js");
    await db.insert(ipBlocks).values({ ip, reason, expiresAt: new Date(Date.now() + blockMs) }).onConflictDoUpdate({
      target: [ipBlocks.ip],
      set: { reason, expiresAt: new Date(Date.now() + blockMs) },
    });
  } catch {}
}

/** Record one event; returns true when it trips a block. */
export async function noteEvent(db: any, ip: string, kind: keyof Buckets): Promise<boolean> {
  if (!ip) return false;
  const now = Date.now();
  const b = bucket(ip);
  const lim = LIMITS[kind === "loginFail" ? "loginFail" : kind === "probe" ? "probe" : kind === "notFound" ? "notFound" : "burst"];
  b[kind] = prune(b[kind], lim.windowMs, now);
  b[kind].push(now);
  if (b[kind].length >= lim.max) {
    b[kind] = [];
    await block(db, ip, kind, lim.blockMs);
    return true;
  }
  return false;
}

export function clientIp(req: FastifyRequest): string {
  const fwd = (req.headers as any)["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return (req as any).ip || (req as any).socket?.remoteAddress || "unknown";
}

export async function unblockIp(db: any, ip: string) {
  memoryBlocks.delete(ip);
  if (!db) return;
  try {
    const { ipBlocks } = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");
    await db.delete(ipBlocks).where(eq(ipBlocks.ip, ip));
  } catch {}
}

export default fp(async function abusePlugin(fastify: FastifyInstance) {
  fastify.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const db: any = (fastify as any).db;
    const ip = clientIp(req);
    if (await isBlocked(db, ip)) {
      return reply.status(403).send({ error: "IP blocked" });
    }
    const raw = (req as any).raw?.url || req.url;
    if (isProbe(raw)) {
      if (await noteEvent(db, ip, "probe")) {
        return reply.status(403).send({ error: "IP blocked" });
      }
    }
    await noteEvent(db, ip, "burst").catch(() => false);
  });

  // NOTE: onSend (not onResponse) — it runs before the response completes,
  // so counting is settled before the next request can arrive (no race).
  fastify.addHook("onSend", async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    try {
      const db: any = (fastify as any).db;
      const ip = clientIp(req);
      const status = reply.statusCode;
      if ((req.url.startsWith("/api/auth/login") || req.url.startsWith("/api/auth/verify-2fa")) && status === 401) {
        await noteEvent(db, ip, "loginFail");
      } else if (status === 404 && req.url.startsWith("/api/")) {
        await noteEvent(db, ip, "notFound");
      }
    } catch {}
    return payload;
  });
});
