/**
 * Measures the real cost of one analysis, so the pricing and margin model rests
 * on numbers from this machine rather than on guesses.
 *
 * Run with: bun run bench
 */
import { parseCsv } from "../src/csv.ts";
import { EMAILS } from "../src/brand.ts";
import { detectMapping } from "../src/mapping.ts";
import { buildDataset, type ItemInput } from "../src/dataset.ts";
import { analyze } from "../src/analysis.ts";
import { buildTemplateNarrative } from "../src/insights.ts";
import { buildPdf } from "../src/pdf.ts";
import { buildDemoDataset, demoCsv } from "../src/demo.ts";
import { Database } from "bun:sqlite";
import { unlinkSync } from "node:fs";

function syntheticRows(count: number): ItemInput[] {
  const items: ItemInput[] = [];
  for (let i = 0; i < count; i++) {
    const base = 5 + ((i * 7) % 60);
    const monthly = Array.from({ length: 12 }, (_, m) => Math.max(0, Math.round(base * (0.6 + Math.random() * 0.8) - (m % 5 === 0 ? base : 0))));
    items.push({
      sku: `SKU-${i}`,
      name: `Artikel ${i} med normallång benämning`,
      category: "Kategori",
      supplier: "Leverantör AB",
      stock: Math.round(base * (1 + Math.random() * 6)),
      cost: 20 + (i % 400),
      price: 40 + (i % 700),
      leadTimeDays: 30,
      moq: 10,
      monthly,
      totalSold: monthly.reduce((a, b) => a + b, 0),
      totalRevenue: null,
    });
  }
  return items;
}

function time(label: string, fn: () => unknown): number {
  const start = performance.now();
  fn();
  const ms = performance.now() - start;
  console.log(`${label.padEnd(46)} ${ms.toFixed(1).padStart(8)} ms`);
  return ms;
}

async function main() {
  console.log("Lagerradar – prestandamätning");
  console.log("=".repeat(64));

  const demo = buildDemoDataset();
  const csv = demoCsv(demo);
  console.log(`CSV-underlag: ${demo.items.length} artiklar, ${(csv.length / 1024).toFixed(0)} kB\n`);

  let parsed = parseCsv(csv);
  let mapping = detectMapping(parsed.headers, parsed.rows);
  let total = 0;

  total += time("1. Tolkning av CSV", () => {
    parsed = parseCsv(csv);
  });
  total += time("2. Kolumnigenkänning", () => {
    mapping = detectMapping(parsed.headers, parsed.rows);
  });
  let dataset = buildDataset(parsed, mapping);
  total += time("3. Validering och typning", () => {
    dataset = buildDataset(parsed, mapping);
  });
  let result = analyze(dataset.items, { months: mapping.periodMonths }, dataset.warnings);
  total += time("4. Analys (380 artiklar)", () => {
    result = analyze(dataset.items, { months: mapping.periodMonths }, dataset.warnings);
  });
  const narrative = buildTemplateNarrative(result, { company: demo.company, filename: "demo.csv" });
  total += time("5. Rapporttext (deterministisk mall)", () => {
    buildTemplateNarrative(result, { company: demo.company, filename: "demo.csv" });
  });
  const pdf = await buildPdf(result, narrative, {
    company: demo.company,
    filename: "demo.csv",
    generatedAt: new Date().toISOString(),
    contactEmail: EMAILS.hello ?? undefined,
  });
  console.log(`${"6. PDF-generering (8 sidor)".padEnd(46)} ${"".padStart(8)} ${(pdf.length / 1024).toFixed(0)} kB`);
  console.log("-".repeat(64));
  console.log(`${"Summa per analys (utan PDF)".padEnd(46)} ${total.toFixed(1).padStart(8)} ms`);

  console.log("\nSkalningstest:");
  for (const count of [5_000, 20_000, 50_000]) {
    const items = syntheticRows(count);
    const start = performance.now();
    const r = analyze(items, { months: 12 });
    const ms = performance.now() - start;
    console.log(
      `${count.toLocaleString("sv-SE")} artiklar`.padEnd(46) +
        `${ms.toFixed(0).padStart(8)} ms   (${r.kpis.skuCount} rader, ${(r.kpis.inventoryValue / 1e6).toFixed(1)} Mkr)`,
    );
  }

  const mem = process.memoryUsage();
  console.log(`\nMinnesbruk: RSS ${(mem.rss / 1024 / 1024).toFixed(0)} MB, heap ${(mem.heapUsed / 1024 / 1024).toFixed(0)} MB`);

  // What one stored analysis costs on disk.
  const db = new Database("data/bench.db", { create: true });
  db.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, payload TEXT)");
  db.query("INSERT INTO t (payload) VALUES (?)").run(JSON.stringify(result));
  const size = db.query("SELECT SUM(LENGTH(payload)) AS s FROM t").get() as { s: number };
  console.log(`Lagringsstorlek per analys: ${(size.s / 1024).toFixed(0)} kB JSON`);
  db.close();
  try {
    unlinkSync("data/bench.db");
  } catch {
    /* ignore */
  }
}

await main();
