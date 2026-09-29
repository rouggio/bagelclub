// Transactional email via Brevo REST API (#28). Render blocks SMTP traffic,
// so all mail goes through https://api.brevo.com/v3/smtp/email.
// Sender defaults to BREVO_VERIFIED_EMAIL; per-club sender identity (#23)
// overrides it through the senderEmail param.
export interface EmailOpts {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  senderEmail?: string;
  senderName?: string;
}

export async function sendEmail(opts: EmailOpts): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY || "";
  const from = opts.senderEmail || process.env.BREVO_VERIFIED_EMAIL || "";
  if (!apiKey || !from) {
    throw Object.assign(new Error("Email not configured (BREVO_API_KEY / BREVO_VERIFIED_EMAIL)"), { statusCode: 501 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(opts.to)) {
    throw Object.assign(new Error("Invalid recipient"), { statusCode: 400 });
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: from, name: opts.senderName || "Bagel Club" },
      to: [{ email: opts.to }],
      subject: opts.subject,
      htmlContent: opts.html || `<p>${opts.text || ""}</p>`,
      ...(opts.text ? { textContent: opts.text } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().then((t) => t.slice(0, 200)).catch(() => "");
    throw Object.assign(new Error(`Email send failed: ${detail}`), { statusCode: 502 });
  }
  return true;
}
