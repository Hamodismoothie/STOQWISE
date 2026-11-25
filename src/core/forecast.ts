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
  | "tsb"
  | "adida"
  | "zero";

export type Frequency = "month" | "week" | "day";

export interface ForecastMetrics {
  mae: number;
  rmse: number;
  wape: number;
  /** Mean absolute percentage error. Null when any actual period is zero. */
  mape: number | null;
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
  /** Last holdout periods: actual outcomes vs the model's predictions. */
  backtest: { actual: number[]; predicted: number[] } | null;
  /** Number of non-finite values treated as zero. */
  missingCount: number;
  /** Extreme values capped for model fitting; the history itself is unchanged. */
  outlierCount: number;
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
  leadTimeSigmaDays: number;
  leadTimeVariabilityIncluded: boolean;
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
export const ORDER_COST_SEK = 350;
export const HOLDING_RATE = 0.22;

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
  /** One-step-ahead predictions for values[1..n-1], made before each outcome. */
  oneStep: number[];
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
  const oneStep: number[] = [];
  for (let i = 1; i < values.length; i++) {
    oneStep.push(level);
    level = best.alpha * values[i]! + (1 - best.alpha) * level;
  }
  return { forecast: () => level, oneStep, method: "ses" };
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
  const oneStep: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = level + trend;
    oneStep.push(prev);
    const newLevel = best.alpha * values[i]! + (1 - best.alpha) * prev;
    trend = best.beta * (newLevel - level) + (1 - best.beta) * trend;
    level = newLevel;
  }
  return { forecast: (step) => Math.max(0, level + trend * step), oneStep, method: "holt" };
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
  const oneStep: number[] = [];
  for (let i = 1; i < n; i++) {
    const s = seas[i % m]!;
    oneStep.push(level + trend + s);
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
    oneStep,
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
  const factor = sba ? 0.95 : 1;
  let size = 0;
  let interval = 1;
  let seen = false;
  let gap = 0;
  const oneStep: number[] = [];
  for (const [index, v] of values.entries()) {
    if (index > 0) oneStep.push(seen && interval > 0 ? Math.max(0, (factor * size) / interval) : 0);
    gap++;
    if (v > 0) {
      if (!seen) {
        // Start with the first observed demand size and inter-demand interval.
        // Initialising from the whole series would leak future observations into
        // the first forecast and understate the forecast error used for safety stock.
        size = v;
        interval = Math.max(1, gap);
        seen = true;
      } else {
        size = alpha * v + (1 - alpha) * size;
        interval = alpha * gap + (1 - alpha) * interval;
      }
      gap = 0;
    }
  }
  const rate = interval > 0 ? (factor * size) / interval : 0;
  return { forecast: () => Math.max(0, rate), oneStep, method: sba ? "sba" : "croston" };
}

/**
 * TSB (Teunter-Syntetos-Babai) models the probability of demand separately from
 * the size of a demand. Unlike Croston, the probability is updated in every
 * period, including zero-demand periods, so the model reacts when an item stops
 * selling. That matters for dead stock and for items whose demand is fading.
 *
 * p_t = alpha * d_t + (1 - alpha) * p_{t-1}, where d_t is 1 on a demand period
 * z_t = beta * y_t + (1 - beta) * z_{t-1}, updated only on demand periods
 * forecast = p_t * z_t
 */
function fitTsb(values: number[]): Fitted {
  // A small, stable parameter grid. A larger grid on 12–24 monthly points
  // mostly fits noise, and TSB is evaluated at several rolling origins.
  const grid = [0.1, 0.2, 0.3];
  let best = { alpha: 0.15, beta: 0.15, sse: Infinity };

  for (const alpha of grid) {
    for (const beta of grid) {
      let probability = values[0]! > 0 ? 1 : 0;
      let size = values[0]!;
      let seen = values[0]! > 0;
      let sse = 0;
      for (let i = 1; i < values.length; i++) {
        const predicted = probability * size;
        sse += (values[i]! - predicted) ** 2;
        if (values[i]! > 0) {
          // The first demand starts the size level at the observed value. The
          // same rule as Croston; smoothing from an artificial zero would make
          // the first forecast far too low.
          size = seen ? beta * values[i]! + (1 - beta) * size : values[i]!;
          seen = true;
          probability = alpha + (1 - alpha) * probability;
        } else {
          probability = (1 - alpha) * probability;
        }
      }
      if (sse < best.sse) best = { alpha, beta, sse };
    }
  }

  let probability = values[0]! > 0 ? 1 : 0;
  let size = values[0]!;
  let seen = values[0]! > 0;
  const oneStep: number[] = [];
  for (let i = 1; i < values.length; i++) {
    oneStep.push(probability * size);
    if (values[i]! > 0) {
      size = seen ? best.beta * values[i]! + (1 - best.beta) * size : values[i]!;
      seen = true;
      probability = best.alpha + (1 - best.alpha) * probability;
    } else {
      probability = (1 - best.alpha) * probability;
    }
  }
  return { forecast: () => Math.max(0, probability * size), oneStep, method: "tsb" };
}

/**
 * ADIDA (Aggregate-Disaggregate Intermittent Demand Approach) sums the series
 * into non-overlapping buckets whose average length is the average demand
 * interval, forecasts the buckets with SES and divides the result back to the
 * original period. Aggregation turns a sparse series into a denser one without
 * changing total demand.
 */
function fitAdida(values: number[]): Fitted {
  const n = values.length;
  const demandPeriods = values.filter((value) => value > 0).length;
  const bucketSize = Math.max(2, Math.min(12, Math.round(n / Math.max(1, demandPeriods))));
  const buckets: number[] = [];
  const bucketLengths: number[] = [];
  for (let start = 0; start < n; start += bucketSize) {
    const slice = values.slice(start, start + bucketSize);
    buckets.push(slice.reduce((sum, value) => sum + value, 0));
    bucketLengths.push(slice.length);
  }
  if (buckets.length < 2) return fitCroston(values, false);

  const aggregate = fitSes(buckets);
  const oneStep: number[] = [];
  for (let i = 1; i < n; i++) {
    const bucket = Math.floor(i / bucketSize);
    const previous = bucket > 0 ? aggregate.oneStep[bucket - 1] : undefined;
    oneStep.push(previous === undefined ? 0 : previous / bucketLengths[bucket]!);
  }
  return {
    // Future buckets are complete by definition; divide by the chosen bucket
    // size, not by a short final bucket in the history.
    forecast: () => Math.max(0, aggregate.forecast(1) / bucketSize),
    oneStep,
    method: "adida",
  };
}

function fitNaive(values: number[]): Fitted {
  const last = values[values.length - 1] ?? 0;
  return { forecast: () => last, oneStep: values.slice(0, -1), method: "naive" };
}

function fitMean(values: number[]): Fitted {
  const m = mean(values);
  const oneStep: number[] = [];
  let sum = values[0] ?? 0;
  for (let i = 1; i < values.length; i++) {
    oneStep.push(sum / i);
    sum += values[i]!;
  }
  return { forecast: () => m, oneStep, method: "mean" };
}

/* -------------------------------------------------------------- evaluation */

function computeMetrics(actual: number[], predicted: number[]): ForecastMetrics {
  const n = Math.min(actual.length, predicted.length);
  if (n === 0) return { mae: 0, rmse: 0, wape: 0, mape: null, bias: 0 };
  let abs = 0;
  let sq = 0;
  let sumAbs = 0;
  let sumActual = 0;
  let sumPred = 0;
  let mapeSum = 0;
  let mapeValid = true;
  for (let i = 0; i < n; i++) {
    const e = predicted[i]! - actual[i]!;
    abs += Math.abs(e);
    sq += e * e;
    sumAbs += Math.abs(actual[i]!);
    sumActual += actual[i]!;
    sumPred += predicted[i]!;
    if (actual[i]! === 0) mapeValid = false;
    else mapeSum += Math.abs(e / actual[i]!);
  }
  return {
    mae: round(abs / n, 3),
    rmse: round(Math.sqrt(sq / n), 3),
    // WAPE is scale-free and does not explode on months with zero demand, which
    // MAPE does. That matters for intermittent retail demand.
    wape: round(sumAbs > 0 ? abs / sumAbs : 0, 4),
    // MAPE is only meaningful when every actual period is non-zero. Returning
    // null is honest; substituting 0 or dropping the zero months would overstate
    // accuracy on exactly the series where it matters most.
    mape: mapeValid ? round(mapeSum / n, 4) : null,
    bias: round(sumActual > 0 ? (sumPred - sumActual) / sumActual : 0, 4),
  };
}

interface Candidate {
  fitted: Fitted;
  score: ForecastMetrics;
  /** Three-step holdout, used as a champion-challenger gate for model choice. */
  gate: ForecastMetrics;
  actual: number[];
  predicted: number[];
}

/**
 * Caps only truly extreme observations for model fitting. The displayed history
 * and the backtest actuals remain untouched, so a spike is still visible - it
 * just cannot dominate the fitted level. Uses the IQR rule with a wide fence.
 */
function winsorize(values: number[]): { values: number[]; outliers: number } {
  const positive = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (positive.length < 4) return { values: [...values], outliers: 0 };
  const q = (p: number) => positive[Math.min(positive.length - 1, Math.floor((positive.length - 1) * p))]!;
  const q1 = q(0.25);
  const q3 = q(0.75);
  const upper = Math.max(q3 + 3 * (q3 - q1), q3 * 2);
  if (!Number.isFinite(upper) || upper <= 0) return { values: [...values], outliers: 0 };
  let outliers = 0;
  const capped = values.map((v) => {
    if (v > upper) {
      outliers++;
      return upper;
    }
    return v;
  });
  return { values: capped, outliers };
}

type FittedFactory = (values: number[]) => Fitted;

function candidatesFor(intermittent: boolean, seriesLength: number): FittedFactory[] {
  if (intermittent) {
    // TSB reacts to fading demand, SBA corrects Croston's positive bias and
    // ADIDA aggregates sparse periods. The backtest decides between them.
    return [
      (series) => fitTsb(series),
      (series) => fitCroston(series, true),
      (series) => fitCroston(series, false),
      (series) => fitAdida(series),
      (series) => fitNaive(series),
    ];
  }
  const list: FittedFactory[] = [
    (series) => fitSes(series),
    (series) => fitNaive(series),
    (series) => fitMean(series),
  ];
  // The training window is shorter than the series. Only offer a model when
  // the backtest can fit it on that shorter window without silently falling
  // back to another method and reporting a misleading score.
  if (seriesLength >= 11) list.push((series) => fitHolt(series));
  if (seriesLength >= 27) list.push((series) => fitHoltWinters(series));
  return list;
}

function evaluate(values: number[], factories: FittedFactory[], actualValues: number[] = values): Candidate[] {
  const n = values.length;
  const holdout = Math.max(1, Math.min(3, Math.floor(n * 0.2)));
  const train = values.slice(0, n - holdout);
  const actual = actualValues.slice(n - holdout);

  if (train.length < 3) {
    // Too short to backtest: trust a simple smoother and say so through the
    // confidence field instead of pretending the number is measured.
    const fitted = fitMean(values);
    const actualShort = actualValues.slice(1);
    const preds = actualShort.map(() => fitted.forecast(1));
    const score = computeMetrics(actualShort, preds);
    return [{ fitted, score, gate: score, actual: actualShort, predicted: preds }];
  }

  const results: Candidate[] = [];
  for (const factory of factories) {
    // Score on rolling one-step forecasts: each prediction is made by a model
    // fitted only on periods before that outcome. This avoids both look-ahead
    // leakage and the bias that a single multi-step holdout gives to a flat
    // mean. The model used for the published forecast is fitted on all history.
    const predicted = actual.map((_, offset) => factory(values.slice(0, train.length + offset)).forecast(1));
    const fitted = factory(values);
    const gateStart = Math.max(1, n - 3);
    const gateActual = actualValues.slice(gateStart);
    const gateFitted = factory(values.slice(0, gateStart));
    const gatePredicted = gateActual.map((_, offset) => gateFitted.forecast(offset + 1));
    results.push({
      fitted,
      score: computeMetrics(actual, predicted),
      gate: computeMetrics(gateActual, gatePredicted),
      actual,
      predicted,
    });
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
  const missingCount = values.filter((v) => !Number.isFinite(v)).length;
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const n = clean.length;
  const robust = winsorize(clean);
  const modelValues = robust.values;
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
      metrics: { mae: 0, rmse: 0, wape: 0, mape: null, bias: 0 },
      candidates: [],
      backtest: null,
      missingCount,
      outlierCount: robust.outliers,
      intermittent: true,
      zeroRatio: 1,
      confidence: "low",
      history: [],
      notes: ["Ingen försäljningshistorik finns för artikeln."],
    };
  }

  const factories = candidatesFor(intermittent, modelValues.length);
  const candidates = evaluate(modelValues, factories, clean);
  // Lowest WAPE wins; MAE breaks ties. Within a small tolerance the simpler
  // model is preferred, because a tiny gain on a short history is usually noise.
  candidates.sort((a, b) => a.score.wape - b.score.wape || a.score.mae - b.score.mae);
  const mostAccurate = candidates[0]!;
  // A small accuracy gain does not justify a more complex model: on short
  // monthly histories that difference is mostly noise and often reverses out of
  // sample. Prefer the simplest model whose WAPE is within a small tolerance of
  // the best one. This is the same idea as a one-standard-error rule.
  const tolerance = Math.max(0.01, mostAccurate.score.wape * 0.1);
  const simplicity: Record<ForecastMethod, number> = {
    ses: 0,
    mean: 1,
    naive: 2,
    holt: 3,
    holt_winters: 4,
    croston: 5,
    sba: 6,
    adida: 7,
    tsb: 8,
    zero: 9,
  };
  let best = candidates
    .filter((candidate) => candidate.score.wape <= mostAccurate.score.wape + tolerance)
    .sort((a, b) => simplicity[a.fitted.method] - simplicity[b.fitted.method])[0]!;
  const sesCandidate = candidates.find((candidate) => candidate.fitted.method === "ses");
  // Champion-challenger gate: SES stays in place unless the challenger beats it
  // on a fixed three-step holdout. This protects the product from choosing a
  // model on a two-month quirk that does not survive a longer horizon.
  if (sesCandidate && best !== sesCandidate && best.gate.wape >= sesCandidate.gate.wape) {
    best = sesCandidate;
  }

  // Sigma is the standard deviation of genuine one-step-ahead forecast errors:
  // each prediction was made before its outcome was observed. Comparing the
  // whole history with the final fitted level (the previous implementation)
  // measures trend distance, not forecast error, and overstates safety stock on
  // trending series. See Modern logistik, kap. 11.6, for the forecast-error rule.
  const residuals = clean.slice(1).map((actual, i) => actual - (best.fitted.oneStep[i] ?? actual));
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

  if (missingCount > 0) notes.push(`${missingCount} saknade värden behandlades som noll i historiken.`);
  if (robust.outliers > 0) notes.push(`${robust.outliers} extremvärden kapades vid modellberäkningen men visas oförändrade i historiken.`);
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
    backtest: { actual: best.actual, predicted: best.predicted },
    missingCount,
    outlierCount: robust.outliers,
    intermittent,
    zeroRatio: round(zeroRatio, 3),
    confidence,
    history: clean,
    notes,
  };
}

/** Wilson formula. Returns the unrounded economic order quantity. */
export function economicOrderQuantity(annualDemand: number, orderCost: number, holdingRate: number, unitCost: number): number {
  if (!(annualDemand > 0) || !(orderCost > 0) || !(holdingRate > 0) || !(unitCost > 0)) return 0;
  return Math.sqrt((2 * annualDemand * orderCost) / (holdingRate * unitCost));
}

/**
 * Standard deviation of demand during lead time when both daily demand and lead
 * time can vary, assuming independent deviations:
 *
 *   sigma_DLT = sqrt((sigma_daily * LT)^2 + (dailyDemand * sigma_LT)^2)
 *
 * This is the SERV1 formulation in Modern logistik, kap. 11.6 (s. 293–295).
 * When lead-time sigma is zero the expression reduces to the common
 * demand-only formula. Both time arguments use days.
 */
export function sigmaDemandDuringLeadTime(
  monthlySigma: number,
  leadTimeDays: number,
  dailyDemand: number,
  leadTimeSigmaDays = 0,
): number {
  const demandSigma = Math.max(0, monthlySigma) * Math.sqrt(Math.max(0, leadTimeDays) / DAYS_PER_MONTH);
  const leadSigma = Math.max(0, dailyDemand) * Math.max(0, leadTimeSigmaDays);
  return Math.hypot(demandSigma, leadSigma);
}

/**
 * Turns a forecast into the numbers a purchaser actually needs: safety stock,
 * reorder point, order quantity and the probability of running out.
 */
export function supplyPlan(
  item: ItemInput,
  forecast: ForecastResult,
  options: {
    serviceLevel?: number;
    horizonMonths?: number;
    leadTimeDays?: number;
    leadTimeSigmaDays?: number;
    holdingRate?: number;
  } = {},
): SupplyPlan {
  const serviceLevel = options.serviceLevel ?? 0.95;
  const z = zScore(serviceLevel);
  const horizonMonths = options.horizonMonths ?? 3;
  const leadTimeDays = options.leadTimeDays ?? item.leadTimeDays ?? 30;
  const leadTimeSigmaDays = Math.max(0, options.leadTimeSigmaDays ?? item.leadTimeSigmaDays ?? 0);
  const holdingRate = options.holdingRate ?? HOLDING_RATE;

  const available = Math.max(0, item.stock - Math.min(item.stock, Math.max(0, item.reserved ?? 0)));
  const forecastMonthly = forecast.points[0]?.value ?? 0;
  const forecastTotal = forecast.points.slice(0, horizonMonths).reduce((a, p) => a + p.value, 0);
  const daily = forecastMonthly / DAYS_PER_MONTH;
  const demandDuringLeadTime = daily * leadTimeDays;
  const sigmaDuringLeadTime = sigmaDemandDuringLeadTime(forecast.sigma, leadTimeDays, daily, leadTimeSigmaDays);

  const safetyStock = z * sigmaDuringLeadTime;
  const reorderPoint = demandDuringLeadTime + safetyStock;

  // EOQ with a stated order cost and holding rate, then rounded up to MOQ.
  const annualDemand = forecastMonthly * 12;
  const unitCost = Math.max(1, item.cost);
  const eoq = economicOrderQuantity(annualDemand, ORDER_COST_SEK, holdingRate, unitCost);
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
    leadTimeSigmaDays: round(leadTimeSigmaDays, 2),
    leadTimeVariabilityIncluded: leadTimeSigmaDays > 0,
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
