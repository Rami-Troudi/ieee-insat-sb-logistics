import { rateLimit } from "./security";
import { createAuthDatabase, createLibSqlClient, LibSqlD1Database } from "./database";
import type { Env, RateLimit } from "./env";

let cachedUrl: string | undefined;
let cachedClient: ReturnType<typeof createLibSqlClient> | undefined;
let cachedDatabase: LibSqlD1Database | undefined;
let cachedAuthDatabase: ReturnType<typeof createAuthDatabase> | undefined;

function database(url: string, authToken?: string) {
  if (!cachedClient || cachedUrl !== url) {
    cachedClient?.close();
    cachedUrl = url;
    cachedClient = createLibSqlClient(url, authToken);
    cachedDatabase = new LibSqlD1Database(cachedClient);
    cachedAuthDatabase = createAuthDatabase(cachedClient);
  }
  return { DB: cachedDatabase!, AUTH_DATABASE: cachedAuthDatabase! };
}

function databaseRateLimit(
  db: LibSqlD1Database,
  prefix: string,
  max: number,
  windowSeconds: number
): RateLimit {
  return {
    limit: async ({ key }) => ({
      success: await rateLimit(db, `${prefix}:${key}`, max, windowSeconds),
    }),
  };
}

export function createRuntimeEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const url = source.TURSO_DATABASE_URL;
  const authToken = source.TURSO_AUTH_TOKEN;
  const secret = source.BETTER_AUTH_SECRET;
  const remoteDatabase = Boolean(url && !url.startsWith("file:"));
  const required = [url, secret];
  if (
    required.some((value) => !value) ||
    (remoteDatabase && !authToken) ||
    (secret?.length ?? 0) < 32
  ) {
    throw new Error("Required server configuration is missing");
  }

  const { DB, AUTH_DATABASE } = database(url!, authToken);
  return {
    DB,
    AUTH_DATABASE,
    API_RATE_LIMITER: databaseRateLimit(DB, "api", 600, 60),
    AUTH_RATE_LIMITER: databaseRateLimit(DB, "auth", 20, 60),
    APP_ORIGIN: source.APP_ORIGIN,
    ENVIRONMENT: source.VERCEL_ENV === "preview" ? "staging" : "production",
    BETTER_AUTH_SECRET: secret!,
    BREVO_API_KEY: source.BREVO_API_KEY,
    BREVO_SENDER_EMAIL: source.BREVO_SENDER_EMAIL,
    BREVO_SENDER_NAME: source.BREVO_SENDER_NAME,
    TURNSTILE_SECRET_KEY: source.TURNSTILE_SECRET_KEY,
    TURNSTILE_SITE_KEY: source.TURNSTILE_SITE_KEY,
    CRON_SECRET: source.CRON_SECRET,
    VERCEL_URL: source.VERCEL_URL,
    VERCEL_PROJECT_PRODUCTION_URL: source.VERCEL_PROJECT_PRODUCTION_URL,
  };
}
