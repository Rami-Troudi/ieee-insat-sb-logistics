import type { Context, MiddlewareHandler } from "hono";
import type { D1Database, Env } from "./env";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function jsonError(c: Context, status: number, code: string, message: string) {
  return c.json({ error: { code, message } }, status as ContentfulStatusCode);
}

export const sameOrigin: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  const origin = c.req.header("Origin");
  if (!origin) return jsonError(c, 403, "ORIGIN_REJECTED", "Request origin is not allowed");
  try {
    const originUrl = new URL(origin);
    const host =
      c.req.header("x-forwarded-host") || c.req.header("host") || new URL(c.req.url).host;
    const hostWithoutPort = host.split(":")[0];
    if (originUrl.hostname !== hostWithoutPort && origin !== new URL(c.req.url).origin) {
      return jsonError(c, 403, "ORIGIN_REJECTED", "Request origin is not allowed");
    }
  } catch {
    return jsonError(c, 403, "ORIGIN_REJECTED", "Request origin is not allowed");
  }
  return next();
};

export async function verifyTurnstile(
  env: Env,
  token: string | undefined,
  ip: string | undefined,
  origin: string
) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  if (ip) body.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!response.ok) return false;
  const result = (await response.json()) as { success?: boolean; hostname?: string };
  return result.success === true && result.hostname === new URL(origin).hostname;
}

export async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function rateLimit(db: D1Database, key: string, max: number, windowSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const keyHash = await digest(key);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const row = await db
    .prepare(
      `INSERT INTO rate_limit_buckets(key_hash,window_start,count)
    VALUES(?,?,1) ON CONFLICT(key_hash) DO UPDATE SET
    count=CASE WHEN window_start=? THEN count+1 ELSE 1 END,
    window_start=? WHERE window_start<>? OR count<? RETURNING count`
    )
    .bind(keyHash, windowStart, windowStart, windowStart, windowStart, max)
    .first<{ count: number }>();
  return row !== null && row.count <= max;
}
