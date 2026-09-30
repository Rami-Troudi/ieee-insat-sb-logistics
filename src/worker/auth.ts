import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import type { Env } from "./env";
import { escapeHtml, sendEmail } from "./email";
import { schema } from "./database";

export function isAllowedOrigin(origin: string, env: Env, requestUrl: string): boolean {
  let trusted: string;
  try {
    trusted = trustedAuthOrigin(env, requestUrl);
  } catch {
    return false;
  }
  if (origin === trusted) return true;

  try {
    const originUrl = new URL(origin);
    const trustedUrl = new URL(trusted);
    const localHostnames = ["localhost", "127.0.0.1"];
    const isOriginLocal = localHostnames.includes(originUrl.hostname);
    const isTrustedLocal = localHostnames.includes(trustedUrl.hostname);

    if (
      originUrl.hostname.endsWith(".vercel.app") &&
      (trustedUrl.hostname.endsWith(".vercel.app") || Boolean(env.APP_ORIGIN?.includes(".vercel.app")))
    ) {
      return true;
    }

    if (isOriginLocal && isTrustedLocal && originUrl.protocol === trustedUrl.protocol) {
      const allowedPorts = new Set([
        originUrl.port,
        trustedUrl.port,
        "5173",
        "5174",
        "5175",
        "5188",
        "8787",
      ]);
      if (allowedPorts.has(originUrl.port) && allowedPorts.has(trustedUrl.port)) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export function trustedAuthOrigin(env: Env, requestUrl: string, originHeader?: string) {
  const requestOrigin = new URL(requestUrl);
  const configuredHosts = new Set(
    [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL]
      .filter((host): host is string => Boolean(host))
      .map((host) => host.replace(/^https?:\/\//, ""))
  );
  const local = ["localhost", "127.0.0.1"].includes(requestOrigin.hostname);

  if (originHeader && isAllowedOrigin(originHeader, env, requestUrl)) {
    return new URL(originHeader).origin;
  }

  if (env.APP_ORIGIN) {
    const appOrigin = new URL(env.APP_ORIGIN);
    if (
      appOrigin.pathname !== "/" ||
      appOrigin.search ||
      appOrigin.hash ||
      appOrigin.username ||
      appOrigin.password
    ) {
      throw new Error("APP_ORIGIN must be an origin without a path.");
    }
    if (appOrigin.protocol !== "https:" && !local) throw new Error("APP_ORIGIN must use HTTPS.");
    if (!local && requestOrigin.origin !== appOrigin.origin) {
      if (
        requestOrigin.hostname.endsWith(".vercel.app") &&
        appOrigin.hostname.endsWith(".vercel.app")
      ) {
        return appOrigin.origin;
      }
      throw new Error("Untrusted application origin.");
    }
    if (
      local &&
      (env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test") &&
      ["localhost", "127.0.0.1"].includes(appOrigin.hostname)
    ) {
      return appOrigin.origin;
    }
    return local ? requestOrigin.origin : appOrigin.origin;
  }
  if (local) return requestOrigin.origin;
  if (!configuredHosts.has(requestOrigin.host) && !requestOrigin.hostname.endsWith(".vercel.app")) {
    throw new Error("Untrusted deployment origin.");
  }
  return requestOrigin.origin;
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
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    plugins: [
      magicLink({
        expiresIn: 10 * 60,
        storeToken: "hashed",
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
