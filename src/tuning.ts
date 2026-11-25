/**
 * Every threshold, weight and display cap that shapes a number the customer
 * sees. Kept in one place so a reviewer can answer "where does 25–55 % come
 * from" without grepping six modules.
 *
 * Nothing here changes an amount by itself: the formulas live in
 * `analysis.ts` (engine) and `core/intelligence.ts` (decision layer).
 */

/** Realisation rates used for the capital-release range. */
export const RELEASE_RATES = {
  deadLow: 0.25,
  deadHigh: 0.55,
  overLow: 0.15,
  overHigh: 0.35,
} as const;

/** Inventory-health model. Weights must sum to 1. */
export const HEALTH = {
  turnsTarget: 6,
  /** Share of inventory value where a driver scores zero. */
  deadShareLimit: 0.25,
  overShareLimit: 0.4,
  /** Share of articles at stockout risk where the driver scores zero. */
  stockoutShareLimit: 0.15,
  weights: { dead: 0.3, over: 0.25, stockout: 0.2, turns: 0.25 },
  grades: [
    { min: 80, grade: "utmärkt" },
    { min: 60, grade: "god" },
    { min: 40, grade: "svag" },
    { min: 0, grade: "kritisk" },
  ],
} as const;

/** Display caps for charts: the remainder is folded into an explicit group. */
export const DISPLAY = {
  treemapGroups: 8,
  profitBars: 6,
  profitCategories: 12,
} as const;

/**
 * ABC cuts on cumulative sales revenue (the engine's `abc`), and XYZ cuts on
 * demand coefficient of variation. Both thresholds are consumed through
 * `core/classification.ts` so every view uses the same rule.
 */
export const CLASS_CUTOFFS = {
  abcA: 0.8,
  abcB: 0.95,
  xyzX: 0.5,
  xyzY: 1,
} as const;

/** Label used when a folded group stands in for several categories. */
export const OTHER_CATEGORY_LABEL = "Övriga kategorier";

/**
 * Keep at most `max` rows and let `createRest` describe everything below the
 * cut. Used wherever a chart used to slice: dropping rows makes the visual add
 * up to less than the KPI printed next to it.
 */
export function foldTail<T>(rows: T[], max: number, createRest: (tail: T[]) => T): T[] {
  if (rows.length <= max) return rows;
  const keep = Math.max(0, max - 1);
  return [...rows.slice(0, keep), createRest(rows.slice(keep))];
}
