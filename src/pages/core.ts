/**
 * Product pages: dashboard, article explorer, article detail, forecast,
 * simulation and copilot.
 *
 * Every page is a pure function of data that was already computed on the server.
 * No page fetches numbers of its own, which is what keeps the dashboard, the PDF
 * and the copilot consistent with each other.
 */
import type { AnalysisResult } from "../analysis.ts";
import type { CopilotAnswer } from "../core/copilot.ts";
import { copilotSuggestions } from "../core/copilot.ts";
import type { IntelligenceSnapshot } from "../core/intelligence.ts";
import { compareScenarios, type ScenarioOutcome, type ScenarioInput } from "../core/simulate.ts";
import type { ForecastResult, SupplyPlan } from "../core/forecast.ts";
import type { Role } from "../data/repo.ts";
import { CLASS_CUTOFFS, DISPLAY, OTHER_CATEGORY_LABEL } from "../tuning.ts";
import { trialState } from "../trial-state.ts";
import { localizeCategory, planSearch } from "../terminology.ts";
import {
  abcXyzMatrix,
  barChart,
  donut,
  forecastChart,
  healthMap,
  riskRadar,
  sparkline,
  treemap,
  valueTimeline,
  velocityMap,
} from "../ui/charts.ts";
import {
  actionBadge,
  alert,
  badge,
  bar,
  card,
  emptyState,
  esc,
  flash,
  icon,
  kpi,
  pagination,
  scorePill,
  shell,
  table,
  tabs,
} from "../ui/base.ts";
import { appAction, appConfidence, appDate, appDateTime, appDynamic, appMethod, appNum, appPct, appSek, appText, appTranslator } from "../i18n-app.ts";
import type { Locale } from "../i18n.ts";

export interface PageContext {
  locale: Locale;
  user: { id: string; name: string; email: string };
  org: { name: string; plan: string; trial_ends_at?: string | null };
  role: Role;
  url: URL;
}

const sv = (locale: Locale, n: number): string => appNum(locale, n, 0);
const sek = (locale: Locale, n: number): string => appSek(locale, n);
const num = (locale: Locale, n: number, d = 0): string => appNum(locale, n, d);
const pct = (locale: Locale, n: number, d = 1): string => appPct(locale, n, d);
const date = (locale: Locale, iso: string): string => appDate(locale, iso);
const dateTime = (locale: Locale, iso: string): string => appDateTime(locale, iso);
const moneyRange = (locale: Locale, low: number, high: number): string => {
  const compact = high >= 1_000_000;
  const from = appSek(locale, low, compact);
  const to = appSek(locale, high, compact);
  // Repeating the currency on both figures ("SEK 46,332–SEK 105,737") costs a
  // third of the card width and pushed the value past the KPI tile, so the
  // second figure carries only the shared prefix when the two match.
  const prefix = from.match(/^[^\d]*/)?.[0] ?? "";
  return `${from}–${prefix && to.startsWith(prefix) ? to.slice(prefix.length) : to}`;
};
const methodLabel = (locale: Locale, m: string): string => appMethod(locale, m);
const confidenceLabel = (locale: Locale, c: string): string => appConfidence(locale, c);

/* ------------------------------------------------------------- dashboard */

/** First screen after sign-up. A trial without an analysis should explain the
 * next three steps, not show an empty dashboard. An ended trial must not offer
 * an upload that the write guard will reject. */
export function dashboardEmptyState(input: {
  locale: Locale;
  org: { plan: string; trial_ends_at?: string | null };
}): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const trial = trialState(input.org);

  if (trial.ended) {
    return `<div class="card"><div class="card-body">
      <div class="empty"><div class="empty-mark">${icon("radar", 26)}</div>
        <p class="eyebrow">${t("Provperioden har tagit slut")}</p>
        <h3>${t("Ingen analys ännu")}</h3>
        <p>${t("Organisationen är i läsbart läge. Det finns ingen analys att visa, men alla data som redan finns kan exporteras. Begär en offert för att aktivera en betald plan och öppna skrivåtkomsten igen.")}</p>
        <div class="flex gap-2 mt-4" style="flex-wrap:wrap;justify-content:center">
          <a class="btn" href="/app/prisestimat">${t("Begär offert")}</a>
          <a class="btn btn-ghost" href="/app/export">${t("Exportera data")}</a>
          <a class="btn btn-ghost" href="/app/abonnemang#provperiod">${t("Läs mer")}</a>
        </div>
      </div></div></div>`;
  }

  if (trial.isTrial) {
    return `<div class="card"><div class="card-body">
      <div class="empty"><div class="empty-mark">${icon("upload", 26)}</div>
        <h3>${t("Ingen analys ännu")}</h3>
        <p><strong>${t("Kom igång med din första analys")}.</strong> ${t("Ladda upp en CSV- eller Excel-export. Analysen visar var kapitalet sitter, vad som riskerar att ta slut och vilka åtgärder som ger störst effekt.")}</p>
        <ol class="prose" style="max-width:560px;margin:18px auto 0;padding-left:20px;text-align:left;font-size:13.5px">
          <li>${t("Ladda upp en export från ert affärs- eller lagersystem.")}</li>
          <li>${t("Kontrollera kolumnmappningen. Vanliga kolumner känns igen automatiskt.")}</li>
          <li>${t("Läs analysen och ladda ner rapporten eller beställningsunderlaget.")}</li>
        </ol>
        <div class="flex gap-2 mt-4" style="flex-wrap:wrap;justify-content:center">
          <a class="btn" href="/app/importera">${t("Ladda upp fil")}</a>
          <a class="btn btn-ghost" href="/app/sandbox">${t("Öppna sandbox")}</a>
          <a class="btn btn-ghost" href="/app/abonnemang#provperiod">${t("Läs mer")}</a>
        </div>
      </div></div></div>`;
  }

  return `<div class="card"><div class="card-body">
    <div class="empty"><div class="empty-mark">${icon("upload", 26)}</div><h3>${t("Ingen analys ännu")}</h3>
    <p>${t("Ladda upp en CSV- eller Excel-export för att komma igång. Vill du se gränssnittet först, öppna sandboxen med syntetisk data.")}</p>
    <a class="btn mt-4" href="/app/importera">${t("Ladda upp fil")}</a>
    <a class="btn btn-ghost mt-4" href="/app/sandbox">${t("Öppna sandbox")}</a></div></div></div>`;
}

export function dashboardPage(input: PageContext & {
  result: AnalysisResult;
  intel: IntelligenceSnapshot;
  analysisId: string;
  analyses: Array<{ id: string; filename: string; created_at: string; rows: number; source?: string | null }>;
  snapshots: Array<{ date: string; value: number }>;
}): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const itemCount = (n: number) => t(k.skuCount === 1 ? "{n} artikel" : "{n} artiklar", { n });
  const { result, intel } = input;
  const k = result.kpis;
  const analysisOptions = input.analyses
    .map((a) => {
      // Identical filenames are common (one export per month). The timestamp,
      // article count and analysis id make every option distinguishable.
      const label = `${a.filename} · ${dateTime(locale, a.created_at)} · ${sv(locale, a.rows)} art. · #${a.id.slice(0, 8)}`;
      return `<option value="${a.id}" title="${esc(a.filename)} · ${dateTime(locale, a.created_at)} · ${esc(a.id)}" ${a.id === input.analysisId ? "selected" : ""}>${esc(label)}</option>`;
    })
    .join("");

  const toolbar = `<form class="filterbar" method="get" action="/app" data-persist="dashboard">
    <div class="form-row grow"><label for="a">${t("Analys")}</label>
      <select id="a" name="analys" data-autosubmit>${analysisOptions}</select></div>
    <div class="form-row"><label for="w">${t("Inaktivitetsfönster")}</label>
      <select id="w" name="fonster" data-autosubmit>
        <option value="90" ${result.settings.deadStockDays === 90 ? "selected" : ""}>${t("90 dagar")}</option>
        <option value="180" ${result.settings.deadStockDays === 180 ? "selected" : ""}>${t("180 dagar")}</option>
        <option value="365" ${result.settings.deadStockDays === 365 ? "selected" : ""}>${t("365 dagar")}</option>
      </select></div>
    <a class="btn btn-ghost btn-sm" href="/app/analys/${input.analysisId}/rapport.pdf">${icon("download", 15)} PDF</a>
    <a class="btn btn-ghost btn-sm" href="/app/analys/${input.analysisId}/export.xlsx">${icon("download", 15)} Excel</a>
  </form>`;

  const healthRing = (() => {
    const radius = 56;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - intel.health.score / 100);
    return `<div class="health-ring">
      <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">
        <circle class="ring-track" cx="66" cy="66" r="${radius}" fill="none" stroke-width="7"/>
        <circle class="ring-value" cx="66" cy="66" r="${radius}" fill="none" stroke-width="7"
          stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"/>
      </svg>
      <div class="health-center"><strong>${intel.health.score}</strong><span>${esc(appDynamic(locale, intel.health.grade))}</span></div>
    </div>`;
  })();

  const drivers = intel.health.drivers
    .map(
      (d) => `<div class="driver">
        <span class="driver-label">${esc(appDynamic(locale, d.label))}</span>
        <span class="driver-track"><span class="driver-fill" style="width:${Math.round(d.score * 100)}%;background:${d.score > 0.66 ? "var(--success)" : d.score > 0.33 ? "var(--warning)" : "var(--critical)"}"></span></span>
        <span class="driver-score" title="${t("Bidrag till lagerhälsan")}: +${num(locale, d.contribution, 1)} / ${Math.round(d.weight * 100)}">${Math.round(d.score * 100)}<small>+${num(locale, d.contribution, 1)}</small></span>
      </div>`,
    )
    .join("");

  // "Frigjort kapital" is a blend of two rates. Report the rate that the data
  // actually produced instead of a fixed "25–55 %" label.
  const releaseSub = (() => {
    const rate = `${pct(locale, k.releaseRateLow, 0)}–${pct(locale, k.releaseRateHigh, 0)}`;
    if (k.deadStockValue > 0 && k.overstockValue > 0) return t("{rate} realisationsgrad · inaktiva och överlager", { rate });
    if (k.deadStockValue > 0) return t("{rate} realisationsgrad · inaktiva artiklar", { rate });
    if (k.overstockValue > 0) return t("{rate} realisationsgrad · överlager", { rate });
    return t("Inget kapital att frigöra");
  })();

  const coverage = result.xyzCoverage ?? {
    minMonths: 6,
    classified: k.skuCount - intel.classification.unclassified,
    noHistory: intel.classification.reasons.noHistory,
    insufficientHistory: intel.classification.reasons.insufficientHistory,
    zeroDemand: intel.classification.reasons.zeroDemand,
    missingValues: intel.classification.reasons.missingValues,
  };
  const abcUnclassified = intel.classification.unclassified;
  const xyzReasons = [
    coverage.zeroDemand > 0 ? t("{n} har noll efterfrågan", { n: sv(locale, coverage.zeroDemand) }) : "",
    coverage.insufficientHistory > 0
      ? t("{n} har kortare historik än {months} månader", { n: sv(locale, coverage.insufficientHistory), months: sv(locale, coverage.minMonths) })
      : "",
    coverage.noHistory > 0 ? t("{n} saknar månadshistorik", { n: sv(locale, coverage.noHistory) }) : "",
    coverage.missingValues > 0 ? t("{n} har saknade värden i historiken", { n: sv(locale, coverage.missingValues) }) : "",
  ].filter(Boolean);
  const abcFootnote =
    abcUnclassified > 0
      ? t("{n} av {total} artiklar kan inte XYZ-klassificeras tillförlitligt: {reasons}. Variationskoefficienten beräknas inte när medelefterfrågan är 0 eller underlaget är otillräckligt.", {
          n: sv(locale, abcUnclassified),
          total: sv(locale, k.skuCount),
          reasons: xyzReasons.join(" · "),
        })
      : t("Alla artiklar har en XYZ-klass.");

  // Profit bars: top five plus one explicit remainder, so the bars add up to
  // the gross profit shown next to them.
  const profitBars = (() => {
    const rows = intel.profitability.byCategory;
    const label = (row: { category: string }) =>
      row.category === OTHER_CATEGORY_LABEL ? t("Övriga kategorier") : localizeCategory(row.category, locale);
    if (rows.length <= DISPLAY.profitBars) return rows.map((row) => ({ label: label(row), value: row.profit }));
    const head = rows.slice(0, DISPLAY.profitBars - 1);
    const rest = rows.slice(DISPLAY.profitBars - 1);
    return [
      ...head.map((row) => ({ label: label(row), value: row.profit })),
      { label: t("Övriga kategorier"), value: rest.reduce((a, row) => a + row.profit, 0) },
    ];
  })();

  const priorities = intel.priorities.slice(0, 8);
  const priorityList = priorities.length
    ? `<div class="priority-list">${priorities
        .map(
          (p, i) => `<a class="priority-item" data-sku="${esc(p.sku)}" href="/app/artiklar/${encodeURIComponent(p.sku)}?analys=${input.analysisId}">
        <span class="priority-rank">${String(i + 1).padStart(2, "0")}</span>
        <span><span class="priority-title">${esc(p.name)}</span>
          <p class="priority-why">${esc(p.reasons.length ? p.reasons.map((r) => appDynamic(locale, r)).join(" · ") : t("Prioriterad av kapitalvikt"))}</p></span>
        <span class="right">${scorePill(p.score)}<br><span class="tag-inline">${sek(locale, p.value)}</span></span>
      </a>`,
        )
        .join("")}</div>`
    : emptyState(t("Inga artiklar kräver åtgärd"), t("Alla artiklar ligger inom sina beställningspunkter och säljer."));

  const anomalies = intel.anomalies.slice(0, 6);
  const anomalyList = anomalies.length
    ? anomalies
        .map(
          (a) => `<dl class="stat-line"><dt><strong>${esc(a.name)}</strong><br><span class="muted">${esc(appDynamic(locale, a.detail))}</span></dt>
      <dd>${badge(a.kind === "never_sold" ? t("Aldrig såld") : a.kind === "stock_spike" ? t("Överlager") : a.kind === "spike" ? t("Topp") : t("Fall"), a.kind === "never_sold" ? "danger" : "warn")}</dd></dl>`,
        )
        .join("")
    : `<p class="muted">${t("Inga avvikande rörelser i historiken.")}</p>`;

  const warnings = result.dataQuality.warnings ?? [];
  const warningLimit = 6;
  const importWarnings = warnings.length
    ? card({
        span: 12,
        title: t("Importvarningar"),
        subtitle: t("Filen importerades, men dessa rader eller värden behövde justeras."),
        body: `${warnings.slice(0, warningLimit).map((warning) => alert(esc(warning), "warn")).join("")}${
          warnings.length > warningLimit
            ? `<p class="hint">${t("Endast de första {n} varningarna visas.", { n: warningLimit })}</p>`
            : ""
        }`,
      })
    : "";

  const content = `
  ${flash(input.url, locale)}
  ${importWarnings}
  <div class="grid">
    <div class="span-12"><div class="grid kpi-grid">${[
      kpi({ label: t("Lagervärde"), value: sek(locale, k.inventoryValue), sub: t(k.skuCount === 1 ? "{n} artikel · {units} enheter" : "{n} artiklar · {units} enheter", { n: sv(locale, k.skuCount), units: sv(locale, k.stockUnits) }), href: `/app/artiklar?analys=${input.analysisId}&sort=value`, spark: sparkline(intel.items.slice(0, 24).map((i) => i.value)) }),
      kpi({ label: t("Inaktivt lager"), value: sek(locale, k.deadStockValue), sub: t(k.deadStockCount === 1 ? "{n} artikel · {share} av värdet" : "{n} artiklar · {share} av värdet", { n: k.deadStockCount, share: pct(locale, k.inventoryValue > 0 ? (k.deadStockValue / k.inventoryValue) * 100 : 0, 0) }), tone: "danger", href: `/app/artiklar?analys=${input.analysisId}&action=write_off` }),
      kpi({ label: t("Överlager"), value: sek(locale, k.overstockValue), sub: itemCount(k.overstockCount), tone: "warn", href: `/app/artiklar?analys=${input.analysisId}&action=reduce` }),
      kpi({ label: t("Lageromsättning"), value: t("{n} ggr/år", { n: num(locale, k.turns, 2) }), sub: k.daysOfInventory ? t("{n} dagars liggtid", { n: sv(locale, k.daysOfInventory) }) : t("saknar historik"), href: `/app/artiklar?analys=${input.analysisId}&sort=turns&dir=asc` }),
      kpi({ label: t("Bristrisk"), value: itemCount(k.stockoutRiskCount), sub: t("{value} i riskerad försäljning", { value: sek(locale, k.stockoutRiskValue) }), tone: "warn", href: `/app/artiklar?analys=${input.analysisId}&action=reorder` }),
      kpi({ label: t("Frigjort kapital"), value: moneyRange(locale, k.potentialReleaseLow, k.potentialReleaseHigh), sub: releaseSub, tone: "good", href: `/app/simulering?analys=${input.analysisId}` }),
    ]
      .map((box) => `<div class="span-4">${box}</div>`)
      .join("")}</div></div>

    ${card({
      span: 12,
      body: `<div class="health-band">${healthRing}
        <div class="health-copy">
          <p class="eyebrow">${t("Lagerhälsa")}</p>
          <p class="health-note">${t("Inaktivt lager, överlager, bristrisk och rotation vägt samman. Bidragen avrundas till en decimal och summerar exakt till totalpoängen; 100 = varje krona rör sig med efterfrågan.")}</p>
        </div>
        <div class="health-drivers"><p class="folio">${t("Drivare")}</p>${drivers}</div></div>`,
    })}

    ${card({
      title: t("Kapitalfördelning"),
      span: 7,
      body: treemap(
        intel.capital.byCategory.map((c) => ({ label: localizeCategory(c.label, locale), value: c.value, dead: c.deadValue })),
        { height: 340, locale, restLabel: t("Övriga kategorier") },
      ) +
        `<div class="legend legend-ramp">
          <span class="legend-note">${t("Färg = andel inaktivt kapital")}</span>
          <span><i class="lg-chip" style="background:var(--matrix-1)"></i>${t("Friskt kapital")}</span>
          <span><i class="lg-chip" style="background:var(--matrix-3)"></i>${t("Delvis inaktivt")}</span>
          <span><i class="lg-chip" style="background:var(--matrix-5)"></i>${t("Inaktivt kapital")}</span>
        </div>
        <p class="tm-shares">${intel.capital.byCategory
          .slice(0, 6)
          .map((c) => `<span>${esc(localizeCategory(c.label, locale))} · ${pct(locale, c.share)}</span>`)
          .join("")}</p>`,
    })}
    ${card({
      title: t("ABC / XYZ"),
      span: 5,
      body: abcXyzMatrix(intel.classification.matrix, {
        locale,
        analysisId: input.analysisId,
        articles: result.items.map((i) => ({
          sku: i.sku,
          name: i.name,
          abc: i.abc,
          xyz: i.xyz,
          action: i.action,
          value: i.value,
        })),
        cutoffs: CLASS_CUTOFFS,
      }) +
        `<p class="hint" style="margin-top:10px">${t("AX = stort värde, jämn efterfrågan. CZ = kandidater för utförsäljning.")}</p>
        <p class="hint">${abcFootnote}</p>`,
    })}

    ${card({
      title: t("Prioriterade åtgärder"),
      subtitle: t("Kapitalvikt, allvar, marginal och brådska."),
      span: 6,
      actions: `<a class="link-btn" href="/app/artiklar?analys=${input.analysisId}&sort=priority">${t("Alla →")}</a>`,
      body: priorityList,
    })}

    ${card({
      title: t("Lönsamhet"),
      span: 6,
      body: `<div class="kv">
        <dl><dt>${t("Försäljningsintäkt")}</dt><dd>${sek(locale, intel.profitability.revenue)}</dd></dl>
        <dl><dt>${t("Inköpskostnad (COGS)")}</dt><dd>${sek(locale, intel.profitability.cogs)}</dd></dl>
        <dl><dt>${t("Bruttovinst")}</dt><dd>${sek(locale, intel.profitability.grossProfit)}</dd></dl>
        <dl><dt>${t("Bruttomarginal")}</dt><dd>${pct(locale, intel.profitability.marginPct)}</dd></dl>
        <dl><dt>${t("Lagervärde / kapitalbindning")}</dt><dd>${sek(locale, intel.profitability.inventoryValue)}</dd></dl>
        <dl><dt>${t("Försäljningsvärde i lager")}</dt><dd>${sek(locale, intel.profitability.stockSalesValue)}</dd></dl>
        <dl><dt>${t("Låg marginal")}</dt><dd>${intel.profitability.lowMarginCount}</dd></dl>
        <dl><dt>${t("Negativ marginal")}</dt><dd>${intel.profitability.negativeMarginCount}</dd></dl>
      </div>
      <div class="mt-4">${barChart(profitBars, { unit: t("Täckningsbidrag per kategori"), tone: "mint" })}</div>`,
    })}

    ${card({
      title: t("Riskprofil"),
      span: 3,
      body: riskRadar([
        { label: t("Inaktivt lager"), value: Math.min(1, (k.deadStockValue / Math.max(1, k.inventoryValue)) / 0.25) },
        { label: t("Överlager"), value: Math.min(1, (k.overstockValue / Math.max(1, k.inventoryValue)) / 0.4) },
        { label: t("Brist"), value: Math.min(1, k.stockoutRiskCount / Math.max(1, k.skuCount) / 0.15) },
        { label: t("Rotation"), value: Math.min(1, k.turns / 6) },
        { label: t("Marginal"), value: Math.min(1, Math.abs(intel.profitability.marginPct) / 40) },
      ]) + `<div class="legend"><span><i style="background:var(--signal)"></i>${t("Högre värde = mer att åtgärda")}</span></div>`,
    })}

    ${card({
      title: t("Lagervärde över tid"),
      subtitle: t("{n} mätpunkter · en per importdag, senaste 24.", { n: input.snapshots.length }),
      span: 3,
      body: valueTimeline(input.snapshots, { locale }),
    })}

    ${card({
      title: t("Lagerhälsokarta"),
      subtitle: t("En ruta per artikel. Färg = åtgärdsbehov."),
      span: 6,
      body:
        healthMap(
          intel.items.slice(0, 720).map((i) => ({
            sku: i.sku,
            name: i.name,
            score: i.priorityScore,
            value: i.value,
            action: i.action,
            stock: i.stock,
            coverDays: i.coverDays,
          })),
          { locale, analysisId: input.analysisId },
        ) +
        `<p class="hint hm-help">${t("Klicka på en ruta för att se artikel, åtgärd och lagervärde.")}</p>
        <div class="legend"><span><i class="lg-chip" style="background:var(--success)"></i>${t("OK")}</span><span><i class="lg-chip" style="background:var(--warning)"></i>${t("Bevaka")}</span><span><i class="lg-chip" style="background:var(--critical)"></i>${t("Risk")}</span><span><i class="lg-chip" style="background:var(--neutral)"></i>${t("Inaktivt lager")}</span></div>`,
    })}

    ${card({
      title: t("Avvikelser"),
      span: 6,
      body: anomalyList,
    })}

    ${card({
      title: t("Rotationskarta"),
      subtitle: t("Omsättning mot marginal. Storlek = värde."),
      span: 6,
      body: velocityMap(
        intel.items
          .filter((i) => i.soldPeriod > 0)
          .slice(0, 240)
          .map((i) => ({ x: i.turns, y: Math.max(0, i.marginPct ?? 0), size: i.value, label: `${i.name}: ${num(locale, i.turns, 1)}×, ${pct(locale, i.marginPct ?? 0)}`, group: (i.marginPct ?? 0) < 0 ? "neg" : "ok" })),
        { locale },
      ),
    })}
  </div>`;

  return shell({
    locale,
    path: input.url.pathname + input.url.search,
    title: t("Översikt"),
    active: "dashboard",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: t("{m} månaders historik · {n} artiklar · uppdaterad {at}", { m: input.result.dataQuality.months, n: sv(locale, k.skuCount), at: dateTime(locale, result.generatedAt) }),
    actions: `<a class="btn" href="/app/importera">${icon("upload", 16)} ${t("Ny import")}</a>
      <a class="btn btn-ghost" href="/app/copilot?analys=${input.analysisId}">${icon("spark", 16)} ${t("Fråga copiloten")}</a>`,
    toolbar,
    content,
  });
}

/* ----------------------------------------------------------------- items */

export interface ItemsPageInput extends PageContext {
  result: AnalysisResult;
  intel: IntelligenceSnapshot;
  analysisId: string;
  rows: Array<Record<string, unknown>>;
  total: number;
  totalValue: number;
  page: number;
  pages: number;
  facets: {
    categories: Array<{ key: string; c: number; v: number }>;
    suppliers: Array<{ key: string; c: number; v: number }>;
    actions: Array<{ key: string; c: number; v: number }>;
  };
  query: Record<string, string>;
  canDelete?: boolean;
}

export function itemsPage(input: ItemsPageInput): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const q = input.query;
  const search = q.q ? planSearch(q.q, locale) : null;
  const categoryOptions = input.facets.categories
    .map((c) => `<option value="${esc(c.key)}" ${q.category === c.key ? "selected" : ""}>${esc(localizeCategory(c.key, locale))} (${c.c})</option>`)
    .join("");
  const actionOptions = input.facets.actions
    .map((a) => `<option value="${esc(String(a.key))}" ${q.action === String(a.key) ? "selected" : ""}>${esc(actionLabel(locale, String(a.key)))} (${a.c})</option>`)
    .join("");

  const toolbar = `<form class="filterbar" method="get" action="/app/artiklar" data-persist="items">
    <input type="hidden" name="analys" value="${input.analysisId}">
    <div class="form-row grow"><label for="q">${t("Sök")}</label>
      <input id="q" name="q" type="search" value="${esc(q.q ?? "")}" placeholder="${t("Artikelnummer eller benämning")}"></div>
    <div class="form-row"><label for="cat">${t("Kategori")}</label>
      <select id="cat" name="category"><option value="">${t("Alla")}</option>${categoryOptions}</select></div>
    <div class="form-row"><label for="act">${t("Åtgärd")}</label>
      <select id="act" name="action"><option value="">${t("Alla")}</option>${actionOptions}</select></div>
    <div class="form-row"><label for="abc">ABC</label>
      <select id="abc" name="abc"><option value="">${t("Alla")}</option>${["A", "B", "C"].map((c) => `<option value="${c}" ${q.abc === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
    <div class="form-row"><label for="xyz">XYZ</label>
      <select id="xyz" name="xyz"><option value="">${t("Alla")}</option>${["X", "Y", "Z"].map((c) => `<option value="${c}" ${q.xyz === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
    <button class="btn" type="submit">${icon("filter", 15)} ${t("Filtrera")}</button>
    <a class="btn btn-ghost" href="/app/artiklar?analys=${input.analysisId}">${t("Rensa")}</a>
  </form>${search && (search.categories.length > 1 || search.synonyms.length || search.translations.length || search.variants.length) ? `<p class="search-note">${esc(search.explanation)}${
    search.translations.length
      ? ` ${locale === "sv" ? "Översättningar används endast för att matcha importerade data." : "Translations are used only to match imported source data."}`
      : ""
  }</p>` : ""}`;

  const pickable = Boolean(input.canDelete);
  const rowsHtml = table({
    locale,
    columns: [
      ...(pickable ? [{ key: "_sel", label: "" }] : []),
      { key: "sku", label: t("Artikel"), sortable: true },
      { key: "name", label: t("Benämning"), sortable: true },
      { key: "category", label: t("Kategori") },
      { key: "stock", label: t("Saldo"), align: "right", sortable: true },
      { key: "value", label: t("Lagervärde"), align: "right", sortable: true },
      { key: "sold", label: t("Sålt"), align: "right", sortable: true },
      { key: "turns", label: t("Oms."), align: "right", sortable: true },
      { key: "cover", label: t("Täckning"), align: "right", sortable: true },
      { key: "margin", label: t("Marginal"), align: "right", sortable: true },
      { key: "abc", label: "ABC" },
      { key: "xyz", label: "XYZ" },
      { key: "action", label: t("Åtgärd") },
    ],
    rows: input.rows.map((r) => ({
      _sel: pickable
        ? `<input type="checkbox" name="sku" value="${esc(r.sku)}" aria-label="${esc(t("Markera {n}", { n: String(r.sku) }))}">`
        : "",
      sku: `<span class="mono">${esc(r.sku)}</span>`,
      name: `${esc(r.name)}${
        Number(r._rank) === 7
          ? ` <span class="match-tag">${t("Översättning")}</span>`
          : Number(r._rank) === 6
            ? ` <span class="match-tag">${t("Synonym")}</span>`
            : ""
      }`,
      category: esc(r.category ? localizeCategory(String(r.category), locale) : "–"),
      stock: sv(locale, Number(r.stock)),
      value: sek(locale, Number(r.value)),
      sold: sv(locale, Number(r.sold)),
      turns: num(locale, Number(r.turns), 2),
      cover: r.cover_days === null ? "–" : `${sv(locale, Number(r.cover_days))} d`,
      margin: r.margin_pct === null ? "–" : pct(locale, Number(r.margin_pct)),
      abc: badge(String(r.abc ?? "–"), String(r.abc) === "A" ? "ok" : String(r.abc) === "B" ? "info" : "default"),
      xyz: esc(r.xyz ?? "–"),
      action: actionBadge(String(r.action ?? "ok"), locale),
    })),
    rowHref: (row) => `/app/artiklar/${encodeURIComponent(String(row.sku).replace(/<[^>]*>/g, ""))}?analys=${input.analysisId}`,
    rowAttrs: (row) => `data-sku="${esc(String(row.sku).replace(/<[^>]*>/g, ""))}" data-abc="${esc(row.abc ?? "")}"`,
    empty: t("Inga artiklar matchar filtret."),
    sortKey: q.sort ?? "value",
    sortDir: (q.dir as "asc" | "desc") ?? "desc",
    baseQuery: { analys: input.analysisId, q: q.q ?? "", category: q.category ?? "", action: q.action ?? "", abc: q.abc ?? "", xyz: q.xyz ?? "" },
  });

  return shell({
    locale,
    path: input.url.pathname + input.url.search,
    title: t("Artiklar"),
    active: "items",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: t(input.total === 1 ? "{n} artikel · lagervärde {value}" : "{n} artiklar · lagervärde {value}", { n: sv(locale, input.total), value: sek(locale, input.totalValue) }),
    actions: `<a class="btn btn-ghost" href="/app/analys/${input.analysisId}/export.xlsx">${icon("download", 16)} Excel</a>
      <a class="btn btn-ghost" href="/app/analys/${input.analysisId}/export.csv">${icon("download", 16)} CSV</a>`,
    toolbar,
    content: `${flash(input.url, locale)}<section class="card"><div class="card-body flush">
      ${pickable ? `<form method="post" action="/app/radera/artiklar" data-pick-form>
        <input type="hidden" name="analys" value="${esc(input.analysisId)}">
        <div class="bulk-bar">
          <label class="flex center gap-2"><input type="checkbox" data-pick-all> ${t("Markera alla på sidan")}</label>
          <span class="muted" data-pick-count>${t("0 markerade")}</span>
          <button class="btn btn-danger btn-sm" type="submit" data-pick-submit disabled>${icon("trash", 15)} ${t("Radera markerade")}</button>
        </div>
        ${rowsHtml}
      </form>` : rowsHtml}
      </div>
      ${pagination({ page: input.page, pages: input.pages, baseQuery: { ...input.query, analys: input.analysisId }, locale })}
    </section>`,
  });
}

function actionLabel(locale: Locale, action: string): string {
  return appAction(locale, action) ?? (
    {
      write_off: "Nedskrivning",
      liquidate: "Realisera",
      reduce: "Minska",
      reorder: "Beställ",
      review: "Granska",
      ok: "OK",
    }[action] ?? action
  );
}

/* ----------------------------------------------------------- item detail */

export function itemPage(input: PageContext & {
  result: AnalysisResult;
  intel: IntelligenceSnapshot;
  analysisId: string;
  item: Record<string, unknown>;
  forecast: ForecastResult | null;
  plan: SupplyPlan | null;
  history: number[];
  similar: Array<{ sku: string; name: string; value: number; turns: number }>;
  /** The import behind the selected analysis, for end-to-end traceability. */
  importRef?: { id: string; started_at: string; filename: string } | null;
}): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const item = input.item;
  const analyzed = input.result.items.find((entry) => entry.sku === item.sku) ?? null;
  // The analyzed row is the shared calculation. The database row is only a
  // fallback for fields the analysis does not carry.
  const stock = analyzed?.stock ?? Number(item.stock);
  const cost = analyzed?.cost ?? Number(item.cost);
  const price = analyzed?.price ?? (item.price === null ? null : Number(item.price));
  const sold = analyzed?.soldPeriod ?? Number(item.sold);
  const revenue = analyzed?.revenuePeriod ?? Number(item.revenue);
  const seller = analyzed?.value ?? Number(item.value);
  const marginPct = price === null || price <= 0 ? null : ((price - cost) / price) * 100;
  const cogs = sold * cost;
  const grossProfit = revenue - cogs;
  const unitMargin = price === null ? null : price - cost;
  const salesValueAtStock = price === null ? null : stock * price;
  const historyTotal = input.history.reduce((sum, value) => sum + value, 0);
  const historyZeroMonths = input.history.filter((value) => value === 0).length;
  const lastMonth = input.history.length > 0 ? input.history[input.history.length - 1]! : null;
  const location = analyzed?.storage || (item.warehouse ? String(item.warehouse) : null);
  const leadTime = analyzed?.leadTimeDays ?? (item.leadTimeDays !== undefined ? Number(item.leadTimeDays) : null);
  const xyzReasonText = !analyzed || analyzed.xyz !== null
    ? null
    : ({
        no_history: t("Ingen månadshistorik finns, så efterfrågan kan inte klassificeras."),
        insufficient_history: t("Historiken är kortare än 6 månader, så variationskoefficienten är inte tillförlitlig."),
        zero_demand: t("Medelefterfrågan är noll. Variationskoefficienten beräknas inte och artikeln tvingas inte in i en XYZ-klass."),
        missing_values: t("Historiken innehåller saknade värden, så artikeln klassificeras inte."),
      } as Record<string, string>)[(analyzed as { xyzReason?: string }).xyzReason ?? "no_history"] ?? null;
  const moq = analyzed?.moq ?? (item.moq !== undefined && item.moq !== null ? Number(item.moq) : null);
  const safetyStock = analyzed?.safetyStock ?? null;
  const reorderPoint = analyzed?.reorderPoint ?? null;
  const available = analyzed?.available ?? (item.available !== undefined ? Number(item.available) : stock);
  const reserved = analyzed?.reserved ?? (item.reserved !== undefined ? Number(item.reserved) : 0);
  const stockStatus =
    (analyzed?.action ?? item.action) === "write_off" || (analyzed?.action ?? item.action) === "liquidate"
      ? t("Inaktivt lager")
      : analyzed?.stockoutRisk
        ? t("Bristrisk")
        : (analyzed?.overstockQty ?? Number(item.overstockQty ?? 0)) > 0
          ? t("Överlager")
          : t("Balanserad");
  const forecastWape = input.forecast ? pct(locale, input.forecast.metrics.wape * 100) : "–";
  const forecastMape = input.forecast?.metrics.mape === null || input.forecast?.metrics.mape === undefined
    ? "–"
    : pct(locale, input.forecast.metrics.mape * 100);

  const historyPoints = input.history.map((v, i) => ({ label: `M${i + 1}`, value: v }));
  const forecastSeries = input.forecast
    ? input.forecast.points.map((p) => ({ label: `P${p.step}`, value: p.value, lo: p.lo, hi: p.hi }))
    : [];

  const chart = input.forecast
    ? forecastChart(historyPoints, forecastSeries, { width: 760, height: 280, locale })
    : `<div class="chart-placeholder"><p>${t("Artikeln saknar månadshistorik, så någon prognos kan inte beräknas.")}</p><p class="muted">${t("Importera försäljning per månad för att få prognos, beställningspunkt och bristrisk.")}</p></div>`;

  const candidates = input.forecast
    ? table({
    locale,
        columns: [
          { key: "method", label: t("Modell") },
          { key: "wape", label: "WAPE", align: "right" },
          { key: "mape", label: "MAPE", align: "right" },
          { key: "mae", label: "MAE", align: "right" },
          { key: "rmse", label: "RMSE", align: "right" },
          { key: "bias", label: "Bias", align: "right" },
        ],
        rows: input.forecast.candidates.map((c) => ({
          method: `${esc(methodLabel(locale, c.method))}${c.method === input.forecast!.method ? " " + badge(t("vald"), "ok") : ""}`,
          wape: pct(locale, c.metrics.wape * 100),
          mape: c.metrics.mape === null ? "–" : pct(locale, c.metrics.mape * 100),
          mae: num(locale, c.metrics.mae, 1),
          rmse: num(locale, c.metrics.rmse, 1),
          bias: num(locale, c.metrics.bias * 100, 1) + " %",
        })),
      })
    : "";

  return shell({
    locale,
    path: input.url.pathname + input.url.search,
    title: String(item.name),
    active: "items",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: `<span class="mono">${esc(item.sku)}</span> · ${esc(item.category ? localizeCategory(String(item.category), locale) : t("Utan kategori"))} · ${esc(item.supplier ?? t("Okänd leverantör"))}`,
    actions: `<a class="btn btn-ghost" href="/app/artiklar?analys=${input.analysisId}">${t("← Alla artiklar")}</a>`,
    content: `
    <div class="grid">
      <section class="card span-8"><div class="card-body">
        <div class="item-hero">
          <div>
            <h1 class="item-title">${esc(item.name)}</h1>
            <span class="item-sku">${esc(item.sku)}</span>
            <div class="flex gap-2 wrap" style="margin-top:12px">
              ${actionBadge(String(item.action), locale)}
              ${badge(`ABC ${esc(item.abc)}`, "info")}
              ${badge(`XYZ ${esc(item.xyz ?? "–")}`, "default")}
              ${badge(esc(String(item.warehouse ?? t("Huvudlager"))), "default")}
            </div>
            ${xyzReasonText ? `<p class="hint" style="margin-top:8px">${esc(xyzReasonText)}</p>` : ""}
          </div>
          <dl class="fact-grid">
            <div class="fact"><dt>${t("Lagervärde")}</dt><dd>${sek(locale, seller)}</dd></div>
            <div class="fact"><dt>${t("Saldo")}</dt><dd>${sv(locale, Number(item.stock))}</dd></div>
            <div class="fact"><dt>${t("Omsättning")}</dt><dd>${num(locale, Number(item.turns), 2)}</dd></div>
            <div class="fact"><dt>${t("Täckning")}</dt><dd>${item.cover_days === null ? "–" : `${sv(locale, Number(item.cover_days))} d`}</dd></div>
            <div class="fact"><dt>${t("Marginal")}</dt><dd>${marginPct === null ? "–" : pct(locale, marginPct)}</dd></div>
            <div class="fact"><dt>${t("Prioritet")}</dt><dd>${num(locale, Number(item.priority), 0)}</dd></div>
            <div class="fact"><dt>${t("Analys")}</dt><dd class="mono">#${esc(input.analysisId.slice(0, 8))}</dd></div>
            <div class="fact"><dt>${t("Import")}</dt><dd>${input.importRef ? `<span class="mono">#${esc(input.importRef.id.slice(0, 8))}</span><br><span class="tag-inline">${dateTime(locale, input.importRef.started_at)}</span>` : t("saknas")}</dd></div>
          </dl>
        </div>
      </div></section>

      ${card({
        span: 8,
        title: t("Artikeldata"),
        subtitle: t("Samtliga fält som styr analysen. Värdena kommer från samma importerade datamängd som översikten."),
        body: `<div class="item-facts">
          <div><dt>${t("Artikelnummer")}</dt><dd class="mono">${esc(item.sku)}</dd></div>
          <div><dt>${t("Benämning")}</dt><dd>${esc(item.name)}</dd></div>
          <div><dt>${t("Kategori")}</dt><dd>${esc(item.category ? localizeCategory(String(item.category), locale) : "–")}</dd></div>
          <div><dt>${t("Leverantör")}</dt><dd>${esc(item.supplier ? String(item.supplier) : "–")}</dd></div>
          <div><dt>${t("Lagerplats")}</dt><dd>${esc(location ?? "–")}</dd></div>
          <div><dt>${t("Lagerstatus")}</dt><dd>${esc(stockStatus)}</dd></div>
          <div><dt>${t("Saldo")}</dt><dd>${sv(locale, stock)}</dd></div>
          <div><dt>${t("Tillgängligt")}</dt><dd>${sv(locale, available)}</dd></div>
          <div><dt>${t("Reserverat")}</dt><dd>${sv(locale, reserved)}</dd></div>
          <div><dt>${t("Inköpspris")}</dt><dd>${sek(locale, cost)}</dd></div>
          <div><dt>${t("Försäljningspris")}</dt><dd>${price === null ? t("saknas") : sek(locale, price)}</dd></div>
          <div><dt>${t("Bruttomarginal per enhet")}</dt><dd>${unitMargin === null ? "–" : sek(locale, unitMargin)}</dd></div>
          <div><dt>${t("Bruttomarginal")}</dt><dd>${marginPct === null ? "–" : pct(locale, marginPct)}</dd></div>
          <div><dt>${t("Ledtid")}</dt><dd>${leadTime === null ? "–" : `${num(locale, leadTime)} d`}</dd></div>
          <div><dt>MOQ</dt><dd>${moq === null ? "–" : num(locale, moq)}</dd></div>
          <div><dt>${t("Säkerhetslager")}</dt><dd>${safetyStock === null ? "–" : num(locale, safetyStock, 0)}</dd></div>
          <div><dt>${t("Beställningspunkt")}</dt><dd>${reorderPoint === null ? "–" : num(locale, reorderPoint, 0)}</dd></div>
          <div><dt>ABC</dt><dd>${esc(item.abc ?? "–")}</dd></div>
          <div><dt>XYZ</dt><dd>${esc(item.xyz ?? "–")}</dd></div>
        </div>`,
      })}

      ${card({
        span: 4,
        title: t("Ekonomi"),
        subtitle: t("Inköpskostnad, intäkt och kapitalbindning är separata mått."),
        body: `<dl class="stat-line"><dt>${t("Försäljningsintäkt i period")}</dt><dd>${sek(locale, revenue)}</dd></dl>
        <dl class="stat-line"><dt>${t("Inköpskostnad (COGS)")}</dt><dd>${sek(locale, cogs)}</dd></dl>
        <dl class="stat-line"><dt>${t("Bruttovinst")}</dt><dd>${sek(locale, grossProfit)}</dd></dl>
        <dl class="stat-line"><dt>${t("Bruttomarginal")}</dt><dd>${revenue > 0 ? pct(locale, (grossProfit / revenue) * 100) : "–"}</dd></dl>
        <dl class="stat-line"><dt>${t("Lagervärde")}</dt><dd>${sek(locale, seller)}</dd></dl>
        <dl class="stat-line"><dt>${t("Försäljningsvärde i lager")}</dt><dd>${salesValueAtStock === null ? "–" : sek(locale, salesValueAtStock)}</dd></dl>
        <dl class="stat-line"><dt>${t("Kapitalbindning")}</dt><dd>${sek(locale, seller)}</dd></dl>
        <p class="hint mt-4">${t("Lagervärde och kapitalbindning värderas till inköpspris. Försäljningsvärde i lager värderas till försäljningspris och är inte en intäkt förrän varan säljs.")}</p>`,
      })}

      ${card({
        span: 4,
        title: t("Åtgärd"),
        body: `<p style="margin-top:0">${esc(sqlActionText(locale, String(item.action), item))}</p>
        <dl class="stat-line"><dt>${t("Försäljningspris")}</dt><dd>${item.price === null ? t("saknas") : sek(locale, Number(item.price))}</dd></dl>
        <dl class="stat-line"><dt>${t("Inköpspris")}</dt><dd>${sek(locale, Number(item.cost))}</dd></dl>
        <dl class="stat-line"><dt>${t("Sålt i period")}</dt><dd>${sv(locale, Number(item.sold))} st</dd></dl>
        <dl class="stat-line"><dt>${t("Intäkt i period")}</dt><dd>${sek(locale, Number(item.revenue))}</dd></dl>
        <dl class="stat-line"><dt>${t("Täckningsbidrag")}</dt><dd>${sek(locale, Number(item.profit))}</dd></dl>`,
      })}

      ${card({
        span: 12,
        title: t("Efterfrågan och prognos"),
        subtitle: input.forecast
          ? t("Modell {method} · konfidens {confidence} · WAPE {wape} · MAPE {mape}", { method: methodLabel(locale, input.forecast.method), confidence: confidenceLabel(locale, input.forecast.confidence), wape: forecastWape, mape: forecastMape })
          : t("Prognos kräver månadshistorik"),
        body: chart + (input.forecast ? `<div class="legend"><span><i style="background:var(--ink-soft)"></i>${t("Historik")}</span><span><i style="background:var(--signal)"></i>${t("Prognos")}</span><span><i style="background:var(--signal-band)"></i>${t("95 % intervall")}</span></div>` : "") +
          `<p class="hint mt-4">${t("Historik: {months} månader · {total} enheter · snitt {avg}/månad · senaste månad {last} · {zero} nollmånader.", { months: num(locale, input.history.length), total: num(locale, historyTotal), avg: num(locale, input.history.length ? historyTotal / input.history.length : 0, 1), last: lastMonth === null ? "–" : num(locale, lastMonth), zero: num(locale, historyZeroMonths) })}</p>`,
      })}

      ${card({
        span: 6,
        title: t("Lagerstyrning"),
        subtitle: t("Beräknat med vald servicenivå och artikelns ledtid."),
        body: input.plan
          ? `<div class="kv">
              <dl><dt>${t("Prognos/månad")}</dt><dd>${num(locale, input.plan.forecastMonthly, 1)}</dd></dl>
              <dl><dt>${t("Säkerhetslager")}</dt><dd>${num(locale, input.plan.safetyStock, 0)}</dd></dl>
              <dl><dt>${t("Beställningspunkt")}</dt><dd>${num(locale, input.plan.reorderPoint, 0)}</dd></dl>
              <dl><dt>${t("Orderkvantitet")}</dt><dd>${num(locale, input.plan.orderQuantity, 0)}</dd></dl>
              <dl><dt>${t("Bristrisk")}</dt><dd>${pct(locale, input.plan.stockoutProbability * 100, 0)}</dd></dl>
              <dl><dt>${t("Förväntad brist")}</dt><dd>${num(locale, input.plan.expectedShortageUnits, 1)} st</dd></dl>
            </div>
            <p class="hint mt-4">${t("Orderkvantitet är EOQ (beställningskostnad 350 kr, lagerhållningsränta 22 %) avrundat uppåt till minsta orderkvantitet.")}</p>`
          : `<p class="muted">${t("Saknar historik för att beräkna beställningspunkt.")}</p>`,
      })}

      ${card({
        span: 6,
        title: t("Modelljämförelse"),
        subtitle: t("Backtest på de senaste månaderna. Lägst WAPE vinner."),
        body: candidates || `<p class="muted">${t("Ingen backtest möjlig med så kort historik.")}</p>`,
      })}

      ${card({
        span: 6,
        title: t("Utfall mot prognos"),
        subtitle: t("Backtest på de senaste månaderna. Utfall är faktisk försäljning, prognos är modellens skattning före perioden."),
        body: input.forecast?.backtest
          ? table({
    locale,
              columns: [
                { key: "period", label: t("Period") },
                { key: "actual", label: t("Utfall"), align: "right" },
                { key: "predicted", label: t("Prognos"), align: "right" },
                { key: "error", label: t("Avvikelse"), align: "right" },
              ],
              rows: input.forecast.backtest.actual.map((actual, index) => {
                const predicted = input.forecast!.backtest!.predicted[index] ?? 0;
                return {
                  period: `M-${input.forecast!.backtest!.actual.length - index}`,
                  actual: num(locale, actual),
                  predicted: num(locale, predicted),
                  error: `${actual === 0 ? "–" : `${predicted >= actual ? "+" : ""}${pct(locale, ((predicted - actual) / actual) * 100, 0)}`}`,
                };
              }),
            })
          : `<p class="muted">${t("Ingen backtest är möjlig med så kort historik.")}</p>`,
      })}

      ${card({
        span: 12,
        title: t("Lika artiklar"),
        subtitle: t("Samma kategori, sorterade på kapital."),
        body: input.similar.length
          ? table({
    locale,
              columns: [
                { key: "sku", label: t("Artikel") },
                { key: "name", label: t("Benämning") },
                { key: "value", label: t("Lagervärde"), align: "right" },
                { key: "turns", label: t("Omsättning"), align: "right" },
                { key: "bar", label: "" },
              ],
              rows: input.similar.map((s) => ({
                sku: `<span class="mono">${esc(s.sku)}</span>`,
                name: esc(s.name),
                value: sek(locale, s.value),
                turns: num(locale, s.turns, 2),
                bar: bar(s.value, input.similar[0]?.value ?? 1),
              })),
              rowHref: (row) => `/app/artiklar/${encodeURIComponent(String(row.sku).replace(/<[^>]*>/g, ""))}?analys=${input.analysisId}`,
    rowAttrs: (row) => `data-sku="${esc(String(row.sku).replace(/<[^>]*>/g, ""))}" data-abc="${esc(row.abc ?? "")}"`,
            })
          : `<p class="muted">${t("Inga jämförbara artiklar i kategorin.")}</p>`,
      })}
    </div>`,
  });
}

function sqlActionText(locale: Locale, action: string, item: Record<string, unknown>): string {
  const stock = Number(item.stock);
  switch (action) {
    case "write_off":
      return locale === "sv"
        ? `Ingen försäljning i perioden trots ${sv(locale, stock)} enheter i lager. Bedöm nedskrivning eller retur till leverantör.`
        : `No sales in the period despite ${appNum(locale, stock, 0)} units in stock. Consider a write-down or return to the supplier.`;
    case "liquidate":
      return locale === "sv"
        ? `Artikeln säljer inte längre men har ${sv(locale, stock)} enheter kvar. Realisera via kampanj eller outlet innan värdet urholkas ytterligare.`
        : `The item no longer sells but ${appNum(locale, stock, 0)} units remain. Clear it through a campaign or outlet before the value erodes further.`;
    case "reduce":
      return locale === "sv"
        ? "Saldo ligger över vad ledtid och efterfrågan motiverar. Stoppa påfyllning till lagret är nere på beställningspunkt."
        : "Stock exceeds what lead time and demand justify. Stop replenishment until inventory falls to the reorder point.";
    case "reorder":
      return locale === "sv"
        ? "Täckningen är kortare än ledtiden. Beställ nu för att undvika bristsituation."
        : "Coverage is shorter than the lead time. Order now to avoid a stockout.";
    case "review":
      return locale === "sv"
        ? "Underlaget är ofullständigt för artikeln (pris eller saldo). Komplettera innan beslut."
        : "Data for this item is incomplete (price or stock). Complete it before making a decision.";
    default:
      return locale === "sv"
        ? "Ingen åtgärd krävs. Artikeln ligger inom sina styrgränser."
        : "No action required. The item is within its control limits.";
  }
}

/* -------------------------------------------------------------- forecast */

export function forecastPage(input: PageContext & {
  result: AnalysisResult;
  intel: IntelligenceSnapshot;
  analysisId: string;
  itemForecasts: Array<{ sku: string; name: string; forecast: ForecastResult; plan: SupplyPlan }>;
  categoryForecast: { category: string; series: ForecastResult } | null;
  horizon: number;
}): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const rows = input.itemForecasts.slice(0, 40);
  const chart = rows[0]
    ? forecastChart(
        rows[0].forecast.history.map((v, i) => ({ label: `M${i + 1}`, value: v })),
        rows[0].forecast.points.map((p) => ({ label: `P${p.step}`, value: p.value, lo: p.lo, hi: p.hi })),
        { width: 720, height: 560, locale },
      )
    : `<div class="chart-placeholder">${t("Ingen artikel med månadshistorik hittades.")}</div>`;

  const categoryChart = input.categoryForecast
    ? forecastChart(
        input.categoryForecast.series.history.map((v, i) => ({ label: `M${i + 1}`, value: v })),
        input.categoryForecast.series.points.map((p) => ({ label: `P${p.step}`, value: p.value, lo: p.lo, hi: p.hi })),
        { width: 720, height: 220, locale },
      )
    : `<div class="chart-placeholder">${t("Kategoriprognos kräver minst två månadskolumner i underlaget.")}</div>`;

  return shell({
    locale,
    path: input.url.pathname + input.url.search,
    title: t("Prognos"),
    active: "forecast",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: t("Modellval, säkerhetslager och beställningspunkter."),
    actions: `<form method="get" action="/app/prognos" class="flex gap-2 center">
      <input type="hidden" name="analys" value="${input.analysisId}">
      <select name="horisont" data-autosubmit aria-label="${t("Horisont")}">
        ${[3, 6, 12].map((h) => `<option value="${h}" ${input.horizon === h ? "selected" : ""}>${t("{n} månader", { n: h })}</option>`).join("")}
      </select></form>`,
    content: `
    <div class="grid">
      ${card({
        span: 8,
        title: t("Största artikeln i prognosvyn"),
        subtitle: rows[0] ? `${esc(rows[0].name)} · ${t("modell {method} · {confidence} konfidens", { method: methodLabel(locale, rows[0].forecast.method), confidence: confidenceLabel(locale, rows[0].forecast.confidence) })}` : "",
        body: chart + `<div class="legend"><span><i style="background:var(--ink-soft)"></i>${t("Faktisk efterfrågan")}</span><span><i style="background:var(--signal)"></i>${t("Prognos")}</span><span><i style="background:var(--signal-band)"></i>${t("Osäkerhet")}</span></div>`,
      })}
      ${card({
        span: 4,
        title: t("Modellval"),
        subtitle: "",
        body: `<dl class="stat-line"><dt>${t("Naiv")}</dt><dd>${t("senaste månaden")}</dd></dl>
          <dl class="stat-line"><dt>${t("SES")}</dt><dd>${t("exponentiell utjämning")}</dd></dl>
          <dl class="stat-line"><dt>${t("Holt")}</dt><dd>${t("nivå + trend")}</dd></dl>
          <dl class="stat-line"><dt>${t("Holt-Winters")}</dt><dd>${t("säsong, kräver 24 mån")}</dd></dl>
          <dl class="stat-line"><dt>${t("Croston / SBA")}</dt><dd>${t("glest förekommande efterfrågan")}</dd></dl>
          <dl class="stat-line"><dt>${t("TSB")}</dt><dd>${t("sannolikhet × storlek")}</dd></dl>
          <dl class="stat-line"><dt>${t("ADIDA")}</dt><dd>${t("aggregerad efterfrågan per period")}</dd></dl>
          <p class="hint mt-4">${t("Valet sker per artikel på lägst WAPE i backtest mot de senaste månaderna. Ingen modell väljs för att den är avancerad. MAPE visas endast när alla utfallsperioder är större än noll; WAPE är då det jämförbara måttet.")}</p>
          ${rows[0]?.forecast.notes.length ? `<ul class="prose" style="margin:10px 0 0;padding-left:18px;font-size:12px">${rows[0].forecast.notes.map((note) => `<li>${esc(note)}</li>`).join("")}</ul>` : ""}`,
      })}

      ${card({
        span: 12,
        title: t("Kategori Prognos"),
        subtitle: input.categoryForecast ? t("Aggregerad efterfrågan för {category}", { category: localizeCategory(input.categoryForecast.category, locale) }) : "",
        body: categoryChart,
      })}

      ${card({
        span: 12,
        title: t("Prognos och lagerstyrning per artikel"),
        subtitle: t("Sorterat på lagervärde. Bristrisk är sannolikheten att efterfrågan under ledtid överstiger saldot."),
        body: table({
    locale,
          columns: [
            { key: "sku", label: t("Artikel") },
            { key: "name", label: t("Benämning") },
            { key: "method", label: t("Modell") },
            { key: "fc", label: t("Prognos/mån"), align: "right" },
            { key: "wape", label: "WAPE", align: "right" },
            { key: "mape", label: "MAPE", align: "right" },
            { key: "ss", label: t("Säkerhetslager"), align: "right" },
            { key: "rop", label: t("Beställningspunkt"), align: "right" },
            { key: "qty", label: t("Orderqty"), align: "right" },
            { key: "risk", label: t("Bristrisk"), align: "right" },
          ],
          rows: rows.map((r) => ({
            sku: `<span class="mono">${esc(r.sku)}</span>`,
            name: esc(r.name.slice(0, 40)),
            method: esc(methodLabel(locale, r.forecast.method)),
            fc: num(locale, r.plan.forecastMonthly, 1),
            wape: pct(locale, r.forecast.metrics.wape * 100, 0),
            mape: r.forecast.metrics.mape === null ? "–" : pct(locale, r.forecast.metrics.mape * 100, 0),
            ss: num(locale, r.plan.safetyStock, 0),
            rop: num(locale, r.plan.reorderPoint, 0),
            qty: num(locale, r.plan.orderQuantity, 0),
            risk: r.plan.stockoutProbability > 0.5 ? badge(pct(locale, r.plan.stockoutProbability * 100, 0), "danger") : pct(locale, r.plan.stockoutProbability * 100, 0),
          })),
          rowHref: (row) => `/app/artiklar/${encodeURIComponent(String(row.sku).replace(/<[^>]*>/g, ""))}?analys=${input.analysisId}`,
    rowAttrs: (row) => `data-sku="${esc(String(row.sku).replace(/<[^>]*>/g, ""))}" data-abc="${esc(row.abc ?? "")}"`,
          empty: t("Inga artiklar med tillräcklig historik."),
        }),
      })}
    </div>`,
  });
}

/* -------------------------------------------------------------- simulate */

export interface SimulateInput extends PageContext {
  result: AnalysisResult;
  intel: IntelligenceSnapshot;
  analysisId: string;
  scenarios: ScenarioOutcome[];
  active: ScenarioInput;
  saved: Array<{ id: string; name: string; created_at: string }>;
}

export function simulatePage(input: SimulateInput): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const outcome = input.scenarios[0]!;
  const base = input.scenarios.find((s) => s.input.name === "Basfall") ?? outcome;
  const delta = (key: keyof typeof outcome.totals): string => {
    const value = outcome.totals[key] as number;
    const before = base.totals[key] as number;
    const diff = value - before;
    const cls = diff > 0 ? "delta-up" : diff < 0 ? "delta-down" : "delta-flat";
    return `<span class="${cls}">${diff > 0 ? "+" : ""}${num(locale, diff, 0)}</span>`;
  };

  const slider = (name: string, label: string, min: number, max: number, step: number, value: number, unit: string, sign = false): string => `
    <div class="range-row">
      <label for="${name}">${label}</label>
      <output id="out-${name}" for="${name}">${sign && value > 0 ? "+" : ""}${value}${unit}</output>
      <input id="${name}" name="${name}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"
        data-output="out-${name}" data-unit="${unit}" ${sign ? 'data-sign="plus"' : ""}>
    </div>`;

  const riskList = outcome.risks.length
    ? outcome.risks
        .map((r) => `<div class="stat-line"><dt><strong>${esc(appDynamic(locale, r.title))}</strong><br><span class="muted">${esc(appDynamic(locale, r.detail))}</span></dt>
      <dd>${badge(r.level === "high" ? "Hög" : r.level === "medium" ? "Medel" : "Låg", r.level === "high" ? "danger" : r.level === "medium" ? "warn" : "ok")}</dd></div>`)
        .join("")
    : `<p class="muted">${t("Inga förhöjda risker identifierade i scenariot.")}</p>`;

  const comparison = input.scenarios.length > 1
    ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>${t("Mått")}</th>${input.scenarios
        .map((s) => `<th class="num">${esc(appText(locale, s.input.name))}</th>`)
        .join("")}</tr></thead><tbody>
        ${(
          [
            [t("Lagervärde"), "inventoryValue", "sek"],
            [t("Frigjort kapital"), "freedCapital", "sek"],
            [t("Bristrisk (artiklar)"), "stockoutRiskCount", "num"],
            [t("Uppfyllnadsgrad"), "serviceLevel", "pct"],
            [t("Utebliven marginal"), "lostMargin", "sek"],
            [t("Årlig nettoeffekt"), "annualNetEffect", "sek"],
          ] as Array<[string, keyof typeof outcome.totals, "sek" | "num" | "pct"]>
        )
          .map(
            ([label, key, fmt]) => `<tr><td>${label}</td>${input.scenarios
              .map((s) => {
                const v = s.totals[key] as number;
                const text = fmt === "sek" ? sek(locale, v) : fmt === "pct" ? pct(locale, v * 100) : num(locale, v, 0);
                return `<td class="num">${text}</td>`;
              })
              .join("")}</tr>`,
          )
          .join("")}
      </tbody></table></div>`
    : "";

  return shell({
    locale,
    path: input.url.pathname + input.url.search,
    title: t("Simulering"),
    active: "simulate",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: t("Testa ett beslut innan det fattas. Alla utfall räknas med samma motor som analysen."),
    content: `
    <div class="scenario-grid">
      <form class="card scenario-panel" method="post" action="/app/simulering" data-busy="Beräknar…">
        <div class="card-head"><div><h2>${t("Scenario")}</h2><p>${t("Ändra och kör om.")}</p></div></div>
        <div class="card-body">
          <input type="hidden" name="analys" value="${input.analysisId}">
          <div class="form-row"><label for="namn">${t("Namn")}</label>
            <input id="namn" name="namn" type="text" value="${esc(input.active.name)}" maxlength="60"></div>
          ${slider("demand", t("Efterfrågan"), -50, 100, 5, Math.round((input.active.demandMultiplier - 1) * 100), " %", true)}
          ${slider("lead", t("Leveranstid"), 50, 200, 10, Math.round(input.active.leadTimeMultiplier * 100), " %")}
          ${slider("delay", t("Försening (dagar)"), 0, 60, 5, input.active.supplierDelayDays, " d")}
          ${slider("delayprob", t("Sannolikhet försening"), 0, 100, 10, Math.round(input.active.supplierDelayProbability * 100), " %")}
          ${slider("cost", t("Inköpspris"), 70, 140, 5, Math.round(input.active.costMultiplier * 100), " %")}
          ${slider("price", t("Försäljningspris"), 80, 130, 5, Math.round(input.active.priceMultiplier * 100), " %")}
          ${slider("service", t("Servicenivå"), 80, 99, 1, Math.round(input.active.serviceLevel * 100), " %")}
          ${slider("reduce", t("Lagerreduktion"), 0, 60, 5, Math.round(input.active.stockReductionPct * 100), " %")}
          ${slider("orderqty", t("Orderkvantitet"), 50, 150, 10, Math.round(input.active.orderQtyMultiplier * 100), " %")}
          <div class="flex gap-2" style="margin-top:8px">
            <button class="btn" type="submit">${icon("play", 15)} ${t("Kör scenario")}</button>
            <button class="btn btn-ghost" type="submit" name="spara" value="1">${icon("plus", 15)} ${t("Spara")}</button>
          </div>
        </div>
      </form>

      <div class="stack">
        ${card({
          title: t("{name} jämfört med basfallet", { name: outcome.input.name }),
          subtitle: t("Positivt netto betyder att åtgärden tjänar mer än den kostar i utebliven marginal."),
          body: `<div class="kv" style="margin-bottom:14px">
            <dl><dt>${t("Lagervärde")}</dt><dd>${sek(locale, outcome.totals.inventoryValue)}</dd></dl>
            <dl><dt>${t("Frigjort kapital")}</dt><dd>${sek(locale, outcome.totals.freedCapital)}</dd></dl>
            <dl><dt>${t("Uppfyllnadsgrad")}</dt><dd>${pct(locale, outcome.totals.serviceLevel * 100)}</dd></dl>
            <dl><dt>${t("Bristrisk")}</dt><dd>${t(outcome.totals.stockoutRiskCount === 1 ? "{n} artikel" : "{n} artiklar", { n: num(locale, outcome.totals.stockoutRiskCount) })}</dd></dl>
            <dl><dt>${t("Nettoeffekt/år")}</dt><dd>${sek(locale, outcome.totals.annualNetEffect)}</dd></dl>
          </div>
          <div class="outcome-row"><span class="k">${t("Lagervärde")}</span><span class="v">${sek(locale, outcome.totals.inventoryValue)}</span><span class="d">${delta("inventoryValue")}</span></div>
          <div class="outcome-row"><span class="k">${t("Frigjort kapital")}</span><span class="v">${sek(locale, outcome.totals.freedCapital)}</span><span class="d">${delta("freedCapital")}</span></div>
          <div class="outcome-row"><span class="k">${t("Uppfyllnadsgrad")}</span><span class="v">${pct(locale, outcome.totals.serviceLevel * 100)}</span><span class="d">${delta("serviceLevel")}</span></div>
          <div class="outcome-row"><span class="k">${t("Förväntad brist")}</span><span class="v">${num(locale, outcome.totals.expectedShortageUnits, 0)} st</span><span class="d">${delta("expectedShortageUnits")}</span></div>
          <div class="outcome-row"><span class="k">${t("Utebliven marginal")}</span><span class="v">${sek(locale, outcome.totals.lostMargin)}</span><span class="d">${delta("lostMargin")}</span></div>
          <div class="outcome-row"><span class="k">${t("Lagerhållningskostnad")}</span><span class="v">${sek(locale, outcome.totals.holdingCostAnnual)}</span><span class="d">${delta("holdingCostAnnual")}</span></div>
          <div class="outcome-row"><span class="k">${t("Nettoeffekt per år")}</span><span class="v">${sek(locale, outcome.totals.annualNetEffect)}</span><span class="d">${delta("annualNetEffect")}</span></div>`,
        })}

        ${card({ title: t("Risker"), subtitle: t("Härledda ur siffrorna, inte formulerade i efterhand."), body: riskList })}

        ${comparison ? card({ title: t("Scenariejämförelse"), subtitle: t("Samma baslinje, flera beslut."), body: comparison }) : ""}

        ${card({
          title: t("Beräkningsmodell"),
          subtitle: t("Varje rad är en formel som går att granska."),
          body: `<ul class="prose" style="margin:0;padding-left:18px">${outcome.formulas.map((f) => `<li>${esc(appDynamic(locale, f))}</li>`).join("")}</ul>`,
        })}

        ${card({
          title: t("Största effekt per artikel"),
          body: table({
    locale,
            columns: [
              { key: "sku", label: t("Artikel") },
              { key: "name", label: t("Benämning") },
              { key: "before", label: t("Före"), align: "right" },
              { key: "after", label: t("Efter"), align: "right" },
              { key: "freed", label: t("Frigjort"), align: "right" },
              { key: "risk", label: t("Bristrisk"), align: "right" },
            ],
            rows: outcome.rows.slice(0, 12).map((r) => ({
              sku: `<span class="mono">${esc(r.sku)}</span>`,
              name: esc(r.name.slice(0, 36)),
              before: sek(locale, r.valueBefore),
              after: sek(locale, r.valueAfter),
              freed: sek(locale, r.freed),
              risk: r.stockoutAfter ? badge(t("Ja"), "danger") : t("Nej"),
            })),
            empty: t("Inget scenario beräknat."),
          }),
        })}
      </div>
    </div>`,
  });
}

/* --------------------------------------------------------------- copilot */

export function copilotPage(input: PageContext & {
  analysisId: string;
  turns: Array<{ role: "user" | "assistant"; content: string; answer?: CopilotAnswer }>;
  conversations: Array<{ id: string; title: string; updated_at: string }>;
  error?: string;
}): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const thread = input.turns
    .map((turn) => {
      if (turn.role === "user") {
        return `<div class="turn turn-user"><div class="bubble">${esc(turn.content)}</div></div>`;
      }
      const a = turn.answer;
      if (!a) return `<div class="turn turn-bot"><div class="bubble"><p>${esc(turn.content)}</p></div></div>`;
      const facts = a.facts.length
        ? `<div class="facts">${a.facts.map((f) => `<div><span class="fact-label">${esc(f.label)}</span><span class="fact-value">${esc(f.value)}</span></div>`).join("")}</div>`
        : "";
      const tbl = a.table
        ? table({
    locale,
            columns: a.table.columns.map((c, i) => ({ key: `c${i}`, label: c, align: a.table!.align?.[i] ?? (i === 0 ? "left" : "right") })),
            rows: a.table.rows.map((row) => Object.fromEntries(row.map((cell, i) => [`c${i}`, esc(cell)]))),
          })
        : "";
      const followUps = a.followUps.length
        ? `<div class="chips" style="margin-top:12px">${a.followUps.map((f) => { const local = appText(locale, f); return `<button class="chip" type="button" data-ask="${esc(local)}">${esc(local)}</button>`; }).join("")}</div>`
        : "";
      const brief = a.brief
        ? `<div class="decision-brief">
            <div><span>${t("Identifierat")}</span><p>${esc(a.brief.identified)}</p></div>
            <div><span>${t("Varför det är viktigt")}</span><p>${esc(a.brief.why)}</p></div>
            <div><span>${t("Data bakom")}</span><p>${esc(a.brief.data)}</p></div>
            <div><span>${t("Rekommenderad åtgärd")}</span><p>${esc(a.brief.action)}</p></div>
            <div><span>${t("Uppskattad ekonomisk effekt")}</span><p>${esc(a.brief.effect)}</p></div>
            <div><span>${t("Osäkerheter och antaganden")}</span><p>${esc(a.brief.uncertainty)}</p></div>
          </div>`
        : "";
      return `<div class="turn turn-bot"><div class="bubble">
        <p>${esc(a.answer)}</p>
        ${brief}
        ${facts}${tbl ? `<div class="mt-4">${tbl}</div>` : ""}
        ${followUps}
        <div class="sources">${esc(a.sources.join(" · "))} · ${t("konfidens")} ${esc(confidenceLabel(locale, a.confidence))}${a.notes.length ? ` · ${esc(a.notes.join(" "))}` : ""}</div>
      </div></div>`;
    })
    .join("");

  const empty = `<div class="copilot-intro">
    <p class="folio">${t("Assistenten")}</p>
    <h2 class="copilot-title">${t("Ställ frågan du annars ställer till controllern.")}</h2>
    <p class="health-note">${t("Copiloten svarar med tal ur analysmotorn. Den kan inte hitta på siffror: varje belopp är spårbart till en beräkning, och ett svar som inför nya tal avvisas.")}</p>
  </div>`;

  return shell({
    locale,
    path: input.url.pathname + input.url.search,
    title: t("Copilot"),
    active: "copilot",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: t("Analytisk assistent för lager och supply chain. Svenska och engelska."),
    content: `
    ${input.error ? alert(esc(input.error), "error") : ""}
    <div class="grid">
      <div class="span-8 copilot-stage">
        ${thread ? "" : `<canvas class="net-canvas" data-net="ambient" aria-hidden="true"></canvas>`}
        <div class="thread" data-thread>${thread || empty}</div>
        <form class="composer mt-4" method="post" action="/app/copilot" data-composer data-busy="${t("Tänker…")}">
          <input type="hidden" name="analys" value="${input.analysisId}">
          <input name="q" type="text" placeholder="${t("Fråga t.ex. vilka 20 artiklar som binder mest onödigt kapital")}" aria-label="${t("Fråga copiloten")}" autocomplete="off">
          <button class="btn" type="submit">${t("Fråga")} ${icon("arrow", 15)}</button>
        </form>
        <p class="hint mt-2">${t("Svaren bygger på {n} tidigare meddelanden i den här konversationen. Följdfrågor som \"och de 10 största?\" behåller sammanhanget.", { n: input.turns.length })}</p>
      </div>
      <div class="span-4 copilot-side">
        ${card({
          title: t("Förslag"),
          body: `<div class="chips">${copilotSuggestions(locale).map((s) => `<button class="chip" type="button" data-ask="${esc(s)}">${esc(s)}</button>`).join("")}</div>`,
        })}
        ${card({
          title: t("Tidigare samtal"),
          body: input.conversations.length
            ? `<div class="stack-sm">${input.conversations.map((c) => `<a class="stat-line" href="/app/copilot?analys=${input.analysisId}&samtal=${c.id}"><dt>${esc(c.title)}</dt><dd class="tag-inline">${date(locale, c.updated_at)}</dd></a>`).join("")}</div>`
            : `<p class="muted">${t("Inga sparade samtal ännu.")}</p>`,
        })}
        ${card({
          title: t("Så säkras talen"),
          body: `<p class="muted" style="font-size:13px">${t("Frågan tolkas till ett avgränsat syfte. Motorn räknar fram svaret. En språkmodell får bara formulera om texten, och avvisas om den inför ett tal som inte finns i underlaget.")}</p>`,
        })}
      </div>
    </div>`,
  });
}
