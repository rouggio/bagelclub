import type { FastifyInstance } from "fastify";
import { sendTelegramMessage, sendWhatsAppMessage } from "../services/notifications.js";
import { BRAND_NAME } from "../config/brand.js";
import { requireRequestClub, getClubSettings } from "../services/club.js";

export default async function notificationRoutes(fastify: FastifyInstance) {
  fastify.post("/api/notifications/test", { preHandler: [fastify.authenticate, fastify.requireRole(["admin"])] }, async (req, reply) => {
    const db: any = (fastify as any).db;
    const { channel, to } = (req as any).body as any; // channel: 'telegram' | 'whatsapp', to optional override
    const club = await requireRequestClub(req, reply, db);
    if (!club) return;
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
    return reply.send(result);
  });
}
