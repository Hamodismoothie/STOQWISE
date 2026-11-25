/**
 * Invariant audit for the analysis engine.
 *
 * Every check here is a claim the UI makes to the customer: "these categories
 * add up to the inventory value", "these classes cover every article", "these
 * four drivers add up to the health score". The audit exists so a test can
 * prove those claims instead of assuming them.
 *
 * It returns findings, never throws: pages must keep rendering, a test asserts
 * the list is empty.
 */
import type { AnalysisResult } from "./analysis.ts";
import type { IntelligenceSnapshot } from "./core/intelligence.ts";

export interface AuditFinding {
  check: string;
  detail: string;
}

/** Rounding is applied per group, so a total can drift by a few öre. */
const MONEY_TOLERANCE = 0.5;
const COUNT_TOLERANCE = 0;

const finite = (value: number | null): boolean => value === null || Number.isFinite(value);

export function auditAnalysis(result: AnalysisResult, intel?: IntelligenceSnapshot): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const add = (check: string, detail: string) => findings.push({ check, detail });
  const k = result.kpis;

  // ---------------------------------------------------------------- KPI sanity
  for (const [key, value] of Object.entries(k)) {
    if (typeof value === "number" && !finite(value)) add("kpi-finite", `${key} = ${value}`);
  }
  if (k.skuCount !== result.items.length) {
    add("sku-count", `kpis.skuCount ${k.skuCount} ≠ items ${result.items.length}`);
  }
  if (k.deadStockValue > k.inventoryValue + MONEY_TOLERANCE) {
    add("dead-within-total", `inaktivt lager ${k.deadStockValue} > lagervärde ${k.inventoryValue}`);
  }
  if (k.stockoutRiskCount > k.skuCount) {
    add("stockout-within-count", `${k.stockoutRiskCount} > ${k.skuCount}`);
  }
  if (k.potentialReleaseLow > k.potentialReleaseHigh + MONEY_TOLERANCE) {
    add("release-range", `low ${k.potentialReleaseLow} > high ${k.potentialReleaseHigh}`);
  }
  if (k.potentialReleaseHigh > k.deadStockValue + k.overstockValue + MONEY_TOLERANCE) {
    add("release-within-base", `range ${k.potentialReleaseHigh} > base ${k.deadStockValue + k.overstockValue}`);
  }
  if (k.releaseRateLow < 15 - 0.1 || k.releaseRateHigh > 55 + 0.1) {
    add("release-rate-band", `${k.releaseRateLow}–${k.releaseRateHigh} % outside 15–55 %`);
  }

  // --------------------------------------------------------- classification
  const abcCount = result.abc.reduce((a, row) => a + row.count, 0);
  if (Math.abs(abcCount - k.skuCount) > COUNT_TOLERANCE) {
    add("abc-covers-all", `ABC ${abcCount} artiklar ≠ ${k.skuCount}`);
  }
  const abcValue = result.abc.reduce((a, row) => a + row.value, 0);
  if (Math.abs(abcValue - k.inventoryValue) > MONEY_TOLERANCE) {
    add("abc-value", `ABC-värde ${abcValue} ≠ lagervärde ${k.inventoryValue}`);
  }
  const xyzCount = result.xyz ? result.xyz.reduce((a, row) => a + row.count, 0) : 0;
  if (result.xyz && xyzCount + result.xyzUnclassified !== k.skuCount) {
    add("xyz-covers-all", `XYZ ${xyzCount} + oklassade ${result.xyzUnclassified} ≠ ${k.skuCount}`);
  }
  const matrixCount = result.matrix
    ? result.matrix.reduce((a, row) => a + row.x + row.y + row.z, 0) + result.xyzUnclassified
    : 0;
  if (result.matrix && matrixCount !== k.skuCount) {
    add("matrix-covers-all", `matris ${matrixCount} ≠ ${k.skuCount}`);
  }
  if (result.xyzCoverage) {
    const covered =
      result.xyzCoverage.classified +
      result.xyzCoverage.noHistory +
      result.xyzCoverage.insufficientHistory +
      result.xyzCoverage.zeroDemand +
      result.xyzCoverage.missingValues;
    if (covered !== k.skuCount) add("xyz-coverage", `XYZ-förklaringar ${covered} ≠ ${k.skuCount}`);
  }

  // ------------------------------------------------------------- item fields
  for (const item of result.items) {
    for (const [key, value] of Object.entries(item)) {
      if (typeof value === "number" && !finite(value)) add("item-finite", `${item.sku}.${key} = ${value}`);
    }
    if (item.overstockValue > item.value + MONEY_TOLERANCE) {
      add("item-overstock", `${item.sku}: överlager ${item.overstockValue} > värde ${item.value}`);
    }
    if (item.available > item.stock + COUNT_TOLERANCE) {
      add("item-available", `${item.sku}: tillgängligt ${item.available} > saldo ${item.stock}`);
    }
  }

  if (!intel) return findings;

  // ------------------------------------------------------------- capital split
  const capitalByCategory = intel.capital.byCategory.reduce((a, g) => a + g.value, 0);
  if (Math.abs(capitalByCategory - intel.capital.total) > MONEY_TOLERANCE) {
    add("capital-by-category", `${capitalByCategory} ≠ ${intel.capital.total}`);
  }
  const shareSum = intel.capital.byCategory.reduce((a, g) => a + g.share, 0);
  if (Math.abs(shareSum - 100) > 1) add("capital-share", `andelar ${shareSum} % ≠ 100 %`);

  // -------------------------------------------------------------- profitability
  const profitRevenue = intel.profitability.byCategory.reduce((a, c) => a + c.revenue, 0);
  const profitProfit = intel.profitability.byCategory.reduce((a, c) => a + c.profit, 0);
  if (Math.abs(profitRevenue - intel.profitability.revenue) > MONEY_TOLERANCE * Math.max(1, intel.profitability.byCategory.length)) {
    add("profit-revenue", `kategorier ${profitRevenue} ≠ intäkt ${intel.profitability.revenue}`);
  }
  if (Math.abs(profitProfit - intel.profitability.grossProfit) > MONEY_TOLERANCE * Math.max(1, intel.profitability.byCategory.length)) {
    add("profit-margin", `kategorier ${profitProfit} ≠ täckningsbidrag ${intel.profitability.grossProfit}`);
  }

  // -------------------------------------------------------------------- health
  const weightSum = intel.health.drivers.reduce((a, d) => a + d.weight, 0);
  if (Math.abs(weightSum - 1) > 1e-6) add("health-weights", `vikter ${weightSum} ≠ 1`);
  const contribution = intel.health.drivers.reduce((a, d) => a + d.contribution, 0);
  if (Math.abs(contribution - intel.health.score) > 1e-6) {
    add("health-contribution", `bidrag ${contribution} ≠ poäng ${intel.health.score}`);
  }
  for (const d of intel.health.drivers) {
    if (d.score < 0 || d.score > 1) add("health-driver-range", `${d.label}: ${d.score}`);
  }

  // ------------------------------------------------------------ classification
  const intelMatrix = intel.classification.matrix.reduce((a, row) => a + row.x + row.y + row.z, 0);
  if (intelMatrix + intel.classification.unclassified !== intel.items.length) {
    add("intel-matrix", `matris ${intelMatrix} + ${intel.classification.unclassified} ≠ ${intel.items.length}`);
  }
  for (const cls of ["A", "B", "C"] as const) {
    const engineCount = result.abc.find((row) => row.class === cls)?.count ?? 0;
    const revenueCount = intel.classification.abcRevenue.find((row) => row.class === cls)?.count ?? 0;
    if (engineCount !== revenueCount) {
      add("abc-shared-count", `ABC ${cls}: motor ${engineCount} ≠ intelligens ${revenueCount}`);
    }
    const matrix = intel.classification.matrix.find((row) => row.abc === cls);
    const matrixCount = matrix ? matrix.x + matrix.y + matrix.z + matrix.unclassified : 0;
    if (matrixCount !== revenueCount) {
      add("matrix-shared-count", `matris ${cls}: ${matrixCount} ≠ ABC ${revenueCount}`);
    }
  }

  // --------------------------------------------------------------- priorities
  const seen = new Set<string>();
  for (const p of intel.priorities) {
    if (seen.has(p.sku)) add("priority-duplicate", p.sku);
    seen.add(p.sku);
    if (!Number.isFinite(p.score) || !Number.isFinite(p.value)) add("priority-finite", p.sku);
  }

  return findings;
}
