/**
 * Writes controlled browser fixtures for the Live Warehouse FPS harness.
 * The files are temporary and live under public/world/.scale-bench only while
 * the benchmark runs. They contain synthetic data, never customer rows.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { analyze } from "../src/analysis.ts";
import { locateLiveArticle, liveClusterDetail } from "../src/ui/live-warehouse.ts";
import { buildAppWorld } from "../src/world.ts";
import { syntheticItems } from "./synthetic.ts";

const counts = process.argv.slice(2).map(Number).filter(Boolean);
const targets = counts.length ? counts : [500, 5_000, 10_000, 50_000, 100_000, 250_000, 500_000];
const dir = "public/world/.scale-bench";
mkdirSync(dir, { recursive: true });

const manifest: Array<{ count: number; mode: string; clusters: number; bytes: number }> = [];
for (const count of targets) {
  const result = analyze(syntheticItems(count), { months: 12 });
  const world = buildAppWorld(result.items, result.kpis, "sv");
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
    clusters: world.clusters,
    replenishment: world.replenishment,
    summary: world.summary,
    analysisId: `bench-${count}`,
  };
  const file = `${dir}/${count}.json`;
  writeFileSync(file, JSON.stringify(payload));

  let detail = null;
  if (world.mode === "hierarchical") {
    const target = result.items[Math.floor(result.items.length * 0.61)]!;
    const location = locateLiveArticle(result.items, target.sku, "sv");
    if (location?.clusterIndex != null) detail = liveClusterDetail(result.items, location.clusterIndex, "sv");
    if (detail) {
      writeFileSync(`${dir}/${count}-detail.json`, JSON.stringify(detail));
      writeFileSync(`${dir}/${count}-target.json`, JSON.stringify({ sku: target.sku, location }));
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  manifest.push({ count, mode: world.mode, clusters: world.clusters.length, bytes });
  console.log(`${count}: ${world.mode}, ${world.clusters.length} clusters, ${(bytes / 1024 / 1024).toFixed(2)} MB${detail ? ", detail ready" : ""}`);
}
writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest));
