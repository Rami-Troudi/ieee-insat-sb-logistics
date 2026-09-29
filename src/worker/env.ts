import type { AuthDatabase } from "./database";

export interface D1Result<T = Record<string, unknown>> {
  success: boolean;
  results: T[];
  meta: { changes: number; last_row_id?: number | bigint };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): this;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result<Record<string, unknown>>>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface RateLimit {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  AUTH_DATABASE: AuthDatabase;
  API_RATE_LIMITER: RateLimit;
  AUTH_RATE_LIMITER: RateLimit;
  APP_ORIGIN?: string;
  ENVIRONMENT: "staging" | "production";
  BETTER_AUTH_SECRET: string;
  BREVO_API_KEY?: string;
  BREVO_SENDER_EMAIL?: string;
  BREVO_SENDER_NAME?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  CRON_SECRET?: string;
  VERCEL_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
}

export interface AppUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "MEMBER" | "OPERATOR" | "SUPERADMIN";
  clearance: "I" | "II" | "III" | "IV" | "V" | "VI";
  affiliation: "EXTERNAL" | "AEROBOTIX" | "IEEE" | "RAS_BOARD" | "EUROBOT";
  claimed_affiliation: string | null;
  affiliation_verified: number;
  clearance_source: string | null;
  status: "ACTIVE" | "RESTRICTED" | "BANNED" | "BLACKLISTED" | "PENDING";
  created_at: number;
}
