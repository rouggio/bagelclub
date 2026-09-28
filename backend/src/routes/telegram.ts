import type { FastifyInstance } from "fastify";
import { users, telegramLinkTokens } from "../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";
import { randomBytes } from "crypto";
import { sendTelegramMessage } from "../services/notifications.js";
import { BRAND_NAME, TELEGRAM_BOT_USERNAME_FALLBACK } from "../config/brand.js";
import { requireRequestClub, getClubSettings, reqDb, attachClubClient } from "../services/club.js";

async function getBotUsername(botToken: string): Promise<string> {
  if (!botToken) return TELEGRAM_BOT_USERNAME_FALLBACK;
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const j: any = await r.json().catch(() => null);
    if (j?.ok && j.result?.username) return j.result.username;
  } catch {}
  return TELEGRAM_BOT_USERNAME_FALLBACK;
}

/** This club's bot token — strictly per-club settings, no env fallback. */
async function clubBotToken(db: any, clubId: string): Promise<string> {
  try {
    const s = await getClubSettings(db, clubId);
    return s?.telegramBotToken || "";
  } catch {
    return "";
  }
}

export default async function telegramRoutes(fastify: FastifyInstance) {
  // POST /api/telegram/link -> create short token and return deep link
  fastify.post("/api/telegram/link", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    let db: any = (fastify as any).db;
    if (!db) return reply.status(501).send({ error: "DB not configured" });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req);
    const user = (req as any).user;
    const botToken = await clubBotToken(db, club.id);
    const username = await getBotUsername(botToken);
    const token = randomBytes(16).toString("hex"); // 32 chars
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    try {
      await db.insert(telegramLinkTokens).values({ token, clubId: club.id, userId: user.id, expiresAt });
    } catch (e: any) {
      return reply.status(500).send({ error: "Could not create link" });
    }
    // cleanup expired tokens
    try { await db.delete(telegramLinkTokens).where(eq(telegramLinkTokens.expiresAt, new Date(0))); } catch {}
    const url = `https://t.me/${username}?start=${token}`;
    return reply.send({ url, token, username, expires_at: expiresAt.toISOString() });
  });

  // GET /api/telegram/status -> whether linked
  fastify.get("/api/telegram/status", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    let db: any = (fastify as any).db;
    if (!db) return reply.send({ linked: false });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req);
    const user = (req as any).user;
    const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    const linked = !!rows[0]?.telegramChatId;
    return reply.send({ linked, telegram_chat_id: linked ? String(rows[0].telegramChatId) : null });
  });

  // POST /api/telegram/unlink
  fastify.post("/api/telegram/unlink", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    let db: any = (fastify as any).db;
    if (!db) return reply.send({ ok: true });
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req);
    const user = (req as any).user;
    await db.update(users).set({ telegramChatId: null } as any).where(eq(users.id, user.id));
    return reply.send({ ok: true, linked: false });
  });

  // POST /api/telegram/webhook -> Telegram calls this when user sends /start.
  // Club routing: the link token encodes (club_id, user_id); every bot-token
  // lookup below is scoped to the token's club. A token-less /start or an
  // unknown token cannot be routed to any club → silent ok.
  fastify.post("/api/telegram/webhook", async (req, reply) => {
    // Trust-root bootstrap: the link token IS the credential (exact match,
    // owner-side). Everything after routes to the token's club.
    const ownerDb: any = (fastify as any).dbOwner ?? (fastify as any).db;
    const body: any = (req as any).body;
    // Telegram update structure: { message: { chat: {id}, text: "/start <token>" } }
    const message = body?.message || body?.edited_message;
    if (!message?.chat?.id || !message?.text) {
      return reply.send({ ok: true });
    }
    const chatId = String(message.chat.id);
    const text: string = String(message.text).trim();
    // only handle /start <token>
    const m = text.match(/^\/start\s+([a-f0-9]{32})/i);
    if (!m) return reply.send({ ok: true });
    const token = m[1].toLowerCase();
    if (!ownerDb) return reply.send({ ok: true });
    // find token (owner-side trust root)
    const rows = await ownerDb.select().from(telegramLinkTokens).where(eq(telegramLinkTokens.token, token)).limit(1);
    const link = rows[0];
    if (!link) return reply.send({ ok: true }); // expired or invalid — unroutable, stay silent
    // From here the token's club scopes everything (RLS-attached client).
    await attachClubClient(req, { clubId: link.clubId });
    const db: any = reqDb(req);
    const botToken = await clubBotToken(db, link.clubId);
    if (new Date(link.expiresAt) < new Date()) {
      await db.delete(telegramLinkTokens).where(eq(telegramLinkTokens.token, token));
      if (botToken) await sendTelegramMessage(botToken, chatId, "Link expired. Please generate a new one from your Profile.");
      return reply.send({ ok: true });
    }
    // link user (must still be a live member of the token's club)
    const uRows = await db.select().from(users)
      .where(and(eq(users.id, link.userId), eq(users.clubId, link.clubId), isNull(users.deletedAt))).limit(1);
    if (!uRows[0]) {
      await db.delete(telegramLinkTokens).where(eq(telegramLinkTokens.token, token));
      return reply.send({ ok: true });
    }
    await db.update(users).set({ telegramChatId: chatId } as any).where(eq(users.id, link.userId));
    await db.delete(telegramLinkTokens).where(eq(telegramLinkTokens.token, token));
    // confirm
    if (botToken) await sendTelegramMessage(botToken, chatId, `✅ Telegram linked to your ${BRAND_NAME} account! You'll receive booking approvals/rejections here.`);
    return reply.send({ ok: true });
  });
}
