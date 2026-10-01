import { createDb } from "../db/connection.js";
import { clubs } from "../db/schema.js";

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const { db, pool } = createDb(url);
  const { withClubScope, withSuperadminScope } = await import("../services/club.js");
  const { getClubSettings } = await import("../services/club.js");
  const { medcertRequired, sendMedcertReminders } = await import("../services/medcert.js");
  let total = 0;
  try {
    // #33: club list is cross-tenant — read under superadmin scope.
    const all: any[] = await withSuperadminScope(db, async (cx: any) => cx.select().from(clubs));
    for (const club of all as any[]) {
      try {
        const n = await withClubScope(db, club.id, async (cx: any) => {
          const settings = await getClubSettings(cx, club.id);
          if (!medcertRequired(settings)) return 0;
          return sendMedcertReminders(cx, { ...club }, settings);
        });
        total += n;
      } catch (e) {
        console.error(`medcert reminders failed for ${club.slug}`, e);
      }
    }
    console.log(`Medcert reminders sent: ${total} at ${new Date().toISOString()}`);
  } finally {
    await pool.end();
  }
}

import path from "path";
import { fileURLToPath } from "url";
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain || process.argv[1]?.endsWith("medcertReminders.ts") || process.argv[1]?.endsWith("medcertReminders.js")) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { run as runMedcertReminders };
