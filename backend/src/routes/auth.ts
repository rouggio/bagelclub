import type { FastifyInstance } from "fastify";
import { registerSchema, loginSchema } from "../types/schemas.js";
import bcrypt from "bcryptjs";
import { users } from "../db/schema.js";
import { eq, or, and, isNull } from "drizzle-orm";
import { resolveClubSlug, requireClub, getClubSettings, clubLocales } from "../services/club.js";

const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "7d";
const live = () => isNull(users.deletedAt);

function refreshCookieOpts() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

function signAccess(fastify: FastifyInstance, user: any, clubSlug: string | null) {
  return fastify.jwt.sign({
    id: user.id,
    username: user.username,
    role: user.role,
    clubId: user.clubId ?? null,
    preferred_language: user.preferredLanguage,
  } as any);
}

function publicUser(user: any, clubSlug: string | null) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    clubId: user.clubId ?? null,
    club_slug: clubSlug,
    preferred_language: user.preferredLanguage,
  };
}

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/api/auth/register", async (req, reply) => {
    const parsed = registerSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const { password, ...data } = parsed.data as any;
    const passwordHash = await bcrypt.hash(password, 10);

    const db: any = (fastify as any).dbOwner ?? (fastify as any).db; // trust root: credential checks run owner-side
    if (!db) {
      // No DB (dev without docker) — fallback to dummy
      const user = { id: "dev-" + Date.now(), username: data.username, role: "visitor" as const, email: data.email, clubId: null };
      const token = fastify.jwt.sign({ id: user.id, username: user.username, role: user.role, clubId: null });
      return reply.status(201).send({ user, token });
    }

    // Club first: public registration always lands in exactly one club as visitor.
    const club = await requireClub(req, reply, db, resolveClubSlug(req) ?? (data.club_slug ? String(data.club_slug).toLowerCase() : null));
    if (!club) return;
    const settings = await getClubSettings(db, club.id);
    const { enabled, def } = clubLocales(settings);
    const lang = data.preferred_language ?? def;
    if (!enabled.includes(lang)) return reply.status(400).send({ error: "preferred_language not enabled for this club" });

    try {
      const emailVal = (data.email as string | null | undefined)?.toLowerCase?.() ?? null;
      const uname = String(data.username);
      const dupName = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.clubId, club.id), eq(users.username, uname), live())).limit(1);
      if (dupName[0]) return reply.status(409).send({ error: "username or email already taken" });
      if (emailVal) {
        const dupMail = await db.select({ id: users.id }).from(users)
          .where(and(eq(users.clubId, club.id), eq(users.email, emailVal), live())).limit(1);
        if (dupMail[0]) return reply.status(409).send({ error: "username or email already taken" });
      }
      const [user] = await db
        .insert(users)
        .values({
          clubId: club.id,
          username: uname,
          email: emailVal,
          mobile: data.mobile,
          passwordHash,
          firstName: data.first_name,
          lastName: data.last_name,
          role: "visitor",
          preferredLanguage: lang,
        })
        .returning();

      const token = signAccess(fastify, user, club.slug);
      // Persistent session: httpOnly refresh cookie (7d sliding). SPA renews the
      // short-lived access token via POST /api/auth/refresh — no login needed.
      reply.setCookie?.("refresh_token", (fastify.jwt.sign as any)({ id: user.id }, { expiresIn: REFRESH_EXPIRES_IN }), refreshCookieOpts());
      return reply.status(201).send({ user: publicUser(user, club.slug), token });
    } catch (e: any) {
      if (String(e.message).includes("unique") || String(e.code) === "23505") {
        return reply.status(409).send({ error: "username or email already taken" });
      }
      req.log.error(e);
      return reply.status(500).send({ error: "Registration failed" });
    }
  });

  fastify.post("/api/auth/login", async (req, reply) => {
    const parsed = loginSchema.safeParse((req as any).body);
    if (!parsed.success) return reply.status(400).send(parsed.error.flatten());
    const { username, email, password } = parsed.data;
    const db: any = (fastify as any).dbOwner ?? (fastify as any).db; // trust root: credential checks run owner-side
    if (!db) return reply.status(501).send({ error: "DB not configured — set DATABASE_URL" });

    const slug = resolveClubSlug(req) ?? ((parsed.data as any).club_slug ? String((parsed.data as any).club_slug).toLowerCase() : null);
    const identifier = (email || username)!.toLowerCase();
    const idMatch = or(eq(users.email, identifier), eq(users.username, identifier));

    let user: any;
    let clubSlug: string | null = null;
    let club: any = null;
    if (slug) {
      // Club members (and club admins): identity resolved inside the club.
      club = await requireClub(req, reply, db, slug);
      if (!club) return;
      const rows = await db.select().from(users)
        .where(and(eq(users.clubId, club.id), idMatch, live())).limit(1);
      user = rows[0];
      if (!user && username) {
        const r2 = await db.select().from(users)
          .where(and(eq(users.clubId, club.id), eq(users.username, username), live())).limit(1);
        user = r2[0];
      }
      clubSlug = club.slug;
    } else {
      // No slug: platform superadmin login only (never a club user).
      const rows = await db.select().from(users)
        .where(and(eq(users.role, "superadmin" as any), idMatch, live())).limit(1);
      user = rows[0];
    }
    if (!user) return reply.status(401).send({ error: "Invalid credentials" });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return reply.status(401).send({ error: "Invalid credentials" });

    // Superadmin stops here: second factor (Telegram OTP) required.
    if (user.role === "superadmin") {
      const { startChallenge } = await import("../services/twoFactor.js");
      try {
        const ch = await startChallenge(db, user);
        return reply.send({ two_factor_required: true, challenge_id: ch.challengeId, expires_at: ch.expiresAt });
      } catch (e: any) {
        return reply.status(e.statusCode || 500).send({ error: e.message || "2FA failed" });
      }
    }

    // Club admins stop here too when the club enforces 2FA.
    if (user.role === "admin" && club) {
      const { getClubSettings } = await import("../services/club.js");
      const settings = await getClubSettings(db, club.id);
      if (settings?.twoFaEnabled) {
        const { startClubChallenge } = await import("../services/twoFactor.js");
        try {
          const ch = await startClubChallenge(db, club, user, "login");
          return reply.send({ two_factor_required: true, challenge_id: ch.challengeId, expires_at: ch.expiresAt });
        } catch (e: any) {
          return reply.status(e.statusCode || 500).send({ error: e.message || "2FA failed" });
        }
      }
    }

    const token = signAccess(fastify, user, clubSlug);
    reply.setCookie?.("refresh_token", (fastify.jwt.sign as any)({ id: user.id }, { expiresIn: REFRESH_EXPIRES_IN }), refreshCookieOpts());
    return reply.send({ user: publicUser(user, clubSlug), token });
  });

  // Silent session renewal: verifies the httpOnly refresh cookie (NOT the access
  // token — the old auth-gated version could never renew an expired session),
  // issues a fresh 15m access token and rotates the cookie (7d sliding window).
  fastify.post("/api/auth/refresh", async (req, reply) => {
    const db: any = (fastify as any).dbOwner ?? (fastify as any).db; // trust root: credential checks run owner-side
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const raw = (req as any).cookies?.refresh_token;
    if (!raw) return reply.status(401).send({ error: "No refresh session" });
    let payload: any;
    try {
      payload = fastify.jwt.verify(raw);
    } catch {
      return reply.status(401).send({ error: "Refresh expired — please login again" });
    }
    const rows = await db.select().from(users).where(and(eq(users.id, payload.id), live())).limit(1);
    const user = rows[0];
    if (!user) return reply.status(401).send({ error: "User not found" });
    let clubSlug: string | null = null;
    if (user.clubId) {
      const { clubs } = await import("../db/schema.js");
      const crows = await db.select().from(clubs).where(eq(clubs.id, user.clubId)).limit(1);
      if (!crows[0] || !crows[0].isActive) return reply.status(401).send({ error: "Club unavailable" });
      clubSlug = crows[0].slug;
    }
    const token = signAccess(fastify, user, clubSlug);
    reply.setCookie?.("refresh_token", (fastify.jwt.sign as any)({ id: user.id }, { expiresIn: REFRESH_EXPIRES_IN }), refreshCookieOpts());
    return reply.send({ token, user: publicUser(user, clubSlug) });
  });

  fastify.post("/api/auth/logout", async (_req, reply) => {
    reply.clearCookie?.("refresh_token", { path: "/" });
    return reply.send({ ok: true });
  });

  // Step 2 of 2FA login: verify the OTP → full session (superadmin or club admin).
  fastify.post("/api/auth/verify-2fa", async (req, reply) => {
    const { challenge_id, code } = ((req as any).body as any) || {};
    if (!challenge_id || code === undefined) return reply.status(400).send({ error: "challenge_id + code required" });
    const db: any = (fastify as any).dbOwner ?? (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const { verifyChallenge } = await import("../services/twoFactor.js");
    // Resolve the challenge's owner first (trust root: exact id match).
    const { loginChallenges } = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const chRows = await db.select().from(loginChallenges).where(eq(loginChallenges.id, challenge_id)).limit(1);
    if (!chRows[0]) return reply.status(401).send({ error: "Invalid or expired code" });
    const uRows = await db.select().from(users).where(and(eq(users.id, chRows[0].userId), isNull(users.deletedAt))).limit(1);
    const user = uRows[0];
    if (!user || !["superadmin", "admin"].includes(user.role)) return reply.status(401).send({ error: "Invalid or expired code" });
    let clubSlug: string | null = null;
    if (user.role === "admin") {
      // Club admins complete 2FA only while their club enforces it.
      if (!user.clubId) return reply.status(401).send({ error: "Invalid or expired code" });
      const { getClubSettings } = await import("../services/club.js");
      const { clubs } = await import("../db/schema.js");
      const settings = await getClubSettings(db, user.clubId);
      if (!settings?.twoFaEnabled) return reply.status(401).send({ error: "Invalid or expired code" });
      const crows = await db.select().from(clubs).where(eq(clubs.id, user.clubId)).limit(1);
      if (!crows[0] || !crows[0].isActive) return reply.status(401).send({ error: "Club unavailable" });
      clubSlug = crows[0].slug;
    }
    try {
      await verifyChallenge(db, user.id, challenge_id, code);
    } catch (e: any) {
      return reply.status(401).send({ error: "Invalid or expired code" });
    }
    const token = signAccess(fastify, user, clubSlug);
    reply.setCookie?.("refresh_token", (fastify.jwt.sign as any)({ id: user.id }, { expiresIn: REFRESH_EXPIRES_IN }), refreshCookieOpts());
    return reply.send({ user: publicUser(user, clubSlug), token });
  });
}
