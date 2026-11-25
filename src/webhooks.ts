/**
 * Outbound webhooks.
 *
 * Each delivery is signed with HMAC-SHA256 over the raw body, so a receiver can
 * verify that the event came from us without trusting the network. Retries are
 * bounded (3 attempts, exponential backoff) and every attempt is logged, because
 * an integration that fails silently is worse than one that is not offered.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { db } from "./db.ts";
import { logDelivery, type WebhookRow } from "./data/repo.ts";
import { config } from "./config.ts";

export type WebhookEvent =
  | "analysis.completed"
  | "analysis.failed"
  | "import.completed"
  | "stockout.risk"
  | "report.ready";

export function signBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifySignature(secret: string, body: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = signBody(secret, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIp(address: string): boolean {
  const clean = address.trim().replace(/^\[|\]$/g, "").split("%")[0]!.toLowerCase();
  if (isIP(clean) === 4) return isPrivateIpv4(clean);
  if (isIP(clean) !== 6) return true;
  if (clean === "::" || clean === "::1") return true;
  if (clean.startsWith("fc") || clean.startsWith("fd") || /^fe[89ab]/.test(clean) || /^fe[c-f]/.test(clean) || clean.startsWith("ff")) return true;
  const mapped = clean.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (clean.startsWith("::ffff:")) return mapped ? isPrivateIpv4(mapped[1]!) : true;
  return false;
}

/**
 * Blocks SSRF targets: credentials in the URL, plain HTTP in production,
 * loopback/private/link-local addresses and hostnames that resolve to them.
 * DNS can still change between this check and the request (DNS rebinding); the
 * delivery is re-checked and redirects are not followed to limit that window.
 */
export async function assertSafeWebhookUrl(raw: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Webhook-URL är inte en giltig URL.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && !config.isProduction)) {
    throw new Error("Webhook-URL måste använda https://.");
  }
  if (url.username || url.password) throw new Error("Webhook-URL får inte innehålla inloggningsuppgifter.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new Error("Webhook-URL saknar värdnamn.");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal") {
    throw new Error("Webhook-URL får inte peka på en intern adress.");
  }
  if (isIP(host.replace(/^\[|\]$/g, ""))) {
    if (isPrivateIp(host)) throw new Error("Webhook-URL får inte peka på en intern adress.");
  } else {
    let addresses: Array<{ address: string }>;
    try {
      addresses = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new Error("Webhook-värdnamnet kunde inte slås upp.");
    }
    if (addresses.length === 0 || addresses.some((entry) => isPrivateIp(entry.address))) {
      throw new Error("Webhook-URL får inte peka på en intern adress.");
    }
  }
  return url.toString();
}

async function deliver(webhook: WebhookRow, event: string, payload: unknown): Promise<{ ok: boolean; code: number | null; attempts: number; error: string | null }> {
  const body = JSON.stringify({ event, sentAt: new Date().toISOString(), data: payload });
  const signature = signBody(webhook.secret, body);
  try {
    await assertSafeWebhookUrl(webhook.url);
  } catch {
    return { ok: false, code: null, attempts: 0, error: "otillåten webhook-adress" };
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lagerradar-event": event,
          "x-stoqwise-signature": signature,
          "user-agent": "STOQWISE-Webhook/2.0",
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) return { ok: true, code: res.status, attempts: attempt, error: null };
      if (attempt === 3) return { ok: false, code: res.status, attempts: attempt, error: `HTTP ${res.status}` };
    } catch (error) {
      if (attempt === 3) {
        return { ok: false, code: null, attempts: attempt, error: error instanceof Error ? error.message : "okänt fel" };
      }
    }
    await Bun.sleep(250 * attempt);
  }
  return { ok: false, code: null, attempts: 3, error: "utskick misslyckades" };
}

/** Fire-and-forget: never blocks the request that triggered it. */
export async function dispatchEvent(orgId: string, event: WebhookEvent, payload: unknown): Promise<number> {
  const hooks = db
    .query("SELECT * FROM webhooks WHERE org_id = $o AND active = 1")
    .all({ $o: orgId }) as WebhookRow[];

  const matching = hooks.filter((h) => h.events.split(",").includes(event) || h.events.includes("*"));
  if (matching.length === 0) return 0;

  const results = await Promise.all(
    matching.map(async (hook) => {
      const result = await deliver(hook, event, payload);
      logDelivery({
        webhookId: hook.id,
        event,
        status: result.ok ? "ok" : "failed",
        responseCode: result.code,
        attempts: result.attempts,
        error: result.error,
      });
      return result.ok ? 1 : 0;
    }),
  );
  return results.reduce<number>((a, b) => a + b, 0);
}

export const webhookEvents: WebhookEvent[] = [
  "analysis.completed",
  "analysis.failed",
  "import.completed",
  "stockout.risk",
  "report.ready",
];
