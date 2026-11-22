/**
 * HTTP plumbing: routing, request context, guards, rate limiting and headers.
 *
 * Kept separate from the server so route modules stay readable and so the same
 * guards can be reused by the JSON API without duplicating permission logic.
 */
import type { OrgRow, Permission, Role } from "./data/repo.ts";
import { can, membershipFor, orgForUser } from "./data/repo.ts";
import { currentUser, isSameOrigin } from "./auth.ts";
import type { UserRow } from "./db.ts";

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
  const headers = new Headers(res.headers);
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
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
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

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "127.0.0.1";
}

export async function buildContext(req: Request, params: Record<string, string>): Promise<RequestContext> {
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
    ip: clientIp(req),
  };
}

/* ------------------------------------------------------------------- guards */

export function requireUser(ctx: RequestContext, json401 = false): Response | null {
  if (ctx.user) return null;
  if (json401) return json({ error: "unauthorized", message: "Inloggning krävs." }, 401);
  return redirect(`/logga-in?nasta=${encodeURIComponent(ctx.url.pathname)}`);
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
  return null;
}

function forbiddenPage(role: Role, permission: Permission): string {
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Behörighet saknas</title>
  <link rel="stylesheet" href="/v3.css?v=92"></head><body class="standalone">
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
