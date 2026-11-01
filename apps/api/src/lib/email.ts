import type { Env } from "../env";

export interface Email {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends a transactional email through Resend when RESEND_API_KEY is set.
 * In development (or without a key) the email is printed to the console instead.
 */
export async function sendEmail(env: Env, email: Email): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email] to=${email.to} subject="${email.subject}"\n${email.text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM ?? "Nexo <no-reply@example.com>", to: email.to, subject: email.subject, text: email.text }),
  });
  if (!res.ok) console.error("[email] send failed", res.status, await res.text());
}
