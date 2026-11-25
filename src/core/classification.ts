/**
 * The one place where article classes are decided.
 *
 * Both the analysis engine and the decision layer rank the same articles, so
 * they must use the same cut-offs and the same cumulative rule. Keeping the
 * ranker here means a class shown in a table, a matrix cell, a PDF or a 3D scene
 * can only differ if the underlying measure differs - never because two modules
 * implemented the arithmetic twice.
 */
import type { AbcClass, AnalysisResult, AnalyzedItem, XyzClass } from "../analysis.ts";
import { CLASS_CUTOFFS } from "../tuning.ts";

/**
 * Bumped when the classification rules change. Stored results with another
 * version are recomputed on read, so an old analysis cannot keep showing the
 * previous rule set next to a freshly calculated KPI.
 */
export const CLASSIFICATION_VERSION = "2026-11-23.abc-revenue.xyz-per-item";

/** Why an article did not receive an X/Y/Z class. */
export type XyzReason = "ok" | "no_history" | "insufficient_history" | "zero_demand" | "missing_values";

/** Below this many complete monthly observations, CV is not reliable. */
export const XYZ_MIN_MONTHS = 6;

export interface AbcThresholds {
  a: number;
  b: number;
}

const DEFAULT_ABC: AbcThresholds = { a: CLASS_CUTOFFS.abcA, b: CLASS_CUTOFFS.abcB };

/**
 * Ranks articles A/B/C by cumulative share of a measure.
 *
 * The class is decided on the share accumulated *before* the article. That is
 * deliberate: the article that crosses the 80 % line still belongs to A, so a
 * single dominant article cannot be pushed into B by its own weight. A
 * portfolio with no positive measure gets C throughout instead of labelling
 * every article A on a 0 % cumulative.
 */
export function classifyAbc(
  rows: Array<{ sku: string; measure: number }>,
  thresholds: AbcThresholds = DEFAULT_ABC,
): Map<string, AbcClass> {
  const out = new Map<string, AbcClass>();
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.measure), 0);
  if (!(total > 0)) {
    for (const row of rows) out.set(row.sku, "C");
    return out;
  }
  const sorted = [...rows].sort((a, b) => b.measure - a.measure);
  let cumulative = 0;
  for (const row of sorted) {
    const cls: AbcClass = cumulative < thresholds.a ? "A" : cumulative < thresholds.b ? "B" : "C";
    out.set(row.sku, cls);
    cumulative += Math.max(0, row.measure) / total;
  }
  return out;
}

export interface XyzEvaluation {
  xyz: XyzClass | null;
  /** Coefficient of variation, or null when it must not be computed. */
  cv: number | null;
  mean: number;
  /** Complete monthly observations used. */
  months: number;
  reason: XyzReason;
}

const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

const stdev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1));
};

/**
 * Classifies demand variability.
 *
 * The coefficient of variation is standard deviation / mean. When the mean is
 * zero the ratio is undefined, so the article is reported as `zero_demand`
 * instead of being forced into Z (which would equate "never sold" with
 * "volatile demand"). Missing values and fewer than six observations are also
 * reported explicitly rather than being classed on a thinner basis.
 */
export function evaluateXyz(
  monthly: number[] | null | undefined,
  minMonths = XYZ_MIN_MONTHS,
): XyzEvaluation {
  if (!monthly || monthly.length === 0) {
    return { xyz: null, cv: null, mean: 0, months: 0, reason: "no_history" };
  }
  const complete = monthly.filter((value) => Number.isFinite(value));
  if (complete.length !== monthly.length) {
    return {
      xyz: null,
      cv: null,
      mean: complete.length ? mean(complete) : 0,
      months: complete.length,
      reason: "missing_values",
    };
  }
  if (complete.length < minMonths) {
    return { xyz: null, cv: null, mean: mean(complete), months: complete.length, reason: "insufficient_history" };
  }
  const m = mean(complete);
  if (!(m > 0)) {
    return { xyz: null, cv: null, mean: m, months: complete.length, reason: "zero_demand" };
  }
  const cv = stdev(complete) / m;
  const xyz: XyzClass = cv < CLASS_CUTOFFS.xyzX ? "X" : cv <= CLASS_CUTOFFS.xyzY ? "Y" : "Z";
  return { xyz, cv, mean: m, months: complete.length, reason: "ok" };
}

const round = (n: number, d = 2): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/** The aggregate class tables every view shares. */
export function summarizeClassification(items: Array<{ sku: string; value: number; revenuePeriod: number; monthlyDemand: number[] | null }>) {
  const abcMap = classifyAbc(items.map((item) => ({ sku: item.sku, measure: item.revenuePeriod })));
  const evaluations = new Map(items.map((item) => [item.sku, evaluateXyz(item.monthlyDemand)]));
  const revenueTotal = items.reduce((sum, item) => sum + item.revenuePeriod, 0);
  const classes: AbcClass[] = ["A", "B", "C"];

  const abc = classes.map((cls) => {
    const rows = items.filter((item) => abcMap.get(item.sku) === cls);
    const revenue = rows.reduce((sum, item) => sum + item.revenuePeriod, 0);
    return {
      class: cls,
      count: rows.length,
      value: round(rows.reduce((sum, item) => sum + item.value, 0)),
      revenue: round(revenue),
      revenueShare: revenueTotal > 0 ? round((revenue / revenueTotal) * 100, 1) : 0,
    };
  });

  const classified = (cls: XyzClass) => items.filter((item) => evaluations.get(item.sku)?.xyz === cls).length;
  const hasMonthly = (["X", "Y", "Z"] as XyzClass[]).some((cls) => classified(cls) > 0);
  const xyz = hasMonthly ? (["X", "Y", "Z"] as XyzClass[]).map((cls) => ({ class: cls, count: classified(cls) })) : null;

  const matrix = hasMonthly
    ? classes.map((cls) => {
        const rows = items.filter((item) => abcMap.get(item.sku) === cls);
        return {
          abc: cls,
          x: rows.filter((item) => evaluations.get(item.sku)?.xyz === "X").length,
          y: rows.filter((item) => evaluations.get(item.sku)?.xyz === "Y").length,
          z: rows.filter((item) => evaluations.get(item.sku)?.xyz === "Z").length,
          unclassified: rows.filter((item) => evaluations.get(item.sku)?.xyz === null).length,
        };
      })
    : null;

  const reasonCount = (reason: XyzReason) => items.filter((item) => evaluations.get(item.sku)?.reason === reason).length;
  const xyzCoverage = {
    minMonths: XYZ_MIN_MONTHS,
    classified: items.length - reasonCount("no_history") - reasonCount("insufficient_history") - reasonCount("zero_demand") - reasonCount("missing_values"),
    noHistory: reasonCount("no_history"),
    insufficientHistory: reasonCount("insufficient_history"),
    zeroDemand: reasonCount("zero_demand"),
    missingValues: reasonCount("missing_values"),
  };

  return {
    abc,
    xyz,
    xyzUnclassified: items.length - xyzCoverage.classified,
    xyzCoverage,
    matrix,
  };
}

/**
 * Refreshes only the derived classes and their summaries on a stored result.
 * Stock, cost, demand history, safety stock, KPIs and recommendations are kept
 * exactly as they were; an old analysis therefore gets the current rule set
 * without silently changing its business numbers.
 */
export function refreshClassification(result: AnalysisResult): AnalysisResult {
  if (result.classificationVersion === CLASSIFICATION_VERSION || !Array.isArray(result.items) || result.items.length === 0) {
    return result;
  }
  const abcMap = classifyAbc(result.items.map((item) => ({ sku: item.sku, measure: item.revenuePeriod })));
  const items: AnalyzedItem[] = result.items.map((item) => {
    const evaluation = evaluateXyz(item.monthlyDemand);
    return {
      ...item,
      abc: abcMap.get(item.sku) ?? "C",
      xyz: evaluation.xyz,
      xyzCv: evaluation.cv === null ? null : round(evaluation.cv, 3),
      xyzMonths: evaluation.months,
      xyzReason: evaluation.reason,
    };
  });
  const bySku = new Map(items.map((item) => [item.sku, item]));
  const remap = (list: AnalyzedItem[]) => list.map((item) => bySku.get(item.sku) ?? item);
  return {
    ...result,
    ...summarizeClassification(items),
    classificationVersion: CLASSIFICATION_VERSION,
    items,
    topCapital: Array.isArray(result.topCapital) ? remap(result.topCapital) : result.topCapital,
    deadStock: Array.isArray(result.deadStock) ? remap(result.deadStock) : result.deadStock,
    overstock: Array.isArray(result.overstock) ? remap(result.overstock) : result.overstock,
    reorder: Array.isArray(result.reorder) ? remap(result.reorder) : result.reorder,
  };
}
