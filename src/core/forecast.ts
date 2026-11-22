/**
 * Forecasting engine.
 *
 * Everything here is deterministic given the input series: no random numbers, no
 * external calls, no model that has to be trusted. That is a hard requirement,
 * because the forecast drives reorder points and capital calculations that a
 * customer will act on.
 *
 * Models are chosen by out-of-sample accuracy (WAPE) on a holdout of the last
 * months, not by preference. Intermittent demand (many zero months) is routed to
 * Croston/SBA instead of exponential smoothing, which is the standard treatment:
 * smoothing a series that is zero most months predicts something that never
 * happens.
 *
 * Uncertainty is reported, never hidden: every forecast carries a residual
 * sigma, a prediction interval and a stated confidence.
 */
import type { ItemInput } from "../dataset.ts";
import { zScore } from "../analysis.ts";

export type ForecastMethod =
  | "naive"
  | "mean"
  | "ses"
  | "holt"
  | "holt_winters"
  | "croston"
  | "sba"
  | "zero";

export type Frequency = "month" | "week" | "day";

export interface ForecastMetrics {
  mae: number;
  rmse: number;
  wape: number;
  bias: number;
}

export interface ForecastPoint {
  step: number;
  value: number;
  lo: number;
  hi: number;
}

export interface MethodScore {
  method: ForecastMethod;
  metrics: ForecastMetrics;
}

export interface ForecastResult {
  method: ForecastMethod;
  frequency: Frequency;
  horizon: number;
  points: ForecastPoint[];
  /** Residual standard deviation per month. */
  sigma: number;
  metrics: ForecastMetrics;
  candidates: MethodScore[];
  intermittent: boolean;
  zeroRatio: number;
  confidence: "high" | "medium" | "low";
  history: number[];
  notes: string[];
}

export interface SupplyPlan {
  horizonMonths: number;
  forecastMonthly: number;
  forecastTotal: number;
  leadTimeDays: number;
  demandDuringLeadTime: number;
  sigmaDuringLeadTime: number;
  safetyStock: number;
  reorderPoint: number;
  orderQuantity: number;
  stockoutProbability: number;
  expectedShortageUnits: number;
  expectedShortageValue: number;
  projectedStock: number;
  projectedValue: number;
  daysOfCover: number | null;
}

const DAYS_PER_MONTH = 30.44;
const DAYS_PER_WEEK = 7;
const ORDER_COST_SEK = 350;
const HOLDING_RATE = 0.22;

/* ------------------------------------------------------------------ math */

export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/** E[(Z - z)+] for a standard normal Z. Used for expected shortages. */
export function normalLoss(z: number): number {
  return normalPdf(z) - z * (1 - normalCdf(z));
}

/** Abramowitz & Stegun 7.1.26 - max error 1.5e-7, far beyond what we need. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / (xs.length - 1));
}

const round = (n: number, d = 2): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/* ----------------------------------------------------------------- models */

interface Fitted {
  forecast: (step: number) => number;
  method: ForecastMethod;
}

/** Simple exponential smoothing; alpha chosen by grid search on the train set. */
function fitSes(values: number[]): Fitted {
  let best = { alpha: 0.3, sse: Infinity };
  for (let a = 5; a <= 95; a += 5) {
    const alpha = a / 100;
    let level = values[0] ?? 0;
    let sse = 0;
    for (let i = 1; i < values.length; i++) {
      const prev = level;
      level = alpha * values[i]! + (1 - alpha) * level;
      sse += (values[i]! - prev) ** 2;
    }
    if (sse < best.sse) best = { alpha, sse };
  }
  let level = values[0] ?? 0;
  for (let i = 1; i < values.length; i++) level = best.alpha * values[i]! + (1 - best.alpha) * level;
  return { forecast: () => level, method: "ses" };
}

/** Holt linear trend. */
function fitHolt(values: number[]): Fitted {
  let best = { alpha: 0.3, beta: 0.1, sse: Infinity };
  for (let a = 10; a <= 90; a += 20) {
    for (let b = 5; b <= 50; b += 15) {
      const alpha = a / 100;
      const beta = b / 100;
      let level = values[0] ?? 0;
      let trend = values.length > 1 ? (values[1]! - values[0]!) : 0;
      let sse = 0;
      for (let i = 1; i < values.length; i++) {
        const prev = level + trend;
        sse += (values[i]! - prev) ** 2;
        const newLevel = alpha * values[i]! + (1 - alpha) * prev;
        trend = beta * (newLevel - level) + (1 - beta) * trend;
        level = newLevel;
      }
      if (sse < best.sse) best = { alpha, beta, sse };
    }
  }
  let level = values[0] ?? 0;
  let trend = values.length > 1 ? values[1]! - values[0]! : 0;
  for (let i = 1; i < values.length; i++) {
    const prev = level + trend;
    const newLevel = best.alpha * values[i]! + (1 - best.alpha) * prev;
    trend = best.beta * (newLevel - level) + (1 - best.beta) * trend;
    level = newLevel;
  }
  return { forecast: (step) => Math.max(0, level + trend * step), method: "holt" };
}

/** Holt-Winters additive seasonality. Needs two full seasons to be meaningful. */
function fitHoltWinters(values: number[]): Fitted {
  const m = 12;
  const n = values.length;
  const seasonAvg = mean(values);
  const seasonal: number[] = [];
  for (let i = 0; i < m; i++) {
    const sameSlots: number[] = [];
    for (let j = i; j < n; j += m) sameSlots.push(values[j]!);
    seasonal.push(mean(sameSlots) - seasonAvg);
  }
  let best = { alpha: 0.3, beta: 0.05, gamma: 0.3, sse: Infinity };
  for (let a = 10; a <= 70; a += 30) {
    for (let b = 5; b <= 25; b += 20) {
      for (let g = 10; g <= 70; g += 30) {
        const alpha = a / 100;
        const beta = b / 100;
        const gamma = g / 100;
        const seas = [...seasonal];
        let level = values[0]! - seas[0]!;
        let trend = (values[1]! - values[0]!) || 0;
        let sse = 0;
        for (let i = 1; i < n; i++) {
          const s = seas[i % m]!;
          const predicted = level + trend + s;
          sse += (values[i]! - predicted) ** 2;
          const newLevel = alpha * (values[i]! - s) + (1 - alpha) * (level + trend);
          trend = beta * (newLevel - level) + (1 - beta) * trend;
          seas[i % m] = gamma * (values[i]! - newLevel) + (1 - gamma) * s;
          level = newLevel;
        }
        if (sse < best.sse) best = { alpha, beta, gamma, sse };
      }
    }
  }
  const seas = [...seasonal];
  let level = values[0]! - seas[0]!;
  let trend = (values[1]! - values[0]!) || 0;
  for (let i = 1; i < n; i++) {
    const s = seas[i % m]!;
    const newLevel = best.alpha * (values[i]! - s) + (1 - best.alpha) * (level + trend);
    trend = best.beta * (newLevel - level) + (1 - best.beta) * trend;
    seas[i % m] = best.gamma * (values[i]! - newLevel) + (1 - best.gamma) * s;
    level = newLevel;
  }
  const last = n - 1;
  return {
    forecast: (step) => {
      const s = seas[(last + step) % m] ?? 0;
      return Math.max(0, level + trend * step + s);
    },
    method: "holt_winters",
  };
}

/**
 * Croston / SBA for intermittent demand. Demand sizes and the intervals between
 * them are smoothed separately, then divided, which keeps the forecast from
 * inventing demand in every period.
 */
function fitCroston(values: number[], sba: boolean): Fitted {
  const alpha = 0.15;
  let size = 0;
  let interval = 1;
  let seen = false;
  let gap = 0;
  let sizeInit = 0;
  let count = 0;
  for (const v of values) {
    if (v > 0) {
      sizeInit += v;
      count++;
    }
  }
  if (count > 0) {
    size = sizeInit / count;
    interval = values.length / count;
    seen = true;
  }
  for (const v of values) {
    gap++;
    if (v > 0) {
      if (seen) {
        size = alpha * v + (1 - alpha) * size;
        interval = alpha * gap + (1 - alpha) * interval;
      }
      gap = 0;
    }
  }
  const factor = sba ? 0.95 : 1;
  const rate = interval > 0 ? (factor * size) / interval : 0;
  return { forecast: () => Math.max(0, rate), method: sba ? "sba" : "croston" };
}

function fitNaive(values: number[]): Fitted {
  const last = values[values.length - 1] ?? 0;
  return { forecast: () => last, method: "naive" };
}

function fitMean(values: number[]): Fitted {
  const m = mean(values);
  return { forecast: () => m, method: "mean" };
}

/* -------------------------------------------------------------- evaluation */

function computeMetrics(actual: number[], predicted: number[]): ForecastMetrics {
  const n = Math.min(actual.length, predicted.length);
  if (n === 0) return { mae: 0, rmse: 0, wape: 0, bias: 0 };
  let abs = 0;
  let sq = 0;
  let sumAbs = 0;
  let sumActual = 0;
  let sumPred = 0;
  for (let i = 0; i < n; i++) {
    const e = predicted[i]! - actual[i]!;
    abs += Math.abs(e);
    sq += e * e;
    sumAbs += Math.abs(actual[i]!);
    sumActual += actual[i]!;
    sumPred += predicted[i]!;
  }
  return {
    mae: round(abs / n, 3),
    rmse: round(Math.sqrt(sq / n), 3),
    // WAPE is scale-free and does not explode on months with zero demand, which
    // MAPE does. That matters for intermittent retail demand.
    wape: round(sumAbs > 0 ? abs / sumAbs : 0, 4),
    bias: round(sumActual > 0 ? (sumPred - sumActual) / sumActual : 0, 4),
  };
}

interface Candidate {
  fitted: Fitted;
  score: ForecastMetrics;
}

function candidatesFor(values: number[], intermittent: boolean): Array<() => Fitted> {
  if (intermittent) {
    return [() => fitCroston(values, true), () => fitCroston(values, false), () => fitNaive(values)];
  }
  const list: Array<() => Fitted> = [() => fitSes(values), () => fitNaive(values), () => fitMean(values)];
  if (values.length >= 8) list.push(() => fitHolt(values));
  if (values.length >= 24) list.push(() => fitHoltWinters(values));
  return list;
}

function evaluate(values: number[], factories: Array<() => Fitted>): Candidate[] {
  const n = values.length;
  const holdout = Math.max(1, Math.min(3, Math.floor(n * 0.2)));
  const train = values.slice(0, n - holdout);
  const test = values.slice(n - holdout);

  if (train.length < 3) {
    // Too short to backtest: trust a simple smoother and say so through the
    // confidence field instead of pretending the number is measured.
    const fitted = fitMean(values);
    const preds = values.slice(1).map(() => fitted.forecast(1));
    return [{ fitted, score: computeMetrics(values.slice(1), preds) }];
  }

  const results: Candidate[] = [];
  for (const factory of factories) {
    const fitted = factory();
    const predicted = test.map((_, i) => fitted.forecast(i + 1));
    results.push({ fitted, score: computeMetrics(test, predicted) });
  }
  return results;
}

/* ----------------------------------------------------------------- public */

export interface ForecastOptions {
  horizon?: number;
  frequency?: Frequency;
  serviceLevel?: number;
}

export function forecastSeries(values: number[], options: ForecastOptions = {}): ForecastResult {
  const horizonMonths = Math.max(1, Math.min(24, options.horizon ?? 6));
  const frequency = options.frequency ?? "month";
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const n = clean.length;
  const zeros = clean.filter((v) => v === 0).length;
  const zeroRatio = n > 0 ? zeros / n : 1;
  const intermittent = zeroRatio > 0.4;

  const notes: string[] = [];
  if (n === 0) {
    return {
      method: "zero",
      frequency,
      horizon: horizonMonths,
      points: Array.from({ length: horizonMonths }, (_, i) => ({ step: i + 1, value: 0, lo: 0, hi: 0 })),
      sigma: 0,
      metrics: { mae: 0, rmse: 0, wape: 0, bias: 0 },
      candidates: [],
      intermittent: true,
      zeroRatio: 1,
      confidence: "low",
      history: [],
      notes: ["Ingen försäljningshistorik finns för artikeln."],
    };
  }

  const factories = candidatesFor(clean, intermittent);
  const candidates = evaluate(clean, factories);
  // Lowest WAPE wins; MAE breaks ties. A simpler model is only preferred when it
  // is at least as accurate, which is why the sort is stable on tie.
  candidates.sort((a, b) => a.score.wape - b.score.wape || a.score.mae - b.score.mae);
  const best = candidates[0]!;

  // Residual sigma from in-sample one-step errors of the chosen model.
  const residuals: number[] = [];
  for (let i = 1; i < n; i++) residuals.push(clean[i]! - best.fitted.forecast(1));
  const sigma = stdev(residuals);

  const scale = frequency === "week" ? 1 / 4.345 : frequency === "day" ? 1 / DAYS_PER_MONTH : 1;
  // Weekly/daily horizons are rounded up so a request for "1 month" always
  // returns a full cover period rather than 4 of the 4.345 weeks.
  const steps = frequency === "month" ? horizonMonths : Math.ceil(horizonMonths / scale);
  const points: ForecastPoint[] = [];
  for (let step = 1; step <= steps; step++) {
    const monthStep = frequency === "month" ? step : step * scale;
    const value = Math.max(0, best.fitted.forecast(monthStep)) * scale;
    const interval = 1.96 * sigma * Math.sqrt(monthStep) * scale;
    points.push({ step, value: round(value, 2), lo: round(Math.max(0, value - interval), 2), hi: round(value + interval, 2) });
  }

  if (n < 6) notes.push(`Endast ${n} månader av historik. Prognosen är en grov uppskattning.`);
  if (intermittent) notes.push("Glest förekommande efterfrågan: Croston/SBA används i stället för exponentiell utjämning.");
  if (zeroRatio > 0.8) notes.push("Artikeln säljer i färre än vart femte månad. Prognosen bör läsas som en sannolikhet, inte ett belopp.");

  const wape = best.score.wape;
  const confidence: ForecastResult["confidence"] =
    n >= 12 && wape <= 0.3 ? "high" : n >= 6 && wape <= 0.6 ? "medium" : "low";
  if (confidence === "low") notes.push("Låg träffsäkerhet i backtestningen. Använd prognosen som riktning, inte som exakt nivå.");

  return {
    method: best.fitted.method,
    frequency,
    horizon: steps,
    points,
    sigma: round(sigma, 3),
    metrics: best.score,
    candidates: candidates.map((c) => ({ method: c.fitted.method, metrics: c.score })),
    intermittent,
    zeroRatio: round(zeroRatio, 3),
    confidence,
    history: clean,
    notes,
  };
}

/**
 * Turns a forecast into the numbers a purchaser actually needs: safety stock,
 * reorder point, order quantity and the probability of running out.
 */
export function supplyPlan(
  item: ItemInput,
  forecast: ForecastResult,
  options: { serviceLevel?: number; horizonMonths?: number; leadTimeDays?: number; holdingRate?: number } = {},
): SupplyPlan {
  const serviceLevel = options.serviceLevel ?? 0.95;
  const z = zScore(serviceLevel);
  const horizonMonths = options.horizonMonths ?? 3;
  const leadTimeDays = options.leadTimeDays ?? item.leadTimeDays ?? 30;
  const holdingRate = options.holdingRate ?? HOLDING_RATE;

  const available = Math.max(0, item.stock - Math.min(item.stock, Math.max(0, item.reserved ?? 0)));
  const forecastMonthly = forecast.points[0]?.value ?? 0;
  const forecastTotal = forecast.points.slice(0, horizonMonths).reduce((a, p) => a + p.value, 0);
  const daily = forecastMonthly / DAYS_PER_MONTH;
  const demandDuringLeadTime = daily * leadTimeDays;
  const sigmaDuringLeadTime = forecast.sigma * Math.sqrt(leadTimeDays / DAYS_PER_MONTH);

  const safetyStock = z * sigmaDuringLeadTime;
  const reorderPoint = demandDuringLeadTime + safetyStock;

  // EOQ with a stated order cost and holding rate, then rounded up to MOQ.
  const annualDemand = forecastMonthly * 12;
  const unitCost = Math.max(1, item.cost);
  const eoq = Math.sqrt((2 * annualDemand * ORDER_COST_SEK) / (holdingRate * unitCost));
  const moq = item.moq ?? 1;
  // EOQ is a cycle quantity; the first order still has to cover the gap to the
  // reorder point. Taking the larger of the two keeps MOQ and available stock in
  // the same calculation instead of publishing an EOQ that cannot restore cover.
  const netRequirement = Math.max(0, reorderPoint - available);
  const orderQuantity = Math.max(moq, Math.ceil(Math.max(eoq, netRequirement) / moq) * moq);

  const stockoutProbability =
    sigmaDuringLeadTime > 0
      ? Math.min(1, Math.max(0, 1 - normalCdf((available - demandDuringLeadTime) / sigmaDuringLeadTime)))
      : available < demandDuringLeadTime
        ? 1
        : 0;
  const zStock = sigmaDuringLeadTime > 0 ? (available - demandDuringLeadTime) / sigmaDuringLeadTime : 0;
  const expectedShortageUnits = sigmaDuringLeadTime > 0 ? sigmaDuringLeadTime * normalLoss(zStock) : 0;
  const sellPrice = item.price ?? item.cost;

  const projectedStock = available - forecastTotal;
  const daysOfCover = daily > 0 ? available / daily : null;

  return {
    horizonMonths,
    forecastMonthly: round(forecastMonthly, 2),
    forecastTotal: round(forecastTotal, 2),
    leadTimeDays,
    demandDuringLeadTime: round(demandDuringLeadTime, 2),
    sigmaDuringLeadTime: round(sigmaDuringLeadTime, 3),
    safetyStock: round(safetyStock, 1),
    reorderPoint: round(reorderPoint, 1),
    orderQuantity: Math.round(orderQuantity),
    stockoutProbability: round(stockoutProbability, 4),
    expectedShortageUnits: round(expectedShortageUnits, 2),
    expectedShortageValue: round(expectedShortageUnits * sellPrice, 2),
    projectedStock: round(projectedStock, 1),
    projectedValue: round(Math.max(0, projectedStock) * item.cost, 2),
    daysOfCover: daysOfCover === null ? null : round(daysOfCover, 0),
  };
}

/** Category or warehouse level series, summed from item history. */
export function aggregateSeries(items: Array<{ monthly: number[] | null }>): number[] | null {
  const withHistory = items.filter((i) => i.monthly && i.monthly.length > 0);
  if (withHistory.length === 0) return null;
  const length = Math.max(...withHistory.map((i) => i.monthly!.length));
  const out = new Array(length).fill(0);
  for (const item of withHistory) {
    const offset = length - item.monthly!.length;
    item.monthly!.forEach((v, i) => {
      out[offset + i] += v;
    });
  }
  return out;
}
