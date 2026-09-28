import type { FastifyRequest, FastifyReply } from "fastify";
import { clubs, appSettings } from "../db/schema.js";
import { eq } from "drizzle-orm";

export const ALL_LOCALES = ["it", "en", "fr", "de", "es"] as const;

export const RESERVED_SLUGS = new Set([
  "api", "health", "assets", "club", "clubs", "admin", "login", "register",
  "me", "profile", "platform", "demo", "clubs-list", "static",
]);

export function slugify(name: string): string {
  const base = String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "club";
  return base;
}

export function validateSlug(slug: string): string | null {
  if (!/^[a-z0-9-]{3,50}$/.test(slug)) return "slug must match ^[a-z0-9-]{3,50}$";
  if (slug.startsWith("demo-")) return "slug prefix demo- is reserved for demo runs";
  if (RESERVED_SLUGS.has(slug)) return "slug is reserved";
  return null;
}

export function validTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Club slug from X-Club-Slug header → ?slug= query → body.club_slug. */
export function resolveClubSlug(req: FastifyRequest): string | null {
  const h = (req.headers as any)["x-club-slug"];
  if (typeof h === "string" && h.trim()) return h.trim().toLowerCase();
  const q = (req.query as any)?.slug;
  if (typeof q === "string" && q.trim()) return q.trim().toLowerCase();
  const b = (req.body as any)?.club_slug;
  if (typeof b === "string" && b.trim()) return b.trim().toLowerCase();
  return null;
}

/** Load club by slug. Replies 404/403 on failure, returns null. */
export async function requireClub(req: FastifyRequest, reply: FastifyReply, db: any, slug: string | null) {
  if (!slug) {
    reply.status(400).send({ error: "club_slug required" });
    return null;
  }
  const rows = await db.select().from(clubs).where(eq(clubs.slug, slug)).limit(1);
  const club = rows[0];
  if (!club) {
    reply.status(404).send({ error: "Unknown club" });
    return null;
  }
  if (!club.isActive) {
    reply.status(403).send({ error: "Club suspended" });
    return null;
  }
  await attachClubClient(req, { clubId: club.id });
  return club;
}

/**
 * Cross-check JWT against the resolved club. Superadmin has NO implicit
 * access (must impersonate via a live grant — see grant endpoints).
 * Impersonated sessions (role admin + imp claim) re-verify the grant row,
 * so revocation ends the session immediately. Replies 403, returns false.
 */
export async function assertClubAccess(req: FastifyRequest, reply: FastifyReply, club: any): Promise<boolean> {
  const user = (req as any).user;
  if (!user) {
    reply.status(401).send({ error: "Unauthorized" });
    return false;
  }
  if (user.role === "superadmin") {
    reply.status(403).send({ error: "Impersonation grant required" });
    return false;
  }
  if (!user.clubId || user.clubId !== club.id) {
    reply.status(403).send({ error: "Cross-club access denied" });
    return false;
  }
  if (user.imp) {
    try {
      const db: any = (req as any).server?.db;
      const { impersonationGrants } = await import("../db/schema.js");
      const { eq, and, isNull } = await import("drizzle-orm");
      const rows = await db.select().from(impersonationGrants).where(
        and(
          eq(impersonationGrants.id, user.imp),
          eq(impersonationGrants.clubId, club.id),
          eq(impersonationGrants.superadminId, user.id),
          isNull(impersonationGrants.revokedAt)
        )
      ).limit(1);
      const g = rows[0];
      if (!g || new Date(g.expiresAt).getTime() < Date.now()) {
        reply.status(403).send({ error: "Impersonation expired or revoked" });
        return false;
      }
    } catch (e) {
      reply.status(403).send({ error: "Impersonation check failed" });
      return false;
    }
  }
  return true;
}

/**
 * Authed-route club resolution: explicit slug (header/query) wins and is
 * cross-checked against the JWT; without a slug the JWT's own club is used
 * (transitional path until the frontend always sends X-Club-Slug).
 * Replies 4xx on failure, returns null.
 */
export async function requireRequestClub(req: FastifyRequest, reply: FastifyReply, db: any) {
  const user = (req as any).user;
  const slug = resolveClubSlug(req);
  if (slug) {
    const club = await requireClub(req, reply, db, slug);
    if (!club) return null;
    if (!(await assertClubAccess(req, reply, club))) return null;
    return club;
  }
  if (user?.role === "superadmin") {
    reply.status(400).send({ error: "club_slug required" });
    return null;
  }
  if (!user?.clubId) {
    reply.status(401).send({ error: "Unauthorized" });
    return null;
  }
  const rows = await db.select().from(clubs).where(eq(clubs.id, user.clubId)).limit(1);
  const club = rows[0];
  if (!club || !club.isActive) {
    reply.status(401).send({ error: "Club unavailable" });
    return null;
  }
  await attachClubClient(req, { clubId: club.id });
  return club;
}

/** Per-club settings row (replaces the old WHERE id = 1 reads). */
export async function getClubSettings(db: any, clubId: string) {
  const rows = await db.select().from(appSettings).where(eq(appSettings.clubId, clubId)).limit(1);
  return rows[0] ?? null;
}

/** Platform setting (superadmin-maintained, e.g. base_url). */
export async function getPlatformSetting(db: any, key: string): Promise<string | null> {
  try {
    const { platformSettings } = await import("../db/schema.js");
    const rows = await db.select().from(platformSettings).where(eq(platformSettings.key, key)).limit(1);
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

export async function setPlatformSetting(db: any, key: string, value: string | null) {
  const { platformSettings } = await import("../db/schema.js");
  await db.insert(platformSettings).values({ key, value, updatedAt: new Date() }).onConflictDoUpdate({
    target: [platformSettings.key],
    set: { value, updatedAt: new Date() },
  });
}

export function clubLocales(settings: any): { enabled: string[]; def: string } {
  const enabled = Array.isArray(settings?.enabledLocales) && settings.enabledLocales.length > 0
    ? settings.enabledLocales
    : [...ALL_LOCALES];
  const def = typeof settings?.defaultLocale === "string" && enabled.includes(settings.defaultLocale)
    ? settings.defaultLocale
    : enabled[0];
  return { enabled, def };
}

// ---------------------------------------------------------------------------
// Phase 4 RLS: per-request database scope.
//
// Runtime connects as a NON-OWNER app role; RLS policies deny tenant rows
// unless the request-scoped GUC matches. Owners (migrations, seeds, dashboard)
// bypass RLS by design — never use FORCE.
//
// attachClubClient() checks out one pooled connection, opens a transaction and
// SET LOCALs the GUC. All subsequent queries on the returned drizzle instance
// run inside that transaction. app.ts commits + releases onResponse.
// Without attach, reqDb() falls back to the pool (fail-open for trust-root
// paths that carry their own credential checks: auth, webhook bootstrap).
// ---------------------------------------------------------------------------

export async function attachClubClient(req: any, opts: { clubId?: string | null; superadmin?: boolean }) {
  if (req.clubDb) return req.clubDb;
  const pool = req.server?.pool;
  if (!pool) return null;
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (opts.superadmin) await client.query("SET LOCAL app.superadmin = '1'");
      else if (opts.clubId) await client.query(`SET LOCAL app.club_id = '${String(opts.clubId).replace(/'/g, "''")}'`);
      // else: fail-closed — no GUC, tenant tables deny.
      const { drizzle } = await import("drizzle-orm/node-postgres");
      const schema = await import("../db/schema.js");
      req.clubDb = drizzle(client, { schema });
      req.clubClient = client;
      return req.clubDb;
    } catch (e) {
      try { client.release(); } catch {}
      req.log?.warn?.(e, "attachClubClient failed, falling back to pool");
      return null;
    }
  } catch (e) {
    req.log?.warn?.(e, "attachClubClient checkout failed, falling back to pool");
    return null;
  }
}

/** Request-scoped drizzle (RLS GUC set) or the pool fallback. */
export function reqDb(req: any) {
  return req.clubDb ?? req.server?.db;
}

/** Superadmin request scope (platform routes). Call after requireSuperadmin. */
export async function attachSuperadmin(req: any) {
  return attachClubClient(req, { superadmin: true });
}

/**
 * Self-managed club scope for fire-and-forget / background work (notifications,
 * cron): checks out a pooled client, sets the GUC, runs fn, commits + releases.
 * Pass a pool drizzle (createDb flag) — transaction clients pass through.
 */
export async function withClubScope(poolDb: any, clubId: string | null | undefined, fn: (cx: any) => Promise<any>) {
  if (!poolDb?.__isPool || !clubId) return fn(poolDb);
  const pool = poolDb.__pool;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL app.club_id = '${String(clubId).replace(/'/g, "''")}'`);
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const schema = await import("../db/schema.js");
    const cx = drizzle(client, { schema });
    try {
      const out = await fn(cx);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      throw e;
    }
  } finally {
    try { client.release(); } catch {}
  }
}

/** Self-managed superadmin scope (cron cleanup). */
export async function withSuperadminScope(poolDb: any, fn: (cx: any) => Promise<any>) {
  if (!poolDb?.__isPool) return fn(poolDb);
  const pool = poolDb.__pool;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL app.superadmin = '1'");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const schema = await import("../db/schema.js");
    const cx = drizzle(client, { schema });
    try {
      const out = await fn(cx);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      throw e;
    }
  } finally {
    try { client.release(); } catch {}
  }
}
