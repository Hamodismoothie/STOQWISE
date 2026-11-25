/**
 * Fixed-origin forecast benchmark.
 *
 * Every series is cut at the same point: the model sees all but the last three
 * months, then forecasts those three. This is deliberately stricter than the
 * engine's internal model-selection backtest, and it is the number used when
 * deciding whether a new model earns its place.
 *
 * Run with: bun run forecast:bench
 */
import { buildDemoDataset, type DemoEnvironmentId } from "../src/demo.ts";
import { forecastSeries } from "../src/core/forecast.ts";

const HORIZON = 3;
const ENVIRONMENTS: DemoEnvironmentId[] = ["industri", "livsmedel", "foodservice", "ecommerce"];

const wape = (actual: number[], predicted: number[]): { abs: number; total: number } => {
  let abs = 0;
  let total = 0;
  for (let i = 0; i < actual.length; i++) {
    abs += Math.abs((predicted[i] ?? 0) - actual[i]!);
    total += actual[i]!;
  }
  return { abs, total };
};

/** SES with alpha selected on the training window, the strongest simple baseline. */
function sesForecast(values: number[]): number {
  let best = { alpha: 0.3, sse: Infinity };
  for (let step = 5; step <= 95; step += 5) {
    const alpha = step / 100;
    let level = values[0] ?? 0;
    let sse = 0;
    for (let i = 1; i < values.length; i++) {
      sse += (values[i]! - level) ** 2;
      level = alpha * values[i]! + (1 - alpha) * level;
    }
    if (sse < best.sse) best = { alpha, sse };
  }
  let level = values[0] ?? 0;
  for (let i = 1; i < values.length; i++) level = best.alpha * values[i]! + (1 - best.alpha) * level;
  return Math.max(0, level);
}

interface Totals {
  items: number;
  abs: number;
  total: number;
  wins: number;
}

function empty(): Totals {
  return { items: 0, abs: 0, total: 0, wins: 0 };
}

const rows: Array<{ env: string; engine: Totals; ses: Totals; naive: Totals; ms: number }> = [];

for (const env of ENVIRONMENTS) {
  const dataset = buildDemoDataset(env, "sv");
  const engine = empty();
  const ses = empty();
  const naive = empty();
  const start = performance.now();
  for (const item of dataset.items) {
    const series = item.monthly ?? [];
    if (series.length < 8) continue;
    const train = series.slice(0, -HORIZON);
    const actual = series.slice(-HORIZON);
    if (actual.reduce((sum, value) => sum + value, 0) <= 0) continue;
    const forecast = forecastSeries(train, { horizon: HORIZON });
    const predicted = forecast.points.map((point) => point.value);
    const e = wape(actual, predicted);
    const s = wape(actual, Array(HORIZON).fill(sesForecast(train)));
    const n = wape(actual, Array(HORIZON).fill(train[train.length - 1] ?? 0));
    engine.items += 1;
    engine.abs += e.abs;
    engine.total += e.total;
    engine.wins += e.abs <= s.abs ? 1 : 0;
    ses.items += 1;
    ses.abs += s.abs;
    ses.total += s.total;
    naive.items += 1;
    naive.abs += n.abs;
    naive.total += n.total;
  }
  rows.push({ env, engine, ses, naive, ms: performance.now() - start });
}

const pct = (total: Totals): string => (total.total > 0 ? `${((total.abs / total.total) * 100).toFixed(1)} %` : "–");
console.log("STOQWISE – prognosbenchmark (3 månaders holdout)\n");
console.log("Miljö          Artiklar   Motor     SES      Naiv     Motor vinner mot SES   Tid");
for (const row of rows) {
  console.log(
    `${row.env.padEnd(14)} ${String(row.engine.items).padStart(7)}   ${pct(row.engine).padStart(6)}   ${pct(row.ses).padStart(6)}   ${pct(row.naive).padStart(6)}   ${String(row.engine.wins).padStart(17)}   ${row.ms.toFixed(0).padStart(3)} ms`,
  );
}
const combined = rows.reduce(
  (acc, row) => ({
    engine: { ...acc.engine, abs: acc.engine.abs + row.engine.abs, total: acc.engine.total + row.engine.total },
    ses: { ...acc.ses, abs: acc.ses.abs + row.ses.abs, total: acc.ses.total + row.ses.total },
  }),
  { engine: empty(), ses: empty() },
);
const improvement = combined.ses.abs > 0 ? (1 - combined.engine.abs / combined.ses.abs) * 100 : 0;
console.log(
  `\nSammanvägt WAPE: motor ${pct(combined.engine)}, SES ${pct(combined.ses)}. Förbättring mot SES: ${improvement.toFixed(1)} %.`,
);
