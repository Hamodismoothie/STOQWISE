/**
 * HTTP plumbing: routing, request context, guards, rate limiting and headers.
 *
 * Kept separate from the server so route modules stay readable and so the same
 * guards can be reused by the JSON API without duplicating permission logic.
 */
import type { OrgRow, Permission, Role } from "./data/repo.ts";
import { can, limitsForOrg, membershipFor, orgForUser } from "./data/repo.ts";
import { currentUser, isSameOrigin } from "./auth.ts";
import type { UserRow } from "./db.ts";
import { config } from "./config.ts";

export interface RequestContext {
  req: Request;
  url: URL;
  params: Record<string, string>;
  user: UserRow | null;
  org: OrgRow | null;
  role: Role | null;
  ip: string;
  form?: Awaited<ReturnType<Request["formData"]>>;
}

type FormDataLike = Awaited<ReturnType<Request["formData"]>>;

export type Handler = (ctx: RequestContext) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, pattern, segments: pattern.split("/").filter(Boolean), handler });
  }

  get(pattern: string, handler: Handler): void {
    this.add("GET", pattern, handler);
  }

  post(pattern: string, handler: Handler): void {
    this.add("POST", pattern, handler);
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method && !(method === "HEAD" && route.method === "GET")) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const segment = route.segments[i]!;
        if (segment.startsWith(":")) params[segment.slice(1)] = decodeURIComponent(parts[i]!);
        else if (segment !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }
}

/* --------------------------------------------------------------- responses */

export function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

/** Plain text or XML, cacheable because robots.txt and sitemap.xml rarely change. */
export function plain(body: string, contentType = "text/plain; charset=utf-8"): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType, "cache-control": "public, max-age=3600" },
  });
}

export function redirect(location: string, status = 303, cookie?: string): Response {
  const headers: Record<string, string> = { location };
  if (cookie) headers["set-cookie"] = cookie;
  return new Response(null, { status, headers });
}

export function binary(data: Uint8Array, contentType: string, filename: string): Response {
  return new Response(data, {
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, max-age=0, must-revalidate",
    },
  });
}

export function securityHeaders(res: Response): Response {
  // A pre-compressed response must keep its body and its content-encoding;
  // wrapping it in a new Response would make the runtime decode it again.
  if (res.headers.get("content-encoding")) {
    applySecurityHeaders(res.headers);
    return res;
  }
  const headers = new Headers(res.headers);
  applySecurityHeaders(headers);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function applySecurityHeaders(headers: Headers): void {
  headers.set(
    "content-security-policy",
    [
      "default-src 'self'",
      "img-src 'self' data:",
      // Inline styles are used for chart geometry; scripts are never inline.
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "font-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
    ].join("; "),
  );
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("x-permitted-cross-domain-policies", "none");
  if (config.isProduction || config.appOrigin.startsWith("https://")) headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
}

/* ------------------------------------------------------------ rate limits */

interface Bucket {
  count: number;
  reset: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowSeconds: number): { ok: boolean; retryAfter: number } {
  const nowMs = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset < nowMs) {
    // Bound memory even during a burst of unique keys between cleanups. Map
    // iteration order is insertion order, so evict the oldest entries first.
    if (buckets.size >= 50_000) {
      let removed = 0;
      for (const [oldKey, oldBucket] of buckets) {
        if (oldBucket.reset < nowMs || removed >= 10_000) {
          buckets.delete(oldKey);
          removed++;
        }
        if (removed >= 10_000) break;
      }
    }
    buckets.set(key, { count: 1, reset: nowMs + windowSeconds * 1000 });
    return { ok: true, retryAfter: 0 };
  }
  bucket.count++;
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.reset - nowMs) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

// Bound the map so a hostile client cannot grow it without limit.
setInterval(() => {
  const nowMs = Date.now();
  for (const [key, bucket] of buckets) if (bucket.reset < nowMs) buckets.delete(key);
}, 60_000).unref?.();

/* ------------------------------------------------------------------ context */

export function clientIp(req: Request, peerAddress?: string | null): string {
  // Never trust a client-supplied forwarding header unless the deployment says
  // a proxy overwrites it. The peer address comes from Bun's socket, not from
  // the request, so rate limits cannot be bypassed by choosing another header.
  if (config.trustProxy) {
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]!.trim();
      if (first) return first;
    }
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  return peerAddress?.trim() || "127.0.0.1";
}

export async function buildContext(req: Request, params: Record<string, string>, peerAddress?: string | null): Promise<RequestContext> {
  const url = new URL(req.url);
  const user = currentUser(req);
  const membership = user ? orgForUser(user.id) : null;
  return {
    req,
    url,
    params,
    user,
    org: membership?.org ?? null,
    role: membership?.role ?? null,
    ip: clientIp(req, peerAddress),
  };
}

/* ------------------------------------------------------------------- guards */

export function requireUser(ctx: RequestContext, json401 = false): Response | null {
  if (ctx.user?.status === "suspended") {
    return json401 ? json({ error: "account_suspended" }, 403) : html(blockedPage("Kontot är pausat. Kontakta supporten."), 403);
  }
  if (ctx.org?.status === "suspended") {
    return json401 ? json({ error: "organization_suspended" }, 403) : html(blockedPage("Organisationen är pausad. Kontakta er administratör."), 403);
  }
  if (ctx.user) return null;
  if (json401) return json({ error: "unauthorized", message: "Inloggning krävs." }, 401);
  return redirect(`/logga-in?nasta=${encodeURIComponent(ctx.url.pathname)}`);
}

function blockedPage(message: string): string {
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Kontot är pausat</title>
  <link rel="stylesheet" href="/v3.css?v=143"></head><body class="standalone">
  <main class="standalone-card"><p class="eyebrow">403</p><h1>Åtkomst pausad</h1>
  <p>${message.replace(/[<>&]/g, "")}</p><a class="btn" href="/">Till startsidan</a></main></body></html>`;
}

export function requireOrg(ctx: RequestContext): Response | null {
  if (ctx.org) return null;
  return redirect("/start");
}

export function requirePermission(ctx: RequestContext, permission: Permission, jsonApi = false): Response | null {
  if (!ctx.role) return jsonApi ? json({ error: "unauthorized" }, 401) : redirect("/logga-in");
  if (!can(ctx.role, permission)) {
    return jsonApi
      ? json({ error: "forbidden", message: `Din roll (${ctx.role}) saknar behörigheten ${permission}.` }, 403)
      : html(forbiddenPage(ctx.role, permission), 403);
  }
  // Read-only is a data boundary, not a navigation boundary. GET requests keep
  // working so the customer can read, export and delete. Deletion, billing and
  // quote requests stay open because they are how a trial is ended or upgraded.
  const mutating = ctx.req.method !== "GET" && ctx.req.method !== "HEAD";
  const readOnlyPermission = ["data.write", "api.manage", "members.manage", "copilot.use"].includes(permission);
  if (mutating && readOnlyPermission) {
    const blockedWritable = requireWritable(ctx, jsonApi);
    if (blockedWritable) return blockedWritable;
  }
  return null;
}

/** Blocks tenant data changes after a trial has ended. */
export function requireWritable(ctx: RequestContext, jsonApi = false): Response | null {
  if (!ctx.org) return null;
  const limits = limitsForOrg(ctx.org.id);
  if (!limits.readOnly) return null;
  if (jsonApi) {
    return json({
      error: "trial_ended",
      message: "Provperioden har tagit slut. Organisationen är i läsbart läge och kunddata kan inte ändras.",
    }, 403);
  }
  return html(readOnlyPage(), 403);
}

function readOnlyPage(): string {
  return `<!doctype html><html lang="sv" data-theme="light"><head><meta charset="utf-8"><title>Läsbart läge · STOQWISE</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/v3.css?v=143"><link rel="icon" href="/favicon.svg" type="image/svg+xml"></head>
  <body class="standalone"><main class="standalone-card">
    <p class="eyebrow">Provperioden har tagit slut</p>
    <h1>Organisationen är i läsbart läge</h1>
    <p>Alla analyser, artikelrader och rapporter finns kvar. Du kan läsa och exportera data, men inte importera nya filer eller ändra kunddata.</p>
    <div class="flex gap-2 mt-4" style="flex-wrap:wrap">
      <a class="btn" href="/app">Till dashboarden</a>
      <a class="btn btn-ghost" href="/app/prisestimat">Begär offert</a>
      <a class="btn btn-ghost" href="/app/export">Exportera data</a>
    </div>
  </main></body></html>`;
}

function forbiddenPage(role: Role, permission: Permission): string {
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Behörighet saknas</title>
  <link rel="stylesheet" href="/v3.css?v=143"></head><body class="standalone">
  <main class="standalone-card"><p class="eyebrow">403</p><h1>Behörighet saknas</h1>
  <p>Rollen <strong>${role}</strong> har inte behörigheten <code>${permission}</code>. Be en administratör om åtkomst.</p>
  <a class="btn" href="/app">Till dashboarden</a></main></body></html>`;
}

export function assertSameOrigin(ctx: RequestContext): Response | null {
  if (isSameOrigin(ctx.req)) return null;
  return json({ error: "csrf", message: "Begäran kommer från en annan domän." }, 403);
}

export async function readForm(ctx: RequestContext): Promise<FormDataLike | null> {
  if (ctx.form) return ctx.form;
  try {
    const form = await ctx.req.formData();
    ctx.form = form;
    return form;
  } catch {
    return null;
  }
}

export const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export const numOr = (v: unknown, fallback: number): number => {
  const raw = str(v).replace(",", ".");
  if (raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export function wantsJson(req: Request): boolean {
  return (req.headers.get("accept") ?? "").includes("application/json");
}

export { membershipFor };
