import { describe, it, expect } from "vitest";
import { sendEmail } from "../services/email.js";

describe("brevo email (#28)", () => {
  it("501s without credentials, 400s on bad recipient", async () => {
    const keepKey = process.env.BREVO_API_KEY;
    const keepFrom = process.env.BREVO_VERIFIED_EMAIL;
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_VERIFIED_EMAIL;
    try {
      await expect(sendEmail({ to: "a@b.co", subject: "x" })).rejects.toMatchObject({ statusCode: 501 });
    } finally {
      if (keepKey !== undefined) process.env.BREVO_API_KEY = keepKey;
      if (keepFrom !== undefined) process.env.BREVO_VERIFIED_EMAIL = keepFrom;
    }
    await expect(sendEmail({ to: "not-an-email", subject: "x" })).rejects.toMatchObject({ statusCode: 400 });
  });
});
