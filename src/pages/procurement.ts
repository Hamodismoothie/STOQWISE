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
import { badge, card, emptyState, esc, kpi, shell, table } from "../ui/base.ts";
import { appNum, appPct, appSek, appTranslator } from "../i18n-app.ts";
import type { PageContext } from "./core.ts";

export type ProcurementPriority = "critical" | "high" | "planned";

export interface ProcurementSuggestion {
  sku: string;
  name: string;
  supplier: string | null;
  available: number;
  reorderPoint: number;
  safetyStock: number;
  leadTimeDays: number;
  coverDays: number | null;
  monthlyDemand: number;
  suggestedQty: number;
  orderValue: number;
  eoq: number | null;
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
  };
}

export interface ProcurementOptions {
  orderCost?: number;
  holdingRate?: number;
  coverageDays?: number;
}

const PRIORITY_RANK: Record<ProcurementPriority, number> = { critical: 0, high: 1, planned: 2 };

export function buildProcurementView(items: AnalyzedItem[], options: ProcurementOptions = {}): ProcurementView {
  const orderCost = options.orderCost ?? 750;
  const holdingRate = options.holdingRate ?? 0.2;
  const coverageDays = options.coverageDays ?? 30;
  const coverageFactor = coverageDays / 30;

  const suggestions = items
    .filter(
      (item) =>
        item.avgMonthlyDemand > 0 &&
        (item.available <= item.reorderPoint || (item.coverDays !== null && item.coverDays <= item.leadTimeDays * 1.25)),
    )
    .map<ProcurementSuggestion>((item) => {
      const target = Math.max(item.reorderPoint - item.available, item.avgMonthlyDemand * coverageFactor);
      const suggestedQty = Math.max(1, Math.ceil(target));
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
        available: item.available,
        reorderPoint: item.reorderPoint,
        safetyStock: item.safetyStock,
        leadTimeDays: item.leadTimeDays,
        coverDays: item.coverDays,
        monthlyDemand: item.avgMonthlyDemand,
        suggestedQty,
        orderValue: suggestedQty * item.cost,
        eoq: eoq === null ? null : Math.round(eoq),
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
      missingLeadTime: items.filter((i) => i.leadTimeDays <= 0).length,
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

  const rows = view.suggestions.slice(0, 30).map((s) => ({
    item: `<a class="link-strong" href="/app/artiklar?q=${encodeURIComponent(s.sku)}">${esc(s.sku)}</a><span class="cell-sub">${esc(s.name)}</span>`,
    supplier: s.supplier ? esc(s.supplier) : "–",
    available: num(s.available),
    reorder: num(s.reorderPoint),
    cover: days(s.coverDays),
    toOrder: `<strong>${num(s.suggestedQty)}</strong>`,
    eoq: s.eoq === null ? "–" : num(s.eoq),
    value: sek(s.orderValue),
    priority: priorityBadge(s.priority),
  }));

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

      ${
        view.suggestions.length === 0
          ? card({ title: t("Inga akuta inköpsbehov"), body: emptyState(t("Alla artiklar ligger över sina beställningspunkter."), t("Justera servicegrad eller ledtid i analysen om bilden inte stämmer.")) })
          : card({
              title: t("Prioriterade inköpsförslag"),
              subtitle: t("Sorterat på brådskande först, därefter inköpsvärde. Kvantiteten återställer beställningspunkten och täcker cirka {days} dagar.", { days: num(view.assumptions.coverageDays) }),
              body: table({
                columns: [
                  { key: "item", label: t("Artikel") },
                  { key: "supplier", label: t("Leverantör") },
                  { key: "available", label: t("Tillgängligt"), align: "right" },
                  { key: "reorder", label: t("Beställningspunkt"), align: "right" },
                  { key: "cover", label: t("Täcker"), align: "right" },
                  { key: "toOrder", label: t("Att beställa"), align: "right" },
                  { key: "eoq", label: t("EOQ"), align: "right" },
                  { key: "value", label: t("Inköpsvärde"), align: "right" },
                  { key: "priority", label: t("Prioritet") },
                ],
                rows,
                empty: t("Inga förslag."),
              }),
            })
      }

      ${card({
        title: t("Leverantörsöversikt"),
        subtitle: t("Leverantörer rankade på bundet lagervärde. Risken bygger på andelen artiklar med bristrisk och andelen inaktiva artiklar."),
        body: table({
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

      ${card({
        title: t("Så räknas förslagen"),
        body: `<ul class="assumption-list">
          <li>${t("Beställningspunkt och säkerhetslager kommer från analysens servicegrad och ledtid per artikel.")}</li>
          <li>${t("Föreslagen kvantitet = högsta värdet av (beställningspunkt − saldo) och {days} dagars genomsnittlig efterfrågan.", { days: num(view.assumptions.coverageDays) })}</li>
          <li>${t("EOQ = √(2 × årsbehov × orderkostnad / (inköpspris × lagerhållningsränta)), med antagandena {cost} per order och {rate} i lagerhållningsränta.", { cost: sek(view.assumptions.orderCost), rate: appPct(locale, view.assumptions.holdingRate * 100, 0) })}</li>
          <li>${t("Minsta orderkvantitet (MOQ) finns inte i underlaget och kan därför inte tas hänsyn till. Kontrollera kvantiteten mot avtal innan beställning.")}</li>
          ${view.assumptions.missingLeadTime > 0 ? `<li>${t("{n} artiklar saknar ledtid och använder analysens standardvärde. Kontrollera dessa extra noga.", { n: num(view.assumptions.missingLeadTime) })}</li>` : ""}
          <li>${t("Förslagen är beslutsstöd, inte automatiska inköpsordrar. Ingen beställning skickas från STOQWISE.")}</li>
        </ul>`,
      })}
    `,
  });
}
