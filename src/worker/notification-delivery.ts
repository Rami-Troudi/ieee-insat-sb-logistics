import { DateTime } from "luxon";
import type { Env } from "./env";
import { one, write, DISPLAY_TIME_ZONE } from "./domain";
import { escapeHtml, sendEmail } from "./email";

type Delivery = {
  notification_id: string;
  type: string;
  title: string;
  message: string;
  created_at: number;
  user_email: string | null;
  status: string | null;
  pickup_at: number;
  return_at: number;
  updated_at: number;
  borrowed_count: number;
  collected_count: number;
  first_attempt_at: number | null;
};

function relevant(row: Delivery, now: number) {
  if (!row.user_email || now - Number(row.created_at) > 24 * 60 * 60_000) return false;
  const borrowed = Number(row.borrowed_count) > 0;
  const due = Number(row.return_at);
  const label = DateTime.fromMillis(due, { zone: DISPLAY_TIME_ZONE }).toFormat(
    "ccc, d LLL 'at' HH:mm"
  );
  if (row.type === "RESERVATION_APPROVED")
    return (
      row.status === "APPROVED" &&
      !Number(row.collected_count) &&
      now < Number(row.pickup_at) + 30 * 60_000 &&
      Number(row.updated_at) <= Number(row.created_at)
    );
  if (row.type === "RETURN_DUE_SOON")
    return (
      row.status === "APPROVED" &&
      borrowed &&
      due > now &&
      due <= now + 60 * 60_000 &&
      row.message.includes(label)
    );
  if (row.type === "RETURN_OVERDUE")
    return row.status === "APPROVED" && borrowed && due <= now && row.message.includes(label);
  if (row.type === "PICKUP_EXPIRED")
    return row.status === "CANCELLED" && !Number(row.collected_count);
  if (row.type === "RESERVATION_DECLINED") return row.status === "DECLINED";
  return ![
    "RESERVATION_APPROVED",
    "RETURN_DUE_SOON",
    "RETURN_OVERDUE",
    "PICKUP_EXPIRED",
    "RESERVATION_DECLINED",
  ].includes(row.type);
}

export async function deliverNotificationEmails(
  env: Env,
  now = Date.now(),
  deadline = Date.now() + 16_000
) {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) return { sent: 0, skipped: 0, pending: 0 };
  let sent = 0,
    skipped = 0;
  for (let count = 0; count < 25 && Date.now() + 8_000 < deadline; count++) {
    const token = crypto.randomUUID();
    const claimed = await write(env, async (tx) => {
      const row = await one<{ notification_id: string }>(
        tx,
        "SELECT notification_id FROM notification_emails WHERE (status='PENDING' AND next_attempt_at<=?) OR (status='SENDING' AND (lease_until IS NULL OR lease_until<=?)) ORDER BY next_attempt_at,notification_id LIMIT 1",
        [now, Date.now()]
      );
      if (!row) return null;
      await tx.execute({
        sql: "UPDATE notification_emails SET status='SENDING',lease_token=?,lease_until=?,first_attempt_at=COALESCE(first_attempt_at,?) WHERE notification_id=?",
        args: [token, Date.now() + 60_000, Date.now(), row.notification_id],
      });
      return row.notification_id;
    });
    if (!claimed) break;
    // Fetch fresh state immediately before contacting the provider.
    const row = await one<Delivery>(
      env.CLIENT,
      `SELECT ne.notification_id,ne.first_attempt_at,n.type,n.title,n.message,n.created_at,u.email AS user_email,
       r.status,r.pickup_at,r.return_at,r.updated_at,
       (SELECT COUNT(*) FROM reservation_assets WHERE reservation_id=r.id AND state='BORROWED') AS borrowed_count,
       (SELECT COUNT(*) FROM reservation_assets WHERE reservation_id=r.id AND actual_pickup_at IS NOT NULL) AS collected_count
       FROM notification_emails ne JOIN notifications n ON n.id=ne.notification_id
       LEFT JOIN user u ON u.id=n.user_id AND u.disabled_at IS NULL LEFT JOIN reservations r ON r.id=n.reservation_id
       WHERE ne.notification_id=? AND ne.lease_token=?`,
      [claimed, token]
    );
    // Ambiguous submissions older than provider deduplication TTL require investigation,
    // rather than an automatic resend that could duplicate a delivered message.
    if (!row || !relevant(row, now) || Date.now() - Number(row.first_attempt_at) > 14 * 60_000) {
      await env.CLIENT.execute({
        sql: "UPDATE notification_emails SET status='SKIPPED',skip_reason=?,lease_token=NULL,lease_until=NULL WHERE notification_id=? AND lease_token=?",
        args: [
          row && Date.now() - Number(row.first_attempt_at) > 14 * 60_000
            ? "DELIVERY_UNCERTAIN"
            : "OBSOLETE",
          claimed,
          token,
        ],
      });
      skipped++;
      continue;
    }
    let accepted = false;
    try {
      await sendEmail(
        env,
        row.user_email!,
        row.title,
        `<p>${escapeHtml(row.message)}</p>`,
        claimed,
        Math.min(8000, deadline - Date.now())
      );
      accepted = true;
      await env.CLIENT.execute({
        sql: "UPDATE notification_emails SET status='SENT',attempts=attempts+1,sent_at=?,next_attempt_at=0,lease_token=NULL,lease_until=NULL WHERE notification_id=? AND lease_token=?",
        args: [Date.now(), claimed, token],
      });
      sent++;
    } catch {
      // Keep an accepted-but-unrecorded submission leased. Recovery reuses its provider key.
      if (!accepted)
        await env.CLIENT.execute({
          sql: "UPDATE notification_emails SET status='PENDING',attempts=attempts+1,next_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE notification_id=? AND lease_token=?",
          args: [now + 60_000, claimed, token],
        });
    }
  }
  const remaining = await one<{ count: number }>(
    env.CLIENT,
    "SELECT COUNT(*) AS count FROM notification_emails WHERE status IN ('PENDING','SENDING')"
  );
  return { sent, skipped, pending: Number(remaining?.count ?? 0) };
}
