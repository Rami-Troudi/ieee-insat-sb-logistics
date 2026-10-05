import type { Env } from "./env";

export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  htmlContent: string,
  idempotencyKey?: string,
  timeoutMs = 8000
) {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
    throw new Error("Email delivery is not configured.");
  }
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: {
        email: env.BREVO_SENDER_EMAIL,
        name: env.BREVO_SENDER_NAME ?? "IEEE INSAT SB Equipment Reservations",
      },
      to: [{ email: to }],
      subject,
      htmlContent,
      ...(idempotencyKey ? { headers: { idempotencyKey } } : {}),
    }),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { code?: string } | null;
    if (idempotencyKey && error?.code === "duplicate_parameter") return;
    throw new Error("Email delivery failed");
  }
}

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!
  );
}
