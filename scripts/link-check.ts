/**
 * Link and page check for the public surface.
 *
 * Crawls every reachable public page from the start URL, follows internal links
 * and reports pages with a non-2xx/3xx status, pages without a title, and links
 * that point to a missing route. Read-only: it only issues GET requests.
 *
 * Usage:
 *   BASE=http://localhost:3997 bun scripts/link-check.ts
 *
 * Exit code 1 when a broken page or link is found, so it can gate a workflow.
 */

const BASE = (process.env.BASE ?? "http://localhost:3000").replace(/\/$/, "");
const MAX_PAGES = Number(process.env.MAX_PAGES ?? "80");

const SKIP_PREFIXES = ["/api/", "/app", "/admin", "/logga-ut", "/media/", "/assets/"];

type PageResult = {
  path: string;
  status: number;
  title: string;
};

function normalize(href: string): string | null {
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return null;
  let url: URL;
  try {
    url = new URL(href, BASE);
  } catch {
    return null;
  }
  if (url.origin !== new URL(BASE).origin) return null;
  if (SKIP_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;
  if (/\.(png|jpg|jpeg|webp|svg|gif|pdf|csv|xlsx|zip|woff2?)$/i.test(url.pathname)) return null;
  return url.pathname + url.search;
}

function titleOf(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1]!.trim() : "";
}

const seen = new Map<string, PageResult>();
const queue: string[] = ["/"];
const links = new Map<string, Set<string>>();
const brokenLinks: Array<{ from: string; to: string; status: number }> = [];

while (queue.length > 0 && seen.size < MAX_PAGES) {
  const path = queue.shift()!;
  if (seen.has(path)) continue;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { redirect: "follow", headers: { accept: "text/html" } });
  } catch (error) {
    console.error(`Request failed for ${path}: ${error instanceof Error ? error.message : String(error)}`);
    seen.set(path, { path, status: 0, title: "" });
    continue;
  }

  const html = (response.headers.get("content-type") ?? "").includes("text/html") ? await response.text() : "";
  seen.set(path, { path, status: response.status, title: titleOf(html) });
  if (!html) continue;

  const found = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"/gi)) {
    const target = normalize(match[1]!);
    if (!target) continue;
    found.add(target);
    if (!seen.has(target) && !queue.includes(target)) queue.push(target);
  }
  if (found.size > 0) links.set(path, found);
}

// Re-check the final set once, so a link is reported only if the target is
// genuinely unreachable and not just queued past the page limit.
for (const [from, targets] of links) {
  for (const to of targets) {
    const result = seen.get(to);
    if (!result) continue;
    if (result.status >= 400 || result.status === 0) brokenLinks.push({ from, to, status: result.status });
  }
}

const pages = [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
const failing = pages.filter((page) => page.status >= 400 || page.status === 0);
const untitled = pages.filter((page) => page.status < 400 && !page.title);

console.log(`Kontrollerade ${pages.length} sidor från ${BASE}.`);
for (const page of pages) console.log(`  ${page.status}  ${page.path}${page.title ? `  — ${page.title}` : "  — SAKNAR TITEL"}`);

if (brokenLinks.length > 0) {
  console.log(`\nTrasiga länkar (${brokenLinks.length}):`);
  for (const link of brokenLinks) console.log(`  ${link.from} → ${link.to} (${link.status})`);
}
if (failing.length > 0) console.log(`\nSidor med felstatus: ${failing.length}`);
if (untitled.length > 0) console.log(`\nSidor utan titel: ${untitled.length}`);

process.exit(failing.length > 0 || brokenLinks.length > 0 ? 1 : 0);
