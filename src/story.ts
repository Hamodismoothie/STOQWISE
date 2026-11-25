/**
 * The four-step story on the landing page.
 *
 * Every figure here is derived from the same demo dataset and the same engine as
 * the app: `analyze` for classification and KPIs, `forecastSeries` for the
 * warehouse-level demand series and `supplyPlan` for the order proposals. The
 * public page never invents a number and never computes inventory maths in the
 * browser; it renders this structure.
 */
import type { AnalysisResult, AnalyzedItem } from "./analysis.ts";
import type { DemoDataset, DemoEnvironmentId } from "./demo.ts";
import type { ItemInput } from "./dataset.ts";
import { aggregateSeries, forecastSeries, supplyPlan, type ForecastPoint } from "./core/forecast.ts";
import { industryProfile, type IndustryId } from "./industry.ts";

export interface StoryField {
  key: "sku" | "name" | "category" | "supplier" | "stock" | "cost" | "price" | "leadTime" | "moq" | "history" | "shelfLife";
  /** Share of the imported rows that carry a value, 0–1. */
  coverage: number;
}

export interface StorySample {
  sku: string;
  name: string;
  category: string;
  supplier: string;
  stock: number;
  cost: number;
  value: number;
  leadTimeDays: number;
  shelfLifeDays: number | null;
}

export interface StoryImport {
  rowsRead: number;
  items: number;
  suppliers: number;
  months: number;
  fields: StoryField[];
  samples: StorySample[];
  issues: Array<{ key: "duplicates" | "skipped" | "negative" | "zeroCost" | "missingPrice" | "missingLead" | "missingHistory"; count: number }>;
}

export interface StoryClassRow {
  key: string;
  count: number;
  value: number;
  share: number;
}

export interface StoryTopItem {
  sku: string;
  name: string;
  abc: string;
  xyz: string | null;
  coverDays: number | null;
  turns: number;
  value: number;
  status: "overstock" | "stockout" | "inactive" | "balanced";
}

export interface StoryMatrixCell {
  abc: string;
  xyz: string;
  count: number;
  value: number;
  /** Share of total inventory value, 0–1. */
  share: number;
}

export interface StoryAnalysis {
  abc: StoryClassRow[];
  xyz: StoryClassRow[];
  /** Aggregated 3×3 ABC/XYZ view for the public demo. Never item level. */
  matrix: StoryMatrixCell[];
  top: StoryTopItem[];
  turns: number;
  daysOfInventory: number | null;
  coverMedian: number | null;
  deadValue: number;
  deadCount: number;
  overstockValue: number;
  stockoutCount: number;
  inventoryValue: number;
  /** Food and pharma only: stock that outlives its shelf life at current cover. */
  shelfRisk: { count: number; value: number } | null;
}

export interface StoryScenario {
  id: "down" | "base" | "up";
  demandPct: number;
  points: ForecastPoint[];
  monthly: number;
  total: number;
  coverageMonths: number | null;
}

export interface StoryForecast {
  labels: string[];
  history: number[];
  points: ForecastPoint[];
  method: string;
  confidence: "high" | "medium" | "low";
  seasonal: boolean;
  seasonalPct: number;
  scenarios: StoryScenario[];
  /** Warehouse cover in months at the base forecast. */
  coverageMonths: number | null;
}

export interface StoryOrder {
  sku: string;
  name: string;
  supplier: string;
  leadTimeDays: number;
  moq: number | null;
  quantity: number;
  reorderPoint: number;
  safetyStock: number;
  purchaseValue: number;
  coverBefore: number | null;
  coverAfter: number | null;
  stockoutProbability: number;
  expectedShortageValue: number;
}

export interface StoryDecision {
  orders: StoryOrder[];
  totals: {
    count: number;
    purchaseValue: number;
    expectedShortageValue: number;
    capitalReleaseLow: number;
    capitalReleaseHigh: number;
    overstockValue: number;
    serviceLevel: number;
  };
}

export interface Story {
  id: DemoEnvironmentId;
  industry: { id: IndustryId; label: { sv: string; en: string }; zones: Array<{ label: { sv: string; en: string }; tone: string }> };
  import: StoryImport;
  analysis: StoryAnalysis;
  forecast: StoryForecast;
  decision: StoryDecision;
}

const MONTHS: Record<"sv" | "en", string[]> = {
  sv: ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

const round = (value: number, digits = 0): number => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

const median = (values: number[]): number | null => {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 0 ? (clean[mid - 1]! + clean[mid]!) / 2 : clean[mid]!;
};

/** Month labels for the last `months` periods and the forecast horizon. */
function monthLabels(months: number, horizon: number, locale: "sv" | "en"): string[] {
  const now = new Date();
  const names = MONTHS[locale];
  const labels: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(`${names[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`);
  }
  for (let i = 1; i <= horizon; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    labels.push(`${names[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`);
  }
  return labels;
}

function asInput(item: AnalyzedItem): ItemInput {
  return {
    sku: item.sku,
    name: item.name,
    category: item.category,
    subcategory: item.subcategory ?? null,
    brand: item.brand ?? null,
    unit: item.unit ?? null,
    shelfLifeDays: item.shelfLifeDays,
    storage: item.storage,
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
}

function coverageOf(items: ItemInput[], pick: (item: ItemInput) => unknown): number {
  if (items.length === 0) return 0;
  const filled = items.filter((item) => {
    const value = pick(item);
    return value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);
  }).length;
  return round(filled / items.length, 4);
}

function classStatus(item: AnalyzedItem): StoryTopItem["status"] {
  if (item.action === "write_off" || item.action === "liquidate") return "inactive";
  if (item.stockoutRisk) return "stockout";
  if (item.overstockQty > 0) return "overstock";
  return "balanced";
}

/**
 * Builds the story from data that is already loaded, so the page computes the
 * analysis exactly once. The demand series is aggregated from the same monthly
 * history the app uses per article.
 */
export function buildStory(dataset: DemoDataset, result: AnalysisResult, locale: "sv" | "en" = "sv"): Story {
  const items = dataset.items;
  const profile = industryProfile(dataset.environment.industryId);
  const shelfRiskItems = result.items.filter(
    (item) => item.shelfLifeDays !== null && item.coverDays !== null && item.coverDays > item.shelfLifeDays,
  );
  const shelfRisk = profile.attributes.includes("shelfLife")
    ? {
        count: shelfRiskItems.length,
        value: round(shelfRiskItems.reduce((sum, item) => sum + item.value, 0), 0),
      }
    : null;
  const history = aggregateSeries(items) ?? [];
  const horizon = 6;
  const serviceLevel = result.settings.serviceLevel;

  const baseForecast = forecastSeries(history, { horizon, serviceLevel });
  const lastHistory = history.slice(-12);
  const labels = monthLabels(lastHistory.length, horizon, locale);

  const stockUnits = result.kpis.stockUnits;
  const monthly = baseForecast.points[0]?.value ?? 0;
  const coverageMonths = monthly > 0 ? round(stockUnits / monthly, 1) : null;

  const window12 = history.slice(-12);
  const mean12 = window12.reduce((a, b) => a + b, 0) / Math.max(1, window12.length);
  const amplitude = mean12 > 0 ? (Math.max(...window12) - Math.min(...window12)) / mean12 : 0;
  const seasonal = window12.length >= 6 && amplitude >= 0.25;

  const scenarios: StoryScenario[] = ([-15, 0, 15] as const).map((pct) => {
    const factor = 1 + pct / 100;
    const scaled = history.map((value) => Math.max(0, Math.round(value * factor)));
    const forecast = pct === 0 ? baseForecast : forecastSeries(scaled, { horizon, serviceLevel });
    const scenarioMonthly = forecast.points[0]?.value ?? 0;
    return {
      id: pct < 0 ? "down" : pct > 0 ? "up" : "base",
      demandPct: pct,
      points: forecast.points,
      monthly: round(scenarioMonthly, 0),
      total: round(forecast.points.reduce((sum, point) => sum + point.value, 0), 0),
      coverageMonths: scenarioMonthly > 0 ? round(stockUnits / scenarioMonthly, 1) : null,
    };
  });

  const suppliers = new Set(items.map((item) => item.supplier).filter((supplier): supplier is string => Boolean(supplier)));
  const shelfCoverage = items.filter((item) => item.shelfLifeDays !== null).length;
  const fields: StoryField[] = [
    { key: "sku", coverage: coverageOf(items, (item) => item.sku) },
    { key: "name", coverage: coverageOf(items, (item) => item.name) },
    { key: "category", coverage: coverageOf(items, (item) => item.category) },
    { key: "supplier", coverage: coverageOf(items, (item) => item.supplier) },
    { key: "stock", coverage: coverageOf(items, (item) => item.stock) },
    { key: "cost", coverage: coverageOf(items, (item) => item.cost) },
    { key: "price", coverage: coverageOf(items, (item) => item.price) },
    { key: "leadTime", coverage: coverageOf(items, (item) => item.leadTimeDays) },
    { key: "moq", coverage: coverageOf(items, (item) => item.moq) },
    { key: "history", coverage: coverageOf(items, (item) => item.monthly) },
  ];
  if (shelfCoverage > 0) {
    fields.push({ key: "shelfLife", coverage: round(shelfCoverage / Math.max(1, items.length), 4) });
  }

  const samples: StorySample[] = [...result.items]
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map((item) => ({
      sku: item.sku,
      name: item.name,
      category: item.category ?? "",
      supplier: item.supplier ?? "",
      stock: round(item.stock, 0),
      cost: round(item.cost, 0),
      value: round(item.value, 0),
      leadTimeDays: item.leadTimeDays,
      shelfLifeDays: item.shelfLifeDays,
    }));

  const issues: StoryImport["issues"] = [
    { key: "duplicates", count: 0 },
    { key: "skipped", count: 0 },
    { key: "negative", count: 0 },
    { key: "zeroCost", count: items.filter((item) => item.cost <= 0).length },
    { key: "missingPrice", count: items.filter((item) => item.price === null || item.price <= 0).length },
    { key: "missingLead", count: items.filter((item) => (item.leadTimeDays ?? 0) <= 0).length },
    { key: "missingHistory", count: items.filter((item) => !item.monthly || item.monthly.length === 0).length },
  ];

  const abc = (result.abc ?? []).map((row) => ({
    key: row.class,
    count: row.count,
    value: round(row.value, 0),
    // `revenueShare` is reported in percent by the engine.
    share: round(row.revenueShare > 1 ? row.revenueShare / 100 : row.revenueShare, 4),
  }));
  const xyzRows = result.xyz ?? [];
  const xyzTotal = xyzRows.reduce((sum, row) => sum + row.count, 0) + result.xyzUnclassified;
  const xyz: StoryClassRow[] = xyzRows.map((row) => ({
    key: row.class,
    count: row.count,
    value: 0,
    share: xyzTotal > 0 ? round(row.count / xyzTotal, 4) : 0,
  }));
  if (result.xyzUnclassified > 0) {
    xyz.push({ key: "–", count: result.xyzUnclassified, value: 0, share: xyzTotal > 0 ? round(result.xyzUnclassified / xyzTotal, 4) : 0 });
  }

  const inventoryValue = result.kpis.inventoryValue;
  const matrix: StoryMatrixCell[] = ["A", "B", "C"].flatMap((abc) =>
    ["X", "Y", "Z"].map((xyz) => {
      const matches = result.items.filter((item) => item.abc === abc && item.xyz === xyz);
      const value = round(matches.reduce((sum, item) => sum + item.value, 0), 0);
      return {
        abc,
        xyz,
        count: matches.length,
        value,
        share: inventoryValue > 0 ? round(value / inventoryValue, 4) : 0,
      };
    }),
  );

  const top: StoryTopItem[] = [...result.items]
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .map((item) => ({
      sku: item.sku,
      name: item.name,
      abc: item.abc,
      xyz: item.xyz,
      coverDays: item.coverDays,
      turns: round(item.cost * (item.soldPeriod / Math.max(1, result.dataQuality.months)) * 12 / Math.max(1, item.value), 1),
      value: round(item.value, 0),
      status: classStatus(item),
    }));

  const coverMedian = median(result.items.map((item) => item.coverDays).filter((value): value is number => value !== null));

  const orders: StoryOrder[] = [];
  for (const item of result.reorder) {
    const input = asInput(item);
    const forecast = forecastSeries(item.monthlyDemand ?? [], { horizon, serviceLevel });
    const plan = supplyPlan(input, forecast, { serviceLevel, horizonMonths: horizon });
    if (!(plan.orderQuantity > 0)) continue;
    const available = Math.max(0, item.available);
    const daily = plan.forecastMonthly / 30.44;
    orders.push({
      sku: item.sku,
      name: item.name,
      supplier: item.supplier ?? "",
      leadTimeDays: plan.leadTimeDays,
      moq: item.moq ?? null,
      quantity: plan.orderQuantity,
      reorderPoint: plan.reorderPoint,
      safetyStock: plan.safetyStock,
      purchaseValue: round(plan.orderQuantity * item.cost, 0),
      coverBefore: item.coverDays === null ? null : round(item.coverDays, 0),
      coverAfter: daily > 0 ? round((available + plan.orderQuantity) / daily, 0) : null,
      stockoutProbability: plan.stockoutProbability,
      expectedShortageValue: plan.expectedShortageValue,
    });
  }
  orders.sort((a, b) => b.expectedShortageValue - a.expectedShortageValue || b.purchaseValue - a.purchaseValue);

  const decision: StoryDecision = {
    orders: orders.slice(0, 4),
    totals: {
      count: orders.length,
      purchaseValue: round(orders.reduce((sum, order) => sum + order.purchaseValue, 0), 0),
      expectedShortageValue: round(orders.reduce((sum, order) => sum + order.expectedShortageValue, 0), 0),
      capitalReleaseLow: result.kpis.potentialReleaseLow,
      capitalReleaseHigh: result.kpis.potentialReleaseHigh,
      overstockValue: result.kpis.overstockValue,
      serviceLevel,
    },
  };

  return {
    id: dataset.environment.id,
    industry: {
      id: profile.id,
      label: profile.label,
      zones: profile.zones.map((zone) => ({ label: zone.label, tone: zone.tone })),
    },
    import: {
      rowsRead: items.length,
      items: items.length,
      suppliers: suppliers.size,
      months: dataset.months,
      fields,
      samples,
      issues,
    },
    analysis: {
      abc,
      xyz,
      matrix,
      top,
      turns: result.kpis.turns,
      daysOfInventory: result.kpis.daysOfInventory,
      coverMedian: coverMedian === null ? null : round(coverMedian, 0),
      deadValue: result.kpis.deadStockValue,
      deadCount: result.kpis.deadStockCount,
      overstockValue: result.kpis.overstockValue,
      stockoutCount: result.kpis.stockoutRiskCount,
      inventoryValue: result.kpis.inventoryValue,
      shelfRisk,
    },
    forecast: {
      labels,
      history: lastHistory,
      points: baseForecast.points,
      method: baseForecast.method,
      confidence: baseForecast.confidence,
      seasonal,
      seasonalPct: round(amplitude * 100, 0),
      scenarios,
      coverageMonths,
    },
    decision,
  };
}
