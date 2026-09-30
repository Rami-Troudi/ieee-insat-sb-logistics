import type { Context } from "hono";
import type { Env } from "./env";
import { isAllowedOrigin } from "./auth";

export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function jsonError(c: Context, status: number, code: string, message: string) {
  return c.json({ error: { code, message } }, status as 400);
}

export async function sameOrigin(c: Context<{ Bindings: Env }>, next: () => Promise<void>) {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  const origin = c.req.header("Origin");
  if (!origin || !isAllowedOrigin(origin, c.env, c.req.url)) {
    return jsonError(c, 403, "FORBIDDEN", "Request origin is not allowed.");
  }
  await next();
}

export async function isRateLimited(env: Env, key: string, max: number, windowMs = 60_000) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const keyHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const timestamp = Date.now();
  const result = await env.CLIENT.execute({
    sql: `INSERT INTO rate_limit_buckets(key_hash,window_start,count) VALUES(?,?,1)
      ON CONFLICT(key_hash) DO UPDATE SET
        window_start=CASE WHEN rate_limit_buckets.window_start + ? <= excluded.window_start THEN excluded.window_start ELSE rate_limit_buckets.window_start END,
        count=CASE WHEN rate_limit_buckets.window_start + ? <= excluded.window_start THEN 1 ELSE rate_limit_buckets.count + 1 END
      RETURNING count`,
    args: [keyHash, timestamp, windowMs, windowMs],
  });
  return Number(result.rows[0]?.count ?? max + 1) > max;
}

export function requestIp(c: Context) {
  const forwarded = c.req.header("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return forwarded || c.req.header("x-real-ip") || "unknown";
}
