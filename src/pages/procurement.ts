/**
 * Procurement intelligence.
 *
 * The calculations are deliberately plain and inspectable: a reorder point
 * comes from the analysis, the suggested quantity restores the reorder point
 * and covers roughly one month of demand, and EOQ is calculated from stated
 * assumptions when a purchase cost is available. No supplier data is invented:
 * missing lead times and minimum order quantities are called out in the page.
 */
import type { AnalyzedItem } from "../analysis.ts";
import { forecastSeries, HOLDING_RATE, ORDER_COST_SEK, supplyPlan } from "../core/forecast.ts";
import { badge, card, emptyState, esc, icon, kpi, shell, table } from "../ui/base.ts";
import { appNum, appPct, appSek, appTranslator } from "../i18n-app.ts";
import { orderGroups } from "../procurement-export.ts";
import type { PageContext } from "./core.ts";

export type ProcurementPriority = "critical" | "high" | "planned";

export interface ProcurementSuggestion {
  sku: string;
  name: string;
  supplier: string | null;
  /** Physical balance, including reserved units. */
  stock: number;
  /** Balance available to promise. */
  available: number;
  reorderPoint: number;
  safetyStock: number;
  leadTimeDays: number;
  coverDays: number | null;
  monthlyDemand: number;
  /** Forecast demand during the lead time; historical average when no forecast exists. */
  expectedDemand: number;
  moq: number;
  suggestedQty: number;
  orderValue: number;
  eoq: number | null;
  /** Available + ordered − expected demand during lead time. */
  stockAfter: number;
  /** Probability of a stockout before a new order arrives. Null without a forecast. */
  stockoutProbability: number | null;
  priority: ProcurementPriority;
}

export interface SupplierScore {
  name: string;
  items: number;
  inventoryValue: number;
  stockoutRisk: number;
  deadStockValue: number;
  avgLeadTimeDays: number;
  shareOfValue: number;
  risk: "high" | "medium" | "low";
}

export interface ProcurementView {
  suggestions: ProcurementSuggestion[];
  suppliers: SupplierScore[];
  totals: {
    suggestions: number;
    critical: number;
    orderValue: number;
    supplierCount: number;
    stockoutRisk: number;
  };
  assumptions: {
    orderCost: number;
    holdingRate: number;
    coverageDays: number;
    missingLeadTime: number;
    serviceLevel: number;
  };
  filter: {
    supplier: string | null;
    groupBySupplier: boolean;
    suppliers: string[];
  };
}

export interface ProcurementOptions {
  orderCost?: number;
  holdingRate?: number;
  coverageDays?: number;
  serviceLevel?: number;
  supplier?: string | null;
  groupBySupplier?: boolean;
}

const PRIORITY_RANK: Record<ProcurementPriority, number> = { critical: 0, high: 1, planned: 2 };

export function buildProcurementView(items: AnalyzedItem[], options: ProcurementOptions = {}): ProcurementView {
  // Same stated assumptions as the article page and supplyPlan: one order cost
  // and one holding rate across the product. Two different defaults made the
  // suggested quantity depend on which page the buyer happened to open.
  const orderCost = options.orderCost ?? ORDER_COST_SEK;
  const holdingRate = options.holdingRate ?? HOLDING_RATE;
  const coverageDays = options.coverageDays ?? 30;
  const coverageFactor = coverageDays / 30;
  const serviceLevel = options.serviceLevel ?? 0.95;
  const suppliersInData = [...new Set(items.map((item) => item.supplier?.trim() || ""))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "sv"));
  const scopedItems = options.supplier
    ? items.filter((item) => (item.supplier?.trim() || "") === options.supplier)
    : items;

  const suggestions = scopedItems
    .filter(
      (item) =>
        item.avgMonthlyDemand > 0 &&
        (item.available <= item.reorderPoint || (item.coverDays !== null && item.coverDays <= item.leadTimeDays * 1.25)),
    )
    .map<ProcurementSuggestion>((item) => {
      const moq = Math.max(1, Math.ceil(item.moq ?? 1));
      // Use the same forecast/supply-plan engine as the article and forecast
      // views when monthly history exists. Historical average is only a fallback.
      let expectedDemand = item.avgMonthlyDemand * (item.leadTimeDays / 30.44);
      let forecastReorderPoint = item.reorderPoint;
      let stockoutProbability: number | null = null;
      if (item.monthlyDemand && item.monthlyDemand.length > 0) {
        const raw = {
          sku: item.sku,
          name: item.name,
          category: item.category,
          supplier: item.supplier,
          stock: item.stock,
          reserved: item.reserved,
          cost: item.cost,
          price: item.price,
          leadTimeDays: item.leadTimeDays,
          moq: item.moq ?? null,
          monthly: item.monthlyDemand,
          totalSold: item.soldPeriod,
          totalRevenue: item.revenuePeriod,
        };
        const forecast = forecastSeries(item.monthlyDemand, { horizon: Math.max(1, Math.ceil(coverageDays / 30)) });
        const plan = supplyPlan(raw, forecast, { serviceLevel, horizonMonths: Math.max(1, Math.ceil(coverageDays / 30)) });
        expectedDemand = plan.demandDuringLeadTime;
        forecastReorderPoint = plan.reorderPoint;
        stockoutProbability = plan.stockoutProbability;
      }
      const target = Math.max(
        forecastReorderPoint - item.available,
        item.avgMonthlyDemand * coverageFactor,
      );
      const suggestedQty = Math.max(moq, Math.ceil(target / moq) * moq);
      const annualDemand = Math.max(0, item.avgMonthlyDemand * 12);
      const eoq =
        item.cost > 0 && annualDemand > 0
          ? Math.sqrt((2 * annualDemand * orderCost) / (item.cost * holdingRate))
          : null;
      const critical = item.stockoutRisk || (item.coverDays !== null && item.coverDays <= item.leadTimeDays);
      return {
        sku: item.sku,
        name: item.name,
        supplier: item.supplier,
        stock: item.stock,
        available: item.available,
        reorderPoint: item.reorderPoint,
        safetyStock: item.safetyStock,
        leadTimeDays: item.leadTimeDays,
        coverDays: item.coverDays,
        monthlyDemand: item.avgMonthlyDemand,
        expectedDemand,
        moq,
        suggestedQty,
        orderValue: suggestedQty * item.cost,
        eoq: eoq === null ? null : Math.round(eoq),
        stockAfter: item.available + suggestedQty - expectedDemand,
        stockoutProbability,
        priority: critical ? "critical" : item.available <= item.reorderPoint ? "high" : "planned",
      };
    })
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.orderValue - a.orderValue);

  const supplierMap = new Map<string, { items: number; value: number; stockout: number; dead: number; lead: number }>();
  for (const item of items) {
    const name = item.supplier?.trim() || "__unknown__";
    const row = supplierMap.get(name) ?? { items: 0, value: 0, stockout: 0, dead: 0, lead: 0 };
    row.items += 1;
    row.value += item.value;
    row.stockout += item.stockoutRisk ? 1 : 0;
    row.dead += item.action === "write_off" || item.action === "liquidate" ? item.value : 0;
    row.lead += item.leadTimeDays;
    supplierMap.set(name, row);
  }
  const totalValue = items.reduce((sum, item) => sum + item.value, 0);
  const suppliers = [...supplierMap.entries()]
    .map<SupplierScore>(([key, row]) => {
      const stockoutShare = row.items > 0 ? row.stockout / row.items : 0;
      const deadShare = row.value > 0 ? row.dead / row.value : 0;
      return {
        name: key === "__unknown__" ? "" : key,
        items: row.items,
        inventoryValue: row.value,
        stockoutRisk: row.stockout,
        deadStockValue: row.dead,
        avgLeadTimeDays: row.items > 0 ? row.lead / row.items : 0,
        shareOfValue: totalValue > 0 ? row.value / totalValue : 0,
        risk: stockoutShare > 0.15 || deadShare > 0.2 ? "high" : stockoutShare > 0.05 || deadShare > 0.1 ? "medium" : "low",
      };
    })
    .sort((a, b) => b.inventoryValue - a.inventoryValue);

  return {
    suggestions,
    suppliers,
    totals: {
      suggestions: suggestions.length,
      critical: suggestions.filter((s) => s.priority === "critical").length,
      orderValue: suggestions.reduce((sum, s) => sum + s.orderValue, 0),
      supplierCount: suppliers.filter((s) => s.name).length,
      stockoutRisk: items.filter((i) => i.stockoutRisk).length,
    },
    assumptions: {
      orderCost,
      holdingRate,
      coverageDays,
      missingLeadTime: scopedItems.filter((i) => i.leadTimeDays <= 0).length,
      serviceLevel,
    },
    filter: {
      supplier: options.supplier ?? null,
      groupBySupplier: Boolean(options.groupBySupplier),
      suppliers: suppliersInData,
    },
  };
}

export function procurementPage(input: PageContext & { view: ProcurementView }): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const { view } = input;
  const num = (n: number) => appNum(locale, n, 0);
  const sek = (n: number) => appSek(locale, n);
  const days = (n: number | null) => (n === null ? "–" : `${num(Math.max(0, n))} ${t("dagar")}`);

  const priorityBadge = (priority: ProcurementPriority): string =>
    priority === "critical"
      ? badge(t("Kritisk"), "danger")
      : priority === "high"
        ? badge(t("Hög"), "warn")
        : badge(t("Planerad"), "info");

  const supplierOptions = view.filter.suppliers
    .map((name) => `<option value="${esc(name)}" ${view.filter.supplier === name ? "selected" : ""}>${esc(name)}</option>`)
    .join("");

  const groupParams = new URLSearchParams();
  if (view.filter.supplier) groupParams.set("leverantor", view.filter.supplier);
  if (!view.filter.groupBySupplier) groupParams.set("grupp", "leverantor");
  const groupHref = `/app/inkop${groupParams.toString() ? `?${groupParams.toString()}` : ""}`;
  const clearParams = new URLSearchParams();
  if (view.filter.groupBySupplier) clearParams.set("grupp", "leverantor");
  const clearHref = `/app/inkop${clearParams.toString() ? `?${clearParams.toString()}` : ""}`;

  // The order file is the page's output, not a separate report: the same view
  // builds both, and a supplier card downloads only its own block.
  const orderHref = (extension: "csv" | "xlsx", supplier: string | null) => {
    const params = new URLSearchParams();
    if (supplier) params.set("leverantor", supplier);
    return `/app/inkop/bestallning.${extension}${params.toString() ? `?${params.toString()}` : ""}`;
  };
  const orderActions = (supplier: string | null) =>
    `<div class="flex gap-2">
      <a class="btn btn-ghost btn-sm" href="${orderHref("csv", supplier)}">${icon("download", 13)} ${t("Ladda ner CSV")}</a>
      <a class="btn btn-ghost btn-sm" href="${orderHref("xlsx", supplier)}">${icon("download", 13)} ${t("Ladda ner Excel")}</a>
    </div>`;

  const filterBar = `<form class="filterbar" method="get" action="/app/inkop">
    ${view.filter.groupBySupplier ? '<input type="hidden" name="grupp" value="leverantor">' : ""}
    <div class="form-row grow"><label for="supplier">${t("Leverantör")}</label>
      <select id="supplier" name="leverantor"><option value="">${t("Alla leverantörer")}</option>${supplierOptions}</select></div>
    <button class="btn" type="submit">${icon("filter", 15)} ${t("Filtrera")}</button>
    <a class="btn btn-ghost" href="${clearHref}">${t("Rensa")}</a>
  </form>
  <p class="hint">${view.filter.supplier ? t("Visar endast förslag från {supplier}.", { supplier: view.filter.supplier }) : t("Alla leverantörer visas.")} · <a class="link-strong" href="${groupHref}">${view.filter.groupBySupplier ? t("Visa som en lista") : t("Gruppera per leverantör")}</a></p>`;

  const suggestionRows = (list: ProcurementSuggestion[]) =>
    list.map((s) => ({
      item: `<a class="link-strong" href="/app/artiklar?q=${encodeURIComponent(s.sku)}">${esc(s.sku)}</a><span class="cell-sub">${esc(s.name)}</span>`,
      supplier: s.supplier ? esc(s.supplier) : "–",
      stock: num(s.stock),
      available: num(s.available),
      expected: num(s.expectedDemand),
      lead: days(s.leadTimeDays),
      safety: num(s.safetyStock),
      reorder: num(s.reorderPoint),
      moq: num(s.moq),
      toOrder: `<strong>${num(s.suggestedQty)}</strong>`,
      value: sek(s.orderValue),
      after: num(s.stockAfter),
      risk:
        s.stockoutProbability === null
          ? s.priority === "critical"
            ? badge(t("Kritisk"), "danger")
            : "–"
          : appPct(locale, s.stockoutProbability * 100, 0),
      priority: priorityBadge(s.priority),
    }));

  const suggestionColumns = [
    { key: "item", label: t("Artikel") },
    { key: "supplier", label: t("Leverantör") },
    { key: "stock", label: t("Saldo"), align: "right" as const },
    { key: "available", label: t("Tillgängligt"), align: "right" as const },
    { key: "expected", label: t("Förväntad efterfrågan"), align: "right" as const },
    { key: "lead", label: t("Ledtid"), align: "right" as const },
    { key: "safety", label: t("Säkerhetslager"), align: "right" as const },
    { key: "reorder", label: t("Beställningspunkt"), align: "right" as const },
    { key: "moq", label: "MOQ", align: "right" as const },
    { key: "toOrder", label: t("Att beställa"), align: "right" as const },
    { key: "value", label: t("Inköpsvärde"), align: "right" as const },
    { key: "after", label: t("Efter leverans"), align: "right" as const },
    { key: "risk", label: t("Bristrisk utan order"), align: "right" as const },
    { key: "priority", label: t("Prioritet") },
  ];

  const suggestionsContent = (() => {
    if (view.suggestions.length === 0) {
      return card({
        title: t("Inga akuta inköpsbehov"),
        body: emptyState(t("Alla artiklar ligger över sina beställningspunkter."), t("Justera servicegrad eller ledtid i analysen om bilden inte stämmer.")),
      });
    }
    if (!view.filter.groupBySupplier) {
      return card({
        title: t("Prioriterade inköpsförslag"),
        subtitle: t("Sorterat på brådskande först, därefter inköpsvärde. Kvantiteten återställer beställningspunkten och täcker cirka {days} dagar, avrundad till MOQ.", { days: num(view.assumptions.coverageDays) }),
        actions: orderActions(view.filter.supplier),
        body:
          table({ locale, columns: suggestionColumns, rows: suggestionRows(view.suggestions.slice(0, 50)), empty: t("Inga förslag.") }) +
          `<p class="hint">${t("Filen innehåller samtliga {n} förslag, grupperade per leverantör, redo att skickas till inköp.", { n: num(view.suggestions.length) })}</p>`,
      });
    }
    // The same grouping the order file uses, so screen and file list suppliers
    // (and the rows inside them) in one order.
    return orderGroups(view)
      .map((group) =>
        card({
          title: group.supplier ?? t("Okänd leverantör"),
          subtitle: t("{n} förslag · inköpsvärde {value}", { n: num(group.suggestions.length), value: sek(group.orderValue) }),
          actions: orderActions(group.supplier),
          body: table({ locale, columns: suggestionColumns, rows: suggestionRows(group.suggestions), empty: t("Inga förslag.") }),
        }),
      )
      .join("");
  })();

  const supplierRows = view.suppliers
    .filter((s) => s.name)
    .slice(0, 15)
    .map((s) => ({
      supplier: esc(s.name),
      items: num(s.items),
      value: sek(s.inventoryValue),
      share: appPct(locale, s.shareOfValue * 100, 1),
      lead: days(s.avgLeadTimeDays),
      stockout: num(s.stockoutRisk),
      dead: sek(s.deadStockValue),
      risk:
        s.risk === "high"
          ? badge(t("Förhöjd risk"), "danger")
          : s.risk === "medium"
            ? badge(t("Bevaka"), "warn")
            : badge(t("Stabil"), "ok"),
    }));

  return shell({
    title: t("Inköpsintelligens"),
    active: "procurement",
    locale,
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: t("Beställningsförslag, ledtider och leverantörsrisk från er senaste analys."),
    content: `
      <div class="kpi-grid">
        ${kpi({ label: t("Artiklar att beställa"), value: num(view.totals.suggestions), sub: t("Utifrån beställningspunkt och ledtid"), tone: view.totals.suggestions > 0 ? "warn" : "good" })}
        ${kpi({ label: t("Kritiska innan ledtid"), value: num(view.totals.critical), sub: t("Tar slut snabbare än leveranstiden"), tone: view.totals.critical > 0 ? "danger" : "good" })}
        ${kpi({ label: t("Inköpsvärde, förslag"), value: sek(view.totals.orderValue), sub: t("Vid föreslagen kvantitet") })}
        ${kpi({ label: t("Leverantörer"), value: num(view.totals.supplierCount), sub: `${num(view.totals.stockoutRisk)} ${t("artiklar med bristrisk")}` })}
      </div>

      ${filterBar}
      ${suggestionsContent}

      ${card({
        title: t("Leverantörsöversikt"),
        subtitle: t("Leverantörer rankade på bundet lagervärde. Risken bygger på andelen artiklar med bristrisk och andelen inaktiva artiklar."),
        body: table({
    locale,
          columns: [
            { key: "supplier", label: t("Leverantör") },
            { key: "items", label: t("Artiklar"), align: "right" },
            { key: "value", label: t("Lagervärde"), align: "right" },
            { key: "share", label: t("Andel"), align: "right" },
            { key: "lead", label: t("Snittledtid"), align: "right" },
            { key: "stockout", label: t("Bristrisk"), align: "right" },
            { key: "dead", label: t("Inaktivt lager"), align: "right" },
            { key: "risk", label: t("Bedömning") },
          ],
          rows: supplierRows,
          empty: t("Leverantörskolumnen saknas i underlaget."),
        }),
      })}

      ${`<details class="method">
        <summary>${t("Så räknas förslagen")}</summary>
        <ul class="assumption-list">
          <li>${t("Beställningspunkt och säkerhetslager kommer från analysens servicegrad och ledtid per artikel.")}</li>
          <li>${t("Föreslagen kvantitet = högsta värdet av (beställningspunkt − saldo) och {days} dagars genomsnittlig efterfrågan, avrundad uppåt till MOQ.", { days: num(view.assumptions.coverageDays) })}</li>
          <li>${t("Förväntad efterfrågan under ledtid och bristrisk kommer från prognosmotorn när månadshistorik finns. Utan historik används historiskt medelvärde och risken visas som –.")}</li>
          <li>${t("EOQ = √(2 × årsbehov × orderkostnad / (inköpspris × lagerhållningsränta)), med antagandena {cost} per order och {rate} i lagerhållningsränta.", { cost: sek(view.assumptions.orderCost), rate: appPct(locale, view.assumptions.holdingRate * 100, 0) })}</li>
          <li>${t("MOQ används när artikeln har en minsta orderkvantitet i underlaget. Saknas den antas 1 och kvantiteten måste kontrolleras mot avtal.")}</li>
          ${view.assumptions.missingLeadTime > 0 ? `<li>${t("{n} artiklar saknar ledtid och använder analysens standardvärde. Kontrollera dessa extra noga.", { n: num(view.assumptions.missingLeadTime) })}</li>` : ""}
          <li>${t("Förslagen är beslutsstöd, inte automatiska inköpsordrar. Ingen beställning skickas från STOQWISE.")}</li>
        </ul>
      </details>`}
    `,
  });
}
