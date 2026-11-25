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
import { CLASS_CUTOFFS, RELEASE_RATES } from "./tuning.ts";
import {
  CLASSIFICATION_VERSION,
  classifyAbc,
  evaluateXyz,
  summarizeClassification,
  XYZ_MIN_MONTHS,
  type XyzEvaluation,
} from "./core/classification.ts";

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
  /** Minimum order quantity from the item record, if the source provides it. */
  moq?: number | null;
  safetyStock: number;
  reorderPoint: number;
  overstockQty: number;
  overstockValue: number;
  stockoutRisk: boolean;
  abc: AbcClass;
  xyz: XyzClass | null;
  // Optional so stored results from before the reason fields still type-check;
  // the UI treats a missing reason as "no history".
  /** Coefficient of variation behind the XYZ class, null when not computable. */
  xyzCv?: number | null;
  /** Complete monthly observations used for XYZ. */
  xyzMonths?: number;
  /** Why an article has no XYZ class. `ok` means it has one. */
  xyzReason?: "ok" | "no_history" | "insufficient_history" | "zero_demand" | "missing_values";
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
  /** Version of the ABC/XYZ rules that produced this result. */
  classificationVersion?: string;
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
    /** Sales revenue for the analyzed period (units × selling price). */
    salesValue: number;
    /** Cost of goods sold for the analyzed period (units × purchase cost). */
    cogsPeriod: number;
    grossProfit: number;
    grossMarginPct: number;
    turns: number;
    daysOfInventory: number | null;
    potentialReleaseLow: number;
    potentialReleaseHigh: number;
    /** Blended realisation rate behind the range, as a percentage. */
    releaseRateLow: number;
    releaseRateHigh: number;
    capitalCostAnnual: number;
    stockoutRiskCount: number;
    stockoutRiskValue: number;
    averageLeadTimeDays: number;
    turnoverMedian: number;
  };
  aging: AgingBucket[];
  abc: Array<{ class: AbcClass; count: number; value: number; revenue: number; revenueShare: number }>;
  xyz: Array<{ class: XyzClass; count: number }> | null;
  /** Articles with stock but no demand history: no X/Y/Z class by design. */
  xyzUnclassified: number;
  /** Why articles are outside X/Y/Z, so the UI can explain it instead of guessing. */
  xyzCoverage: {
    minMonths: number;
    classified: number;
    noHistory: number;
    insufficientHistory: number;
    zeroDemand: number;
    missingValues: number;
  };
  matrix: { abc: AbcClass; x: number; y: number; z: number; unclassified: number }[] | null;
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

/**
 * Inverse standard-normal CDF (Acklam's rational approximation, relative error
 * below 1.15e-9). A lookup table is tempting, but it silently maps every
 * unlisted service level (for example 92 %) to 95 %, which changes safety stock
 * without telling the user. This computes the factor for the requested level.
 */
export function zScore(serviceLevel: number): number {
  const p = serviceLevel;
  if (!(p > 0 && p < 1)) return 1.6448536269514722;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  const high = 1 - low;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > high) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
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

    // SERV1: combine demand variability over the lead time with lead-time
    // variability when the item record provides it. Without a lead-time sigma
    // the expression is the demand-only case, which is reported as an assumption.
    const demandSigma = sigmaMonthly > 0 ? sigmaMonthly * Math.sqrt(leadTimeDays / daysPerMonth) : 0;
    const leadTimeSigma = Math.max(0, item.leadTimeSigmaDays ?? 0);
    const sigmaDuringLeadTime = Math.hypot(demandSigma, avgDailyDemand * leadTimeSigma);
    const safetyStock = z * sigmaDuringLeadTime;
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

  // --------------------------------------------------- ABC (sales revenue)
  // The ranker is shared with the decision layer, so the matrix on the dashboard
  // and the ABC filter on the article list describe the same population.
  const abcMap = classifyAbc(base.map((row) => ({ sku: row.item.sku, measure: row.revenuePeriod })));

  // -------------------------------------------------------------- XYZ (CV)
  const xyzMap = new Map<string, XyzClass>();
  const xyzEvaluations = new Map<string, XyzEvaluation>();
  for (const row of base) {
    const evaluation = evaluateXyz(row.monthlyDemand, XYZ_MIN_MONTHS);
    xyzEvaluations.set(row.item.sku, evaluation);
    if (evaluation.xyz) xyzMap.set(row.item.sku, evaluation.xyz);
  }
  // A single article without history must not disable XYZ for the whole file.
  const hasMonthly = xyzMap.size > 0;

  // ------------------------------------------------------------- classification
  const analyzed: AnalyzedItem[] = base.map((row) => {
    const abc = abcMap.get(row.item.sku) ?? "C";
    const xyz = xyzMap.get(row.item.sku) ?? null;
    const xyzEvaluation = xyzEvaluations.get(row.item.sku)!;

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
      moq: row.item.moq ?? null,
      safetyStock: round(row.safetyStock, 1),
      reorderPoint: round(row.reorderPoint, 1),
      overstockQty: round(row.overstockQty, 1),
      overstockValue: round(row.overstockValue, 2),
      stockoutRisk: row.stockoutRisk,
      abc,
      xyz,
      xyzCv: xyzEvaluation.cv === null ? null : round(xyzEvaluation.cv, 3),
      xyzMonths: xyzEvaluation.months,
      xyzReason: xyzEvaluation.reason,
      action,
      actionValue: round(actionValue, 2),
    };
  });

  // ---------------------------------------------------------------- aggregates
  const inventoryValue = analyzed.reduce((a, i) => a + i.value, 0);
  const stockUnits = analyzed.reduce((a, i) => a + i.stock, 0);
  const periodCogs = analyzed.reduce((a, i) => a + i.soldPeriod * i.cost, 0);
  const salesValue = analyzed.reduce((a, i) => a + i.revenuePeriod, 0);
  const grossProfit = salesValue - periodCogs;
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
  const DEAD_LOW = RELEASE_RATES.deadLow;
  const DEAD_HIGH = RELEASE_RATES.deadHigh;
  const OVER_LOW = RELEASE_RATES.overLow;
  const OVER_HIGH = RELEASE_RATES.overHigh;
  const potentialReleaseLow = deadStockValue * DEAD_LOW + overstockValue * OVER_LOW;
  const potentialReleaseHigh = deadStockValue * DEAD_HIGH + overstockValue * OVER_HIGH;
  // The headline rate depends on the mix: dead stock releases at 25–55 %, overstock
  // at 15–35 %. Reporting a fixed "25–55 %" next to a range built only from
  // overstock would overstate the assumption, so the rate is derived from the data.
  const releaseBase = deadStockValue + overstockValue;
  const releaseRateLow = releaseBase > 0 ? (potentialReleaseLow / releaseBase) * 100 : 0;
  const releaseRateHigh = releaseBase > 0 ? (potentialReleaseHigh / releaseBase) * 100 : 0;

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

  const { abc, xyz, xyzUnclassified, xyzCoverage, matrix } = summarizeClassification(analyzed);

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
    classificationVersion: CLASSIFICATION_VERSION,
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
      salesValue: round(salesValue, 2),
      cogsPeriod: round(periodCogs, 2),
      grossProfit: round(grossProfit, 2),
      grossMarginPct: salesValue > 0 ? round((grossProfit / salesValue) * 100, 1) : 0,
      turns: round(turns, 2),
      daysOfInventory: daysOfInventory === null ? null : round(daysOfInventory, 0),
      potentialReleaseLow: round(potentialReleaseLow, 2),
      potentialReleaseHigh: round(potentialReleaseHigh, 2),
      releaseRateLow: round(releaseRateLow, 1),
      releaseRateHigh: round(releaseRateHigh, 1),
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
    xyzUnclassified,
    xyzCoverage,
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
