import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import type { Env } from "./env";
import { escapeHtml, sendEmail } from "./email";
import { schema } from "./database";

function configuredOrigins(env: Env): string[] {
  return [env.APP_ORIGIN, env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      if (url.pathname !== "/" || url.search || url.hash || url.username || url.password)
        throw new Error("Configured URLs must be origins without paths or credentials.");
      if (
        url.protocol !== "https:" &&
        !(env.ENVIRONMENT !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname))
      )
        throw new Error("Configured origins must use HTTPS.");
      return url.origin;
    });
}

export function isAllowedOrigin(origin: string, env: Env, requestUrl: string): boolean {
  try {
    const url = new URL(origin);
    if (url.origin !== origin) return false;
    const allowed = configuredOrigins(env);
    if (allowed.includes(origin)) return true;
    const request = new URL(requestUrl);
    const local = (value: URL) => ["localhost", "127.0.0.1"].includes(value.hostname);
    return (
      ["development", "test"].includes(env.ENVIRONMENT) &&
      local(url) &&
      local(request) &&
      url.protocol === request.protocol &&
      [request.port, "5173", "5174", "5175", "5188", "8787"].includes(url.port)
    );
  } catch {
    return false;
  }
}

export function trustedAuthOrigin(env: Env, requestUrl: string, originHeader?: string) {
  const request = new URL(requestUrl);
  const allowed = configuredOrigins(env);
  const local =
    ["development", "test"].includes(env.ENVIRONMENT) &&
    ["localhost", "127.0.0.1"].includes(request.hostname);
  if (!local && !allowed.includes(request.origin)) throw new Error("Untrusted deployment origin.");
  if (originHeader && isAllowedOrigin(originHeader, env, requestUrl)) return originHeader;
  return env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : request.origin;
}

export function createAuth(env: Env, origin: string) {
  let isLocal = false;
  try {
    const u = new URL(origin);
    isLocal = ["localhost", "127.0.0.1"].includes(u.hostname);
  } catch {
    isLocal = false;
  }

  const trustedOrigins = [origin];
  if (isLocal) {
    trustedOrigins.push(
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5174",
      "http://localhost:5188",
      "http://127.0.0.1:5188",
      "http://localhost:8787",
      "http://127.0.0.1:8787"
    );
  }

  return betterAuth({
    appName: "IEEE INSAT SB Equipment Reservations",
    baseURL: origin,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(env.DB, { provider: "sqlite", schema: schema.authSchema }),
    trustedOrigins,
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "USER",
          input: false,
        },
      },
    },
    advanced: {
      useSecureCookies: origin.startsWith("https://"),
      defaultCookieAttributes: {
        httpOnly: true,
        secure: origin.startsWith("https://"),
        sameSite: "lax",
        path: "/",
      },
    },
    session: {
      expiresIn: 30 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: env.AUTH_RATE_LIMIT_PER_MINUTE,
      storage: "database",
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    plugins: [
      magicLink({
        expiresIn: 10 * 60,
        storeToken: "hashed",
        disableSignUp: true,
        sendMagicLink: async ({ email, url }) => {
          await sendEmail(
            env,
            email,
            "Your IEEE INSAT SB sign-in link",
            `<p>Use this single-use link within 10 minutes to sign in:</p><p><a href="${escapeHtml(url)}">Sign in</a></p><p>If you did not request this email, you can ignore it.</p>`
          );
        },
      }),
    ],
  });
}

export async function makeCookieSignature(value: string, secret: string): Promise<string> {
  const secretBuf = typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
  const key = await crypto.subtle.importKey(
    "raw",
    secretBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

export async function signCookieValue(value: string, secret: string): Promise<string> {
  const signature = await makeCookieSignature(value, secret);
  return encodeURIComponent(`${value}.${signature}`);
}

export async function verifyCookieValue(rawVal: string, secret: string): Promise<string | null> {
  const decoded = decodeURIComponent(rawVal);
  const dotIndex = decoded.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const value = decoded.slice(0, dotIndex);
  const sig = decoded.slice(dotIndex + 1);
  if (!value || !sig) return null;
  const expectedSig = await makeCookieSignature(value, secret);
  if (sig !== expectedSig) return null;
  return value;
}
