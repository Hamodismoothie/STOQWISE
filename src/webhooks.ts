/**
 * Outbound webhooks.
 *
 * Each delivery is signed with HMAC-SHA256 over the raw body, so a receiver can
 * verify that the event came from us without trusting the network. Retries are
 * bounded (3 attempts, exponential backoff) and every attempt is logged, because
 * an integration that fails silently is worse than one that is not offered.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db.ts";
import { logDelivery, type WebhookRow } from "./data/repo.ts";

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

async function deliver(webhook: WebhookRow, event: string, payload: unknown): Promise<{ ok: boolean; code: number | null; attempts: number; error: string | null }> {
  const body = JSON.stringify({ event, sentAt: new Date().toISOString(), data: payload });
  const signature = signBody(webhook.secret, body);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lagerradar-event": event,
          "x-stoqwise-signature": signature,
          "user-agent": "Stoqwise-Webhook/2.0",
        },
        body,
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
