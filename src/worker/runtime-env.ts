import type { Client } from "@libsql/client";
import type { AppDatabase } from "./database";
import { createDatabase, createLibSqlClient } from "./database";
import type { Env, RuntimeEnvironment } from "./env";

let cachedUrl: string | undefined;
let cachedToken: string | undefined;
let cachedClient: Client | undefined;
let cachedDatabase: AppDatabase | undefined;

function database(url: string, authToken?: string) {
  if (!cachedClient || cachedUrl !== url || cachedToken !== authToken) {
    cachedClient?.close();
    cachedUrl = url;
    cachedToken = authToken;
    cachedClient = createLibSqlClient(url, authToken);
    cachedDatabase = createDatabase(cachedClient);
  }
  return { CLIENT: cachedClient!, DB: cachedDatabase! };
}

export async function createRuntimeEnv(source: NodeJS.ProcessEnv = process.env): Promise<Env> {
  const url = source.TURSO_DATABASE_URL;
  const authToken = source.TURSO_AUTH_TOKEN;
  const secret = source.BETTER_AUTH_SECRET;
  const remoteDatabase = Boolean(url && !url.startsWith("file:"));
  if (!url || !secret || secret.length < 32 || (remoteDatabase && !authToken)) {
    throw new Error(
      "Set TURSO_DATABASE_URL, BETTER_AUTH_SECRET (32+ characters), and a remote TURSO_AUTH_TOKEN."
    );
  }
  if (/ieee[-_]?ras[-_]?insat/i.test(url))
    throw new Error("The reservation app refuses to connect to the RAS database.");

  const vercelEnvironment = source.VERCEL_ENV;
  const environment: RuntimeEnvironment =
    source.NODE_ENV === "test"
      ? "test"
      : vercelEnvironment === "production"
        ? "production"
        : vercelEnvironment === "preview"
          ? "preview"
          : "development";

  if (environment === "production" && !source.APP_ORIGIN) {
    throw new Error("APP_ORIGIN must be set to the separate IEEE INSAT SB application origin.");
  }

  const { CLIENT, DB } = database(url, authToken);
  await CLIENT.execute("PRAGMA foreign_keys = ON");
  return {
    CLIENT,
    DB,
    APP_ORIGIN: source.APP_ORIGIN,
    ENVIRONMENT: environment,
    BETTER_AUTH_SECRET: secret,
    BREVO_API_KEY: source.BREVO_API_KEY,
    BREVO_SENDER_EMAIL: source.BREVO_SENDER_EMAIL,
    BREVO_SENDER_NAME: source.BREVO_SENDER_NAME,
    VERCEL_URL: source.VERCEL_URL,
    VERCEL_PROJECT_PRODUCTION_URL: source.VERCEL_PROJECT_PRODUCTION_URL,
    API_RATE_LIMIT_PER_MINUTE: 1200,
    AUTH_RATE_LIMIT_PER_MINUTE: 10,
  };
}
