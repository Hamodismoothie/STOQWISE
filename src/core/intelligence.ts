/**
 * Inventory intelligence: the layer that turns the raw analysis into a decision
 * surface.
 *
 * The base engine (`analysis.ts`) answers "what do we have". This module answers
 * "where is the money, what is abnormal, and what should be done first" - still
 * with plain arithmetic and stated formulas, because every number here ends up
 * in a board presentation.
 */
import type { AbcClass, AnalysisResult, AnalyzedItem, ItemAction } from "../analysis.ts";
import type { ItemInput } from "../dataset.ts";
import { DISPLAY, HEALTH, OTHER_CATEGORY_LABEL } from "../tuning.ts";
import { classifyAbc } from "./classification.ts";

export interface IntelligenceItem extends AnalyzedItem {
  unitMargin: number;
  marginPct: number | null;
  profitPeriod: number;
  turns: number;
  dio: number | null;
  abcRevenue: AbcClass;
  abcValue: AbcClass;
  abcProfit: AbcClass;
  capitalShare: number;
  seasonalIndex: number[] | null;
  seasonStrength: number;
  peakIndex: number | null;
  anomalyCount: number;
  lastMonthDeviation: number;
  priorityScore: number;
  priorityReasons: string[];
  /** Slow vs fast rotator, relative to the portfolio's median turns. */
  velocity: "fast" | "normal" | "slow" | "dead";
}

export interface CapitalGroup {
  key: string;
  label: string;
  value: number;
  count: number;
  share: number;
  deadValue: number;
  overstockValue: number;
}

export interface IntelligenceSnapshot {
  items: IntelligenceItem[];
  capital: {
    total: number;
    byCategory: CapitalGroup[];
    bySupplier: CapitalGroup[];
    byAbc: CapitalGroup[];
    byAction: CapitalGroup[];
    concentrationTop10: number;
  };
  profitability: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    marginPct: number;
    /** Inventory at purchase cost (capital tied up). */
    inventoryValue: number;
    /** Inventory at selling price, not revenue until sold. */
    stockSalesValue: number;
    negativeMarginCount: number;
    lowMarginCount: number;
    lowMarginValue: number;
    byCategory: Array<{ category: string; revenue: number; profit: number; marginPct: number }>;
  };
  health: {
    score: number;
    grade: "utmärkt" | "god" | "svag" | "kritisk";
    /** `contribution` is score × weight in points, so the drivers sum to the score. */
    drivers: Array<{ label: string; value: number; score: number; weight: number; contribution: number }>;
  };
  classification: {
    /** The matrix is always ABC by sales revenue, the same class as the lists. */
    abcMeasure: "revenue";
    abcRevenue: Array<{ class: AbcClass; count: number; value: number; share: number }>;
    abcValue: Array<{ class: AbcClass; count: number; value: number; share: number }>;
    abcProfit: Array<{ class: AbcClass; count: number; value: number; share: number }>;
    matrix: Array<{ abc: AbcClass; x: number; y: number; z: number; unclassified: number; value: number }>;
    /** Articles with no demand history: outside X/Y/Z by design, still in ABC. */
    unclassified: number;
    /** Why those articles have no X/Y/Z class. */
    reasons: { noHistory: number; insufficientHistory: number; zeroDemand: number; missingValues: number };
  };
  velocity: {
    fast: number;
    normal: number;
    slow: number;
    dead: number;
    medianTurns: number;
  };
  anomalies: Array<{
    sku: string;
    name: string;
    kind: "spike" | "drop" | "never_sold" | "stock_spike";
    detail: string;
    severity: number;
  }>;
  seasonality: Array<{
    sku: string;
    name: string;
    strength: number;
    peakIndex: number;
    lowIndex: number;
    ratio: number;
  }>;
  priorities: Array<{
    sku: string;
    name: string;
    action: ItemAction;
    score: number;
    value: number;
    reasons: string[];
  }>;
  valueTrend: Array<{ date: string; value: number }>;
  formulas: string[];
}

export interface IntelligenceOptions {
  months: number;
  /** Oldest to newest, e.g. ["2024-01", ...]. Used to name seasonal peaks. */
  monthLabels?: string[];
  /** Historical snapshots for the value trend, already sorted oldest first. */
  snapshots?: Array<{ date: string; value: number }>;
  deadStockDays?: number;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (n: number, d = 2): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / (xs.length - 1));
}

function groupBy(
  items: IntelligenceItem[],
  keyFn: (i: IntelligenceItem) => string,
  total: number,
): CapitalGroup[] {
  const map = new Map<string, CapitalGroup>();
  for (const item of items) {
    const key = keyFn(item) || "Okänd";
    const g = map.get(key) ?? { key, label: key, value: 0, count: 0, share: 0, deadValue: 0, overstockValue: 0 };
    g.value += item.value;
    g.count++;
    if (item.action === "write_off" || item.action === "liquidate") g.deadValue += item.value;
    g.overstockValue += item.overstockValue;
    map.set(key, g);
  }
  return [...map.values()]
    .map((g) => ({ ...g, value: round(g.value), deadValue: round(g.deadValue), overstockValue: round(g.overstockValue), share: total > 0 ? round((g.value / total) * 100, 1) : 0 }))
    .sort((a, b) => b.value - a.value);
}

function seasonalProfile(history: number[], labels?: string[]): { index: number[]; strength: number; peak: number; low: number } | null {
  if (history.length < 12) return null;
  const overall = mean(history);
  if (overall <= 0) return null;

  // Group by calendar month when labels are available, otherwise by position.
  const groups = new Map<number, number[]>();
  history.forEach((v, i) => {
    let slot = i % 12;
    const label = labels?.[i];
    if (label) {
      const m = label.match(/(?:^|\D)(\d{1,2})(?:\D|$)/);
      const parsed = m ? Number(m[1]) : NaN;
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 12) slot = parsed - 1;
    }
    const list = groups.get(slot) ?? [];
    list.push(v);
    groups.set(slot, list);
  });

  const index = Array.from({ length: 12 }, (_, i) => {
    const list = groups.get(i);
    return list && list.length > 0 ? mean(list) / overall : 1;
  });

  const peaks = index.filter((v) => Number.isFinite(v));
  const max = Math.max(...peaks);
  const min = Math.min(...peaks);
  // Strength = how much of the average level the seasonal swing represents,
  // capped at 1. A flat series scores 0.
  const strength = max > 0 ? Math.min(1, (max - min) / max) : 0;
  const peak = index.indexOf(max);
  const low = index.indexOf(min);
  return { index: index.map((v) => round(v, 2)), strength: round(strength, 3), peak, low };
}

export function buildIntelligence(
  rawItems: ItemInput[],
  result: AnalysisResult,
  options: IntelligenceOptions,
): IntelligenceSnapshot {
  const months = Math.max(1, options.months);
  const bySku = new Map(rawItems.map((i) => [i.sku, i]));
  const inventoryTotal = result.kpis.inventoryValue;

  const allAnalyzed = collectAll(result);
  const valueRanking = classifyAbc(allAnalyzed.map((i) => ({ sku: i.sku, measure: i.value })));
  const profitRanking = classifyAbc(
    allAnalyzed.map((i) => ({ sku: i.sku, measure: Math.max(0, i.revenuePeriod - i.soldPeriod * i.cost) })),
  );

  // Turns per item: annualised COGS over average inventory value held.
  const turnsValues = allAnalyzed
    .filter((i) => i.value > 0 && i.soldPeriod > 0)
    .map((i) => ((i.soldPeriod / months) * 12 * i.cost) / i.value)
    .sort((a, b) => a - b);
  const medianTurns = turnsValues.length ? turnsValues[Math.floor(turnsValues.length / 2)]! : 0;

  const items: IntelligenceItem[] = allAnalyzed.map((item) => {
    const raw = bySku.get(item.sku);
    const sell = item.price ?? item.cost;
    const unitMargin = sell - item.cost;
    const revenue = item.revenuePeriod;
    const cogs = item.soldPeriod * item.cost;
    const profitPeriod = revenue - cogs;
    const marginPct = revenue > 0 ? (profitPeriod / revenue) * 100 : null;
    const annualCogs = (item.soldPeriod / months) * 12 * item.cost;
    const turns = item.value > 0 ? annualCogs / item.value : 0;
    const dio = turns > 0 ? 365 / turns : null;

    const profile = raw?.monthly ? seasonalProfile(raw.monthly, options.monthLabels) : null;

    // Anomaly detection on the monthly history: |z| >= 2 counts as a spike or
    // drop. We also report the latest month's deviation, which is what a buyer
    // reacts to.
    let anomalyCount = 0;
    let lastMonthDeviation = 0;
    if (raw?.monthly && raw.monthly.length >= 6) {
      const m = mean(raw.monthly);
      const sd = stdev(raw.monthly);
      for (const v of raw.monthly) {
        if (sd > 0 && Math.abs((v - m) / sd) >= 2) anomalyCount++;
      }
      const last = raw.monthly[raw.monthly.length - 1]!;
      const prev = mean(raw.monthly.slice(-4, -1));
      lastMonthDeviation = prev > 0 ? (last - prev) / prev : last > 0 ? 1 : 0;
    }

    const velocity: IntelligenceItem["velocity"] =
      item.soldPeriod === 0 ? "dead" : turns >= medianTurns * 2 ? "fast" : turns >= medianTurns * 0.5 ? "normal" : "slow";

    return {
      ...item,
      unitMargin: round(unitMargin),
      marginPct: marginPct === null ? null : round(marginPct, 1),
      profitPeriod: round(profitPeriod),
      turns: round(turns, 2),
      dio: dio === null ? null : round(dio, 0),
      abcRevenue: item.abc,
      abcValue: valueRanking.get(item.sku) ?? "C",
      abcProfit: profitRanking.get(item.sku) ?? "C",
      capitalShare: inventoryTotal > 0 ? round((item.value / inventoryTotal) * 100, 2) : 0,
      seasonalIndex: profile?.index ?? null,
      seasonStrength: profile?.strength ?? 0,
      peakIndex: profile?.peak ?? null,
      anomalyCount,
      lastMonthDeviation: round(lastMonthDeviation, 3),
      priorityScore: 0,
      priorityReasons: [],
      velocity,
    };
  });

  // ------------------------------------------------------------- priorities
  // Score = capital at stake (40) + severity of the action (30) + margin impact
  // (20) + urgency from cover days (10). Weights are fixed and documented so a
  // customer can argue with them.
  const maxValue = Math.max(1, ...items.map((i) => i.value));
  const maxProfitLost = Math.max(1, ...items.map((i) => Math.abs(i.profitPeriod)));
  for (const item of items) {
    const reasons: string[] = [];
    const capitalScore = (item.value / maxValue) * 40;
    if (item.value > inventoryTotal * 0.02) reasons.push(`${item.capitalShare} % av lagervärdet i en artikel`);

    let severity = 0;
    if (item.action === "write_off") {
      severity = 30;
      reasons.push("Ingen försäljning i perioden");
    } else if (item.action === "liquidate") {
      severity = 26;
      reasons.push("Ingen registrerad försäljning under ett år");
    } else if (item.action === "reduce") {
      severity = 18;
      reasons.push(`Överlager ${Math.round(item.overstockQty)} enheter`);
    } else if (item.action === "reorder") {
      severity = 22;
      reasons.push(`Täcker ${item.coverDays ?? 0} dagar mot ${item.leadTimeDays} dagars ledtid`);
    } else if (item.action === "review") {
      severity = 6;
    }

    const marginScore = (Math.abs(item.profitPeriod) / maxProfitLost) * 20;
    if (item.profitPeriod < 0) reasons.push("Negativt täckningsbidrag");
    else if (item.marginPct !== null && item.marginPct < 15) reasons.push(`Låg marginal (${item.marginPct} %)`);

    const urgency =
      item.coverDays !== null && item.coverDays < item.leadTimeDays
        ? 10
        : item.coverDays !== null && item.coverDays < item.leadTimeDays * 1.5
          ? 5
          : 0;
    if (urgency > 0) reasons.push("Risk för brist inom ledtid");

    item.priorityScore = round(capitalScore + severity + marginScore + urgency, 1);
    item.priorityReasons = reasons.slice(0, 3);
  }

  const priorities = [...items]
    .filter((i) => i.action !== "ok")
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 50)
    .map((i) => ({
      sku: i.sku,
      name: i.name,
      action: i.action,
      score: i.priorityScore,
      value: i.value,
      reasons: i.priorityReasons,
    }));

  // ------------------------------------------------------------ aggregates
  const revenue = items.reduce((a, i) => a + i.revenuePeriod, 0);
  const cogs = items.reduce((a, i) => a + i.soldPeriod * i.cost, 0);
  const grossProfit = revenue - cogs;
  const stockSalesValue = items.reduce((a, i) => a + i.stock * (i.price ?? i.cost), 0);

  const lowMarginItems = items.filter((i) => i.marginPct !== null && i.marginPct < 15 && i.value > 0);
  const negativeMarginItems = items.filter((i) => i.profitPeriod < 0 && i.value > 0);

  const categoryProfit = new Map<string, { revenue: number; profit: number }>();
  for (const item of items) {
    const key = item.category ?? "Utan kategori";
    const e = categoryProfit.get(key) ?? { revenue: 0, profit: 0 };
    e.revenue += item.revenuePeriod;
    e.profit += item.profitPeriod;
    categoryProfit.set(key, e);
  }

  const sortedByValue = [...items].sort((a, b) => b.value - a.value);
  const top10Value = sortedByValue.slice(0, 10).reduce((a, i) => a + i.value, 0);

  // ---------------------------------------------------------------- health
  const deadShare = inventoryTotal > 0 ? result.kpis.deadStockValue / inventoryTotal : 0;
  const overShare = inventoryTotal > 0 ? result.kpis.overstockValue / inventoryTotal : 0;
  const stockoutShare = items.length > 0 ? result.kpis.stockoutRiskCount / items.length : 0;
  const turnsScore = Math.min(1, result.kpis.turns / HEALTH.turnsTarget);

  const drivers = [
    { label: "Kapital i inaktiva artiklar", value: result.kpis.deadStockValue, score: Math.max(0, 1 - deadShare / HEALTH.deadShareLimit), weight: HEALTH.weights.dead },
    { label: "Överlager", value: result.kpis.overstockValue, score: Math.max(0, 1 - overShare / HEALTH.overShareLimit), weight: HEALTH.weights.over },
    { label: "Bristrisk", value: result.kpis.stockoutRiskCount, score: Math.max(0, 1 - stockoutShare / HEALTH.stockoutShareLimit), weight: HEALTH.weights.stockout },
    { label: "Omsättningshastighet", value: result.kpis.turns, score: turnsScore, weight: HEALTH.weights.turns },
  ].map((d) => ({
    ...d,
    score: round(d.score, 3),
    contribution: round(d.score * d.weight * 100, 1),
  }));
  // The displayed drivers are the source of truth: round each contribution to
  // one decimal, sum those numbers, then put the rounding residual on the
  // largest driver. That is why the four visible contributions always add up
  // to the visible score instead of 82 vs 81.
  const contributions = drivers.map((d) => round(d.score * d.weight * 100, 1));
  const healthScore = Math.max(0, Math.min(100, Math.round(contributions.reduce((a, c) => a + c, 0))));
  const residual = round(healthScore - contributions.reduce((a, c) => a + c, 0), 1);
  if (residual !== 0) {
    let largest = 0;
    for (let i = 1; i < contributions.length; i++) {
      if (contributions[i]! > contributions[largest]!) largest = i;
    }
    contributions[largest] = round(Math.max(0, contributions[largest]! + residual), 1);
  }
  const driversWithContribution = drivers.map((d, i) => ({ ...d, contribution: contributions[i]! }));
  const grade = (HEALTH.grades.find((band) => healthScore >= band.min) ?? HEALTH.grades[HEALTH.grades.length - 1]!).grade;

  // ------------------------------------------------------------- anomalies
  const anomalies: IntelligenceSnapshot["anomalies"] = [];
  for (const item of items) {
    if (item.anomalyCount > 0 && item.velocity !== "dead") {
      anomalies.push({
        sku: item.sku,
        name: item.name,
        kind: item.lastMonthDeviation > 0 ? "spike" : "drop",
        detail: `${item.anomalyCount} avvikande månader i historiken. Senaste månaden ${item.lastMonthDeviation > 0 ? "+" : ""}${Math.round(item.lastMonthDeviation * 100)} % mot snittet före.`,
        severity: round(Math.min(1, item.anomalyCount / 4), 2),
      });
    }
    if (item.soldPeriod === 0 && item.value > inventoryTotal * 0.005) {
      anomalies.push({
        sku: item.sku,
        name: item.name,
        kind: "never_sold",
        detail: `Ingen försäljning alls under ${months} månader men ${Math.round(item.stock)} enheter i lager.`,
        severity: 0.9,
      });
    }
    // Stock far above what a year of demand would justify.
    const annualDemand = item.avgMonthlyDemand * 12;
    if (annualDemand > 0 && item.stock > annualDemand * 2.5) {
      anomalies.push({
        sku: item.sku,
        name: item.name,
        kind: "stock_spike",
        detail: `Lagret motsvarar ${round(item.stock / annualDemand, 1)} års förbrukning.`,
        severity: round(Math.min(1, item.stock / (annualDemand * 5)), 2),
      });
    }
  }

  const seasonality = items
    .filter((i) => i.seasonalIndex !== null && i.seasonStrength > 0.25)
    .sort((a, b) => b.seasonStrength - a.seasonStrength)
    .slice(0, 20)
    .map((i) => {
      const idx = i.seasonalIndex!;
      const peak = Math.max(...idx);
      const low = Math.min(...idx);
      return {
        sku: i.sku,
        name: i.name,
        strength: i.seasonStrength,
        peakIndex: i.peakIndex ?? 0,
        lowIndex: idx.indexOf(low),
        ratio: round(peak / Math.max(0.01, low), 2),
      };
    });

  return {
    items,
    capital: {
      total: round(inventoryTotal),
      byCategory: groupBy(items, (i) => i.category ?? "Utan kategori", inventoryTotal),
      bySupplier: groupBy(items, (i) => i.supplier ?? "Okänd leverantör", inventoryTotal),
      byAbc: groupBy(items, (i) => `ABC ${i.abcValue}`, inventoryTotal),
      byAction: groupBy(items, (i) => actionLabel(i.action), inventoryTotal),
      concentrationTop10: inventoryTotal > 0 ? round((top10Value / inventoryTotal) * 100, 1) : 0,
    },
    profitability: {
      revenue: round(revenue),
      cogs: round(cogs),
      grossProfit: round(grossProfit),
      marginPct: revenue > 0 ? round((grossProfit / revenue) * 100, 1) : 0,
      inventoryValue: round(inventoryTotal),
      stockSalesValue: round(stockSalesValue),
      negativeMarginCount: negativeMarginItems.length,
      lowMarginCount: lowMarginItems.length,
      lowMarginValue: round(lowMarginItems.reduce((a, i) => a + i.value, 0)),
      byCategory: [...categoryProfit.entries()]
        .map(([category, v]) => ({
          category,
          revenue: round(v.revenue),
          profit: round(v.profit),
          marginPct: v.revenue > 0 ? round((v.profit / v.revenue) * 100, 1) : 0,
        }))
        .sort((a, b) => b.profit - a.profit)
        // Keep the list complete: fold the tail into one explicit group so the
        // category profits still add up to the gross profit shown on the card.
        .reduce<Array<{ category: string; revenue: number; profit: number; marginPct: number }>>((acc, row, i) => {
          if (i < DISPLAY.profitCategories) return [...acc, row];
          const rest = acc.find((r) => r.category === OTHER_CATEGORY_LABEL);
          if (!rest) {
            return [...acc, { category: OTHER_CATEGORY_LABEL, revenue: row.revenue, profit: row.profit, marginPct: row.marginPct }];
          }
          rest.revenue = round(rest.revenue + row.revenue);
          rest.profit = round(rest.profit + row.profit);
          rest.marginPct = rest.revenue > 0 ? round((rest.profit / rest.revenue) * 100, 1) : 0;
          return acc;
        }, []),
    },
    health: { score: healthScore, grade, drivers: driversWithContribution },
    classification: {
      abcMeasure: "revenue",
      abcRevenue: summarizeAbc(items, (i) => i.abcRevenue),
      abcValue: summarizeAbc(items, (i) => i.abcValue),
      abcProfit: summarizeAbc(items, (i) => i.abcProfit),
      unclassified: items.filter((i) => i.xyz === null).length,
      reasons: (() => {
        const reasons = { noHistory: 0, insufficientHistory: 0, zeroDemand: 0, missingValues: 0 };
        for (const item of items) {
          if (item.xyz !== null) continue;
          // Stored results from before the reason field fall back to the data
          // they do have, so an old analysis is still explained correctly.
          const reason =
            (item as { xyzReason?: string }).xyzReason ??
            (!item.monthlyDemand
              ? "no_history"
              : item.monthlyDemand.length < 6
                ? "insufficient_history"
                : "zero_demand");
          if (reason === "insufficient_history") reasons.insufficientHistory++;
          else if (reason === "zero_demand") reasons.zeroDemand++;
          else if (reason === "missing_values") reasons.missingValues++;
          else reasons.noHistory++;
        }
        return reasons;
      })(),
      matrix: (["A", "B", "C"] as AbcClass[]).map((cls) => {
        // The dashboard matrix must count the same ABC class the article list
        // filters on, which is the engine's revenue class.
        const rows = items.filter((i) => i.abcRevenue === cls);
        return {
          abc: cls,
          x: rows.filter((i) => i.xyz === "X").length,
          y: rows.filter((i) => i.xyz === "Y").length,
          z: rows.filter((i) => i.xyz === "Z").length,
          unclassified: rows.filter((i) => i.xyz === null).length,
          value: round(rows.reduce((a, i) => a + i.value, 0)),
        };
      }),
    },
    velocity: {
      fast: items.filter((i) => i.velocity === "fast").length,
      normal: items.filter((i) => i.velocity === "normal").length,
      slow: items.filter((i) => i.velocity === "slow").length,
      dead: items.filter((i) => i.velocity === "dead").length,
      medianTurns: round(medianTurns, 2),
    },
    anomalies: anomalies.sort((a, b) => b.severity - a.severity).slice(0, 40),
    seasonality,
    priorities,
    valueTrend: (options.snapshots ?? []).map((s) => ({ date: s.date, value: round(s.value) })),
    formulas: [
      "ABC i matris, listor och filter = kumulativ andel av försäljningsvärdet under perioden. A: andelen före artikeln < 80 %, B: 80–95 %, C: resten. Artikeln som passerar en gräns stannar i klassen före den.",
      "ABC på lagervärde och täckningsbidrag redovisas separat som abcValue och abcProfit; de styr inte matrisen.",
      "XYZ = standardavvikelse / medelvärde för månadsefterfrågan med minst 6 månader: X < 0,5, Y 0,5–1,0, Z > 1,0. Medelvärde 0, saknade värden eller kortare historik ger ingen klass.",
      "Lageromsättning per artikel = (såld kvantitet / månader × 12 × inköpspris) / lagervärde.",
      "DIO = 365 / lageromsättning.",
      "Täckningsbidrag = försäljningsvärde − såld kvantitet × inköpspris.",
      "Säsongindex = medelvärde för kalendermånad / totalt medelvärde. Kräver minst 12 månader.",
      "Anomali = månad med |z| ≥ 2 mot artikelns egen historik.",
      "Prioritetspoäng = kapitalvikt (40) + åtgärdens allvar (30) + marginalpåverkan (20) + brådskande täckning (10).",
      "Hälsopoäng = summan av drivarnas bidrag (0,30 inaktivt kapital + 0,25 överlager + 0,20 bristrisk + 0,25 omsättning, skalat 0–100). Bidragen avrundas till en decimal och avrundningsdifferensen läggs på största drivaren, så delpoängen summerar exakt till totalen.",
    ],
  };
}

function summarizeAbc(items: IntelligenceItem[], key: (i: IntelligenceItem) => AbcClass) {
  const classes: AbcClass[] = ["A", "B", "C"];
  const total = items.reduce((a, i) => a + i.value, 0);
  return classes.map((cls) => {
    const rows = items.filter((i) => key(i) === cls);
    const value = rows.reduce((a, i) => a + i.value, 0);
    return { class: cls, count: rows.length, value: round(value), share: total > 0 ? round((value / total) * 100, 1) : 0 };
  });
}

function actionLabel(action: ItemAction): string {
  switch (action) {
    case "write_off":
      return "Nedskrivning";
    case "liquidate":
      return "Realisera";
    case "reduce":
      return "Minska";
    case "reorder":
      return "Beställ";
    case "review":
      return "Granska";
    default:
      return "OK";
  }
}

export { actionLabel };

/**
 * Every analyzed article. Older stored results predate `items`, so we fall back
 * to the union of the top lists rather than crashing on historical rows.
 */
export function collectAll(result: AnalysisResult): AnalyzedItem[] {
  if (Array.isArray(result.items) && result.items.length > 0) return result.items;
  const map = new Map<string, AnalyzedItem>();
  for (const list of [result.topCapital, result.deadStock, result.overstock, result.reorder]) {
    for (const item of list) map.set(item.sku, item);
  }
  return [...map.values()];
}
