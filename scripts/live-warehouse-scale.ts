/**
 * Live Warehouse scale benchmark.
 *
 * Uses controlled synthetic rows only. Nothing here reads or writes customer
 * data. Every number printed is measured on the machine running the script.
 *
 * Run: bun scripts/live-warehouse-scale.ts [count ...]
 */
import { analyze } from "../src/analysis.ts";
import { TECHNICAL_ITEM_CAPACITY } from "../src/capacity.ts";
import { parseCsv } from "../src/csv.ts";
import { buildDataset, type ItemInput } from "../src/dataset.ts";
import { detectMapping } from "../src/mapping.ts";
import { locateLiveArticle, locateLiveArticles, liveClusterDetail } from "../src/ui/live-warehouse.ts";
import { appWorldTable } from "../src/pages/world-app.ts";
import { buildSimulationInput } from "../src/ui/live-simulation.ts";
import { buildAppWorld, simulatePortfolio } from "../src/world.ts";
import { syntheticCsv, syntheticItems } from "./synthetic.ts";

const COUNTS = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0);
const TARGETS = COUNTS.length ? COUNTS : [500, 5_000, 10_000, 50_000, 100_000, 250_000, 500_000];

const now = () => performance.now();
const ms = (value: number) => Math.round(value * 10) / 10;
const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))]!;
}

function rss() {
  return process.memoryUsage().rss;
}

type Result = {
  articles: number;
  csvMB: number;
  parseMs: number;
  validateMs: number;
  analysisMs: number;
  worldMs: number;
  payloadMB: number;
  worldMode: string;
  clusters: number;
  detailSlots: number;
  searchSamples: number;
  searchAllMs: number;
  batchSearchMs: number;
  searchMatches: number;
  searchMs: number;
  searchP95Ms: number;
  clusterDetailMs: number | null;
  filterMs: number;
  tableMs: number;
  tableTotal: number;
  simulationMs: number;
  simulationStatuses: number;
  simulationInputArticles: number;
  allocationRssMB: number;
  analysisRssMB: number;
  worldRssMB: number;
  peakRssMB: number;
  soak: { iterations: number; ms: number; rssStartMB: number; rssEndMB: number } | null;
};

function collect(count: number): Result {
  const allocationStart = now();
  const items = syntheticItems(count);
  const allocationMs = now() - allocationStart;
  const allocationRss = rss();
  const csv = syntheticCsv(items);
  const csvMB = mb(Buffer.byteLength(csv));

  const parseStart = now();
  const parsed = parseCsv(csv);
  const parseMs = now() - parseStart;
  const mapping = detectMapping(parsed.headers, parsed.rows);
  const validateStart = now();
  const dataset = buildDataset(parsed, mapping);
  if (dataset.errors.length) throw new Error(dataset.errors.join(" "));
  if (dataset.items.length !== count) throw new Error(`expected ${count} rows, got ${dataset.items.length}`);
  const validateMs = now() - validateStart;

  const analysisStart = now();
  const result = analyze(dataset.items, { months: mapping.periodMonths }, dataset.warnings);
  const analysisMs = now() - analysisStart;
  const analysisRss = rss();

  const worldStart = now();
  const world = buildAppWorld(result.items, result.kpis, "sv");
  const worldMs = now() - worldStart;
  const worldRss = rss();

  const payload = {
    mode: world.mode,
    limit: world.limit,
    technicalCapacity: world.technicalCapacity,
    locale: "sv",
    floor: world.floor,
    zones: world.zones,
    frames: world.frames,
    picks: world.picks,
    slots: world.slots,
    blocks: world.blocks,
    replenishment: world.replenishment,
    summary: world.summary,
    simulation: buildSimulationInput(world, result.items, "analysis"),
  };
  const payloadMB = mb(Buffer.byteLength(JSON.stringify(payload)));

  const sampleCount = Math.min(40, count);
  const samples = Array.from({ length: sampleCount }, (_, i) => result.items[Math.floor((i * 7919) % count)]!);
  const searchTimes: number[] = [];
  for (const sample of samples) {
    const start = now();
    const location = locateLiveArticle(result.items, sample.sku, "sv");
    if (!location) throw new Error(`missing location for ${sample.sku}`);
    searchTimes.push(now() - start);
  }
  const searchMs = searchTimes.reduce((sum, value) => sum + value, 0);
  const searchAllStart = now();
  const searchMatches = result.items
    .filter((item) => `${item.sku} ${item.name} ${item.category ?? ""}`.toLocaleLowerCase("sv-SE").includes("synthetic article 499"))
    .sort((a, b) => b.value - a.value || a.sku.localeCompare(b.sku))
    .slice(0, 12);
  const searchAllMs = now() - searchAllStart;
  const batchStart = now();
  const batchMatches = result.items
    .filter((item) => `${item.sku} ${item.name} ${item.category ?? ""}`.toLocaleLowerCase("sv-SE").includes("synthetic article 499"))
    .sort((a, b) => b.value - a.value || a.sku.localeCompare(b.sku))
    .slice(0, 12);
  const batchLocations = locateLiveArticles(result.items, batchMatches.map((item) => item.sku), "sv");
  if (batchLocations.size !== batchMatches.length) throw new Error("batch locations missing");
  const batchSearchMs = now() - batchStart;

  let clusterDetailMs: number | null = null;
  if (world.mode === "hierarchical") {
    const clusterStart = now();
    const sampleLocation = locateLiveArticle(result.items, samples[0]!.sku, "sv");
    if (sampleLocation?.clusterIndex != null) {
      const cluster = liveClusterDetail(result.items, sampleLocation.clusterIndex, "sv");
      if (!cluster || !cluster.slots.length) throw new Error("cluster detail unavailable");
    }
    clusterDetailMs = now() - clusterStart;
  }

  const filterStart = now();
  const filtered = result.items.filter(
    (item) => item.abc === "A" && item.stockoutRisk && item.category?.startsWith("Category 1"),
  );
  const filterMs = now() - filterStart;
  const tableCategory = result.items.find((item) => item.category)?.category;
  const tableStart = now();
  const table = appWorldTable({
    items: result.items,
    locale: "sv",
    analysisId: "benchmark",
    category: tableCategory ?? undefined,
    page: 2,
    sort: "value",
    dir: "desc",
  });
  const tableMs = now() - tableStart;

  const simulationStart = now();
  const simulation = simulatePortfolio(dataset.items, {
    months: mapping.periodMonths,
    serviceLevel: result.settings.serviceLevel,
  }, { demandPct: 10, leadDeltaDays: 3 }, "sv");
  const simulationMs = now() - simulationStart;
  const peakRss = rss();

  let soak: Result["soak"] = null;
  if (count >= 100_000) {
    const soakStart = now();
    const soakRssStart = rss();
    for (let i = 0; i < 80; i++) {
      const sample = result.items[(i * 104729) % count]!;
      if (!locateLiveArticle(result.items, sample.sku, "sv")) throw new Error("soak location missing");
    }
    soak = {
      iterations: 80,
      ms: ms(now() - soakStart),
      rssStartMB: mb(soakRssStart),
      rssEndMB: mb(rss()),
    };
  }

  void allocationMs;
  return {
    articles: count,
    csvMB,
    parseMs: ms(parseMs),
    validateMs: ms(validateMs),
    analysisMs: ms(analysisMs),
    worldMs: ms(worldMs),
    payloadMB,
    worldMode: world.mode,
    clusters: world.clusters.length,
    detailSlots: world.slots.length,
    searchSamples: sampleCount,
    searchAllMs: ms(searchAllMs),
    batchSearchMs: ms(batchSearchMs),
    searchMatches: searchMatches.length,
    searchMs: ms(searchMs),
    searchP95Ms: ms(percentile(searchTimes, 0.95)),
    clusterDetailMs: clusterDetailMs === null ? null : ms(clusterDetailMs),
    filterMs: ms(filterMs),
    tableMs: ms(tableMs),
    tableTotal: table.total,
    simulationMs: ms(simulationMs),
    simulationStatuses: Object.keys(simulation.statusBySku).length,
    simulationInputArticles: payload.simulation.articles.length,
    allocationRssMB: mb(allocationRss),
    analysisRssMB: mb(analysisRss),
    worldRssMB: mb(worldRss),
    peakRssMB: mb(peakRss),
    soak,
  };
}

console.log(`STOQWISE Live Warehouse scale probe · platform cap ${TECHNICAL_ITEM_CAPACITY.toLocaleString("sv-SE")}`);
console.log("Synthetic data only. Times are wall-clock milliseconds on this machine.\n");
const results: Result[] = [];
for (const count of TARGETS) {
  if (count > TECHNICAL_ITEM_CAPACITY) {
    console.error(`skip ${count}: above technical capacity`);
    continue;
  }
  const result = collect(count);
  results.push(result);
  const memory = result.soak ? ` · soak +${result.soak.rssEndMB - result.soak.rssStartMB} MB` : "";
  console.log(
    `${String(count).padStart(7)} · csv ${String(result.csvMB).padStart(5)} MB · parse ${String(result.parseMs).padStart(6)} · ` +
    `validate ${String(result.validateMs).padStart(6)} · analyze ${String(result.analysisMs).padStart(6)} · ` +
    `world ${String(result.worldMs).padStart(6)} · payload ${String(result.payloadMB).padStart(6)} MB · ` +
    `${result.worldMode}/${result.clusters} clusters · search p95 ${String(result.searchP95Ms).padStart(6)} · ` +
    `simulate ${String(result.simulationMs).padStart(6)} · peak ${String(result.peakRssMB).padStart(6)} MB${memory}`,
  );
  if (typeof Bun !== "undefined" && typeof Bun.gc === "function") Bun.gc(true);
}

await Bun.write("reports/live-warehouse-scale.json", JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
console.log("\nWrote reports/live-warehouse-scale.json");
