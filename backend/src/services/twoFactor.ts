import { randomInt, createHash, timingSafeEqual } from "crypto";

// Superadmin 2FA: Telegram-delivered OTP. Secrets live in env
// (SUPERADMIN_TELEGRAM_BOT_TOKEN / SUPERADMIN_TELEGRAM_CHAT_ID — Render
// secrets in prod). Non-prod without secrets logs the code loudly instead.

export const TWO_FA_TTL_MS = 10 * 60 * 1000;
export const TWO_FA_MAX_ATTEMPTS = 5;

function secrets() {
  return {
    botToken: process.env.SUPERADMIN_TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.SUPERADMIN_TELEGRAM_CHAT_ID || "",
  };
}

function hashCode(code: string): string {
  return createHash("sha256").update(String(code)).digest("hex");
}

/** Start a challenge: persist + deliver the OTP. Returns challenge meta. */
export async function startChallenge(db: any, user: any) {
  const { botToken, chatId } = secrets();
  if (!botToken || !chatId) {
    if (process.env.NODE_ENV === "production") {
      throw Object.assign(new Error("2FA not configured"), { statusCode: 501 });
    }
    // Dev convenience only: log instead of sending (never in production).
    console.warn("[2fa] Telegram secrets unset — dev mode, code logged, NOT sent");
  }
  const { loginChallenges } = await import("../db/schema.js");
  const { eq, and, isNull } = await import("drizzle-orm");
  // Single outstanding challenge: drop stale ones.
  await db.delete(loginChallenges).where(eq(loginChallenges.userId, user.id));
  const code = String(randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + TWO_FA_TTL_MS);
  const [row] = await db.insert(loginChallenges).values({
    userId: user.id, codeHash: hashCode(code), expiresAt,
  }).returning();
  if (botToken && chatId) {
    const { sendTelegramMessage } = await import("./notifications.js");
    const ok = await sendTelegramMessage(botToken, chatId, `🔐 Bagel Club platform login code: ${code} (valid 10 minutes)`);
    if (!ok) throw Object.assign(new Error("Could not deliver 2FA code"), { statusCode: 502 });
  } else {
    console.warn(`[2fa] DEV ONLY code for ${user.email}: ${code}`);
  }
  return { challengeId: row.id, expiresAt: expiresAt.toISOString() };
}

export function verifyCodeFormat(code: any): boolean {
  return typeof code === "string" && /^\d{6}$/.test(code);
}

/** Verify a code. Returns the challenge row on success; throws 401 otherwise. */
export async function verifyChallenge(db: any, userId: string, challengeId: string, code: string) {
  const fail = () => Object.assign(new Error("Invalid or expired code"), { statusCode: 401 });
  if (!verifyCodeFormat(code)) throw fail();
  const { loginChallenges } = await import("../db/schema.js");
  const { eq, and, isNull } = await import("drizzle-orm");
  const rows = await db.select().from(loginChallenges).where(
    and(eq(loginChallenges.id, challengeId), eq(loginChallenges.userId, userId), isNull(loginChallenges.consumedAt))
  ).limit(1);
  const ch = rows[0];
  if (!ch || new Date(ch.expiresAt).getTime() < Date.now()) throw fail();
  if ((ch.attempts ?? 0) >= TWO_FA_MAX_ATTEMPTS) {
    await db.delete(loginChallenges).where(eq(loginChallenges.id, challengeId));
    throw fail();
  }
  await db.update(loginChallenges).set({ attempts: (ch.attempts ?? 0) + 1 }).where(eq(loginChallenges.id, challengeId));
  let match = false;
  try {
    const a = Buffer.from(hashCode(code), "hex");
    const b = Buffer.from(String(ch.codeHash), "hex");
    match = a.length === b.length && timingSafeEqual(a, b);
  } catch { match = false; }
  if (!match) throw fail();
  await db.update(loginChallenges).set({ consumedAt: new Date() }).where(eq(loginChallenges.id, challengeId));
  return ch;
}
