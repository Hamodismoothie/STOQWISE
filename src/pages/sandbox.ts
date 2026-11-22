/**
 * Sandbox: the real product interface running on the synthetic demo dataset.
 *
 * Deliberately read-only. The dataset is generated in process, never stored and
 * never mixed with a customer organisation, so there is nothing a sandbox visit
 * can change in the production platform. Every figure on these pages comes from
 * the same analyze() call that produces the customer's own analysis.
 */
import type { AnalysisResult, AnalyzedItem, ItemAction } from "../analysis.ts";
import type { Role } from "../data/repo.ts";
import type { IntelligenceSnapshot } from "../core/intelligence.ts";
import { abcXyzMatrix, forecastChart, treemap } from "../ui/charts.ts";
import { badge, card, emptyState, esc, icon, kpi, shell, table, type ShellOrg, type ShellUser } from "../ui/base.ts";
import { appAction, appDynamic, appNum, appPct, appSek, appText, appTranslator } from "../i18n-app.ts";
import type { Locale } from "../i18n.ts";
import { localizeCategory } from "../terminology.ts";
import type { DemoEnvironmentMeta } from "../demo.ts";

const sek = (locale: Locale, n: number): string => appSek(locale, n);
const sv = (locale: Locale, n: number): string => appNum(locale, n, 0);
const num = (locale: Locale, n: number, d = 0): string => appNum(locale, n, d);
const pct = (locale: Locale, n: number, d = 1): string => appPct(locale, n, d);
const moneyRange = (locale: Locale, low: number, high: number): string => {
  const compact = high >= 1_000_000;
  const from = appSek(locale, low, compact);
  const to = appSek(locale, high, compact);
  // Same rule as the dashboard: the currency is stated once, not twice.
  const prefix = from.match(/^[^\d]*/)?.[0] ?? "";
  return `${from}–${prefix && to.startsWith(prefix) ? to.slice(prefix.length) : to}`;
};

export interface SandboxBase {
  locale: Locale;
  path?: string;
  user: ShellUser;
  org: ShellOrg;
  role: Role;
  result: AnalysisResult;
  intel: IntelligenceSnapshot;
  environment: DemoEnvironmentMeta;
  environments: DemoEnvironmentMeta[];
}

const actionLabel = (locale: Locale, action: ItemAction): string => appAction(locale, action);

function banner(locale: Locale, environment: DemoEnvironmentMeta, environments: DemoEnvironmentMeta[], skuCount: number): string {
  const t = appTranslator(locale);
  const envTitle = locale === "sv" ? environment.title : environment.titleEn;
  const unitItems = locale === "sv" ? "artiklar" : "items";
  const unitMonths = locale === "sv" ? "månader" : "months";
  const envLinks = environments
    .map((env) => `<a class="demo-env ${env.id === environment.id ? "is-active" : ""}" href="/app/sandbox/miljo/${env.id}">${esc(locale === "sv" ? env.accent : env.accentEn)}</a>`)
    .join("");
  return `<div class="sandbox-banner">
    <div class="sandbox-banner-line"><span class="sandbox-tag">${t("Sandbox")}</span>
      <span><strong>${esc(environment.company)}</strong> · ${esc(envTitle)} · ${skuCount} ${unitItems} · ${environment.months} ${unitMonths}</span>
      <a class="link-btn" href="/app">${t("Till din analys")} ${icon("arrow", 13)}</a></div>
    <div class="sandbox-banner-line demo-env-row"><span class="hint">${t("Produktdemonstration. Byt miljö:")}</span><nav class="demo-env-switcher" aria-label="${t("Demonstrationsmiljöer")}">${envLinks}</nav></div>
  </div>`;
}

function actionReason(locale: Locale, item: AnalyzedItem): string {
  const t = appTranslator(locale);
  switch (item.action) {
    case "write_off":
      return item.monthsSinceLastSale === null
        ? t("Ingen försäljning i historiken")
        : t("Ingen försäljning på {n} månader", { n: num(locale, item.monthsSinceLastSale) });
    case "liquidate":
      return t("{n} enheter över beställningspunkt", { n: num(locale, item.overstockQty) });
    case "reduce":
      return t("Överlager {value}", { value: sek(locale, item.overstockValue) });
    case "reorder":
      return t("Täcker {cover} dagar vid ledtid {lead}", { cover: item.coverDays === null ? "okänd" : num(locale, item.coverDays), lead: num(locale, item.leadTimeDays) });
    case "review":
      return item.xyz === "Z"
        ? t("Oregelbunden efterfrågan, granska manuellt")
        : t("Avviker från förväntat mönster");
    default:
      return t("Inom beställningspunkt");
  }
}

/* ------------------------------------------------------------------ dashboard */

export function sandboxDashboard(input: SandboxBase & { history: number[]; forecastPoints: Array<{ value: number; lo: number; hi: number }> }): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const itemCount = (n: number) => t(k.skuCount === 1 ? "{n} artikel" : "{n} artiklar", { n });
  const { result } = input;
  const k = result.kpis;
  const priorities = input.intel.priorities.slice(0, 8);

  const chart = forecastChart(
    input.history.map((v, i) => ({ label: `M${i + 1}`, value: v })),
    input.forecastPoints.map((p, i) => ({ label: `P${i + 1}`, value: p.value, lo: p.lo, hi: p.hi })),
    { width: 720, height: 240, locale },
  );

  const board = `<div class="grid">
    ${[
      [t("Lagervärde"), sek(locale, k.inventoryValue), itemCount(k.skuCount)],
      [t("Inaktivt lager"), sek(locale, k.deadStockValue), itemCount(k.deadStockCount)],
      [t("Överlager"), sek(locale, k.overstockValue), itemCount(k.overstockCount)],
      [t("Lageromsättning"), t("{n} ggr/år", { n: num(locale, k.turns, 2) }), k.daysOfInventory ? t("{n} dagars liggtid", { n: sv(locale, k.daysOfInventory) }) : t("saknar historik")],
      [t("Bristrisk"), itemCount(k.stockoutRiskCount), t("{value} i riskerad försäljning", { value: sek(locale, k.stockoutRiskValue) })],
      [t("Frigjort kapital"), moneyRange(locale, k.potentialReleaseLow, k.potentialReleaseHigh), t("25–55 % realisationsgrad")],
    ]
      .map(([label, value, sub]) => `<div class="span-4">${kpi({ label: label!, value: value!, sub: sub! })}</div>`)
      .join("")}

    ${card({
      span: 7,
      title: t("Kapital per kategori"),
      subtitle: t("Ytan är lagervärde. Mörk ton betyder att kapitalet inte rör sig."),
      body: treemap(
        input.intel.capital.byCategory.slice(0, 8).map((c) => ({ ...c, label: localizeCategory(c.label, locale) })),
        { height: 300, locale },
      ),
    })}

    ${card({
      span: 5,
      title: "ABC / XYZ",
      subtitle: t("Värde och efterfrågestabilitet per klass."),
      body: input.intel.classification.matrix.length
        ? abcXyzMatrix(input.intel.classification.matrix, { locale })
        : emptyState(t("XYZ saknas"), t("Minst sex månader av månadsförsäljning krävs.")),
    })}

    ${card({
      span: 12,
      title: t("Prioriterade artiklar"),
      subtitle: t("Sorterat på påverkan i kronor. Öppna en artikel för att se beräkningen."),
      body: priorities.length
        ? `<div class="priority-list">${priorities
            .map(
              (p, i) => `<a class="priority-item" href="/app/sandbox/artiklar/${encodeURIComponent(p.sku)}">
            <span class="priority-rank">${String(i + 1).padStart(2, "0")}</span>
            <span><span class="priority-title">${esc(p.name)}</span><p class="priority-why">${esc(p.reasons.map((r) => appDynamic(locale, r)).join(" · "))}</p></span>
            <span class="right mono">${sek(locale, p.value)}</span></a>`,
            )
            .join("")}</div>`
        : emptyState(t("Inga åtgärder"), t("Alla artiklar ligger inom sina beställningspunkter.")),
    })}

    ${card({
      span: 12,
      title: t("Efterfrågan och prognos"),
      subtitle: t("Aggregerad månadsförsäljning med sex månaders framskrivning och osäkerhetsband."),
      body: chart + `<div class="legend"><span><i style="background:var(--ink-soft)"></i>${t("Faktisk")}</span><span><i style="background:var(--signal)"></i>Prognos</span></div>`,
    })}
  </div>`;

  return shell({
    locale,
    path: input.path,
    title: t("Sandbox"),
    active: "sandbox",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: `${esc(input.environment.company)} · ${esc(input.locale === "sv" ? input.environment.industry : input.environment.industryEn)}`,
    content: banner(locale, input.environment, input.environments, result.kpis.skuCount) + board,
  });
}

/* ---------------------------------------------------------------------- items */

export function sandboxItems(input: SandboxBase & { query: Record<string, string> }): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const q = input.query;
  const search = (q.q ?? "").trim().toLowerCase();
  const category = q.category ?? "";
  const action = q.action ?? "";
  const sort = q.sort ?? "value";
  const dir = q.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const perPage = 25;

  const filtered = input.result.items.filter((item) => {
    if (search && !`${item.sku} ${item.name} ${item.supplier ?? ""}`.toLowerCase().includes(search)) return false;
    if (category && (item.category ?? "Utan kategori") !== category) return false;
    if (action && item.action !== action) return false;
    return true;
  });

  const key = sort === "sku" ? (i: AnalyzedItem) => i.sku : (i: AnalyzedItem) => (sort === "stock" ? i.stock : sort === "cover" ? (i.coverDays ?? 0) : i.value);
  const sorted = [...filtered].sort((a, b) => {
    const av = key(a);
    const bv = key(b);
    if (typeof av === "string" && typeof bv === "string") return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    return dir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av);
  });

  const pages = Math.max(1, Math.ceil(sorted.length / perPage));
  const current = Math.min(page, pages);
  const rows = sorted.slice((current - 1) * perPage, current * perPage);

  const catList = [...new Set(input.result.items.map((i) => i.category ?? "Utan kategori"))].sort();

  const toolbar = `<form class="filterbar" method="get" action="/app/sandbox/artiklar">
    <div class="form-row grow"><label for="q">${t("Sök")}</label>
      <input id="q" name="q" type="search" value="${esc(q.q ?? "")}" placeholder="${t("Artikelnummer, benämning eller leverantör")}"></div>
    <div class="form-row"><label for="cat">${t("Kategori")}</label>
      <select id="cat" name="category"><option value="">${t("Alla")}</option>${catList
        .map((c) => `<option value="${esc(c)}" ${category === c ? "selected" : ""}>${esc(localizeCategory(c, locale))}</option>`)
        .join("")}</select></div>
    <div class="form-row"><label for="act">${t("Åtgärd")}</label>
      <select id="act" name="action"><option value="">${t("Alla")}</option>${((["write_off", "liquidate", "reduce", "reorder", "review", "ok"] as ItemAction[]))
        .map((a) => `<option value="${a}" ${action === a ? "selected" : ""}>${actionLabel(locale, a)}</option>`)
        .join("")}</select></div>
    <button class="btn" type="submit">${icon("filter", 15)} ${t("Filtrera")}</button>
    <a class="btn btn-ghost" href="/app/sandbox/artiklar">${t("Rensa")}</a>
  </form>`;

  const rowsHtml = table({
    columns: [
      { key: "sku", label: t("Artikel"), sortable: true },
      { key: "name", label: t("Benämning"), sortable: true },
      { key: "category", label: t("Kategori") },
      { key: "stock", label: t("Saldo"), align: "right", sortable: true },
      { key: "value", label: t("Lagervärde"), align: "right", sortable: true },
      { key: "cover", label: t("Täckning"), align: "right", sortable: true },
      { key: "rop", label: t("Beställningspunkt"), align: "right" },
      { key: "klass", label: "ABC / XYZ" },
      { key: "action", label: t("Åtgärd") },
    ],
    rows: rows.map((r) => ({
      sku: `<span class="mono">${esc(r.sku)}</span>`,
      name: esc(r.name),
      category: esc(r.category ? localizeCategory(String(r.category), locale) : "–"),
      stock: sv(locale, r.stock),
      value: sek(locale, r.value),
      cover: r.coverDays === null ? "–" : `${sv(locale, r.coverDays)} d`,
      rop: sv(locale, r.reorderPoint),
      klass: `<span class="mono">${esc(r.abc)}${r.xyz ? ` / ${esc(r.xyz)}` : ""}</span>`,
      action: badge(actionLabel(locale, r.action), r.action === "ok" ? "default" : r.action === "reorder" ? "ok" : "warn"),
    })),
    rowHref: (row) => `/app/sandbox/artiklar/${encodeURIComponent(String(row.sku).replace(/<[^>]*>/g, ""))}`,
    empty: t("Inga artiklar matchar filtret."),
    sortKey: sort,
    sortDir: dir,
    baseQuery: { q: q.q ?? "", category, action },
  });

  const pager =
    pages <= 1
      ? ""
      : `<nav class="pagination" aria-label="${t("Sidnavigering")}">
    ${current > 1 ? `<a class="page-link" href="?${new URLSearchParams({ q: q.q ?? "", category, action, sort, dir, page: String(current - 1) })}">${t("← Föregående")}</a>` : `<span class="page-link is-disabled">${t("← Föregående")}</span>`}
    <span class="page-status">${t("Sida {page} av {pages}", { page: current, pages })} · ${t("{n} artiklar", { n: sv(locale, sorted.length) })}</span>
    ${current < pages ? `<a class="page-link" href="?${new URLSearchParams({ q: q.q ?? "", category, action, sort, dir, page: String(current + 1) })}">${t("Nästa →")}</a>` : `<span class="page-link is-disabled">${t("Nästa →")}</span>`}
  </nav>`;

  return shell({
    locale,
    path: input.path,
    title: t("Artiklar · Sandbox"),
    active: "sandbox",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: t("{n} artiklar · syntetisk data", { n: sv(locale, sorted.length) }),
    toolbar,
    content: banner(locale, input.environment, input.environments, input.result.kpis.skuCount) + `<section class="card"><div class="card-body flush">${rowsHtml}</div>${pager}</section>`,
  });
}

/* ----------------------------------------------------------------------- item */

export function sandboxItem(input: SandboxBase & { item: AnalyzedItem }): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const { item } = input;
  const history = item.monthlyDemand ?? [];
  const chart = history.length
    ? forecastChart(
        history.map((v, i) => ({ label: `M${i + 1}`, value: v })),
        [],
        { width: 720, height: 240, locale },
      )
    : `<div class="chart-placeholder">${t("Ingen månadshistorik för den här artikeln.")}</div>`;

  const stockUnit = item.unit ?? t("st");
  const facts: Array<[string, string]> = [
    [t("Artikelnummer"), item.sku],
    [t("Kategori"), item.category ? localizeCategory(item.category, locale) : "–"],
    [t("Underkategori"), item.subcategory ?? "–"],
    [t("Varumärke"), item.brand ?? "–"],
    [t("Leverantör"), item.supplier ?? "–"],
    [t("Saldo"), `${sv(locale, item.stock)} ${stockUnit}`],
    [t("Reserverat"), `${sv(locale, item.reserved)} ${stockUnit}`],
    ...(item.shelfLifeDays === null ? [] : [[t("Hållbarhet"), `${sv(locale, item.shelfLifeDays)} ${t("dagar")}`] as [string, string]]),
    ...(item.storage === null ? [] : [[t("Förvaring"), esc(item.storage)] as [string, string]]),
    [t("Tillgängligt"), `${sv(locale, item.available)} ${stockUnit}`],
    [t("Enhet"), item.unit ?? "st"],
    [t("Ingående kostnad"), sek(locale, item.cost)],
    [t("Lagervärde"), sek(locale, item.value)],
    [t("Sålt i perioden"), `${sv(locale, item.soldPeriod)} ${t("st")}`],
    [t("Genomsnittlig månadsefterfrågan"), num(locale, item.avgMonthlyDemand, 1)],
    [t("Täckning"), item.coverDays === null ? "–" : `${sv(locale, item.coverDays)} ${t("dagar")}`],
    [t("Ledtid"), `${sv(locale, item.leadTimeDays)} ${t("dagar")}`],
    [t("Säkerhetslager"), `${sv(locale, item.safetyStock)} ${t("st")}`],
    [t("Beställningspunkt"), `${sv(locale, item.reorderPoint)} ${t("st")}`],
    [t("Överlager"), `${sv(locale, item.overstockQty)} ${t("st")} · ${sek(locale, item.overstockValue)}`],
    ["ABC / XYZ", `${item.abc}${item.xyz ? ` / ${item.xyz}` : ""}`],
    [t("Åtgärd"), `${actionLabel(locale, item.action)} · ${sek(locale, item.actionValue)}`],
  ];

  return shell({
    locale,
    path: input.path,
    title: item.name,
    active: "sandbox",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: `${item.sku} · ${t("sandbox")}`,
    actions: `<a class="btn btn-ghost" href="/app/sandbox/artiklar">${icon("arrow", 15)} ${t("Tillbaka")}</a>`,
    content:
      banner(locale, input.environment, input.environments, input.result.kpis.skuCount) +
      `<div class="grid">
        ${card({
          span: 5,
          title: t("Artikeldata"),
          subtitle: t("Beräknat av analysmotorn på syntetisk data."),
          body: `<dl class="stat-line-col">${facts
            .map(([label, value]) => `<div class="stat-line"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`)
            .join("")}</dl>`,
        })}
        <div class="span-7">
          ${card({
            title: t("Månadsefterfrågan"),
            subtitle: t("Sålda enheter per månad i underlaget."),
            body: chart,
          })}
          ${card({
            title: t("Varför åtgärden föreslås"),
            body: `<p>${esc(actionReason(locale, item))}</p>
              ${item.shelfLifeDays !== null && item.coverDays !== null && item.coverDays > item.shelfLifeDays ? `<p class="hint">${t("Lagret motsvarar {cover} dagars förbrukning men hållbarheten är {shelf} dagar. Risk för svinn: sälj äldsta partiet först enligt FEFO och minska nästa påfyllning.", { cover: sv(locale, item.coverDays), shelf: sv(locale, item.shelfLifeDays) })}</p>` : ""}
      <p class="hint">${t("Beräkningen utgår från tillgängligt saldo {stock}, ledtid {lead} dagar, säkerhetslager {safety} och beställningspunkt {reorder}. Ingen åtgärd är genomförd. Sandboxen är läsbar och sparar inget.", { stock: sv(locale, item.available), lead: sv(locale, item.leadTimeDays), safety: sv(locale, item.safetyStock), reorder: sv(locale, item.reorderPoint) })}</p>
              <p class="hint">${t("Motsvarande analys körs på din egen export när du laddar upp en fil.")}</p>
              <a class="btn" href="/app/importera">${t("Analysera din data")} ${icon("arrow", 15)}</a>`,
          })}
        </div>
      </div>`,
  });
}
