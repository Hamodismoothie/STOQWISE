/**
 * Public pages: landing, pricing, demo, get started, help, legal, about,
 * contact and authentication. The marketing surface is English and uses the
 * enterprise theme (see .site-body in v3.css); the product itself stays Swedish.
 */
import { formatNumber, formatSek } from "../analysis.ts";
import { abcXyzMatrix, forecastChart, treemap } from "../ui/charts.ts";
import { appRole, appTranslator } from "../i18n-app.ts";
import { brandLockup, esc, icon, marketingShell, moneyRange } from "../ui/base.ts";
import { EMAILS } from "../brand.ts";

const helloLink = EMAILS.hello ? `<a class="mono" href="mailto:${EMAILS.hello}">${EMAILS.hello}</a>` : null;
const privacyLink = EMAILS.privacy ? `<a class="mono" href="mailto:${EMAILS.privacy}">${EMAILS.privacy}</a>` : null;
import { DEFAULT_LOCALE, dirFor, formatNumber as localeNumber, formatSek as formatSekLocale, intlFor, strings, type Locale } from "../i18n.ts";
import { localizeCategory } from "../terminology.ts";
import type { DemoEnvironmentMeta } from "../demo.ts";

const sekRange = (low: number, high: number): string => moneyRange(low, high);
const sv = (n: number): string => formatNumber(n, 0);
const en = (n: number): string => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
const en1 = (n: number): string => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);
const million = (n: number, locale: Locale): string =>
  `${new Intl.NumberFormat(intlFor(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n / 1_000_000).replace(/(\.0|,0)$/, "")}M`;
const lnum = (locale: Locale, n: number, decimals = 0): string => localeNumber(locale, n, decimals);

export interface DemoSummary {
  inventoryValue: number;
  deadStockValue: number;
  overstockValue: number;
  turns: number;
  skuCount: number;
  releaseLow: number;
  releaseHigh: number;
  health: number;
  categories: Array<{ label: string; value: number; dead: number }>;
  matrix: Array<{ abc: string; x: number; y: number; z: number; value: number }>;
  history: number[];
  forecastPoints: Array<{ value: number; lo: number; hi: number }>;
  priorities: Array<{ name: string; reasons: string[]; score: number; value: number }>;
}

/* --------------------------------------------------------------- landing */

export function landingPage(input: { user: { name: string } | null; demo: DemoSummary; locale?: Locale }): string {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const c = strings(locale);
  const d = input.demo;
  const isSv = locale === "sv";
  const num = (n: number): string => lnum(locale, n);
  const money = (n: number): string => formatSekLocale(locale, n);
  const releaseRange = (low: number, high: number): string =>
    high >= 1_000_000 ? `SEK ${million(low, locale)}–${million(high, locale)}` : `SEK ${lnum(locale, low)}–${lnum(locale, high)}`;
  const t = (svText: string, enText: string): string => (isSv ? svText : enText);
  const reason = (text: string): string => (isSv ? text.replace(/(\d)\.(\d)/g, "$1,$2") : text);
  const top = d.priorities.slice(0, 4);

  const spark = (() => {
    const values = d.history.slice(-24);
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const w = 520;
    const h = 128;
    const pts = values.map((v, i) => `${((i / Math.max(1, values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / Math.max(1, max - min)) * (h - 14) - 7).toFixed(1)}`);
    return `<svg class="pv-spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="${t("Efterfrågan över tid", "Demand over time")}" preserveAspectRatio="none">
      <defs><linearGradient id="pv-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--signal)" stop-opacity=".26"/><stop offset="1" stop-color="var(--signal)" stop-opacity="0"/></linearGradient></defs>
      <path class="pv-area" d="M0 ${h} L${pts.join(" L")} L${w} ${h} Z" fill="url(#pv-fill)"/>
      <polyline class="pv-line" pathLength="1" points="${pts.join(" ")}" fill="none" stroke="var(--signal)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
      <circle class="pv-end" cx="${w}" cy="${pts[pts.length - 1].split(",")[1]}" r="3.5" fill="var(--signal)"/>
    </svg>`;
  })();

  const priorityRows = (items: typeof top): string =>
    items
      .map(
        (p, i) => `<li class="pv-action"><span class="pv-rank">${String(i + 1).padStart(2, "0")}</span><span class="pv-action-main"><b>${esc(p.name)}</b><small>${esc(reason(p.reasons[0] ?? ""))}</small></span><span class="pv-action-value">${money(p.value)}</span></li>`,
      )
      .join("");

  const preview = `<div class="product-preview reveal reveal-2" data-product-preview>
    <div class="pv-chrome">
      <span class="pv-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="pv-url">app.stoqwise.com / ${t("oversikt", "overview")}</span>
      <span class="pv-fictional"><i></i>${t("Produktdemonstration", "Product demo")}</span>
    </div>
    <div class="pv-app">
      <aside class="pv-rail" aria-hidden="true">
        <div class="pv-mark">S</div>
        <span class="is-active"><i></i>${t("Översikt", "Overview")}</span>
        <span><i></i>${t("Lager", "Inventory")}</span>
        <span><i></i>${t("Efterfrågan", "Demand")}</span>
        <span><i></i>${t("Optimering", "Optimization")}</span>
        <span><i></i>${t("Inköp", "Procurement")}</span>
        <span><i></i>${t("AI-insikter", "AI insights")}</span>
        <div class="pv-rail-foot"><b>${d.skuCount} SKU</b></div>
      </aside>
      <div class="pv-main">
        <div class="pv-topline"><span>${t("Lageröversikt", "Inventory overview")} · ${d.skuCount} SKU</span><span class="pv-live"><i></i>${t("Senast beräknad", "Last calculated")} 09:41</span></div>
        <div class="pv-tabs" role="tablist" aria-label="${t("Produktförhandsvisning", "Product preview")}">
          <button type="button" role="tab" id="pv-tab-overview" aria-controls="pv-panel-overview" aria-selected="true" data-preview-tab="overview">${t("Översikt", "Overview")}</button>
          <button type="button" role="tab" id="pv-tab-forecast" aria-controls="pv-panel-forecast" aria-selected="false" tabindex="-1" data-preview-tab="forecast">${t("Efterfrågan", "Demand")}</button>
          <button type="button" role="tab" id="pv-tab-actions" aria-controls="pv-panel-actions" aria-selected="false" tabindex="-1" data-preview-tab="actions">${t("Åtgärder", "Actions")}</button>
        </div>
        <div class="pv-panel" id="pv-panel-overview" role="tabpanel" aria-labelledby="pv-tab-overview" data-preview-panel="overview">
          <div class="pv-kpis">
            <div><span>${t("Lagervärde", "Inventory value")}</span><strong>${money(d.inventoryValue)}</strong><small>${d.skuCount} ${t("artiklar · fysiskt saldo", "items · physical stock")}</small></div>
            <div><span>${t("Inaktivt lager", "Inactive stock")}</span><strong class="pv-warn">${money(d.deadStockValue)}</strong><small>${t("Ingen försäljning 180 d", "No sales for 180 d")}</small></div>
            <div><span>${t("Lageromsättning", "Inventory turns")}</span><strong>${lnum(locale, d.turns, 1)}×</strong><small>${t("Rullande 12 månader", "Rolling 12 months")}</small></div>
          </div>
          <div class="pv-grid">
            <div class="pv-chart-card"><div class="pv-card-head"><span>${t("Efterfrågan · ", "Demand · ")}${d.history.length} ${t("månader", "months")}</span><span class="pv-chip">${t("Faktisk", "Actual")}</span></div>${spark}</div>
            <div class="pv-insight"><span class="pv-insight-tag">${t("Frigöringspotential", "Release potential")}</span><b>${releaseRange(d.releaseLow, d.releaseHigh)}</b><p>${t("Intervall baserat på inaktiva artiklar och överlager. Öppna optimeringen för att se vad som driver beloppet.", "A range based on inactive items and overstock. Open optimisation to see what drives the amount.")}</p><a class="pv-insight-link" href="/produkt">${t("Öppna optimering", "Open optimisation")} →</a></div>
          </div>
        </div>
        <div class="pv-panel" id="pv-panel-forecast" role="tabpanel" aria-labelledby="pv-tab-forecast" data-preview-panel="forecast" hidden>
          <div class="pv-kpis pv-kpis-2">
            <div><span>${t("Planeringshorisont", "Planning horizon")}</span><strong>12 ${t("mån", "mo")}</strong><small>${t("Rullande prognos", "Rolling forecast")}</small></div>
            <div><span>${t("Prognosintervall", "Forecast interval")}</span><strong>${isSv ? "80 %" : "80%"}</strong><small>${t("Osäkerhetsband", "Uncertainty band")}</small></div>
          </div>
          <div class="pv-chart-wide"><div class="pv-card-head"><span>${t("Efterfrågan · historik och prognos", "Demand · history and forecast")}</span><span class="pv-legend"><i></i>${t("Faktisk", "Actual")}<i></i>${t("Prognos", "Forecast")}</span></div>
            ${forecastChart(
              d.history.map((v, i) => ({ label: `M${i + 1}`, value: v })),
              d.forecastPoints.map((p, i) => ({ label: `F${i + 1}`, value: p.value, lo: p.lo, hi: p.hi })),
              { width: 700, height: 218, locale, unit: "" },
            )}
          </div>
        </div>
        <div class="pv-panel" id="pv-panel-actions" role="tabpanel" aria-labelledby="pv-tab-actions" data-preview-panel="actions" hidden>
          <div class="pv-actions-head"><span>${t("Rekommenderade åtgärder", "Recommended actions")}</span><span class="pv-chip">${t("Kapitalviktad", "Capital weighted")}</span></div>
          <ul class="pv-actions">${priorityRows(top)}</ul>
        </div>
      </div>
    </div>
  </div>`;

  const capabilityRows = [
    {
      id: "intelligence",
      index: "01",
      label: t("Lagerintelligens", "Inventory intelligence"),
      title: t("Se var kapitalet sitter.", "See where capital is tied up."),
      text: t("Saldo, försäljning, inköpspris och ledtid samlas per artikel. ABC/XYZ, inaktiva artiklar, överlager och täckning beräknas på samma underlag.", "Stock, sales, purchase price and lead time are collected per item. ABC/XYZ, inactive items, overstock and cover use the same evidence."),
      bullets: [t("Artiklar rankade efter bundet kapital", "Items ranked by tied-up capital"), t("ABC/XYZ med redovisade trösklar", "ABC/XYZ with stated thresholds"), t("Varje belopp går tillbaka till artikelraden", "Every amount traces back to the item row")],
      visual: `<div class="cap-visual cap-matrix">${abcXyzMatrix(d.matrix)}</div>`,
    },
    {
      id: "forecasting",
      index: "02",
      label: t("Efterfrågeprognos", "Demand forecasting"),
      title: t("Prognosen visar sitt underlag.", "The forecast shows its evidence."),
      text: t("Historik, trend och säsong bildar en rullande prognos med osäkerhetsband. Modellvalet backtestas mot de senaste månaderna i stället för att väljas på antaganden.", "History, trend and seasonality form a rolling forecast with an uncertainty band. The model is chosen by backtesting recent months, not by assumption."),
      bullets: [t("12 månaders planeringshorisont", "12-month planning horizon"), t("Osäkerhetsband i stället för en exakt nivå", "An uncertainty band instead of a single level"), t("Backtest mot faktisk försäljning", "Backtested against actual sales")],
      visual: `<div class="cap-visual cap-forecast">${forecastChart(
        d.history.map((v, i) => ({ label: `M${i + 1}`, value: v })),
        d.forecastPoints.map((p, i) => ({ label: `F${i + 1}`, value: p.value, lo: p.lo, hi: p.hi })),
        { width: 640, height: 270, locale },
      )}</div>`,
    },
    {
      id: "optimization",
      index: "03",
      label: t("Lageroptimering", "Inventory optimization"),
      title: t("Justera parametrar och se effekten.", "Adjust parameters and see the effect."),
      text: t("Pröva beställningspunkt, säkerhetslager och orderkvantitet mot efterfrågan och ledtid. Lagervärde, täckning och bristrisk uppdateras med samma beräkning.", "Test reorder point, safety stock and order quantity against demand and lead time. Inventory value, cover and stockout risk update from the same calculation."),
      bullets: [t("Scenarier på samma underliggande data", "Scenarios on the same underlying data"), t("Effekt på kapital och tillgänglighet", "Impact on capital and availability"), t("Motivering per rekommendation", "A rationale for each recommendation")],
      visual: `<div class="cap-visual cap-params"><div class="cap-params-head"><span>${t("Parametrar i beräkningen", "Parameters in the calculation")}</span><span class="mono">${t("Per artikel", "Per item")}</span></div><div class="cap-param"><span>${t("Servicenivå", "Service level")}</span><b>95 %</b><small>${t("Standardvärde, kan ändras per artikel", "Default, adjustable per item")}</small></div><div class="cap-param"><span>${t("Säkerhetslager", "Safety stock")}</span><b>z × σ × roten ur ledtid</b><small>${t("Skyddar mot variation under ledtiden", "Covers variation during lead time")}</small></div><div class="cap-param"><span>${t("Beställningspunkt", "Reorder point")}</span><b>${t("Medelbehov × ledtid + säkerhetslager", "Average demand × lead time + safety stock")}</b><small>${t("Jämförs med tillgängligt saldo", "Compared with available stock")}</small></div><div class="cap-param"><span>${t("Orderkvantitet", "Order quantity")}</span><b>${t("Justerbar per artikel", "Adjustable per item")}</b><small>${t("Prövas mot täckning och bundet kapital", "Tested against cover and tied-up capital")}</small></div></div>`,
    },
    {
      id: "procurement",
      index: "04",
      label: t("Inköpsintelligens", "Procurement intelligence"),
      title: t("Inköpsrekommendationer med täckning och ledtid.", "Purchase recommendations with cover and lead time."),
      text: t("Förslagen väger täckning, ledtid, säkerhetslager och bundet kapital. Varje rad visar varför kvantiteten föreslås och vad som händer om ordern skjuts upp.", "Proposals weigh cover, lead time, safety stock and tied-up capital. Each line shows why the quantity is suggested and what happens if the order is delayed."),
      bullets: [t("Inköpsunderlag per leverantör", "Purchase plan by supplier"), t("Bristrisk före och efter order", "Stockout risk before and after ordering"), t("Export till CSV eller Excel", "Export to CSV or Excel")],
      visual: `<div class="cap-visual cap-priority"><div class="cap-priority-head"><span>${t("Prioriterade artiklar", "Priority items")}</span><span class="mono">${d.priorities.length} ${t("poster", "records")}</span></div>${top.slice(0, 3).map((p, i) => `<div class="cap-priority-row"><span class="mono">${String(i + 1).padStart(2, "0")}</span><span><b>${esc(p.name)}</b><small>${esc(p.reasons[0] ?? "")}</small></span><em>${money(p.value)}</em></div>`).join("")}</div>`,
    },
  ]
    .map(
      (row, i) => `<section class="cap-row ${i % 2 ? "cap-row-reverse" : ""}" id="${row.id}">
        <div class="cap-copy">
          <p class="section-index"><span>${row.index}</span>${row.label}</p>
          <h3>${row.title}</h3>
          <p>${row.text}</p>
          <ul class="cap-list">${row.bullets.map((b) => `<li>${icon("check", 15)}${b}</li>`).join("")}</ul>
        </div>
        <div class="cap-media">${row.visual}</div>
      </section>`,
    )
    .join("");

  const platformActions = top
    .map(
      (p, i) => `<div class="platform-action"><span class="mono">${String(i + 1).padStart(2, "0")}</span><span><b>${esc(p.name)}</b><small>${esc(reason(p.reasons[0] ?? ""))}</small></span><em>${money(p.value)}</em></div>`,
    )
    .join("");
  const platformMatrix = d.matrix
    .map(
      (row) => `<div class="platform-matrix-row"><b>${row.abc}</b><span>${num(row.x)}</span><span>${num(row.y)}</span><span>${num(row.z)}</span></div>`,
    )
    .join("");
  const platformTabs = [
    {
      id: "oversikt",
      num: "01",
      label: t("Översikt", "Overview"),
      question: t("Vad händer nu?", "What is happening now?"),
      panel: `<div class="platform-main-head"><div><span class="platform-kicker">${t("Översikt", "Overview")}</span><h3>${t("Lagerhälsa och nästa åtgärd", "Inventory health and next action")}</h3></div><span class="pv-live"><i></i>${t("Beräknad", "Calculated")} 09:41</span></div>
        <div class="platform-kpis"><div><span>${t("Lagervärde", "Inventory value")}</span><b>${money(d.inventoryValue)}</b></div><div><span>${t("Lagerhälsa", "Inventory health")}</span><b>${d.health}<small>/100</small></b></div><div><span>${t("Inaktiva artiklar", "Inactive items")}</span><b class="warn">${money(d.deadStockValue)}</b></div></div>
        <div class="platform-body"><div class="platform-chart"><div class="pv-card-head"><span>${t("Kapital per kategori", "Capital by category")}</span><span class="mono">SEK</span></div>${treemap(d.categories.slice(0, 6).map((c) => ({ ...c, label: localizeCategory(c.label, locale) })), { height: 226, format: (v) => num(v), unit: "SEK", ariaLabel: t("Kapital per kategori", "Capital by category"), locale })}</div><div class="platform-findings"><p class="platform-kicker">${t("Prioriterade åtgärder", "Priority actions")}</p>${top.slice(0, 2).map((p) => `<div class="platform-finding"><b>${esc(p.name)}</b><p>${esc(reason(p.reasons[0] ?? ""))}</p><span>${money(p.value)}</span></div>`).join("")}<a class="text-link" href="/produkt">${t("Se alla åtgärder", "See all actions")} ${icon("arrow", 13)}</a></div></div>`,
    },
    {
      id: "lager",
      num: "02",
      label: t("Lager", "Inventory"),
      question: t("Var sitter kapitalet?", "Where is capital tied up?"),
      panel: `<div class="platform-main-head"><div><span class="platform-kicker">${t("Lager", "Inventory")}</span><h3>${t("Kapital per artikel och klass", "Capital by item and class")}</h3></div><span class="pv-live"><i></i>${t("Beräknad", "Calculated")} 09:41</span></div>
        <div class="platform-kpis"><div><span>${t("Lagervärde", "Inventory value")}</span><b>${money(d.inventoryValue)}</b></div><div><span>${t("Överlager", "Overstock")}</span><b>${money(d.overstockValue)}</b></div><div><span>${t("Lageromsättning", "Inventory turns")}</span><b>${num(d.turns)}×</b></div></div>
        <div class="platform-body"><div class="platform-chart"><div class="pv-card-head"><span>${t("Största kapitalbindningen", "Largest capital holdings")}</span><span class="mono">SEK</span></div><div class="platform-actions">${top.slice(0, 4).map((p, i) => `<div class="platform-action"><span class="mono">${String(i + 1).padStart(2, "0")}</span><span><b>${esc(p.name)}</b><small>${esc(p.reasons[0] ?? "")}</small></span><em>${money(p.value)}</em></div>`).join("")}</div></div><div class="platform-findings"><p class="platform-kicker">${t("ABC / XYZ · antal artiklar", "ABC / XYZ · item count")}</p><div class="platform-matrix-table"><div class="platform-matrix-row is-head"><span>${t("Klass", "Class")}</span><span>X</span><span>Y</span><span>Z</span></div>${platformMatrix}</div><p class="platform-note">${t("Klasserna bygger på försäljningsvärde och variation i månadsförsäljning. I produkten går varje rad att öppna i artikelvyn.", "The classes use sales value and variation in monthly sales. Each row opens in the item view.")}</p></div></div>`,
    },
    {
      id: "efterfragan",
      num: "03",
      label: t("Efterfrågan", "Demand"),
      question: t("Vad behöver vi köpa?", "What do we need to buy?"),
      panel: `<div class="platform-main-head"><div><span class="platform-kicker">${t("Efterfrågan", "Demand")}</span><h3>${t("Historik och prognos", "History and forecast")}</h3></div><span class="pv-live"><i></i>${t("Beräknad", "Calculated")} 09:41</span></div>
        <div class="platform-kpis"><div><span>${t("Planeringshorisont", "Planning horizon")}</span><b>12 <small>${t("månader", "months")}</small></b></div><div><span>${t("Osäkerhetsband", "Uncertainty band")}</span><b>${isSv ? "80 %" : "80%"}</b></div><div><span>${t("Historik", "History")}</span><b>${d.history.length} <small>${t("månader", "months")}</small></b></div></div>
        <div class="platform-body platform-body-single"><div class="platform-chart"><div class="pv-card-head"><span>${t("Efterfrågan per månad", "Monthly demand")}</span><span class="pv-legend"><i></i>${t("Faktisk", "Actual")}<i></i>${t("Prognos", "Forecast")}</span></div>${forecastChart(d.history.map((v, i) => ({ label: `M${i + 1}`, value: v })), d.forecastPoints.map((p, i) => ({ label: `F${i + 1}`, value: p.value, lo: p.lo, hi: p.hi })), { width: 820, height: 250, locale, id: "platform-demand" })}<p class="platform-note">${t("Prognosen backtestas mot de senaste månaderna. Osäkerhetsbandet visar intervallet, inte en garanterad nivå.", "The forecast is backtested against recent months. The band shows a range, not a guaranteed level.")}</p></div></div>`,
    },
    {
      id: "optimering",
      num: "04",
      label: t("Optimering", "Optimization"),
      question: t("Vad kan bli bättre?", "What can improve?"),
      panel: `<div class="platform-main-head"><div><span class="platform-kicker">${t("Optimering", "Optimization")}</span><h3>${t("Frigör kapital utan att sänka tillgängligheten", "Release capital without reducing availability")}</h3></div><span class="pv-live"><i></i>${t("Beräknad", "Calculated")} 09:41</span></div>
        <div class="platform-kpis"><div><span>${t("Frigörbart kapital", "Releasable capital")}</span><b>${releaseRange(d.releaseLow, d.releaseHigh)}</b></div><div><span>${t("Inaktiva artiklar", "Inactive items")}</span><b>${money(d.deadStockValue)}</b></div><div><span>${t("Överlager", "Overstock")}</span><b>${money(d.overstockValue)}</b></div></div>
        <div class="platform-body"><div class="cap-capital"><div class="cap-capital-head"><span>${t("Frigöringspotential", "Release potential")}</span><strong>${releaseRange(d.releaseLow, d.releaseHigh)}</strong></div><div class="cap-bar"><i style="width:${Math.min(92, Math.round((d.deadStockValue / Math.max(1, d.inventoryValue)) * 100) + 24)}%"></i></div><div class="cap-capital-foot"><span>${t("Inaktivt lager", "Inactive stock")} ${money(d.deadStockValue)}</span><span>${t("Överlager", "Overstock")} ${money(d.overstockValue)}</span></div></div><div class="platform-findings"><p class="platform-kicker">${t("Så används underlaget", "How the evidence is used")}</p><ul class="platform-notes"><li>${t("Beräkna beställningspunkt utifrån ledtid och servicenivå.", "Calculate the reorder point from lead time and service level.")}</li><li>${t("Jämför säkerhetslager och orderkvantitet mot bundet kapital.", "Compare safety stock and order quantity with tied-up capital.")}</li><li>${t("Se effekten på täckning och bristrisk innan en order läggs.", "See the effect on cover and stockout risk before placing an order.")}</li></ul></div></div>`,
    },
    {
      id: "ai",
      num: "05",
      label: t("AI-beslutsstöd", "AI decision support"),
      question: t("Vad bör vi göra först?", "What should we do first?"),
      panel: `<div class="platform-main-head"><div><span class="platform-kicker">${t("AI-beslutsstöd", "AI decision support")}</span><h3>${t("Prioriterade åtgärder med underlag", "Priority actions with evidence")}</h3></div><span class="pv-live"><i></i>${t("Beräknad", "Calculated")} 09:41</span></div>
        <div class="platform-kpis"><div><span>${t("Åtgärder i kön", "Actions in queue")}</span><b>${top.length || 0}</b></div><div><span>${t("Underlag", "Evidence")}</span><b>${t("Artikelrad", "Item level")}</b></div><div><span>${t("Beslut", "Decision")}</span><b>${t("Granskas manuellt", "Reviewed manually")}</b></div></div>
        <div class="platform-body platform-body-single"><div class="platform-actions">${platformActions}</div><p class="platform-note">${t("Varje åtgärd visar artikel, belopp och orsak. Inga order skickas automatiskt.", "Each action shows the item, amount and reason. No orders are sent automatically.")}</p></div>`,
    },
  ];
  const platform = `<div class="platform-shell" data-platform-tabs>
    <div class="platform-side" role="tablist" aria-label="${t("Plattformens funktioner", "Platform capabilities")}">
      <div class="platform-brand"><span class="pv-mark">S</span><span>STOQWISE</span></div>
      ${platformTabs.map((tab, i) => `<button class="platform-nav ${i === 0 ? "is-active" : ""}" type="button" role="tab" id="platform-tab-${tab.id}" aria-controls="platform-panel-${tab.id}" aria-selected="${i === 0 ? "true" : "false"}" tabindex="${i === 0 ? "0" : "-1"}" data-platform-tab="${tab.id}"><span class="mono">${tab.num}</span><span><b>${tab.label}</b><small>${tab.question}</small></span></button>`).join("")}
    </div>
    <div class="platform-main">
      ${platformTabs.map((tab, i) => `<div class="platform-panel" id="platform-panel-${tab.id}" role="tabpanel" aria-labelledby="platform-tab-${tab.id}" data-platform-panel="${tab.id}" ${i === 0 ? "" : "hidden"}>${tab.panel}</div>`).join("")}
    </div>
  </div>`;

  const industries = [
    [t("Partihandel och industri", "Wholesale and industry"), t("Långa ledtider, stora volymer och kapital i lager. Prioritera rätt artikel, order och lagerläge.", "Long lead times, high volumes and capital in stock. Prioritise the right item, order and stock position."), "Nordvind Industri", `46 SKU · 24 ${t("mån", "mo")}`, "industri"],
    [t("Detaljhandel", "Retail"), t("Säsong, kampanjer och butiksdistribution. Följ överlager under säsongen och täckning inför nästa påfyllning.", "Seasonality, campaigns and store distribution. Track overstock through the season and cover before the next replenishment."), "Ljusgården Hem", `43 SKU · 24 ${t("mån", "mo")}`, "hem"],
    [t("Livsmedel och foodservice", "Food and foodservice"), t("Kort ledtid och hållbarhetsgränser. Skilj på fysiskt saldo och säljbart saldo före nästa inköp.", "Short lead times and shelf-life limits. Separate physical stock from sellable stock before the next purchase."), "Solsidan Foodservice", `37 SKU · 12 ${t("mån", "mo")}`, "foodservice"],
    [t("E-handel", "E-commerce"), t("Snabb rörlighet och lång svans. Se vilka SKU:er som binder kapital och vilka som riskerar att ta slut.", "Fast movement and a long tail. See which SKUs tie up capital and which risk running out."), "Nordbris E-handel", `37 SKU · 12 ${t("mån", "mo")}`, "ecommerce"],
  ]
    .map(
      ([title, text, company, meta, env], i) => `<a class="industry-card" href="/produkt?miljo=${env}" aria-label="${t("Öppna demomiljö: ", "Open demo environment: ")}${title}">
        <div class="industry-top"><span class="mono">0${i + 1}</span></div>
        <h3>${title}</h3><p>${text}</p>
        <div class="industry-foot"><span>${company}</span><span class="mono">${meta}</span></div>
      </a>`,
    )
    .join("");

  const landingIndustries = [
    [t("Partihandel och industri", "Wholesale and industry"), t("Långa ledtider och stora volymer.", "Long lead times and high volumes."), "industri"],
    [t("Detaljhandel", "Retail"), t("Säsong, kampanjer och butiksdistribution.", "Seasonality, campaigns and store distribution."), "hem"],
    [t("Livsmedel och foodservice", "Food and foodservice"), t("Kort ledtid och hållbarhetsgränser.", "Short lead times and shelf-life limits."), "foodservice"],
    [t("E-handel", "E-commerce"), t("Snabb rörlighet och en lång svans.", "Fast movement and a long tail."), "ecommerce"],
  ]
    .map(
      ([title, text, env], i) => `<a class="industry-row" href="/produkt?miljo=${env}" aria-label="${t("Öppna demomiljö: ", "Open demo environment: ")}${title}">
        <span class="industry-index">0${i + 1}</span>
        <span class="industry-copy"><h3>${title}</h3><p>${text}</p></span>
        <span class="industry-open">${t("Öppna demo", "Open demo")} ${icon("arrow", 15)}</span>
      </a>`,
    )
    .join("");

  const faq = [
    [t("Var kommer siffrorna ifrån?", "Where do the figures come from?"), t("Alla beräkningar utgår från den data som importeras till arbetsytan: saldo, försäljning, inköpspris, ledtid och artikelmetadata. Siffrorna i demonstrationen är exempel, beräknade med samma metod som produkten.", "Every calculation starts from the data imported into the workspace: stock, sales, purchase price, lead time and item metadata. The figures in the demonstration are examples, calculated with the same method as the product.")],
    [t("Vilka filer kan jag importera?", "Which files can I import?"), t("CSV och Excel med artikelrader, saldo och försäljningshistorik. Importen mappar kolumner, visar avvikelser och kräver att du bekräftar innan data skrivs.", "CSV and Excel with item rows, stock and sales history. The import maps columns, surfaces exceptions and requires confirmation before writing data.")],
    [t("Ersätter STOQWISE mitt affärssystem?", "Does STOQWISE replace my ERP?"), t("Nej. STOQWISE är beslutsstödet ovanpå era befintliga system. Ni importerar eller synkroniserar data, analyserar och exporterar åtgärder tillbaka till era processer.", "No. STOQWISE is the decision layer on top of your existing systems. You import or synchronise data, analyse it and export actions back into your processes.")],
    [t("Hur fungerar prissättningen?", "How does pricing work?"), t("Priset utgår från antal artiklar, lagerställen, användare, datavolym och funktioner. Ni får ett transparent estimat och begär sedan offert. Ingen betalning aktiveras automatiskt.", "Pricing reflects item count, locations, users, data volume and capabilities. You receive a transparent estimate and then request a quote. No payment is activated automatically.")],
    [t("Vad menar STOQWISE med inaktivt lager?", "What does STOQWISE mean by inactive stock?"), t("Artiklar med saldo över noll och ingen registrerad försäljning under det valda fönstret. Det är inte samma sak som överlager eller långsamt omsatta artiklar. De beräknas separat.", "Items with stock above zero and no recorded sales during the selected window. This is not the same as overstock or slow-moving items. They are calculated separately.")],
    [t("Hur skyddas vår data?", "How is our data protected?"), t("Varje organisation har en separat arbetsyta. Åtkomst styrs av roller och behörigheter, och inloggningar, importer, behörighetsändringar och raderingar loggas. Data används för att leverera tjänsten.", "Each organisation has a separate workspace. Access is governed by roles and permissions, and sign-ins, imports, permission changes and deletions are logged. Data is used to deliver the service.")],
    [t("Finns det stöd för svenska och engelska?", "Are Swedish and English supported?"), t("Ja. Gränssnitt, rapporter och PDF:er finns på svenska och engelska. Språkvalet påverkar format för valuta, datum och tal.", "Yes. The interface, reports and PDFs are available in Swedish and English. Language selection controls currency, date and number formatting.")],
  ]
    .map(([q, a]) => `<details class="faq-item"><summary>${q}<span aria-hidden="true">+</span></summary><div><p>${a}</p></div></details>`)
    .join("");

  return marketingShell({
    title: `${c.home.title1} ${c.home.title2} · STOQWISE`,
    description: c.meta.description,
    user: input.user,
    locale,
    path: "/",
    content: `
    <div class="landing">
    <section class="site-wrap hero hero-ni">
      <canvas class="net-canvas" data-net="hero" aria-hidden="true"></canvas>
      <div class="hero-copy reveal">
        <p class="eyebrow"><span class="eyebrow-mark" aria-hidden="true"></span>${c.home.eyebrow}</p>
        <h1><span>${c.home.title1}</span><span class="hero-accent">${c.home.title2}</span></h1>
        <p class="hero-lead">${c.home.lead}</p>
        <div class="hero-cta">
          <a class="btn btn-lg" href="/produkt">${c.home.explore} ${icon("arrow", 16)}</a>
          <a class="btn btn-ghost btn-lg" href="/kontakt?amne=demo">${t("Boka demo", "Book a demo")}</a>
        </div>
        <ul class="hero-proof">
          <li><span class="mono">01</span>${c.home.proof1}</li>
          <li><span class="mono">02</span>${c.home.proof2}</li>
          <li><span class="mono">03</span>${c.home.proof3}</li>
        </ul>
      </div>
      ${preview}
    </section>

    <section class="ni-section ni-section-white landing-platform" id="platform">
      <div class="site-wrap">
        <div class="platform-head">
          <div><p class="eyebrow"><span class="eyebrow-mark" aria-hidden="true"></span>${t("Produkten", "The product")}</p><h2>${t("Hela lagret i en arbetsyta.", "The whole inventory in one workspace.")}</h2></div>
          <p>${t("Växla mellan vyerna. Samma beräkning ligger bakom varje siffra, varje prognos och varje rekommendation.", "Switch between the views. One calculation sits behind every figure, forecast and recommendation.")}</p>
        </div>
        ${platform}
      </div>
    </section>

    <section class="landing-features" id="capabilities">
      <div class="site-wrap">
        <div class="features-head" id="how-it-works">
          <div><p class="eyebrow"><span class="eyebrow-mark" aria-hidden="true"></span>${t("Vad STOQWISE gör", "What STOQWISE does")}</p><h2>${t("Ett underlag för varje lagerbeslut.", "One evidence base for every inventory decision.")}</h2></div>
          <p>${t("Saldo, försäljning och inköpspris per artikel — samlat i en analys som visar vilken åtgärd som bör komma först.", "Stock, sales and purchase price per item — one analysis that shows which action should come first.")}</p>
        </div>
        <div class="feature-index">
          <a class="feature-row" id="intelligence" href="/produkt">
            <span class="feature-no">01</span>
            <span class="feature-copy"><h3>${t("Frigör kapital", "Release capital")}</h3><p>${t("Inaktiva artiklar, överlager och kapitalbindning per artikel.", "Inactive items, overstock and tied-up capital per item.")}</p></span>
            <span class="feature-meta">ABC / XYZ</span>
            <span class="feature-arrow">${icon("arrow", 16)}</span>
          </a>
          <a class="feature-row" id="forecasting" href="/produkt">
            <span class="feature-no">02</span>
            <span class="feature-copy"><h3>${t("Skydda tillgängligheten", "Protect availability")}</h3><p>${t("Täckning, ledtid och bristrisk tolv månader framåt.", "Cover, lead time and stockout risk twelve months ahead.")}</p></span>
            <span class="feature-meta">12 ${t("mån", "mo")}</span>
            <span class="feature-arrow">${icon("arrow", 16)}</span>
          </a>
          <a class="feature-row" id="procurement" href="/produkt">
            <span class="feature-no">03</span>
            <span class="feature-copy"><h3>${t("Prioritera inköpen", "Prioritise purchasing")}</h3><p>${t("Kvantitet, leverantör och effekt på täckning.", "Quantity, supplier and impact on cover.")}</p></span>
            <span class="feature-meta">${t("Per leverantör", "By supplier")}</span>
            <span class="feature-arrow">${icon("arrow", 16)}</span>
          </a>
        </div>
        <a class="text-link features-link" href="/produkt">${t("Se hela produkten", "See the full product")} ${icon("arrow", 14)}</a>
      </div>
    </section>

    <section class="landing-industries" id="industries">
      <div class="site-wrap">
        <div class="industry-head">
          <div><p class="eyebrow"><span class="eyebrow-mark" aria-hidden="true"></span>${t("Branscher", "Industries")}</p><h2>${t("Fyra miljöer. Samma logik.", "Four environments. One logic.")}</h2></div>
          <p>${t("Olika ledtider, säsonger och marginaler. Underlaget förändras, metoden gör det inte.", "Different lead times, seasons and margins. The evidence changes; the method does not.")}</p>
        </div>
        <div class="industry-list">${landingIndustries}</div>
      </div>
    </section>

    <section class="ni-final">
      <div class="site-wrap ni-final-inner">
        <div><p class="eyebrow eyebrow-light"><span class="eyebrow-mark" aria-hidden="true"></span>${t("Nästa steg", "Next step")}</p><h2>${c.home.ctaTitle}</h2><p>${c.home.ctaText}</p></div>
        <div class="ni-final-actions"><a class="btn btn-mint btn-lg" href="/skapa-konto">${c.home.ctaButton} ${icon("arrow", 16)}</a><a class="btn btn-outline-light btn-lg" href="/kontakt?amne=demo">${t("Boka demo", "Request a demo")}</a></div>
      </div>
    </section>
    </div>`,
  });
}

/* --------------------------------------------------------------- pricing */

export function pricingPage(input: { user: { name: string } | null; locale?: Locale }): string {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const c = strings(locale);
  const sv = locale === "sv";
  const startHref = input.user ? "/start" : "/skapa-konto";
  const copy = sv
    ? {
        eyebrow: "Personlig prissättning",
        title: "Priser som utgår från er verksamhet.",
        lead: "Inga fasta paketpriser. Ni beskriver lager, volymer och behov. STOQWISE beräknar ett transparent estimat som ni kan justera innan ni begär offert.",
        primary: "Få ditt personliga estimat",
        secondary: "Prata med oss",
        factorsTitle: "Det som formar estimatet",
        factorsLead: "Priset bygger på faktiska operativa förutsättningar, inte på en generisk tabell.",
        factors: [
          ["Företag och bransch", "Storlek, affärsmodell och antal användare."],
          ["Artikelvolym", "Antal aktiva artiklar och hur ofta sortimentet förändras."],
          ["Lagerställen", "Lager, butiker och kanaler som ska ingå i analysen."],
          ["Datavolym", "Transaktioner, lagervärde och antal leverantörer."],
          ["Funktioner", "Prognos, optimering, inköp, produktintelligens och AI-insikter."],
          ["Integrationer och support", "Systemlandskap, implementation och önskad servicenivå."],
        ],
        profilesTitle: "En lösning som växer med verksamheten",
        profilesLead: "Vi utgår från fyra interna konfigurationer och anpassar dem efter er situation. Ingen nivå låses fast i förväg.",
        profiles: [
          ["Core", "En butik eller kanal som vill få ordning på lager och inköp."],
          ["Growth", "Flera lagerställen, växande sortiment och behov av prognos."],
          ["Business", "Större organisationer med flera team, system och beslutsnivåer."],
          ["Enterprise", "Omfattande data, integrationer, säkerhetskrav och dedikerad support."],
        ],
        stepsTitle: "Från behov till beslut",
        steps: [
          ["Skapa konto", "Registrera er utan kort. Ni får tillgång till er egen arbetsyta."],
          ["Beskriv verksamheten", "Ange bransch, artiklar, lagerställen, användare och önskade funktioner."],
          ["Läs estimatet", "Se månadspris, årspris, rekommenderad konfiguration och implementation."],
          ["Begär offert", "Justera underlaget och skicka en formell förfrågan. Ingen betalning sker automatiskt."],
        ],
        trustTitle: "Ett estimat, inte ett bindande pris.",
        trustText: "Estimatet är indicativt och bygger på uppgifterna ni lämnar samt STOQWISE konfigurerade prisregler. Moms tillkommer. Offert och avtal krävs innan aktivering.",
        noPrice: "Vi publicerar inga fasta månads- eller årsspriser. Det gör att priset kan spegla faktisk volym, komplexitet och de funktioner ni faktiskt använder.",
        cta: "Beräkna ditt estimat",
      }
    : {
        eyebrow: "Personalised pricing",
        title: "Pricing shaped by your business.",
        lead: "No fixed package prices. Describe your inventory, volumes and requirements. STOQWISE calculates a transparent estimate you can adjust before requesting a quote.",
        primary: "Get your personalised estimate",
        secondary: "Talk to us",
        factorsTitle: "What shapes your estimate",
        factorsLead: "The price reflects real operating conditions, not a generic table.",
        factors: [
          ["Company and industry", "Size, business model and number of users."],
          ["Item volume", "Active items and how often the assortment changes."],
          ["Locations", "Warehouses, stores and channels included in the analysis."],
          ["Data volume", "Transactions, inventory value and number of suppliers."],
          ["Capabilities", "Forecasting, optimization, procurement, product intelligence and AI insights."],
          ["Integrations and support", "System landscape, implementation and service level."],
        ],
        profilesTitle: "A solution that grows with the business",
        profilesLead: "We start from four internal configurations and adapt them to your situation. No tier is fixed in advance.",
        profiles: [
          ["Core", "One store or channel getting inventory and purchasing under control."],
          ["Growth", "Multiple locations, a growing assortment and a need for forecasting."],
          ["Business", "Larger organisations with several teams, systems and decision levels."],
          ["Enterprise", "High data volume, integrations, security requirements and dedicated support."],
        ],
        stepsTitle: "From requirement to decision",
        steps: [
          ["Create an account", "Register without a card. You get your own workspace."],
          ["Describe the business", "Provide industry, items, locations, users and required capabilities."],
          ["Read the estimate", "See monthly price, annual price, recommended configuration and implementation."],
          ["Request a quote", "Adjust the profile and submit a formal request. No payment is taken automatically."],
        ],
        trustTitle: "An estimate, not a binding price.",
        trustText: "The estimate is indicative and based on the information you provide and STOQWISE's configured pricing rules. VAT is added. A quote and agreement are required before activation.",
        noPrice: "We do not publish fixed monthly or annual prices. That lets the price reflect actual volume, complexity and the capabilities you use.",
        cta: "Calculate your estimate",
      };

  const factors = copy.factors
    .map(([title, text], i) => `<article class="factor"><span class="mono">${String(i + 1).padStart(2, "0")}</span><h3>${esc(title)}</h3><p>${esc(text)}</p></article>`)
    .join("");
  const profiles = copy.profiles
    .map(([name, text], i) => `<article class="profile-card"><span class="mono">${String(i + 1).padStart(2, "0")}</span><h3>${esc(name)}</h3><p>${esc(text)}</p><span class="profile-link">${sv ? "Anpassas efter behov" : "Tailored to requirements"} →</span></article>`)
    .join("");
  const steps = copy.steps
    .map(([title, text], i) => `<li><span class="step-no">${String(i + 1).padStart(2, "0")}</span><div><h3>${esc(title)}</h3><p>${esc(text)}</p></div></li>`)
    .join("");

  return marketingShell({
    title: sv ? "Priser · STOQWISE" : "Pricing · STOQWISE",
    active: "pricing",
    user: input.user,
    locale,
    path: "/priser",
    description: copy.lead,
    content: `
    <section class="site-wrap pricing-hero">
      <div class="pricing-hero-copy">
        <p class="eyebrow"><span class="eyebrow-mark" aria-hidden="true"></span>${copy.eyebrow}</p>
        <h1>${copy.title}</h1>
        <p class="lead">${copy.lead}</p>
        <div class="hero-cta"><a class="btn btn-lg" href="${startHref}">${copy.primary} ${icon("arrow", 16)}</a><a class="btn btn-ghost btn-lg" href="/kontakt">${copy.secondary}</a></div>
        <p class="hint">${copy.noPrice}</p>
      </div>
      <aside class="pricing-model" aria-label="${sv ? "Så byggs estimatet" : "How the estimate is built"}">
        <div class="pricing-model-head"><span>${sv ? "ESTIMATMODELL" : "ESTIMATE MODEL"}</span><span class="pv-live"><i aria-hidden="true"></i>${sv ? "Live modell" : "Live model"}</span></div>
        <div class="pricing-model-profile">
          <span class="mono">${sv ? "EXEMPELPROFIL" : "EXAMPLE PROFILE"}</span>
          <strong>${sv ? "Flerlager distribution" : "Multi-site distribution"}</strong>
          <p>${sv ? "Profilen är illustrativ. Ditt pris beräknas på er faktiska volym." : "The profile is illustrative. Your price is calculated from your actual volume."}</p>
        </div>
        <div class="pricing-model-rows">
          ${[
            [sv ? "Artiklar" : "Items", sv ? "Sortiment och omsättningstakt" : "Assortment and turnover", 72],
            [sv ? "Lagerställen" : "Locations", sv ? "Lager, butiker och kanaler" : "Warehouses, stores and channels", 46],
            [sv ? "Användare" : "Users", sv ? "Roller och beslutsnivåer" : "Roles and decision levels", 58],
            [sv ? "Integrationer" : "Integrations", sv ? "System, API och synkronisering" : "Systems, API and synchronisation", 35],
          ].map(([label, note, value]) => `<div class="pricing-model-row"><span><b>${label}</b><small>${note}</small></span><i><span style="width:${value}%"></span></i></div>`).join("")}
        </div>
        <div class="pricing-model-result">
          <span>${sv ? "Resultat" : "Result"}</span>
          <strong>${sv ? "Transparent intervall" : "Transparent range"}</strong>
          <small>${sv ? "Månadspris · årspris · implementation" : "Monthly · annual · implementation"}</small>
        </div>
        <a class="pricing-model-cta" href="${startHref}">${copy.cta} ${icon("arrow", 14)}</a>
      </aside>
    </section>

    <section class="site-wrap section">
      <div class="section-head"><p class="eyebrow">${sv ? "Transparens" : "Transparency"}</p><h2>${copy.factorsTitle}</h2><p>${copy.factorsLead}</p></div>
      <div class="factor-grid">${factors}</div>
    </section>

    <section class="site-wrap section">
      <div class="section-head"><p class="eyebrow">${sv ? "Konfiguration" : "Configuration"}</p><h2>${copy.profilesTitle}</h2><p>${copy.profilesLead}</p></div>
      <div class="profile-grid">${profiles}</div>
    </section>

    <section class="site-wrap section pricing-steps">
      <div class="grid"><div class="span-5"><p class="eyebrow">${sv ? "Kundresan" : "Customer journey"}</p><h2>${copy.stepsTitle}</h2><p class="muted">${copy.trustText}</p></div>
      <div class="span-7"><ol class="steps">${steps}</ol></div></div>
    </section>

    <div class="site-wrap"><div class="cta-band"><div><h2>${copy.trustTitle}</h2><p>${copy.trustText}</p></div><a class="btn btn-lg" href="${startHref}">${copy.cta} ${icon("arrow", 16)}</a></div></div>`,
  });
}
/* ------------------------------------------------------------------- demo */

export function productPage(input: {
  user: { name: string } | null;
  demo: DemoSummary;
  environment: DemoEnvironmentMeta;
  environments: DemoEnvironmentMeta[];
  locale?: Locale;
}): string {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const c = strings(locale);
  const d = input.demo;
  const environment = input.environment;
  const envTabs = input.environments
    .map(
      (env) =>
        `<a class="demo-env ${env.id === environment.id ? "is-active" : ""}" href="/produkt?miljo=${env.id}">${esc(locale === "sv" ? env.accent : env.accentEn)}</a>`,
    )
    .join("");
  const num = (n: number): string => lnum(locale, n);
  const num1 = (n: number): string => lnum(locale, n, 1);
  const money = (n: number): string => formatSekLocale(locale, n);
  const range = d.releaseHigh >= 1_000_000
    ? `SEK ${million(d.releaseLow, locale)}–${million(d.releaseHigh, locale)}`
    : `SEK ${lnum(locale, d.releaseLow)}–${lnum(locale, d.releaseHigh)}`;
  // Category names are stored in the source data's language; the chart shows them
  // in the reader's language without touching the stored labels.
  const categoryGroups = d.categories.map((c) => ({ ...c, label: localizeCategory(c.label, locale) }));

  return marketingShell({
    title: c.product.pageTitle,
    active: "product",
    user: input.user,
    locale,
    path: "/produkt",
    description: c.product.sub,
    content: `
    <section class="site-wrap product-hero">
      <canvas class="net-canvas net-canvas--soft" data-net="hero" aria-hidden="true"></canvas>
      <div class="product-hero-copy">
        <p class="eyebrow"><span class="eyebrow-mark" aria-hidden="true"></span>${locale === "sv" ? "Produktintelligens" : "Product intelligence"}</p>
        <h1>${c.product.h1}</h1>
        <p class="product-hero-lead">${c.product.sub}</p>
        <div class="hero-cta">
          <a class="btn btn-lg" href="/skapa-konto">${c.product.createAccount} ${icon("arrow", 16)}</a>
          <a class="btn btn-ghost btn-lg" href="/kontakt?amne=demo">${c.product.bookDemo}</a>
        </div>
        <ul class="product-hero-proof">
          <li><span>01</span>${locale === "sv" ? "Samma beräkningar som produkten" : "The same calculations as the product"}</li>
          <li><span>02</span>${locale === "sv" ? "Fyra branschmiljöer" : "Four industry environments"}</li>
          <li><span>03</span>${locale === "sv" ? "Spårbart från KPI till artikel" : "Traceable from KPI to item"}</li>
        </ul>
      </div>
      <aside class="product-hero-panel" aria-label="${locale === "sv" ? "Demomiljöns nyckeltal" : "Demo environment metrics"}">
        <div class="product-hero-panel-head">
          <span class="mono">${locale === "sv" ? "PRODUKTDEMO" : "PRODUCT DEMO"} / ${esc(environment.id).toUpperCase()}</span>
          <span class="pv-live"><i aria-hidden="true"></i>${locale === "sv" ? "Beräknad" : "Calculated"} 09:41</span>
        </div>
        <div class="product-hero-company">
          <span class="product-hero-mark">${esc(environment.company.trim().slice(0, 1).toUpperCase())}</span>
          <div><strong>${esc(environment.company)}</strong><span>${esc(locale === "sv" ? environment.accent : environment.accentEn)}</span></div>
        </div>
        <p class="product-hero-panel-desc">${esc(locale === "sv" ? environment.description : environment.descriptionEn)}</p>
        <div class="product-hero-stats">
          <div><span>${c.product.kpiInventory}</span><strong data-count="${esc(money(d.inventoryValue))}">${money(d.inventoryValue)}</strong></div>
          <div><span>${c.product.kpiTurns}</span><strong data-count="${esc(num1(d.turns))}×">${num1(d.turns)}×</strong></div>
          <div><span>${c.product.kpiDead}</span><strong class="is-warn" data-count="${esc(money(d.deadStockValue))}">${money(d.deadStockValue)}</strong></div>
        </div>
        <div class="product-hero-env">
          <p class="label">${locale === "sv" ? "Byt affärsmiljö" : "Switch business environment"}</p>
          <nav class="demo-env-switcher" aria-label="${locale === "sv" ? "Demomiljöer" : "Demo environments"}">${envTabs}</nav>
        </div>
      </aside>
    </section>

    <section class="site-wrap product-snapshot" aria-label="${locale === "sv" ? "Nyckeltal för demomiljön" : "Demo environment metrics"}">
      <div class="grid">
        ${[
          [c.product.kpiInventory, money(d.inventoryValue)],
          [c.product.kpiDead, money(d.deadStockValue)],
          [c.product.kpiOverstock, money(d.overstockValue)],
          [c.product.kpiTurns, c.product.turnsPerYear.replace("{value}", num1(d.turns))],
          [c.product.kpiRelease, range],
          [c.product.kpiItems, num(d.skuCount)],
        ]
          .map(
            ([label, value]) => `<div class="span-4"><div class="kpi"><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span></div></div>`,
          )
          .join("")}

        <div class="span-7"><div class="card"><div class="card-head"><h2>${c.product.capitalByCategory}</h2></div>
          <div class="card-body">
            <div class="chart-desktop">${treemap(categoryGroups.slice(0, 8), { height: 340, format: num, unit: "SEK", ariaLabel: c.product.capitalByCategory })}</div>
            <div class="chart-mobile">${treemap(categoryGroups.slice(0, 4), { height: 320, width: 360, format: num, unit: "SEK", ariaLabel: c.product.capitalByCategory })}</div>
          </div></div></div>

        <div class="span-5"><div class="card"><div class="card-head"><h2>ABC / XYZ</h2></div>
          <div class="card-body">${abcXyzMatrix(d.matrix)}</div></div></div>

        <div class="span-12"><div class="card"><div class="card-head"><h2>${c.product.priorityActions}</h2></div>
          <div class="card-body"><div class="priority-list">${d.priorities
            .slice(0, 6)
            .map(
              (p, i) => `<div class="priority-item"><span class="priority-rank">${String(i + 1).padStart(2, "0")}</span>
              <span><span class="priority-title">${esc(p.name)}</span><p class="priority-why">${esc(p.reasons[0] ?? "")}</p></span>
              <span class="right mono">${money(p.value)}</span></div>`,
            )
            .join("")}</div></div></div></div>

        <div class="span-12"><div class="card"><div class="card-head"><h2>${c.product.demandForecast}</h2></div>
          <div class="card-body">${forecastChart(
            d.history.map((v, i) => ({ label: `M${i + 1}`, value: v })),
            d.forecastPoints.map((p, i) => ({ label: `F${i + 1}`, value: p.value, lo: p.lo, hi: p.hi })),
            { width: 900, height: 260 },
          )}</div></div></div>
      </div>
    </section>

    <section class="site-wrap section">
      <div class="grid">
        <div class="span-5">
          <h2>${c.product.sandboxTitle}</h2>
          <p class="muted" style="max-width:38ch;margin-top:14px">${c.product.sandboxText}</p>
          <div class="hero-cta" style="margin-top:22px">
            <a class="btn" href="${input.user ? `/app/sandbox/miljo/${environment.id}` : `/logga-in?nasta=/app/sandbox/miljo/${environment.id}`}">${input.user ? c.product.openSandbox : c.product.signInSandbox} ${icon("arrow", 15)}</a>
            <a class="btn btn-ghost" href="/exempelrapport.pdf?miljo=${environment.id}">${icon("download", 15)} ${c.product.exampleReport}</a>
          </div>
        </div>
        <div class="span-6 col-right">
          <div class="value-list">
            <div><h3>${c.product.stepImport}</h3><p>${c.product.stepImportText}</p></div>
            <div><h3>${c.product.stepAnalyse}</h3><p>${c.product.stepAnalyseText}</p></div>
            <div><h3>${c.product.stepForecast}</h3><p>${c.product.stepForecastText}</p></div>
            <div><h3>${c.product.stepAct}</h3><p>${c.product.stepActText}</p></div>
          </div>
        </div>
      </div>
    </section>`,
  });
}
/* -------------------------------------------------------------- get started */

export function getStartedPage(input: { user: { name: string } | null; locale?: Locale }): string {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const c = strings(locale).start;
  const mono = (ch: string): string => `<span class="mono">${ch}</span>`;
  const formatText = c.formatText
    .replace("{semicolon}", mono(";"))
    .replace("{comma}", mono(","))
    .replace("{pipe}", mono("|"));
  const steps = [
    [c.step1Title, c.step1Text],
    [c.step2Title, c.step2Text],
    [c.step3Title, c.step3Text],
    [c.step4Title, c.step4Text],
    [c.step5Title, c.step5Text],
  ];
  return marketingShell({
    title: c.pageTitle,
    description: c.description,
    user: input.user,
    locale,
    path: "/kom-igang",
    content: `
    <section class="site-wrap section" style="padding-top:64px">
      <div class="grid">
        <div class="span-5">
          <h1>${c.h1}</h1>
          <p class="hero-lead">${c.lead}</p>
          <a class="btn" href="/skapa-konto" style="margin-top:8px">${c.cta} ${icon("arrow", 15)}</a>
          <h2 style="margin-top:56px">${c.formatTitle}</h2>
          <p>${formatText}</p>
          <p class="muted">${c.minimum}</p>
        </div>
        <div class="span-6 col-right">
          <ol class="steps">
            ${steps
              .map(
                ([title, text], i) =>
                  `<li><span class="step-no">${String(i + 1).padStart(2, "0")}</span><div><h3>${title}</h3><p>${text}</p></div></li>`,
              )
              .join("")}
          </ol>
        </div>
      </div>

      <p class="support-line"><span>${c.supportPre} <a href="/hjalp">${c.helpLink}</a>${c.supportMid}</span> <a class="link-btn" href="/kontakt">${c.contactCta} ${icon("arrow", 14)}</a></p>
    </section>`,
  });
}

export function developerPage(input: { user: { name: string } | null; locale?: Locale }): string {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const c = strings(locale).dev;
  const endpoints: Array<[string, string, string]> = [
    ["GET", "/api/v1/me", c.endpoints[0]!],
    ["GET", "/api/v1/analyses", c.endpoints[1]!],
    ["POST", "/api/v1/analyses", c.endpoints[2]!],
    ["GET", "/api/v1/analyses/:id", c.endpoints[3]!],
    ["GET", "/api/v1/analyses/:id/items", c.endpoints[4]!],
    ["GET", "/api/v1/analyses/:id/forecast", c.endpoints[5]!],
    ["POST", "/api/v1/analyses/:id/simulate", c.endpoints[6]!],
    ["POST", "/api/v1/copilot", c.endpoints[7]!],
    ["GET", "/api/v1/analyses/:id/export.xlsx", c.endpoints[8]!],
    ["GET", "/api/v1/analyses/:id/report.pdf", c.endpoints[9]!],
  ];
  const lead = c.lead.replace("{permission}", '<span class="mono">api.manage</span>');
  const webhooks = c.webhooksText.replace("{header}", '<span class="mono">X-Stoqwise-Signature</span>');

  return marketingShell({
    title: c.pageTitle,
    user: input.user,
    locale,
    path: "/utvecklare",
    content: `
    <section class="site-wrap section" style="padding-top:56px">
      <div class="prose">
        <p class="eyebrow">${c.eyebrow}</p>
        <h1>${c.h1}</h1>
        <p>${lead}</p>

        <h2 id="api">${c.authTitle}</h2>
        <p>${c.authPre} <a href="/app/integrationer">${c.integrations}</a> ${c.authMid} <span class="mono">Authorization: Bearer</span>${c.authPost}</p>
        <pre><code>curl -H "Authorization: Bearer $STOQWISE_KEY" \\
  "https://your-instance/api/v1/analyses/$ID/items?sort=value&amp;dir=desc&amp;page=1"</code></pre>

        <h2 id="endpoints">${c.endpointsTitle}</h2>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>${c.method}</th><th>${c.endpoint}</th><th>${c.description}</th></tr></thead>
          <tbody>${endpoints.map(([m, p, d]) => `<tr><td class="mono">${m}</td><td class="mono">${p}</td><td>${d}</td></tr>`).join("")}</tbody></table></div>

        <h2>${c.errorsTitle}</h2>
        <p>${c.errorsText}</p>
        <pre><code>${c.errorSample}</code></pre>

        <h2 id="webhooks">${c.webhooksTitle}</h2>
        <p>${webhooks}</p>

        <h2 id="csv">${c.csvTitle}</h2>
        <p>${c.csvText}</p>

        <p class="hint">${c.helpHint} <a href="/kontakt">${c.helpLink}</a>.</p>
      </div>
    </section>`,
  });
}
/* ------------------------------------------------------------- help centre */

export function helpPage(input: { user: { name: string } | null; locale?: Locale }): string {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const c = strings(locale).help;
  return marketingShell({
    title: c.pageTitle,
    user: input.user,
    locale,
    path: "/hjalp",
    content: `
    <section class="site-wrap section" style="padding-top:56px">
      <div class="section-head"><h1>${c.h1}</h1>
      <p>${c.lead} <a href="/kontakt">${c.contactLink}</a>.</p></div>
      <div class="help-grid">
        ${c.articles
          .map((item) => `<article class="feature"><h3>${esc(item.q)}</h3><p>${esc(item.a)}</p></article>`)
          .join("")}
      </div>
      <p class="mt-4" style="margin-top:32px">${c.newHere} <a href="/kom-igang">${c.startLink}</a> ${c.startText}</p>
    </section>`,
  });
}

/* ------------------------------------------------------------------ legal */

export function legalPage(kind: "integritet" | "villkor", user: { name: string } | null, locale: Locale = DEFAULT_LOCALE): string {
  const c = strings(locale).legal;
  const date = new Date().toISOString().slice(0, 10);
  const companyContact = helloLink ? c.companyContactAt.replace("{email}", helloLink) : c.companyContactForm;
  const rightsContact = privacyLink ? `${c.contactWord} ${privacyLink}.` : c.rightsContactForm;

  const privacy = `
    <p class="eyebrow">${c.eyebrow}</p><h1>${c.privacyTitle}</h1>
    <p class="muted">${c.updated.replace("{date}", date)}</p>
    <h2>${c.controllerTitle}</h2>
    <p>${c.controllerText}</p>
    <h2>${c.processTitle}</h2>
    <ul><li>${c.process1}</li>
    <li>${c.process2}</li>
    <li>${c.process3}</li></ul>
    <h2>${c.basisTitle}</h2>
    <p>${c.basisText}</p>
    <h2>${c.retentionTitle}</h2>
    <p>${c.retentionText}</p>
    <h2>${c.subprocessorsTitle}</h2>
    <p>${c.subprocessorsText}</p>
    <h2>${c.cookiesTitle}</h2>
    <p>${c.cookiesText}</p>
    <h2>${c.companyTitle}</h2>
    <p>${c.companyText.replace("{contact}", companyContact)}</p>
    <h2>${c.rightsTitle}</h2>
    <p>${c.rightsText.replace("{contact}", rightsContact)}</p>`;

  const terms = `
    <p class="eyebrow">${c.eyebrow}</p><h1>${c.termsTitle}</h1>
    <p class="muted">${c.updated.replace("{date}", date)}</p>
    <h2>${c.serviceTitle}</h2>
    <p>${c.serviceText}</p>
    <h2>${c.responsibilitiesTitle}</h2>
    <ul><li>${c.resp1}</li>
    <li>${c.resp2}</li>
    <li>${c.resp3}</li></ul>
    <h2>${c.paymentTitle}</h2>
    <p>${c.paymentText}</p>
    <h2>${c.liabilityTitle}</h2>
    <p>${c.liabilityText}</p>
    <h2>${c.cookiesTitle}</h2>
    <p>${c.termsCookiesText}</p>
    <h2>${c.companyTitle}</h2>
    <p>${c.termsCompanyText}</p>
    <h2>${c.personalTitle}</h2>
    <p>${c.personalText} <a href="/integritet">${c.privacyLink}</a>.</p>`;

  return marketingShell({
    title: kind === "integritet" ? c.privacyPageTitle : c.termsPageTitle,
    user,
    locale,
    path: kind === "integritet" ? "/integritet" : "/villkor",
    content: `<section class="site-wrap section" style="padding-top:56px"><div class="prose">${kind === "integritet" ? privacy : terms}</div></section>`,
  });
}

/* ------------------------------------------------------------------ about */

export function aboutPage(input: { user: { name: string } | null; locale?: Locale }): string {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const c = strings(locale).about;
  return marketingShell({
    title: c.pageTitle,
    description: c.description,
    user: input.user,
    locale,
    path: "/om-oss",
    content: `
    <section class="site-wrap" style="padding-top:72px">
      <div class="grid">
        <div class="span-7">
          <p class="eyebrow">${c.eyebrow}</p>
          <h1 class="about-title">${c.h1}</h1>
          <p class="hero-lead">${c.lead}</p>
        </div>
        <div class="span-4 about-facts">
          <div><p class="label">${c.founder}</p><p>Mohammad Al Kakouni</p></div>
          <div><p class="label">${c.educationLabel}</p><p>${c.education}</p></div>
          <div><p class="label">${c.basedLabel}</p><p>${c.based}</p></div>
        </div>
      </div>
    </section>

    <section class="site-wrap section">
      <div class="grid">
        <div class="span-5"><h2>${c.whyTitle}</h2></div>
        <div class="span-6 about-prose col-right">
          <p>${c.whyP1}</p>
          <p>${c.whyP2}</p>
        </div>
      </div>
    </section>

    <section class="site-wrap section">
      <div class="grid">
        <div class="span-5"><h2>${c.experienceTitle}</h2></div>
        <div class="span-6 about-prose col-right">
          <p>${c.experienceP1}</p>
          <p>${c.experienceP2}</p>
        </div>
      </div>
    </section>

    <section class="site-wrap section section-alt">
      <div class="grid">
        <div class="span-7">
          <h2 class="about-vision">${c.visionTitle}</h2>
          <div class="about-prose" style="margin-top:24px; max-width:56ch">
            <p>${c.visionP1}</p>
          </div>
          <p class="about-signature">${c.signature}</p>
        </div>
      </div>
    </section>

    <div class="site-wrap">
      <div class="cta-band">
        <div>
          <h2>${c.ctaTitle}</h2>
          <p>${c.ctaText}</p>
        </div>
        <a class="btn btn-lg" href="/produkt">${c.ctaButton} ${icon("arrow", 16)}</a>
      </div>
    </div>`,
  });
}

/* ---------------------------------------------------------------- contact */

export function contactPage(input: {
  user: { name: string } | null;
  sent?: boolean;
  error?: string;
  subject?: string;
  locale?: Locale;
}): string {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const c = strings(locale).contact;
  const requested =
    input.subject === "demo"
      ? "Product demonstration"
      : input.subject === "enterprise"
        ? "Enterprise discussion"
        : input.subject;
  const subjects = [
    { value: "General inquiry", label: c.subjects.general },
    { value: "Product demonstration", label: c.subjects.demo },
    { value: "Business inquiry", label: c.subjects.business },
    { value: "Enterprise discussion", label: c.subjects.enterprise },
  ];
  return marketingShell({
    title: c.pageTitle,
    user: input.user,
    locale,
    path: "/kontakt",
    content: `
    <section class="site-wrap section" style="padding-top:72px">
      <div class="grid">
        <div class="span-5">
          <p class="eyebrow">${c.eyebrow}</p>
          <h1>${c.h1}</h1>
          <p class="muted">${c.lead}</p>
          <div class="rule"></div>
          ${helloLink ? `<dl class="stat-line"><dt>${c.emailLabel}</dt><dd class="mono">${helloLink}</dd></dl>` : ""}
          <dl class="stat-line"><dt>${c.demoLabel}</dt><dd><a href="/kontakt?amne=demo">${c.demoLink}</a></dd></dl>
          <dl class="stat-line"><dt>${c.enterpriseLabel}</dt><dd><a href="/kontakt?amne=enterprise">${c.enterpriseLink}</a></dd></dl>
        </div>
        <div class="span-6 col-right">
          <div class="card"><div class="card-body">
            ${input.sent ? `<div class="alert alert-ok">${icon("check", 16)}<div>${c.sent}</div></div>` : ""}
            ${input.error ? `<div class="alert alert-error">${icon("alert", 16)}<div>${esc(input.error)}</div></div>` : ""}
            <form method="post" action="/kontakt" data-busy="${c.send}…">
              <div class="form-row"><label for="n">${c.name}</label><input id="n" name="namn" type="text" required></div>
              <div class="form-row"><label for="e">${c.email}</label><input id="e" name="epost" type="email" required></div>
              <div class="form-row"><label for="c">${c.company}</label><input id="c" name="foretag" type="text"></div>
              <div class="form-row"><label for="a">${c.subjectLabel}</label>
                <select id="a" name="amne">
                  ${subjects.map((s) => `<option value="${s.value}" ${requested === s.value ? "selected" : ""}>${s.label}</option>`).join("")}
                </select></div>
              <div class="form-row"><label for="m">${c.messageLabel}</label><textarea id="m" name="meddelande" required placeholder="${c.messagePlaceholder}"></textarea></div>
              <button class="btn" type="submit">${c.send}</button>
              <p class="hint mt-2">${c.privacyHint} <a href="/integritet">${c.privacyPolicy}</a>.</p>
            </form>
          </div></div>
        </div>
      </div>
    </section>`,
  });
}

/* ------------------------------------------------------------------- auth */

function authLayout(input: {
  locale?: Locale;
  title: string;
  lede: string;
  statement: string;
  note: string;
  error?: string;
  content: string;
  footer: string;
}): string {
  const authLocale = input.locale ?? DEFAULT_LOCALE;
  return `<!doctype html><html lang="${authLocale}" dir="${authLocale === "ar" ? "rtl" : "ltr"}" data-theme="light"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(input.title)} · STOQWISE</title>
  <meta name="color-scheme" content="light dark"><meta name="theme-color" content="#f6f4ef">
  <link rel="preload" href="/fonts/geist-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/geist-sans-latin-500-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/v3.css?v=95"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <script src="/v3.js?v=54" defer></script></head>
  <body class="app-body auth-body">
  <div class="auth-shell">
    <aside class="auth-aside">
      <a class="site-brand" href="/">${brandLockup()}</a>
      <div class="auth-statement">
        <p class="eyebrow">${esc(input.lede)}</p>
        <h2>${esc(input.statement)}</h2>
        <blockquote>${esc(input.note)}</blockquote>
      </div>
      <p class="folio">${new Date().getFullYear()}</p>
    </aside>
    <main class="auth-main">
      <div class="auth-card">
        <h1>${esc(input.title)}</h1>
        ${input.error ? `<div class="alert alert-error" role="alert">${esc(input.error)}</div>` : ""}
        ${input.content}
        <p class="auth-alt">${input.footer}</p>
      </div>
    </main>
  </div>
  </body></html>`;
}

export function loginPage(input: { error?: string; next?: string; user: { name: string } | null; locale?: Locale }): string {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const c = strings(locale).auth;
  if (input.user) {
    return marketingShell({
      title: c.signIn,
      user: input.user,
      locale,
      path: "/logga-in",
      content: `<section class="site-wrap section"><p class="hero-lead">${c.alreadySignedIn} <a class="link-btn" href="/app">${c.openApp} →</a></p></section>`,
    });
  }
  return authLayout({
    locale,
    title: c.signIn,
    lede: c.customerLogin,
    statement: c.signInStatement,
    note: c.signInNote,
    error: input.error,
    content: `<form method="post" action="/logga-in" data-busy="${c.sending}">
      <input type="hidden" name="nasta" value="${esc(input.next ?? "/app")}">
      <div class="form-row"><label for="e">${c.email}</label><input id="e" name="epost" type="email" required autocomplete="email" placeholder="name@company.com"></div>
      <div class="form-row"><label for="p">${c.password}</label><input id="p" name="losenord" type="password" required autocomplete="current-password"></div>
      <button class="btn btn-block mt-3" type="submit">${c.signInButton}</button>
    </form>`,
    footer: `${c.noAccount} <a href="/skapa-konto">${c.createOne}</a>`,
  });
}

export function registerPage(input: { error?: string; plan?: string; user: { name: string } | null; locale?: Locale }): string {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const c = strings(locale).auth;
  if (input.user) {
    return marketingShell({
      title: c.createAccount,
      user: input.user,
      locale,
      path: "/skapa-konto",
      content: `<section class="site-wrap section"><p class="hero-lead">${c.alreadySignedIn} <a class="link-btn" href="/app">${c.openApp} →</a></p></section>`,
    });
  }
  return authLayout({
    locale,
    title: c.createAccount,
    lede: c.freeTrial,
    statement: c.registerStatement,
    note: c.registerNote,
    error: input.error,
    content: `<form method="post" action="/skapa-konto" data-busy="${c.creating}">
      <input type="hidden" name="plan" value="${esc(input.plan ?? "trial")}">
      <div class="form-row"><label for="n">${c.name}</label><input id="n" name="namn" type="text" required autocomplete="name"></div>
      <div class="form-row"><label for="c">${c.company}</label><input id="c" name="foretag" type="text" required autocomplete="organization"></div>
      <div class="form-row"><label for="e">${c.email}</label><input id="e" name="epost" type="email" required autocomplete="email"></div>
      <div class="form-row"><label for="p">${c.password}</label><input id="p" name="losenord" type="password" minlength="10" required autocomplete="new-password">
        <span class="hint">${c.passwordHint}</span></div>
      <button class="btn btn-block mt-3" type="submit">${c.registerButton}</button>
    </form>`,
    footer: `${c.haveAccount} <a href="/logga-in">${c.signIn}</a> · ${c.acceptTerms} <a href="/villkor">${c.terms}</a>.`,
  });
}

export function invitePage(input: { token: string; email: string; orgName: string; role: string; error?: string }): string {
  return authLayout({
    title: "Join the team",
    lede: "Invitation",
    statement: `You are invited to ${input.orgName}.`,
    note: `The ${input.role} role grants access to the organisation's analyses. The role is checked on the server on every request.`,
    error: input.error,
    content: `<form method="post" action="/bjud-in/${encodeURIComponent(input.token)}" data-busy="Joining…">
      <input type="hidden" name="token" value="${esc(input.token)}">
      <div class="form-row"><label for="e">Email</label><input id="e" name="epost" type="email" value="${esc(input.email)}" readonly></div>
      <div class="form-row"><label for="n">Name</label><input id="n" name="namn" type="text" required autocomplete="name"></div>
      <div class="form-row"><label for="p">Choose a password</label><input id="p" name="losenord" type="password" minlength="10" required autocomplete="new-password"></div>
      <button class="btn btn-block mt-3" type="submit">Join</button>
    </form>`,
    footer: `Questions? <a href="/kontakt">Contact us</a>`,
  });
}

/* -------------------------------------------------------------- onboarding */

export function onboardingPage(input: { user: { name: string }; org: { name: string; plan: string }; role: string; locale?: Locale }): string {
  const locale = input.locale ?? "sv";
  const t = appTranslator(locale);
  return `<!doctype html><html lang="${locale}" dir="${dirFor(locale)}" data-theme="light"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1"><title>${t("Kom igång")} · STOQWISE</title>
  <meta name="color-scheme" content="light dark">  <meta name="theme-color" content="#f6f4ef">
  <link rel="stylesheet" href="/v3.css?v=95"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <script src="/v3.js?v=54" defer></script></head>
  <body class="app-body"><main class="onboarding">
    <a class="site-brand" href="/">${brandLockup()}</a>
    <p class="eyebrow" style="margin-top:30px">${t("Välkommen")} · ${esc(input.org.name)}</p>
    <h1 class="onboarding-title">${t("Dags att se vad lagret kostar.")}</h1>
    <p class="health-note">${t("Ditt konto är klart med rollen {role}. Tre steg återstår.", { role: appRole(locale, input.role as "owner" | "admin" | "analyst" | "viewer") })}</p>
    <ol class="steps">
      <li><span class="step-no">01</span><div><h3>${t("Ladda upp en export")}</h3><p>${t("CSV eller Excel från affärssystemet. Kolumnerna känns oftast igen automatiskt.")}</p></div></li>
      <li><span class="step-no">02</span><div><h3>${t("Granska mappningen")}</h3><p>${t("Artikelnummer, saldo, pris och rörelse. Avvikelser flaggas innan analysen körs.")}</p></div></li>
      <li><span class="step-no">03</span><div><h3>${t("Läs analysen")}</h3><p>${t("Inaktivt lager, prognos och åtgärdslista. Rapporten kan laddas ner som PDF eller Excel.")}</p></div></li>
    </ol>
    <div class="hero-actions">
      <a class="btn" href="/app/importera">${t("Ladda upp en fil")} ${icon("arrow", 15)}</a>
      <a class="btn btn-ghost" href="/app/sandbox">${t("Öppna sandboxen")}</a>
    </div>
    <p class="hint mt-4">${t("Behöver du hjälp?")} <a href="/kontakt">${t("Kontakta oss")}</a>.</p>
  </main></body></html>`;
}

export function notFoundPage(locale: Locale = DEFAULT_LOCALE): string {
  const c = strings(locale).notFound;
  return marketingShell({
    title: c.pageTitle,
    description: c.text,
    locale,
    path: "/404",
    content: `
    <section class="site-wrap error-shell">
      <div class="error-copy">
        <p class="eyebrow"><span class="eyebrow-mark" aria-hidden="true"></span>${esc(c.eyebrow)}</p>
        <div class="error-code" aria-hidden="true">404</div>
        <h1>${esc(c.title)}</h1>
        <p class="error-lead">${esc(c.text)}</p>
        <div class="hero-cta">
          <a class="btn btn-lg" href="/">${esc(c.home)} ${icon("arrow", 16)}</a>
          <a class="btn btn-ghost btn-lg" href="/app">${esc(c.app)}</a>
        </div>
      </div>
      <aside class="error-panel" aria-label="${esc(c.popular)}">
        <p class="error-panel-kicker">${esc(c.popular)}</p>
        <a href="/produkt"><span>01</span><strong>${esc(c.product)}</strong>${icon("arrow", 14)}</a>
        <a href="/priser"><span>02</span><strong>${esc(c.pricing)}</strong>${icon("arrow", 14)}</a>
        <a href="/hjalp"><span>03</span><strong>${esc(c.help)}</strong>${icon("arrow", 14)}</a>
        <a href="/kontakt"><span>04</span><strong>${esc(c.contact)}</strong>${icon("arrow", 14)}</a>
        <div class="error-panel-foot"><span class="live-dot" aria-hidden="true"></span><span>STOQWISE / Nordic Intelligence</span></div>
      </aside>
    </section>`,
  });
}
