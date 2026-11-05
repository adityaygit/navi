import "server-only";
import type { Email } from "./templates";

// Outgoing email. Production uses Resend's HTTP API (RESEND_API_KEY + EMAIL_FROM).
// Without a key: development logs the email instead of sending; production refuses,
// so a missing key is visible rather than silently dropping mail.

export type Sender = (to: string, email: Email) => Promise<{ ok: true; id?: string } | { ok: false; error: string }>;

export const resendSender: Sender = async (to, email) => {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) {
    if (process.env.NODE_ENV === "production") return { ok: false, error: "Email is not configured (RESEND_API_KEY / EMAIL_FROM)." };
    console.info(`[email:dev] to=${to} subject="${email.subject}"\n${email.text}`);
    return { ok: true, id: "dev-log" };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: email.subject, html: email.html, text: email.text, reply_to: process.env.EMAIL_REPLY_TO || undefined }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[email] Resend ${res.status}: ${detail.slice(0, 300)}`);
    return { ok: false, error: `Email provider returned ${res.status}` };
  }
  const json = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, id: json.id };
};
