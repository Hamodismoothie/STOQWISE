/**
 * The analysis engine.
 *
 * Rules that the whole product depends on:
 *   - Every number is computed here, in plain arithmetic. No model, no estimate.
 *   - Every output carries the assumption that produced it, so a report can be
 *     defended in a meeting with a controller.
 *   - "Frigjort kapital" is always a range with a stated realisation rate, never
 *     a single promise.
 */
import type { ItemInput } from "./dataset.ts";

export type AbcClass = "A" | "B" | "C";
export type XyzClass = "X" | "Y" | "Z";
export type ItemAction = "write_off" | "liquidate" | "reduce" | "reorder" | "review" | "ok";

export interface AnalysisSettings {
  deadStockDays: number;
  overstockReviewDays: number;
  serviceLevel: number;
  capitalCostRate: number;
  /** Months covered by the sales history. */
  months: number;
  defaultLeadTimeDays: number;
  currency: "SEK";
}

export const defaultSettings: AnalysisSettings = {
  deadStockDays: 180,
  overstockReviewDays: 30,
  serviceLevel: 0.95,
  capitalCostRate: 0.08,
  months: 12,
  defaultLeadTimeDays: 30,
  currency: "SEK",
};

export interface AnalyzedItem {
  sku: string;
  name: string;
  category: string | null;
  subcategory?: string | null;
  brand?: string | null;
  unit?: string | null;
  shelfLifeDays: number | null;
  storage: string | null;
  supplier: string | null;
  stock: number;
  reserved: number;
  available: number;
  cost: number;
  price: number | null;
  value: number;
  soldPeriod: number;
  revenuePeriod: number;
  avgMonthlyDemand: number;
  monthlyDemand: number[] | null;
  monthsSinceLastSale: number | null;
  coverDays: number | null;
  leadTimeDays: number;
  safetyStock: number;
  reorderPoint: number;
  overstockQty: number;
  overstockValue: number;
  stockoutRisk: boolean;
  abc: AbcClass;
  xyz: XyzClass | null;
  action: ItemAction;
  actionValue: number;
}

export interface AgingBucket {
  label: string;
  count: number;
  value: number;
}

export interface Recommendation {
  id: string;
  priority: number;
  title: string;
  detail: string;
  impactLow: number;
  impactHigh: number;
  kind: "release" | "protect" | "process";
}

export interface AnalysisResult {
  generatedAt: string;
  settings: AnalysisSettings;
  currency: "SEK";
  kpis: {
    inventoryValue: number;
    skuCount: number;
    stockUnits: number;
    deadStockValue: number;
    deadStockCount: number;
    overstockValue: number;
    overstockCount: number;
    slowMoverValue: number;
    slowMoverCount: number;
    annualCogs: number;
    turns: number;
    daysOfInventory: number | null;
    potentialReleaseLow: number;
    potentialReleaseHigh: number;
    capitalCostAnnual: number;
    stockoutRiskCount: number;
    stockoutRiskValue: number;
    averageLeadTimeDays: number;
    turnoverMedian: number;
  };
  aging: AgingBucket[];
  abc: Array<{ class: AbcClass; count: number; value: number; revenue: number; revenueShare: number }>;
  xyz: Array<{ class: XyzClass; count: number }> | null;
  matrix: { abc: AbcClass; x: number; y: number; z: number }[] | null;
  /** Every analyzed article. The top lists below are slices of this array. */
  items: AnalyzedItem[];
  topCapital: AnalyzedItem[];
  deadStock: AnalyzedItem[];
  overstock: AnalyzedItem[];
  reorder: AnalyzedItem[];
  recommendations: Recommendation[];
  assumptions: string[];
  dataQuality: { warnings: string[]; months: number; hasMonthly: boolean; hasPrice: boolean };
}

// Keyed by toFixed(2), because 0.9.toFixed(2) is "0.90" - a mismatch here would
// silently fall back to the 95 % z-value for every caller.
const Z_BY_SERVICE: Record<string, number> = {
  "0.90": 1.2816,
  "0.95": 1.6449,
  "0.98": 2.0537,
  "0.99": 2.3263,
};

export function zScore(serviceLevel: number): number {
  const key = serviceLevel.toFixed(2);
  return Z_BY_SERVICE[key] ?? 1.6449;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

const round = (n: number, decimals = 0): number => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

export function analyze(
  items: ItemInput[],
  settingsInput: Partial<AnalysisSettings> = {},
  dataWarnings: string[] = [],
): AnalysisResult {
  const settings: AnalysisSettings = { ...defaultSettings, ...settingsInput };
  const months = Math.max(1, settings.months);
  const z = zScore(settings.serviceLevel);
  const daysPerMonth = 30.44;

  // ---------------------------------------------------------- per item math
  const base = items.map((item) => {
    const reserved = Math.max(0, Math.min(item.stock, item.reserved ?? 0));
    const available = Math.max(0, item.stock - reserved);
    const value = item.stock * item.cost;
    const monthly = item.monthly;
    const soldPeriod = monthly ? monthly.reduce((a, b) => a + b, 0) : item.totalSold;
    const revenuePeriod =
      item.totalRevenue ?? (item.price !== null ? soldPeriod * item.price : soldPeriod * item.cost);

    const avgMonthlyDemand = soldPeriod / months;
    const avgDailyDemand = avgMonthlyDemand / daysPerMonth;
    const leadTimeDays = item.leadTimeDays ?? settings.defaultLeadTimeDays;

    let sigmaMonthly = 0;
    let monthsSinceLastSale: number | null = null;
    if (monthly && monthly.length > 0) {
      sigmaMonthly = stdev(monthly);
      const lastIndex = [...monthly].reverse().findIndex((v) => v > 0);
      monthsSinceLastSale = lastIndex === -1 ? monthly.length : lastIndex;
    }

    const safetyStock = sigmaMonthly > 0 ? z * sigmaMonthly * Math.sqrt(leadTimeDays / daysPerMonth) : 0;
    const reorderPoint = avgDailyDemand * leadTimeDays + safetyStock;
    const overstockQty = Math.max(
      0,
      available - (avgDailyDemand * (leadTimeDays + settings.overstockReviewDays) + safetyStock),
    );
    const coverDays = avgDailyDemand > 0 ? available / avgDailyDemand : null;
    const stockoutRisk = avgDailyDemand > 0 && coverDays !== null && coverDays < leadTimeDays;

    return {
      item,
      available,
      reserved,
      value,
      soldPeriod,
      revenuePeriod,
      avgMonthlyDemand,
      monthlyDemand: monthly,
      monthsSinceLastSale,
      coverDays,
      leadTimeDays,
      safetyStock,
      reorderPoint,
      overstockQty,
      overstockValue: overstockQty * item.cost,
      stockoutRisk,
    };
  });

  // ------------------------------------------------------------- ABC (value)
  const revenueTotal = base.reduce((a, b) => a + b.revenuePeriod, 0);
  const sortedByRevenue = [...base].sort((a, b) => b.revenuePeriod - a.revenuePeriod);
  const abcMap = new Map<string, AbcClass>();
  let cumulative = 0;
  for (const row of sortedByRevenue) {
    // Classification uses the share accumulated *before* this article, so the
    // article that crosses the 80 % line still belongs to A. Classifying on the
    // share after would leave a dominant single article in class B.
    const cls: AbcClass = cumulative < 0.8 ? "A" : cumulative < 0.95 ? "B" : "C";
    abcMap.set(row.item.sku, cls);
    const share = revenueTotal > 0 ? row.revenuePeriod / revenueTotal : 0;
    cumulative += share;
  }

  // -------------------------------------------------------------- XYZ (CV)
  const hasMonthly = base.every((b) => b.monthlyDemand !== null) && months >= 6;
  const xyzMap = new Map<string, XyzClass>();
  if (hasMonthly) {
    for (const row of base) {
      const values = row.monthlyDemand!;
      const m = mean(values);
      const sd = stdev(values);
      // No demand history means no demand classification. Labelling an item Z
      // because it never sold conflates "inactive" with "volatile demand".
      if (m > 0) {
        const cv = sd / m;
        xyzMap.set(row.item.sku, cv < 0.5 ? "X" : cv <= 1 ? "Y" : "Z");
      }
    }
  }

  // ------------------------------------------------------------- classification
  const analyzed: AnalyzedItem[] = base.map((row) => {
    const abc = abcMap.get(row.item.sku) ?? "C";
    const xyz = xyzMap.get(row.item.sku) ?? null;

    // Inactive stock: no sales inside the inactive-stock window.
    const windowMonths = Math.max(1, Math.round(settings.deadStockDays / daysPerMonth));
    let dead = false;
    if (row.monthlyDemand) {
      const window = row.monthlyDemand.slice(-windowMonths);
      dead = row.item.stock > 0 && window.reduce((a, b) => a + b, 0) === 0;
    } else {
      dead = row.item.stock > 0 && row.soldPeriod === 0 && months * daysPerMonth >= settings.deadStockDays;
    }

    const daysSinceLastSale =
      row.monthsSinceLastSale === null ? null : Math.round(row.monthsSinceLastSale * daysPerMonth);

    let action: ItemAction = "ok";
    if (dead) {
      // No sale at all in the whole window is a write-off candidate; a sale more
      // than a year ago is a liquidation candidate. The distinction changes what
      // the customer is asked to do, so it must not depend on rounding of days.
      action =
        row.soldPeriod === 0 || daysSinceLastSale === null || daysSinceLastSale > 365 ? "write_off" : "liquidate";
    } else if (row.overstockQty > 0 && row.overstockValue > row.value * 0.2) {
      action = "reduce";
    } else if (row.stockoutRisk) {
      action = "reorder";
    } else if (row.avgMonthlyDemand > 0 && (row.coverDays ?? 0) > 365) {
      action = "reduce";
    } else if (row.item.cost <= 0 || row.available === 0) {
      action = "review";
    }

    const actionValue =
      action === "write_off" || action === "liquidate"
        ? row.value
        : action === "reduce"
          ? row.overstockValue
          : 0;

    return {
      sku: row.item.sku,
      name: row.item.name,
      category: row.item.category,
      subcategory: row.item.subcategory ?? null,
      brand: row.item.brand ?? null,
      unit: row.item.unit ?? null,
      shelfLifeDays: row.item.shelfLifeDays ?? null,
      storage: row.item.storage ?? null,
      supplier: row.item.supplier,
      stock: row.item.stock,
      reserved: row.reserved,
      available: row.available,
      cost: row.item.cost,
      price: row.item.price,
      value: round(row.value, 2),
      soldPeriod: round(row.soldPeriod, 2),
      revenuePeriod: round(row.revenuePeriod, 2),
      avgMonthlyDemand: round(row.avgMonthlyDemand, 2),
      monthlyDemand: row.monthlyDemand,
      monthsSinceLastSale: row.monthsSinceLastSale,
      coverDays: row.coverDays === null ? null : round(row.coverDays, 0),
      leadTimeDays: round(row.leadTimeDays, 0),
      safetyStock: round(row.safetyStock, 1),
      reorderPoint: round(row.reorderPoint, 1),
      overstockQty: round(row.overstockQty, 1),
      overstockValue: round(row.overstockValue, 2),
      stockoutRisk: row.stockoutRisk,
      abc,
      xyz,
      action,
      actionValue: round(actionValue, 2),
    };
  });

  // ---------------------------------------------------------------- aggregates
  const inventoryValue = analyzed.reduce((a, i) => a + i.value, 0);
  const stockUnits = analyzed.reduce((a, i) => a + i.stock, 0);
  const periodCogs = analyzed.reduce((a, i) => a + i.soldPeriod * i.cost, 0);
  const annualCogs = (periodCogs / months) * 12;
  const turns = inventoryValue > 0 ? annualCogs / inventoryValue : 0;
  const daysOfInventory = turns > 0 ? 365 / turns : null;

  const deadItems = analyzed.filter((i) => i.action === "write_off" || i.action === "liquidate");
  const deadStockValue = deadItems.reduce((a, i) => a + i.value, 0);
  const overstockItems = analyzed.filter((i) => i.overstockValue > 0 && !deadItems.includes(i));
  const overstockValue = overstockItems.reduce((a, i) => a + i.overstockValue, 0);
  const slowMoverItems = analyzed.filter(
    (i) => i.avgMonthlyDemand > 0 && i.coverDays !== null && i.coverDays > 180,
  );
  const slowMoverValue = slowMoverItems.reduce((a, i) => a + i.value, 0);
  const stockoutItems = analyzed.filter((i) => i.stockoutRisk);

  // Realisation rates are deliberately conservative and clearly labelled.
  const DEAD_LOW = 0.25;
  const DEAD_HIGH = 0.55;
  const OVER_LOW = 0.15;
  const OVER_HIGH = 0.35;
  const potentialReleaseLow = deadStockValue * DEAD_LOW + overstockValue * OVER_LOW;
  const potentialReleaseHigh = deadStockValue * DEAD_HIGH + overstockValue * OVER_HIGH;

  const agingBuckets: AgingBucket[] = [
    { label: "Aktiv (sålt senaste 90 d)", count: 0, value: 0 },
    { label: "91–180 dagar", count: 0, value: 0 },
    { label: "181–365 dagar", count: 0, value: 0 },
    { label: "Över 365 dagar", count: 0, value: 0 },
    { label: "Aldrig såld i perioden", count: 0, value: 0 },
  ];
  for (const item of analyzed) {
    const days =
      item.monthsSinceLastSale === null ? null : Math.round(item.monthsSinceLastSale * daysPerMonth);
    let idx = 4;
    if (days !== null) {
      if (days <= 3) idx = 0;
      else if (days <= 6) idx = 1;
      else if (days <= 12) idx = 2;
      else idx = 3;
    }
    if (item.soldPeriod === 0) idx = 4;
    agingBuckets[idx]!.count++;
    agingBuckets[idx]!.value = round(agingBuckets[idx]!.value + item.value, 2);
  }

  const abcClasses: AbcClass[] = ["A", "B", "C"];
  const abc = abcClasses.map((cls) => {
    const rows = analyzed.filter((i) => i.abc === cls);
    const revenue = rows.reduce((a, i) => a + i.revenuePeriod, 0);
    return {
      class: cls,
      count: rows.length,
      value: round(rows.reduce((a, i) => a + i.value, 0), 2),
      revenue: round(revenue, 2),
      revenueShare: revenueTotal > 0 ? round((revenue / revenueTotal) * 100, 1) : 0,
    };
  });

  const xyz = hasMonthly
    ? (["X", "Y", "Z"] as XyzClass[]).map((cls) => ({
        class: cls,
        count: analyzed.filter((i) => i.xyz === cls).length,
      }))
    : null;

  const matrix = hasMonthly
    ? abcClasses.map((cls) => {
        const rows = analyzed.filter((i) => i.abc === cls);
        return {
          abc: cls,
          x: rows.filter((i) => i.xyz === "X").length,
          y: rows.filter((i) => i.xyz === "Y").length,
          z: rows.filter((i) => i.xyz === "Z").length,
        };
      })
    : null;

  const byValueDesc = (a: AnalyzedItem, b: AnalyzedItem) => b.value - a.value;
  const topCapital = [...analyzed].sort(byValueDesc).slice(0, 20);
  const deadStock = [...deadItems].sort(byValueDesc).slice(0, 50);
  const overstock = [...overstockItems]
    .sort((a, b) => b.overstockValue - a.overstockValue)
    .slice(0, 50);
  const reorder = [...stockoutItems]
    .sort((a, b) => (a.coverDays ?? 0) - (b.coverDays ?? 0))
    .slice(0, 50);

  const turnoverPerItem = analyzed
    .filter((i) => i.value > 0 && i.soldPeriod > 0)
    .map((i) => ((i.soldPeriod / months) * 12 * i.cost) / i.value)
    .sort((a, b) => a - b);
  const turnoverMedian =
    turnoverPerItem.length > 0
      ? round(turnoverPerItem[Math.floor(turnoverPerItem.length / 2)]!, 2)
      : 0;

  // ------------------------------------------------------------ recommendations
  const recommendations: Recommendation[] = [];
  if (deadStockValue > 0) {
    recommendations.push({
      id: "dead-stock",
      priority: 1,
      title: "Minska kapital i inaktiva artiklar",
      detail: `${deadItems.length} artiklar har inte sålt något under de senaste ${settings.deadStockDays} dagarna och binder ${formatSek(deadStockValue)}. Börja med de ${Math.min(20, deadItems.length)} största posterna: kampanj, outlet, retur till leverantör eller nedskrivning.`,
      impactLow: round(deadStockValue * DEAD_LOW),
      impactHigh: round(deadStockValue * DEAD_HIGH),
      kind: "release",
    });
  }
  if (overstockValue > 0) {
    recommendations.push({
      id: "overstock",
      priority: 2,
      title: "Skär ner överlager",
      detail: `${overstockItems.length} artiklar ligger över vad ledtid och efterfrågan motiverar. Minska nästa beställning eller stoppa påfyllning till lagret är tömt till önskad nivå.`,
      impactLow: round(overstockValue * OVER_LOW),
      impactHigh: round(overstockValue * OVER_HIGH),
      kind: "release",
    });
  }
  if (stockoutItems.length > 0) {
    const riskValue = stockoutItems.reduce((a, i) => {
      const missing = Math.max(0, i.reorderPoint - i.available);
      return a + missing * (i.price ?? i.cost);
    }, 0);
    recommendations.push({
      id: "stockout",
      priority: 3,
      title: "Undvik brist på artiklar som säljer",
      detail: `${stockoutItems.length} artiklar täcker mindre än sin egen ledtid. Det motsvarar cirka ${formatSek(riskValue)} i försäljning som riskerar att utebli under nästa ledtid.`,
      impactLow: round(riskValue * 0.3),
      impactHigh: round(riskValue * 0.7),
      kind: "protect",
    });
  }
  if (potentialReleaseHigh > 0) {
    recommendations.push({
      id: "capital-cost",
      priority: 4,
      title: "Sätt en kapitalbindningsbudget",
      detail: `Med ${Math.round(settings.capitalCostRate * 100)} % kalkylränta kostar det bundna lagret ${formatSek(inventoryValue * settings.capitalCostRate)} per år i utebliven avkastning. Ett mål om att frigöra ${formatSek((potentialReleaseLow + potentialReleaseHigh) / 2)} motsvarar ungefär ${formatSek(((potentialReleaseLow + potentialReleaseHigh) / 2) * settings.capitalCostRate)} per år.`,
      impactLow: round(potentialReleaseLow * settings.capitalCostRate),
      impactHigh: round(potentialReleaseHigh * settings.capitalCostRate),
      kind: "release",
    });
  }
  if (analyzed.some((i) => i.leadTimeDays === settings.defaultLeadTimeDays && i.supplier === null)) {
    recommendations.push({
      id: "data",
      priority: 5,
      title: "Komplettera ledtider och leverantörer",
      detail:
        "Analysen använder en schablonledtid där uppgift saknas. Med verkliga ledtider per leverantör blir beställningspunkterna betydligt träffsäkrare.",
      impactLow: 0,
      impactHigh: 0,
      kind: "process",
    });
  }

  const assumptions = [
    `Inaktivt lager = artikel med lager men utan försäljning de senaste ${settings.deadStockDays} dagarna.`,
    `Överlager = saldo utöver förväntad efterfrågan under ledtid + ${settings.overstockReviewDays} dagars granskningsperiod, plus säkerhetslager.`,
    `Säkerhetslager beräknas med servicenivå ${Math.round(settings.serviceLevel * 100)} % (z = ${z.toFixed(2)}) och standardavvikelse i månadsförsäljning.`,
    `Schablonledtid ${settings.defaultLeadTimeDays} dagar används där ledtid saknas i filen.`,
    `Frigjort kapital är ett intervall: ${Math.round(DEAD_LOW * 100)}–${Math.round(DEAD_HIGH * 100)} % realisationsgrad på kapital i inaktiva artiklar och ${Math.round(OVER_LOW * 100)}–${Math.round(OVER_HIGH * 100)} % på överlager.`,
    `Kalkylränta för kapitalbindning: ${Math.round(settings.capitalCostRate * 100)} % per år.`,
    `Försäljningshistorik: ${months} månader.`,
  ];

  return {
    generatedAt: new Date().toISOString(),
    settings,
    currency: "SEK",
    kpis: {
      inventoryValue: round(inventoryValue, 2),
      skuCount: analyzed.length,
      stockUnits: round(stockUnits, 2),
      deadStockValue: round(deadStockValue, 2),
      deadStockCount: deadItems.length,
      overstockValue: round(overstockValue, 2),
      overstockCount: overstockItems.length,
      slowMoverValue: round(slowMoverValue, 2),
      slowMoverCount: slowMoverItems.length,
      annualCogs: round(annualCogs, 2),
      turns: round(turns, 2),
      daysOfInventory: daysOfInventory === null ? null : round(daysOfInventory, 0),
      potentialReleaseLow: round(potentialReleaseLow, 2),
      potentialReleaseHigh: round(potentialReleaseHigh, 2),
      capitalCostAnnual: round(inventoryValue * settings.capitalCostRate, 2),
      stockoutRiskCount: stockoutItems.length,
      stockoutRiskValue: round(
        stockoutItems.reduce(
          (a, i) => a + Math.max(0, i.reorderPoint - i.available) * (i.price ?? i.cost),
          0,
        ),
        2,
      ),
      averageLeadTimeDays: round(mean(analyzed.map((i) => i.leadTimeDays)), 0),
      turnoverMedian,
    },
    aging: agingBuckets,
    abc,
    xyz,
    matrix,
    items: analyzed,
    topCapital,
    deadStock,
    overstock,
    reorder,
    recommendations,
    assumptions,
    dataQuality: {
      warnings: dataWarnings,
      months,
      hasMonthly,
      hasPrice: analyzed.some((i) => i.price !== null),
    },
  };
}

/** Swedish currency formatting used in reports, UI and AI prompts alike. */
export function formatSek(value: number, compact = false): string {
  if (!Number.isFinite(value)) return "–";
  const abs = Math.abs(value);
  if (compact && abs >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} Mkr`;
  }
  if (compact && abs >= 10_000) {
    return `${Math.round(value / 1000).toLocaleString("sv-SE")} tkr`;
  }
  return `${Math.round(value).toLocaleString("sv-SE")} kr`;
}

export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString("sv-SE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
