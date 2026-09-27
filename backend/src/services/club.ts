import type { FastifyRequest, FastifyReply } from "fastify";
import { clubs, appSettings } from "../db/schema.js";
import { eq } from "drizzle-orm";

export const ALL_LOCALES = ["it", "en", "fr", "de", "es"] as const;

export const RESERVED_SLUGS = new Set([
  "api", "health", "assets", "c", "clubs", "admin", "login", "register",
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
  return club;
}

/**
 * Cross-check JWT against the resolved club. Superadmin bypasses club scope.
 * Replies 403 on mismatch, returns false.
 */
export function assertClubAccess(req: FastifyRequest, reply: FastifyReply, club: any): boolean {
  const user = (req as any).user;
  if (!user) {
    reply.status(401).send({ error: "Unauthorized" });
    return false;
  }
  if (user.role === "superadmin") return true;
  if (!user.clubId || user.clubId !== club.id) {
    reply.status(403).send({ error: "Cross-club access denied" });
    return false;
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
    if (!assertClubAccess(req, reply, club)) return null;
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
  return club;
}

/** Per-club settings row (replaces the old WHERE id = 1 reads). */
export async function getClubSettings(db: any, clubId: string) {
  const rows = await db.select().from(appSettings).where(eq(appSettings.clubId, clubId)).limit(1);
  return rows[0] ?? null;
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
