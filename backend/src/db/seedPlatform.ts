import "dotenv/config";
import { createDb } from "./connection.js";
import { users } from "./schema.js";
import { eq, and, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";

const url = process.env.DATABASE_URL;
const email = (process.env.PLATFORM_ADMIN_EMAIL || "").toLowerCase();
const password = process.env.PLATFORM_ADMIN_PASSWORD || "";
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
if (!email || password.length < 16) {
  console.error("PLATFORM_ADMIN_EMAIL + PLATFORM_ADMIN_PASSWORD (min 16 chars) required");
  process.exit(1);
}

const { db, pool } = createDb(url);
const existing = await db.select({ id: users.id }).from(users)
  .where(and(eq(users.email, email), eq(users.role, "superadmin"), isNull(users.deletedAt))).limit(1);
if (existing[0]) {
  console.log("Platform admin already exists");
} else {
  const passwordHash = await bcrypt.hash(password, 10);
  await db.insert(users).values({
    clubId: null as any,
    username: "superadmin",
    email,
    passwordHash,
    firstName: "Platform",
    lastName: "Admin",
    role: "superadmin",
    isVerified: true,
  });
  console.log("Platform admin created:", email);
}
await pool.end();
