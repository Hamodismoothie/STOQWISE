/**
 * Central configuration. Everything is read from the environment with safe
 * defaults so the app runs on a laptop with zero setup.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { TECHNICAL_ITEM_CAPACITY } from "./capacity.ts";

const ROOT = join(import.meta.dir, "..");

const env = (key: string, fallback = ""): string => {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
};

export const config = {
  root: ROOT,
  port: Number(env("PORT", "3000")),
  appOrigin: env("APP_ORIGIN", `http://localhost:${env("PORT", "3000")}`),
  sessionSecret: env("SESSION_SECRET", "dev-only-insecure-secret-change-me"),
  isProduction: env("NODE_ENV") === "production",
  // Only trust X-Forwarded-For when the app is behind a proxy that overwrites
  // the header. Otherwise any client can choose its own rate-limit identity.
  trustProxy: env("TRUST_PROXY") === "true",
  dataDir: join(ROOT, "data"),
  // Overridable so integration tests can run against a throwaway database.
  dbPath: env("DB_PATH", join(ROOT, "data", "lagerradar.db")),
  reportDir: join(ROOT, "reports"),
  samplesDir: join(ROOT, "samples"),
  publicDir: join(ROOT, "public"),
  // Limits that protect the server from accidental or hostile uploads.
  // Large Enterprise exports are streamed into SQLite, but the request body is
  // bounded so a malicious upload cannot exhaust memory.
  maxUploadBytes: 256 * 1024 * 1024,
  maxRows: TECHNICAL_ITEM_CAPACITY,
  sessionTtlSeconds: 60 * 60 * 24 * 14,
  ai: {
    provider: env("AI_PROVIDER", "none") as "openai" | "anthropic" | "none",
    apiKey: env("AI_API_KEY"),
    model: env("AI_MODEL", "gpt-6-luna"),
    baseUrl: env("AI_BASE_URL", "https://api.openai.com/v1"),
    // Sending customer inventory data to an external processor requires an
    // explicit operator decision (DPA, transfer mechanism and documentation).
    // A configured API key alone must never enable that transfer.
    dataProcessingApproved: env("AI_DATA_PROCESSING_APPROVED") === "true",
  },
  mail: {
    // Empty values put mail in outbox mode instead of sending, so a local
    // checkout never needs a provider account to exercise the flows.
    apiKey: env("RESEND_API_KEY"),
    from: env("MAIL_FROM"),
    notify: env("MAIL_NOTIFY"),
  },
  stripe: {
    secretKey: env("STRIPE_SECRET_KEY"),
    priceBasic: env("STRIPE_PRICE_BASIC"),
    priceMulti: env("STRIPE_PRICE_MULTI"),
  },
} as const;

export function ensureRuntimeDirs(): void {
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.reportDir, { recursive: true });
}
