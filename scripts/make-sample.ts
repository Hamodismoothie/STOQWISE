/**
 * Generates the public sample artefacts:
 *   samples/exempel-lagerdata.csv  - synthetic export that anyone can try
 *   samples/exempelrapport.pdf     - the report a prospect receives
 *
 * Run with: bun run sample
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { EMAILS } from "../src/brand.ts";
import { join } from "node:path";
import { buildDemoDataset, demoCsv } from "../src/demo.ts";
import { analyze } from "../src/analysis.ts";
import { buildTemplateNarrative } from "../src/insights.ts";
import { buildPdf } from "../src/pdf.ts";
import { parseCsv } from "../src/csv.ts";
import { detectMapping } from "../src/mapping.ts";
import { buildDataset } from "../src/dataset.ts";

const root = join(import.meta.dir, "..");
const samples = join(root, "samples");
mkdirSync(samples, { recursive: true });

const dataset = buildDemoDataset("industri");
const csv = demoCsv(dataset);
writeFileSync(join(samples, "exempel-lagerdata.csv"), csv, "utf8");
for (const id of ["industri", "hem", "foodservice", "ecommerce"] as const) {
  const env = buildDemoDataset(id);
  writeFileSync(join(samples, `exempel-${id}.csv`), demoCsv(env), "utf8");
}
console.log(`CSV: ${(csv.length / 1024).toFixed(0)} kB, ${dataset.items.length} artiklar`);

// Round-trip through the real import path, so the sample proves the parser works.
const parsed = parseCsv(csv);
const mapping = detectMapping(parsed.headers, parsed.rows);
const ds = buildDataset(parsed, mapping);
const result = analyze(ds.items, { months: mapping.periodMonths }, ds.warnings);

console.log(
  `Analys: lagervärde ${Math.round(result.kpis.inventoryValue)} kr, inaktivt lager ${Math.round(
    result.kpis.deadStockValue,
  )} kr, ${result.kpis.deadStockCount} artiklar`,
);

const narrative = buildTemplateNarrative(result, {
  company: dataset.company,
  filename: "exempel-industri.csv",
});

const pdf = await buildPdf(result, narrative, {
  company: dataset.company,
  orgNumber: dataset.orgNumber,
  filename: "exempel-industri.csv",
  generatedAt: new Date().toISOString(),
  contactEmail: EMAILS.hello ?? undefined,
});

writeFileSync(join(samples, "exempelrapport.pdf"), pdf);
console.log(`PDF: ${(pdf.length / 1024).toFixed(0)} kB -> samples/exempelrapport.pdf`);
