import "dotenv/config";
import { createDb } from "./connection.js";
import { clubs, courts, timetables, users, appSettings } from "./schema.js";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const { db, pool } = createDb(url);

// Seed club (single-club default)
await db.insert(clubs).values({ slug: "green-village", name: "Green Village", timezone: "Europe/Rome" }).onConflictDoNothing();
const clubRows = await db.select().from(clubs).where(eq(clubs.slug, "green-village")).limit(1);
const clubId = clubRows[0].id;

// Ensure per-club app_settings row
await db.insert(appSettings).values({ clubId }).onConflictDoNothing();

// Seed courts 1-4
const seedCourts = [
  { number: 1, type: "tennis" as const, name: "Central Tennis", surface: "clay" },
  { number: 2, type: "tennis" as const, name: "Tennis 2", surface: "synthetic" },
  { number: 3, type: "padel" as const, name: "Padel 1", surface: "synthetic" },
  { number: 4, type: "padel" as const, name: "Padel 2", surface: "synthetic" },
];

for (const c of seedCourts) {
  await db.insert(courts).values({ ...c, clubId }).onConflictDoNothing();
}

// Default timetable: 08:00-22:00, padel 90 min, tennis 60 min
const allCourts = await db.select().from(courts).where(eq(courts.clubId, clubId));
for (const court of allCourts) {
  const slot = court.type === "padel" ? 90 : 60;
  for (let dow = 0; dow <= 6; dow++) {
    await db
      .insert(timetables)
      .values({
        courtId: court.id,
        dayOfWeek: dow,
        openTime: "08:00",
        closeTime: "22:00",
        slotDurationMinutes: slot,
        isClosed: false,
      })
      .onConflictDoNothing();
  }
}

// Admin user (admin / admin123!)
const adminHash = await bcrypt.hash("admin123!", 10);
await db
  .insert(users)
  .values({
    clubId,
    username: "admin",
    email: "admin@bagelclub.local",
    passwordHash: adminHash,
    firstName: "Admin",
    lastName: "Bagel Club",
    role: "admin",
    isVerified: true,
  })
  .onConflictDoNothing();

console.log("Seed complete");
await pool.end();
