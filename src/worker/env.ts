import type { Client } from "@libsql/client";
import type { AppDatabase } from "./database";

export type UserRole = "USER" | "BOARD" | "SUPERADMIN";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export type RuntimeEnvironment = "development" | "test" | "preview" | "production";

export interface Env {
  DB: AppDatabase;
  CLIENT: Client;
  APP_ORIGIN?: string;
  ENVIRONMENT: RuntimeEnvironment;
  BETTER_AUTH_SECRET: string;
  BREVO_API_KEY?: string;
  BREVO_SENDER_EMAIL?: string;
  BREVO_SENDER_NAME?: string;
  VERCEL_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  API_RATE_LIMIT_PER_MINUTE: number;
  AUTH_RATE_LIMIT_PER_MINUTE: number;
}
