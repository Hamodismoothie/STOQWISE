/**
 * Measures the complete server-side Live Warehouse page path on synthetic data:
 * analysis -> app world model -> rendered HTML payload.
 *
 * This complements live-warehouse-scale.ts (model/search timings) and
 * live-warehouse-browser.ts (rendering/FPS). No customer data is read.
 *
 * Run: bun scripts/live-warehouse-page.ts [count]
 */
import { analyze } from "../src/analysis.ts";
import { appWorldPage } from "../src/pages/world-app.ts";
import { buildAppWorld } from "../src/world.ts";
import { syntheticItems } from "./synthetic.ts";

const count = Math.max(1, Number(process.argv[2]) || 500_000);
const now = () => performance.now();
const ms = (value: number) => Math.round(value * 10) / 10;
const mb = (value: number) => Math.round((value / 1024 / 1024) * 10) / 10;

const allocationStart = now();
const items = syntheticItems(count);
const allocationMs = now() - allocationStart;
const allocationRss = process.memoryUsage().rss;

const analyzeStart = now();
const result = analyze(items, { months: 12 });
const analyzeMs = now() - analyzeStart;

const worldStart = now();
const model = buildAppWorld(result.items, result.kpis, "sv");
const worldMs = now() - worldStart;

const monthLabel = new Intl.DateTimeFormat("sv-SE", { month: "long" }).format(new Date(Date.UTC(2026, 11, 1)));
const renderStart = now();
const html = appWorldPage({
  locale: "sv",
  path: "/app/lagervarld",
  user: { id: "bench", name: "Benchmark", email: "bench@example.invalid" },
  org: { name: "Syntetiskt testlager", plan: "enterprise" },
  role: "owner",
  analysisId: "benchmark",
  monthLabel,
  months: result.dataQuality.months,
  items: result.items,
  kpis: result.kpis,
  model,
  categories: model.categories.map((entry) => entry.category),
  serviceLevel: result.settings.serviceLevel,
});
const renderMs = now() - renderStart;
const memory = process.memoryUsage();

const report = {
  generatedAt: new Date().toISOString(),
  articles: result.items.length,
  mode: model.mode,
  clusters: model.clusters.length,
  allocationMs: ms(allocationMs),
  analyzeMs: ms(analyzeMs),
  worldMs: ms(worldMs),
  renderMs: ms(renderMs),
  totalMs: ms(analyzeMs + worldMs + renderMs),
  htmlBytes: Buffer.byteLength(html),
  htmlMB: mb(Buffer.byteLength(html)),
  payloadMB: mb(Buffer.byteLength(JSON.stringify(model))),
  allocationRssMB: mb(allocationRss),
  heapUsedMB: mb(memory.heapUsed),
  rssMB: mb(memory.rss),
  uniqueClusterCategories: new Set(model.clusters.map((cluster) => cluster.categoryName)).size,
  clustersWithCategoryFilter: model.clusters.every((cluster) => Boolean(cluster.categoryName)),
  uniqueClusterXyzClasses: new Set(model.clusters.map((cluster) => cluster.xyz ?? "none")).size,
  clustersWithXyzFilter: model.clusters.every((cluster) => cluster.xyz === null || ["X", "Y", "Z"].includes(cluster.xyz)),
};

await Bun.write("reports/live-warehouse-page.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
