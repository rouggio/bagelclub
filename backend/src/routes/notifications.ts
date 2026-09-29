import type { FastifyInstance } from "fastify";
import { sendTelegramMessage, sendWhatsAppMessage } from "../services/notifications.js";
import { BRAND_NAME } from "../config/brand.js";
import { requireRequestClub, getClubSettings, reqDb } from "../services/club.js";

export default async function notificationRoutes(fastify: FastifyInstance) {
  fastify.post("/api/notifications/test", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    let db: any = (fastify as any).db;
    const { channel, to } = (req as any).body as any; // channel: 'telegram' | 'whatsapp', to optional override
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
    db = reqDb(req) as any;
    const s = db ? await getClubSettings(db, club.id) : null;
    // Strictly per-club credentials — no env fallbacks.
    const telegramBotToken = s?.telegramBotToken || "";
    const telegramAdminChatId = to || s?.telegramAdminChatId || "";
    const whatsappToken = s?.whatsappToken || "";
    const whatsappPhoneNumberId = s?.whatsappPhoneNumberId || "";
    const whatsappAdminPhone = to || s?.whatsappAdminPhone || "";
    const clubName = s?.clubName || club.name || BRAND_NAME;
    const text = `🔔 ${clubName} — Test notification from ${BRAND_NAME} (${new Date().toISOString()})`;

    let result: any = {};
    if (!channel || channel === "telegram") {
      if (!telegramBotToken || !telegramAdminChatId) {
        result.telegram = { ok: false, error: "Missing telegram_bot_token or telegram_admin_chat_id (club settings)" };
      } else {
        const chatIds = String(telegramAdminChatId).split(",").map((v: string) => v.trim()).filter(Boolean);
        const outs: any[] = [];
        for (const cid of chatIds) {
          const ok = await sendTelegramMessage(telegramBotToken, cid, text);
          outs.push({ chatId: cid, ok });
        }
        result.telegram = outs;
      }
    }
    if (!channel || channel === "whatsapp") {
      if (!whatsappToken || !whatsappPhoneNumberId || !whatsappAdminPhone) {
        result.whatsapp = { ok: false, error: "Missing whatsapp_token / phone_number_id / admin_phone (club settings)" };
      } else {
        const waText = text.replace(/<[^>]*>/g, "");
        const ok = await sendWhatsAppMessage(whatsappPhoneNumberId, whatsappToken, whatsappAdminPhone, waText);
        result.whatsapp = { to: whatsappAdminPhone, ok };
      }
    }
    if (!channel || channel === "email") {
      // Test recipient: explicit override, else the requesting admin's email.
      const user = (req as any).user;
      let dest = to || "";
      if (!dest) {
        try {
          const { users } = await import("../db/schema.js");
          const { eq } = await import("drizzle-orm");
          const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
          dest = rows[0]?.email || "";
        } catch {}
      }
      if (!dest) {
        result.email = { ok: false, error: "No recipient: pass { to } or set your profile email" };
      } else {
        try {
          const { sendEmail } = await import("../services/email.js");
          const sender = (s as any)?.notifyEmailSender || undefined;
          await sendEmail({ to: dest, subject: `${clubName} — Test notification`, text, html: `<p>${text}</p>`, senderEmail: sender });
          result.email = { to: dest, ok: true };
        } catch (e: any) {
          result.email = { ok: false, error: e.message || "send failed" };
        }
      }
    }
    return reply.send(result);
  });
}
