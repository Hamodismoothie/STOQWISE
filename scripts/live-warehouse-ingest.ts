/**
 * Full 500,000-row import through the real pipeline into a throwaway SQLite
 * database. No customer data is read. The database is deleted after measuring.
 *
 * Run: bun scripts/live-warehouse-ingest.ts [count]
 */
import { mkdirSync, rmSync } from "node:fs";

const count = Number(process.argv[2] || 500_000);
const dir = "data/scale-ingest";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
process.env.DB_PATH = `${dir}/lagerradar.db`;

const { db, createUser } = await import("../src/db.ts");
const { createOrganization, queryItems } = await import("../src/data/repo.ts");
const { ingest } = await import("../src/pipeline.ts");
const { syntheticCsv, syntheticItems } = await import("./synthetic.ts");

const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;
const rss = () => mb(process.memoryUsage().rss);
const now = () => performance.now();

const user = createUser({
  email: `scale-${Date.now()}@example.test`,
  passwordHash: "not-used-by-this-benchmark",
  name: "Scale probe",
  company: "Synthetic",
});
const org = createOrganization({ name: `Scale ${Date.now()}`, userId: user.id, plan: "enterprise" });
const items = syntheticItems(count);
const csv = syntheticCsv(items);
const bytes = new TextEncoder().encode(csv);
const csvMB = mb(bytes.byteLength);
console.log(`Synthetic import: ${count.toLocaleString("sv-SE")} rows, ${csvMB} MB CSV, plan ${org.plan}`);

const start = now();
const outcome = await ingest({
  orgId: org.id,
  userId: user.id,
  bytes,
  filename: "synthetic-500k.csv",
  source: "benchmark",
});
const importMs = now() - start;
if (!outcome.ok) throw new Error(outcome.error);

const pageModelStart = now();
const { buildAppWorld } = await import("../src/world.ts");
const { locateLiveArticle } = await import("../src/ui/live-warehouse.ts");
const world = buildAppWorld(outcome.result.items, outcome.result.kpis, "sv");
const worldMs = now() - pageModelStart;

const searchStart = now();
const matches = outcome.result.items
  .filter((item) => `${item.sku} ${item.name} ${item.category ?? ""}`.toLocaleLowerCase("sv-SE").includes("sku-499999"))
  .sort((a, b) => b.value - a.value || a.sku.localeCompare(b.sku))
  .slice(0, 12);
const locations = matches.map((item) => locateLiveArticle(outcome.result.items, item.sku, "sv"));
const searchMs = now() - searchStart;
const total = queryItems(org.id, outcome.analysisId, { pageSize: 1 }).total;

const row = db
  .query("SELECT result_json FROM analyses WHERE id = $id")
  .get({ $id: outcome.analysisId }) as { result_json: string };
const resultJSONMB = mb(Buffer.byteLength(row.result_json));
const parseStart = now();
const parsed = JSON.parse(row.result_json) as { items: unknown[] };
const parseMs = now() - parseStart;
if (parsed.items.length !== count) throw new Error(`parsed ${parsed.items.length} items`);

const report = {
  generatedAt: new Date().toISOString(),
  count,
  csvMB,
  importMs: Math.round(importMs),
  importedItems: total,
  worldMode: world.mode,
  clusters: world.clusters.length,
  worldMs: Math.round(worldMs),
  searchMs: Math.round(searchMs),
  searchRows: matches.length,
  locatedRows: locations.filter(Boolean).length,
  resultJSONMB,
  resultParseMs: Math.round(parseMs),
  peakRssMB: rss(),
};
console.log(JSON.stringify(report, null, 2));
await Bun.write("reports/live-warehouse-ingest.json", JSON.stringify(report, null, 2));
db.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\nWrote reports/live-warehouse-ingest.json and removed ${dir}`);
