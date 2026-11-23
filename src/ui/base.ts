/**
 * Design system: shell, navigation and primitives.
 *
 * Nordic Intelligence: pine navigation, warm paper surfaces, deep-teal
 * actions and a single copper signal. Geist Sans carries the interface and
 * Geist Mono the technical identifiers.
 * Everything is server-rendered so it works without JavaScript; the script
 * only adds motion, menus and view switching.
 */
import type { Role } from "../data/repo.ts";
import { can, limitsFor } from "../data/repo.ts";
import { DEFAULT_LOCALE, LOCALES, dirFor, localeInfo, strings, type Locale } from "../i18n.ts";
import { appDate, appText } from "../i18n-app.ts";
import { searchExamples } from "../terminology.ts";
import { OG_IMAGE_PATH, absoluteUrl, isIndexable, structuredDataJsonLd } from "../seo.ts";
import { fieldValues } from "../admin/store.ts";
import { previewMode } from "../admin/preview.ts";
import { trialState } from "../trial-state.ts";

/**
 * CMS text. Published value for the key when set, otherwise the copy that ships
 * with the code, so a fresh install renders exactly as before.
 */
export const cmsText = (locale: Locale, key: string, fallback: string): string =>
  fieldValues("site", locale, previewMode())[key] ?? fallback;

export const esc = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function money(value: number, compact = false): string {
  if (!Number.isFinite(value)) return "–";
  const abs = Math.abs(value);
  if (compact && abs >= 1_000_000) return `${(value / 1_000_000).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} Mkr`;
  if (compact && abs >= 10_000) return `${Math.round(value / 1000).toLocaleString("sv-SE")} tkr`;
  return `${Math.round(value).toLocaleString("sv-SE")} kr`;
}

/**
 * A span between two amounts reads badly as "590 665 kr–1 355 206 kr" in a
 * narrow KPI tile. Above a million both ends share the unit instead.
 */
export function moneyRange(low: number, high: number): string {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return "–";
  const lo = Math.min(low, high);
  const hi = Math.max(low, high);
  if (hi >= 1_000_000) {
    const millions = (value: number): string =>
      (value / 1_000_000).toLocaleString("sv-SE", { maximumFractionDigits: 1 });
    return `${millions(lo)}–${millions(hi)}\u00a0Mkr`;
  }
  return `${money(lo)}–${money(hi)}`;
}

export const num = (value: number, decimals = 0): string =>
  Number.isFinite(value)
    ? value.toLocaleString("sv-SE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : "–";

export const pct = (value: number, decimals = 1): string => `${num(value, decimals)} %`;

export function date(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { year: "numeric", month: "short", day: "numeric" });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("sv-SE", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* ---------------------------------------------------------------- icons */

const ICONS: Record<string, string> = {
  radar: `<circle cx="12" cy="12" r="9" opacity=".35"/><circle cx="12" cy="12" r="4.5" opacity=".6"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><path d="M12 12 20 6"/>`,
  grid: `<rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/>`,
  layers: `<path d="M12 3 3 7.5 12 12l9-4.5L12 3Z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>`,
  trend: `<path d="M3 17l5-6 4 3 5-7 4 3"/><path d="M3 21h18"/>`,
  sliders: `<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>`,
  spark: `<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m6.5 6.5 2.5 2.5M15 15l2.5 2.5M17.5 6.5 15 9M9 15l-2.5 2.5"/>`,
  upload: `<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>`,
  plug: `<path d="M9 3v6M15 3v6"/><path d="M6 9h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V9Z"/><path d="M12 18v3"/>`,
  key: `<circle cx="8" cy="12" r="4"/><path d="M12 12h9"/><path d="M17 12v3M20 12v2"/>`,
  users: `<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M17 11a3 3 0 1 0 0-6"/><path d="M21 20a5 5 0 0 0-4-4.9"/>`,
  settings: `<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>`,
  book: `<path d="M4 4h7v16H4z"/><path d="M13 4h7v16h-7z"/><path d="M4 8h7M13 8h7"/>`,
  search: `<circle cx="11" cy="11" r="7"/><path d="m16 16 4.5 4.5"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>`,
  moon: `<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>`,
  arrow: `<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>`,
  chevron: `<path d="m6 9 6 6 6-6"/>`,
  check: `<path d="m4 12 5 5L20 6"/>`,
  alert: `<path d="M12 3 2 20h20L12 3Z"/><path d="M12 9v5M12 17v.5"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>`,
  box: `<path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5v-7Z"/><path d="M3 8.5 12 13l9-4.5M12 13v7"/>`,
  logout: `<path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  download: `<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>`,
  filter: `<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>`,
  play: `<path d="M7 4l13 8-13 8V4Z"/>`,
  reset: `<path d="M3 12a9 9 0 1 0 3.2-6.9"/><path d="M3 4v5h5"/>`,
  pause: `<rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/>`,
  menu: `<path d="M4 7h16M4 12h16M4 17h16"/>`,
  panel: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>`,
  help: `<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1.1 1-1.1 1.8"/><path d="M12 17h.01"/>`,
  bolt: `<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>`,
  close: `<path d="M6 6l12 12M18 6 6 18"/>`,
};

const LINKEDIN_URL = "https://www.linkedin.com/company/stoqwise";

const linkedinMark = `<svg class="icon icon-linkedin" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45z"/></svg>`;

export function icon(name: string, size = 18, className = ""): string {
  return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ICONS.grid}</svg>`;
}

/* ------------------------------------------------------------------ shell */

export interface ShellUser {
  id: string;
  name: string;
  email: string;
}

export interface ShellOrg {
  name: string;
  plan: string;
  trial_ends_at?: string | null;
}

export interface ShellOptions {
  title: string;
  locale?: Locale;
  /** Current path with query, so switching language returns to the same view. */
  path?: string;
  active: string;
  user: ShellUser;
  org: ShellOrg;
  role: Role;
  content: string;
  subtitle?: string;
  actions?: string;
  /** Rendered above the page content, e.g. a filter bar. */
  toolbar?: string;
  bare?: boolean;
}

const NAV: Array<{ key: string; group: string; href: string; label: string; folio: string; icon: string; permission: "data.read" | "data.write" | "copilot.use" | "api.manage" | "org.manage" }> = [
  { key: "dashboard", group: "Analys", href: "/app", label: "Översikt", folio: "01", icon: "grid", permission: "data.read" as const },
  { key: "items", group: "Analys", href: "/app/artiklar", label: "Lager", folio: "02", icon: "layers", permission: "data.read" as const },
  { key: "world", group: "Analys", href: "/app/lagervarld", label: "Lagervärld", folio: "02b", icon: "radar", permission: "data.read" as const },
  { key: "forecast", group: "Analys", href: "/app/prognos", label: "Efterfrågan", folio: "03", icon: "trend", permission: "data.read" as const },
  { key: "procurement", group: "Analys", href: "/app/inkop", label: "Inköp", folio: "03b", icon: "box", permission: "data.read" as const },
  { key: "simulate", group: "Analys", href: "/app/simulering", label: "Optimering", folio: "04", icon: "sliders", permission: "data.read" as const },
  { key: "copilot", group: "Analys", href: "/app/copilot", label: "AI-insikter", folio: "05", icon: "spark", permission: "copilot.use" as const },
  { key: "imports", group: "Data", href: "/app/importera", label: "Importer", folio: "06", icon: "upload", permission: "data.write" as const },
  { key: "integrations", group: "Data", href: "/app/integrationer", label: "Integrationer", folio: "07", icon: "plug", permission: "api.manage" as const },
  { key: "sandbox", group: "Data", href: "/app/sandbox", label: "Sandbox", folio: "11", icon: "radar", permission: "data.read" as const },
  { key: "team", group: "Organisation", href: "/app/team", label: "Team", folio: "08", icon: "users", permission: "data.read" as const },
  { key: "estimate", group: "Organisation", href: "/app/prisestimat", label: "Prisestimat", folio: "09", icon: "sliders", permission: "data.read" as const },
  { key: "billing", group: "Organisation", href: "/app/abonnemang", label: "Abonnemang", folio: "10", icon: "key", permission: "data.read" as const },
  { key: "audit", group: "Organisation", href: "/app/logg", label: "Logg", folio: "11", icon: "clock", permission: "org.manage" as const },
  { key: "help", group: "Organisation", href: "/hjalp", label: "Hjälp", folio: "12", icon: "book", permission: "data.read" as const },
];

/**
 * The supplied STOQWISE artwork is the brand. It is used as delivered, as an
 * image file, so no code path can redraw, recolour or re-proportion it.
 * Horizontal lockup for mastheads and footers, stacked lockup for the rail.
 */
export const brandLockup = (variant: "horizontal" | "stacked" = "horizontal", cls = ""): string => {
  const lockup =
    variant === "stacked"
      ? { name: "stoqwise-mark", w: 220, h: 216 }
      : { name: "stoqwise-logo", w: 370, h: 108 };
  const img = (tone: "ink" | "light") =>
    `<img class="brand-lockup brand-lockup-${variant} brand-lockup-${tone}${cls ? ` ${cls}` : ""}" src="/brand/${lockup.name}${tone === "light" ? "-light" : ""}.svg?v=2" alt="STOQWISE" width="${lockup.w}" height="${lockup.h}" decoding="async">`;
  // Two files, one geometry: the ink artwork on light surfaces, the light
  // artwork on dark ones. Exactly one is rendered, so no plate is needed.
  return `${img("ink")}${img("light")}`;
};

export function shell(options: ShellOptions): string {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const t = (source: string, vars?: Record<string, string | number>): string => appText(locale, source, vars);
  const limits = limitsFor(options.org.plan);
  const trial = trialState(options.org);
  const trialBanner = trial.isTrial && trial.endsAt
    ? trial.ended
      ? alert(
          `<strong>${t("Provperioden har tagit slut.")}</strong> ${t("Organisationen är i läsbart läge. All data finns kvar och kan läsas eller exporteras.")} <a href="/app/export">${t("Exportera")}</a> · <a href="/app/prisestimat">${t("Begär offert")}</a> ${t("för att fortsätta.")} <a href="/app/abonnemang#provperiod">${t("Läs mer")}</a>`,
          "warn",
        )
      : alert(
          `<strong>${trial.daysLeft <= 1 ? t("Sista dagen av provperioden.") : t("Provperiod: {n} dagar kvar.", { n: trial.daysLeft })}</strong> ${t("Provperioden slutar {date}.", { date: appDate(locale, trial.endsAt) })} <a href="/app/prisestimat">${t("Begär offert")}</a> ${t("för att fortsätta efteråt.")} <a href="/app/abonnemang#provperiod">${t("Läs mer")}</a>`,
          trial.daysLeft <= 3 ? "warn" : "info",
        )
    : "";
  let lastGroup = "";
  const nav = NAV.filter((item) => can(options.role, item.permission))
    .map((item) => {
      const heading = item.group !== lastGroup ? `<p class="rail-group">${t(item.group)}</p>` : "";
      lastGroup = item.group;
      return `${heading}<a class="rail-link ${item.key === options.active ? "is-active" : ""}" href="${item.href}" data-folio="${item.folio}" ${
        item.key === options.active ? 'aria-current="page"' : ""
      }>${icon(item.icon, 16)}<span>${t(item.label)}</span><em>${item.folio}</em></a>`;
    })
    .join("");

  // Den inloggade appen får inte indexeras ens om robots.txt ignoreras.
  return `<!doctype html>
<html lang="${locale}" dir="${dirFor(locale)}" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, follow">
<title>${esc(options.title)} · STOQWISE</title>
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#0e1a18">
<link rel="preload" href="/fonts/geist-sans-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/geist-sans-600.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/geist-mono-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/v3.css?v=143">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script src="/v3.js?v=81" defer></script>
</head>
<body class="app-body">
<a class="skip" href="#main">${t("Hoppa till innehåll")}</a>
<div class="app-frame">
  <aside class="rail" id="app-rail" aria-label="${t("Huvudnavigering")}">
    <a class="rail-brand" href="/app" aria-label="STOQWISE">${brandLockup()}</a>
    <nav class="rail-nav">${nav}</nav>
    <div class="rail-foot">
      <button class="rail-link" type="button" data-command-open aria-label="${t("Sök (⌘K)")}" data-folio="⌘">${icon("search", 16)}<span>${t("Sök")}</span></button>
      <button class="rail-link" type="button" data-theme-toggle aria-label="${t("Byt tema")}" data-theme-light-label="${t("Byt till ljust tema")}" data-theme-dark-label="${t("Byt till mörkt tema")}" data-folio="◐">${icon("moon", 16)}<span>${t("Tema")}</span></button>
      <button class="rail-link" type="button" data-motion-toggle aria-pressed="false" data-motion-off-label="${t("Rörelse: pausa animationer")}" data-motion-on-label="${t("Rörelse av: aktivera animationer")}" data-motion-off-text="${t("Rörelse")}" data-motion-on-text="${t("Rörelse av")}" data-folio="Ⅱ">${icon("pause", 16)}<span>${t("Rörelse")}</span></button>
      <form method="post" action="/logga-ut" class="rail-form">
        <button class="rail-link" type="submit" data-folio="→"><span>${t("Logga ut")}</span></button>
      </form>
    </div>
    <div class="rail-colophon">
      <strong>${esc(options.org.name)}</strong>
      ${esc(appText(locale, limits.name))} · ${esc(roleLabel(options.role, locale))}<br>
      © ${new Date().getFullYear()} STOQWISE
    </div>
  </aside>

  <div class="app-main">
    <header class="topbar">
      <div class="topbar-left">
        <button class="icon-btn rail-toggle" type="button" data-rail-toggle aria-label="${t("Visa eller dölj navigering")}" aria-expanded="true" aria-controls="app-rail">${icon("panel", 17)}</button>
        <span class="page-status">STOQWISE</span>
        <span class="workspace-chip"><i aria-hidden="true"></i>${esc(options.org.name)}</span>
      </div>
      <div class="topbar-right">
        <button class="ghost-btn topbar-search" type="button" data-command-open>
          ${icon("search", 14)}<span>${t("Sök")}</span><kbd>⌘K</kbd>
        </button>
        <a class="icon-btn" href="/app/logg" aria-label="${t("Aktivitetslogg")}" title="${t("Aktivitetslogg")}">${icon("clock", 17)}</a>
        <a class="icon-btn" href="/hjalp" aria-label="${t("Hjälp")}" title="${t("Hjälp")}">${icon("help", 17)}</a>
        ${languageSwitcher(locale, options.path ?? "/app", "topbar-lang")}
        <div class="user-chip" aria-label="${t("Inloggad användare")}">
          <span class="avatar" aria-hidden="true">${esc(initials(options.user.name))}</span>
          <span class="user-name">${esc(options.user.name)}</span>
        </div>
      </div>
    </header>

    <main id="main" class="page">
      ${options.bare ? "" : `<div class="page-head">
        <div>
          <h1>${esc(options.title)}</h1>
          ${options.subtitle ? `<p class="page-sub">${options.subtitle}</p>` : ""}
        </div>
        ${options.actions ? `<div class="page-actions">${options.actions}</div>` : ""}
      </div>`}
      ${trialBanner}
      ${options.toolbar ?? ""}
      ${options.content}
    </main>
  </div>
</div>

<dialog id="command" class="command" aria-label="${t("Snabbsök")}" data-endpoint="/app/sokforslag" data-empty="${t("Inga träffar")}" data-loading="${t("Söker…")}" data-all="${t("Visa alla resultat")}" data-categories="${t("Kategorier")}" data-synonyms="${t("Synonymer")}" data-error="${t("Sökningen misslyckades")}">
  <form method="get" action="/app/artiklar" class="command-form">
    ${icon("search", 18)}
    <input name="q" type="search" placeholder="${t("Sök artikel, SKU…")}" autocomplete="off" aria-label="${t("Sök")}" aria-controls="command-results">
    <button class="command-close" type="button" data-command-close aria-label="${t("Stäng sökningen")}">${icon("close", 15)}<kbd>Esc</kbd></button>
  </form>
  <div class="command-results" id="command-results" data-command-results role="listbox" aria-live="polite"></div>
  <div class="command-hints">
    <a href="/app/artiklar?action=write_off">${t("Inaktivt lager")}</a>
    <a href="/app/artiklar?action=reorder">${t("Bristrisk")}</a>
    <a href="/app/prognos">${t("Prognoser")}</a>
    <a href="/app/simulering">${t("Simulera scenario")}</a>
    <a href="/app/copilot">${t("Fråga copiloten")}</a>
    ${searchExamples(locale).map((term) => `<a href="/app/artiklar?category=${encodeURIComponent(term)}">${term}</a>`).join("")}
  </div>
</dialog>
</body>
</html>`;
}

export function roleLabel(role: Role, locale: Locale = DEFAULT_LOCALE): string {
  return appText(locale, { owner: "Ägare", admin: "Administratör", analyst: "Analytiker", viewer: "Läsare" }[role]);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/* ------------------------------------------------------------ primitives */

export function kpi(input: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warn" | "danger" | "good";
  href?: string;
  spark?: string;
  delta?: { value: number; label?: string };
}): string {
  const body = `
    <span class="kpi-label">${esc(input.label)}</span>
    <span class="kpi-value" data-count="${esc(input.value)}">${esc(input.value)}</span>
    ${input.sub ? `<span class="kpi-sub">${input.sub}</span>` : ""}
    ${input.spark ? `<span class="kpi-spark">${input.spark}</span>` : ""}
    ${
      input.delta
        ? `<span class="kpi-delta ${input.delta.value >= 0 ? "up" : "down"}">${input.delta.value >= 0 ? "▲" : "▼"} ${num(Math.abs(input.delta.value), 1)} %${input.delta.label ? ` <em>${esc(input.delta.label)}</em>` : ""}</span>`
        : ""
    }`;
  const cls = `kpi kpi-${input.tone ?? "default"}`;
  return input.href
    ? `<a class="${cls} kpi-link" href="${input.href}">${body}${icon("arrow", 14, "kpi-go")}</a>`
    : `<div class="${cls}">${body}</div>`;
}

export function card(input: {
  title?: string;
  subtitle?: string;
  actions?: string;
  body: string;
  className?: string;
  id?: string;
  span?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 12;
}): string {
  return `<section class="card ${input.className ?? ""} ${input.span ? `span-${input.span}` : ""}" ${input.id ? `id="${input.id}"` : ""}>
    ${input.title ? `<header class="card-head"><div><h2>${esc(input.title)}</h2>${input.subtitle ? `<p>${input.subtitle}</p>` : ""}</div>${input.actions ?? ""}</header>` : ""}
    <div class="card-body">${input.body}</div>
  </section>`;
}

export function badge(text: string, tone: "default" | "ok" | "warn" | "danger" | "info" = "default"): string {
  return `<span class="badge badge-${tone}">${esc(text)}</span>`;
}

export function actionBadge(action: string, locale: Locale = DEFAULT_LOCALE): string {
  switch (action) {
    case "write_off":
      return badge(appText(locale, "Nedskrivning"), "danger");
    case "liquidate":
      return badge(appText(locale, "Realisera"), "warn");
    case "reduce":
      return badge(appText(locale, "Minska"), "info");
    case "reorder":
      return badge(appText(locale, "Beställ"), "ok");
    case "review":
      return badge(appText(locale, "Granska"), "default");
    default:
      return badge("OK", "default");
  }
}

export function table(input: {
  columns: Array<{ key: string; label: string; align?: "left" | "right"; sortable?: boolean; width?: string }>;
  rows: Array<Record<string, unknown>>;
  rowHref?: (row: Record<string, unknown>) => string;
  /** Extra attributes (for example `data-sku`) for cross-highlighting. */
  rowAttrs?: (row: Record<string, unknown>) => string;
  empty?: string;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  baseQuery?: Record<string, string>;
  caption?: string;
  locale?: Locale;
}): string {
  const locale = input.locale ?? DEFAULT_LOCALE;
  if (input.rows.length === 0)
    return emptyState(
      input.empty ?? appText(locale, "Inga rader matchar filtret."),
      appText(locale, "Prova att rensa filtret eller importera ny data."),
    );
  const headers = input.columns
    .map((col) => {
      const isSorted = input.sortKey === col.key;
      if (!col.sortable) return `<th scope="col" style="text-align:${col.align ?? "left"}" class="${col.align === "right" ? "num" : ""}">${esc(col.label)}</th>`;
      const params = new URLSearchParams({ ...(input.baseQuery ?? {}), sort: col.key, dir: isSorted && input.sortDir === "desc" ? "asc" : "desc" });
      return `<th scope="col" style="text-align:${col.align ?? "left"}" class="${col.align === "right" ? "num" : ""}" aria-sort="${isSorted ? (input.sortDir === "asc" ? "ascending" : "descending") : "none"}">
        <a class="sort-link ${isSorted ? "is-sorted" : ""}" href="?${params.toString()}" data-sort-link>${esc(col.label)}<span class="sort-ind">${isSorted ? (input.sortDir === "asc" ? "↑" : "↓") : "↕"}</span></a></th>`;
    })
    .join("");

  const rows = input.rows
    .map((row) => {
      const cells = input.columns
        .map((col) => `<td style="text-align:${col.align ?? "left"}" class="${col.align === "right" ? "num" : ""}" data-label="${esc(col.label)}">${row[col.key] ?? "–"}</td>`)
        .join("");
      const href = input.rowHref?.(row);
      const attrs = input.rowAttrs?.(row) ?? "";
      return href ? `<tr class="row-link" ${attrs} data-href="${esc(href)}">${cells}</tr>` : `<tr ${attrs}>${cells}</tr>`;
    })
    .join("");

  return `<div class="table-wrap"><table class="data-table">
    ${input.caption ? `<caption>${esc(input.caption)}</caption>` : ""}
    <thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function emptyState(title: string, detail: string, action?: string): string {
  return `<div class="empty"><div class="empty-mark" aria-hidden="true">${icon("radar", 28)}</div>
    <h3>${esc(title)}</h3><p>${esc(detail)}</p>${action ?? ""}</div>`;
}

export function alert(text: string, tone: "ok" | "error" | "warn" | "info" = "info"): string {
  return `<div class="alert alert-${tone}" role="${tone === "error" ? "alert" : "status"}"><span class="alert-icon">${icon(tone === "error" ? "alert" : tone === "ok" ? "check" : "bolt", 16)}</span><div>${text}</div></div>`;
}

export function flash(url: URL, locale: Locale = DEFAULT_LOCALE): string {
  const error = url.searchParams.get("fel");
  const message = url.searchParams.get("meddelande");
  if (error) return alert(esc(appText(locale, error)), "error");
  if (message) return alert(esc(appText(locale, message)), "ok");
  return "";
}

export function tabs(items: Array<{ label: string; href: string; active: boolean; count?: number }>): string {
  return `<nav class="tabs" aria-label="Vyer">${items
    .map(
      (t) =>
        `<a class="tab ${t.active ? "is-active" : ""}" href="${t.href}" ${t.active ? 'aria-current="page"' : ""}>${esc(t.label)}${t.count !== undefined ? `<span class="tab-count">${t.count}</span>` : ""}</a>`,
    )
    .join("")}</nav>`;
}

export function pagination(input: { page: number; pages: number; baseQuery: Record<string, string>; locale?: Locale }): string {
  if (input.pages <= 1) return "";
  const locale = input.locale ?? DEFAULT_LOCALE;
  const t = (source: string, vars?: Record<string, string | number>): string => appText(locale, source, vars);
  const link = (page: number, label: string, disabled = false): string => {
    const params = new URLSearchParams({ ...input.baseQuery, page: String(page) });
    return disabled
      ? `<span class="page-link is-disabled">${label}</span>`
      : `<a class="page-link" href="?${params.toString()}">${label}</a>`;
  };
  return `<nav class="pagination" aria-label="${esc(t("Sidnavigering"))}">
    ${link(Math.max(1, input.page - 1), t("← Föregående"), input.page <= 1)}
    <span class="page-status">${esc(t("Sida {page} av {pages}", { page: input.page, pages: input.pages }))}</span>
    ${link(Math.min(input.pages, input.page + 1), t("Nästa →"), input.page >= input.pages)}
  </nav>`;
}

export function bar(value: number, max: number, tone = ""): string {
  const width = max > 0 ? Math.max(1, Math.min(100, (value / max) * 100)) : 0;
  return `<span class="mini-bar ${tone}" aria-hidden="true"><span style="width:${width.toFixed(1)}%"></span></span>`;
}

export function scorePill(score: number): string {
  const tone = score >= 65 ? "ok" : score >= 40 ? "warn" : "danger";
  return `<span class="score score-${tone}"><span class="score-num">${num(score, 0)}</span><span class="score-max">/100</span></span>`;
}

/* -------------------------------------------------------- marketing shell */

export function marketingShell(input: {
  title: string;
  description?: string;
  active?: string;
  content: string;
  user?: { name: string } | null;
  locale?: Locale;
  path?: string;
}): string {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const c = strings(locale);
  const dir = dirFor(locale);
  const next = input.path ?? "/";
  const sv = locale === "sv";
  // One address per page: the query string is a view, not a document.
  const canonical = absoluteUrl(next);
  const indexable = isIndexable(next);
  const description = input.description ?? cmsText(locale, "site.meta.home.description", c.meta.description);
  const navCopy = sv
    ? {
        product: "Plattformen",
        platform: "Plattformen",
        solutions: "Lösningar",
        industries: "Branscher",
        resources: "Resurser",
        about: "Om oss",
        pricing: "Prissättning",
        demo: "Boka demo",
        overview: "Plattformsöversikt",
        intelligence: "Lagerintelligens",
        forecasting: "Efterfrågeprognos",
        optimization: "Lageroptimering",
        procurement: "Inköpsintelligens",
        insights: "AI-insikter",
        capital: "Frigör bundet kapital",
        availability: "Undvik brist",
        purchasing: "Bättre inköpsbeslut",
        wholesale: "Partihandel och industri",
        retail: "Detaljhandel",
        food: "Livsmedel och foodservice",
        commerce: "E-handel",
        docs: "Dokumentation",
        help: "Hjälpcenter",
        getStarted: "Kom igång",
        integrations: "Integrationer",
        security: "Säkerhet",
      }
    : {
        product: "Platform",
        platform: "Platform",
        solutions: "Solutions",
        industries: "Industries",
        resources: "Resources",
        about: "About",
        pricing: "Pricing",
        demo: "Book a demo",
        overview: "Platform overview",
        intelligence: "Inventory intelligence",
        forecasting: "Demand forecasting",
        optimization: "Inventory optimization",
        procurement: "Procurement intelligence",
        insights: "AI Decision Support",
        capital: "Release tied-up capital",
        availability: "Prevent stockouts",
        purchasing: "Smarter purchasing",
        wholesale: "Wholesale and industry",
        retail: "Retail",
        food: "Food and foodservice",
        commerce: "E-commerce",
        docs: "Documentation",
        help: "Help centre",
        getStarted: "Get started",
        integrations: "Integrations",
        security: "Security",
      };
  const menuLink = (href: string, label: string) => `<a href="${href}">${label}</a>`;
  const nav = `<details class="nav-menu ${input.active === "product" ? "is-active" : ""}">
      <summary>${navCopy.platform}${icon("chevron", 14, "nav-chevron")}</summary>
      <div class="nav-panel nav-panel-wide">
        <div><p class="nav-kicker">${navCopy.platform}</p>${menuLink("/produkt", navCopy.overview)}${menuLink("/#platform", sv ? "Produktdemonstration" : "Product demo")}${menuLink("/#intelligence", navCopy.intelligence)}${menuLink("/#forecasting", navCopy.forecasting)}</div>
        <div><p class="nav-kicker">${sv ? "Beslutsstöd" : "Decision support"}</p>${menuLink("/produkt", navCopy.optimization)}${menuLink("/#procurement", navCopy.procurement)}${menuLink("/dokumentation", navCopy.integrations)}</div>
      </div>
    </details>
    <details class="nav-menu">
      <summary>${navCopy.industries}${icon("chevron", 14, "nav-chevron")}</summary>
      <div class="nav-panel">${menuLink("/#industries", navCopy.wholesale)}${menuLink("/#industries", navCopy.retail)}${menuLink("/#industries", navCopy.food)}${menuLink("/#industries", navCopy.commerce)}</div>
    </details>
    <details class="nav-menu ${input.active === "resources" ? "is-active" : ""}">
      <summary>${navCopy.resources}${icon("chevron", 14, "nav-chevron")}</summary>
      <div class="nav-panel">${menuLink("/dokumentation", navCopy.docs)}${menuLink("/hjalp", navCopy.help)}${menuLink("/kom-igang", navCopy.getStarted)}${menuLink("/exempelrapport.pdf?miljo=industri", sv ? "Exempelrapport" : "Sample report")}</div>
    </details>
    <a class="nav-link" href="/priser">${navCopy.pricing}</a>
    <a class="nav-link ${input.active === "about" ? "is-active" : ""}" href="/om-oss">${navCopy.about}</a>`;
  const mobileNav = `<div class="site-menu-groups">
    <div><p>${navCopy.platform}</p>${menuLink("/produkt", navCopy.overview)}${menuLink("/#intelligence", navCopy.intelligence)}${menuLink("/#forecasting", navCopy.forecasting)}${menuLink("/produkt", navCopy.optimization)}${menuLink("/#procurement", navCopy.procurement)}</div>
    <div><p>${navCopy.industries}</p>${menuLink("/#industries", navCopy.industries)}</div>
    <div><p>${navCopy.resources}</p>${menuLink("/dokumentation", navCopy.docs)}${menuLink("/hjalp", navCopy.help)}${menuLink("/dokumentation", navCopy.integrations)}${menuLink("/priser", navCopy.pricing)}</div>
    <div><p>${sv ? "Företag" : "Company"}</p>${menuLink("/om-oss", navCopy.about)}${menuLink("/kontakt", c.footer.contact)}</div>
  </div>`;

  return `<!doctype html>
<html lang="${locale}" dir="${dir}" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(input.title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#f6f4ef">
${indexable ? `<link rel="canonical" href="${esc(canonical)}">` : `<meta name="robots" content="noindex, follow">`}
${indexable ? `<script type="application/ld+json">${structuredDataJsonLd()}</script>` : ""}
<meta property="og:title" content="${esc(input.title)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="${localeInfo(locale)?.ogLocale ?? "en_US"}">
<meta property="og:site_name" content="STOQWISE">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(absoluteUrl(OG_IMAGE_PATH))}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="STOQWISE">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(input.title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(absoluteUrl(OG_IMAGE_PATH))}">
<link rel="preload" href="/fonts/geist-sans-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/geist-sans-600.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/geist-mono-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/v3.css?v=143">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script src="/v3.js?v=81" defer></script>
</head>
<body class="site-body">
<a class="skip" href="#main">${c.nav.skip}</a>
<header class="site-header">
  <div class="site-wrap site-header-inner">
    <a class="site-brand" href="/">${brandLockup()}</a>
    <nav class="site-nav" aria-label="${c.nav.menu}">${nav}</nav>
    <details class="site-menu">
      <summary aria-label="${c.nav.menu}"><span>${c.nav.menu}</span></summary>
      <div class="site-menu-panel">${mobileNav}<div class="site-menu-actions">${languageSwitcher(locale, next)}<a class="btn btn-ghost" href="/kontakt?amne=demo">${navCopy.demo}</a>${input.user ? `<a class="btn" href="/app">${c.nav.openApp}</a>` : `<a class="btn btn-ghost" href="/logga-in">${c.nav.signIn}</a><a class="btn" href="/skapa-konto">${c.nav.getStarted}</a>`}</div></div>
    </details>
    <div class="site-actions">
      ${languageSwitcher(locale, next)}
      <a class="site-signin" href="/logga-in">${c.nav.signIn}</a>
      <a class="btn btn-sm" href="${input.user ? "/app" : "/skapa-konto"}">${input.user ? c.nav.openApp : c.nav.getStarted}</a>
    </div>
  </div>
</header>
<main id="main">${input.content}</main>
<footer class="site-footer">
  <div class="site-wrap footer-grid">
    <div class="footer-brand">
      <a class="site-brand" href="/">${brandLockup()}</a>
      <p class="footer-claim">${esc(cmsText(locale, "site.footer.tagline", c.footer.tagline))}</p>
      <p class="footer-note">${esc(cmsText(locale, "site.footer.note", sv ? "Byggt i Sverige för internationella lagerteam." : "Built in Sweden for international inventory teams."))}</p>
    </div>
    <div><h4>${navCopy.product}</h4><a href="/produkt">${navCopy.overview}</a><a href="/#intelligence">${navCopy.intelligence}</a><a href="/#forecasting">${navCopy.forecasting}</a><a href="/priser">${navCopy.pricing}</a></div>
    <div><h4>${navCopy.resources}</h4><a href="/dokumentation">${navCopy.docs}</a><a href="/hjalp">${navCopy.help}</a><a href="/kom-igang">${navCopy.getStarted}</a><a href="/dokumentation">${navCopy.integrations}</a></div>
    <div><h4>${c.footer.company}</h4><a href="/om-oss">${c.footer.about}</a><a href="/kontakt">${c.footer.contact}</a><a href="/integritet">${c.footer.privacy}</a><a href="/villkor">${c.footer.terms}</a></div>
  </div>
  <div class="site-wrap footer-bottom"><span>© ${new Date().getFullYear()} STOQWISE. ${esc(cmsText(locale, "site.footer.rights", c.footer.rights))}</span><a class="footer-social" href="${LINKEDIN_URL}" target="_blank" rel="noopener noreferrer" aria-label="${esc(c.footer.linkedinCompany)}">${linkedinMark}</a></div>
</footer>
</body>
</html>`;
}

/**
 * Language picker. A plain GET form so it works without JavaScript; the small
 * script in v3.js submits it when the selection changes.
 */
let langSwitchSeq = 0;

export function languageSwitcher(locale: Locale, next: string, className = ""): string {
  const c = strings(locale);
  const fieldId = `lang-${locale}-${++langSwitchSeq}`;
  const options = LOCALES.filter((l) => l.available)
    .map((l) => `<option value="${l.code}"${l.code === locale ? " selected" : ""} lang="${l.code}">${l.nativeName}</option>`)
    .join("");
  return `<form class="lang-switch ${className}" method="get" action="/sprak" data-lang-form>
    <input type="hidden" name="next" value="${esc(next)}">
    <label class="sr-only" for="${fieldId}">${c.nav.language}</label>
    <select id="${fieldId}" name="lang" data-lang-select aria-label="${c.nav.language}">${options}</select>
  </form>`;
}