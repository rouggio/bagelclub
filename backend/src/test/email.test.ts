import { describe, it, expect } from "vitest";
import { sendEmail } from "../services/email.js";

describe("brevo email (#28)", () => {
  it("501s without credentials", async () => {
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
  });

  it("400s on bad recipient before any network call", async () => {
    const keepKey = process.env.BREVO_API_KEY;
    const keepFrom = process.env.BREVO_VERIFIED_EMAIL;
    process.env.BREVO_API_KEY = "dummy";
    process.env.BREVO_VERIFIED_EMAIL = "from@test.local";
    try {
      await expect(sendEmail({ to: "not-an-email", subject: "x" })).rejects.toMatchObject({ statusCode: 400 });
    } finally {
      if (keepKey !== undefined) process.env.BREVO_API_KEY = keepKey; else delete process.env.BREVO_API_KEY;
      if (keepFrom !== undefined) process.env.BREVO_VERIFIED_EMAIL = keepFrom; else delete process.env.BREVO_VERIFIED_EMAIL;
    }
  });
});
