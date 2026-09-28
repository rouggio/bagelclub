import { describe, it, expect } from "vitest";
import { cleanSlate, testDb } from "./helpers.js";
import { resetDemoShowcase, startDemoRun } from "../services/demo.js";
import { clubs, users, announcements } from "../db/schema.js";
import { eq } from "drizzle-orm";

describe("demo showcase", () => {
  cleanSlate();

  it("reset seeds admin + 3 players + public creds announcement", async () => {
    const { db, pool } = await testDb();
    await db.insert(clubs).values({ slug: "demo", name: "Demo", timezone: "Europe/Rome", isDemo: true, isListed: true });
    await resetDemoShowcase(db);
    const demoClub = (await db.select().from(clubs).where(eq(clubs.slug, "demo")))[0];
    const members = await db.select().from(users).where(eq(users.clubId, demoClub.id));
    const names = members.map((u: any) => u.username).sort();
    expect(names).toEqual(["demo-admin", "demo1", "demo2", "demo3"]);
    const anns = await db.select().from(announcements).where(eq(announcements.visibility, "public"));
    expect(anns.length).toBe(1);
    expect(anns[0].body).toContain("demo-admin / demo1234!");
    expect(anns[0].body).toContain("demo1 / demo1234!");
    await pool.end();
  });

  it("personal runs stay private (no creds announcement)", async () => {
    const { db, pool } = await testDb();
    const { club } = await startDemoRun(db, { displayName: "Mine", courts: [{ type: "tennis", count: 1 }] });
    expect(club.slug.startsWith("demo-")).toBe(true);
    const anns = await db.select().from(announcements).where(eq(announcements.clubId, club.id));
    expect(anns.length).toBe(0);
    const members = await db.select().from(users).where(eq(users.clubId, club.id));
    expect(members.map((u: any) => u.username)).toEqual(["demo-admin"]);
    await pool.end();
  });
});
