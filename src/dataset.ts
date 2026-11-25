/**
 * Turns raw CSV cells into a typed, validated dataset.
 *
 * Everything that can be wrong with a real export is handled here and reported
 * as a warning or an error, so that the analysis engine can assume clean input.
 */
import type { ParsedCsv } from "./csv.ts";
import { parseNumber } from "./csv.ts";
import type { DetectedMapping } from "./mapping.ts";

export interface ItemInput {
  sku: string;
  name: string;
  category: string | null;
  subcategory?: string | null;
  brand?: string | null;
  unit?: string | null;
  /** Typical shelf life from production, in days. Only present for perishable ranges. */
  shelfLifeDays?: number | null;
  /** Storage condition as printed on the item record. */
  storage?: string | null;
  supplier: string | null;
  stock: number;
  /** Units allocated to open orders. Only present when the source exposes it. */
  reserved?: number;
  cost: number;
  price: number | null;
  leadTimeDays: number | null;
  /** Standard deviation of supplier lead time, in days, when the source provides it. */
  leadTimeSigmaDays?: number | null;
  moq: number | null;
  /** Monthly sold quantity, oldest to newest. Null when only a total is available. */
  monthly: number[] | null;
  totalSold: number;
  totalRevenue: number | null;
}

export interface DatasetStats {
  rowsRead: number;
  itemsImported: number;
  rowsSkipped: number;
  duplicatesMerged: number;
  negativeStock: number;
  zeroCost: number;
  missingPrice: number;
  missingLeadTime: number;
}

export interface DatasetResult {
  items: ItemInput[];
  warnings: string[];
  errors: string[];
  stats: DatasetStats;
}

const MAX_WARNINGS = 12;

export function buildDataset(parsed: ParsedCsv, mapping: DetectedMapping): DatasetResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const stats: DatasetStats = {
    rowsRead: parsed.rows.length,
    itemsImported: 0,
    rowsSkipped: 0,
    duplicatesMerged: 0,
    negativeStock: 0,
    zeroCost: 0,
    missingPrice: 0,
    missingLeadTime: 0,
  };

  const col = mapping.columns;
  if (col.stock === null) errors.push("Kunde inte hitta någon kolumn för lagersaldo.");
  if (col.cost === null) errors.push("Kunde inte hitta någon kolumn för inköpspris.");
  if (mapping.demandMode === "none") {
    errors.push(
      "Kunde inte hitta försäljningshistorik. Lägg till antingen månadskolumner (t.ex. 2024-01) eller en kolumn med såld kvantitet.",
    );
  }
  if (errors.length > 0) return { items: [], warnings, errors, stats };

  const bySku = new Map<string, ItemInput>();
  let skippedExamples: string[] = [];

  parsed.rows.forEach((row, rowIndex) => {
    const cell = (index: number | null): string =>
      index === null ? "" : (row[index] ?? "").trim();

    const sku = cell(col.sku) || cell(col.name);
    const name = cell(col.name) || sku;
    if (!sku && !name) {
      stats.rowsSkipped++;
      return;
    }

    const stockRaw = parseNumber(cell(col.stock));
    const costRaw = parseNumber(cell(col.cost));
    if (stockRaw === null || costRaw === null) {
      stats.rowsSkipped++;
      if (skippedExamples.length < 3) {
        skippedExamples.push(
          `rad ${rowIndex + 2} (${name || sku}): saldo "${cell(col.stock)}", pris "${cell(col.cost)}"`,
        );
      }
      return;
    }

    let stock = stockRaw;
    if (stock < 0) {
      stats.negativeStock++;
      stock = 0;
    }
    let cost = costRaw;
    if (cost <= 0) {
      stats.zeroCost++;
      cost = Math.max(0, cost);
    }

    const shelfRaw = parseNumber(cell(col.shelfLife));
    const shelfLifeDays = shelfRaw !== null && shelfRaw > 0 ? shelfRaw : null;

    const reservedRaw = parseNumber(cell(col.reserved));
    const reserved = reservedRaw !== null && reservedRaw > 0 ? Math.min(stock, reservedRaw) : 0;

    const price = parseNumber(cell(col.price));
    if (price === null || price <= 0) stats.missingPrice++;

    const leadTimeRaw = parseNumber(cell(col.leadTime));
    const leadTimeDays =
      leadTimeRaw !== null && leadTimeRaw > 0 && leadTimeRaw <= 365 ? leadTimeRaw : null;
    if (leadTimeDays === null) stats.missingLeadTime++;

    const moqRaw = parseNumber(cell(col.moq));
    const moq = moqRaw !== null && moqRaw > 0 ? moqRaw : null;

    let monthly: number[] | null = null;
    let totalSold = 0;
    if (mapping.demandMode === "wide") {
      monthly = mapping.monthColumns.map((m) => {
        const v = parseNumber(cell(m.index));
        return v === null || v < 0 ? 0 : v;
      });
      totalSold = monthly.reduce((a, b) => a + b, 0);
    } else {
      const sold = parseNumber(cell(col.totalSold));
      totalSold = sold === null || sold < 0 ? 0 : sold;
    }

    const revenueRaw = parseNumber(cell(col.totalRevenue));
    const revenue =
      revenueRaw !== null && revenueRaw > 0
        ? revenueRaw
        : price !== null && price > 0
          ? totalSold * price
          : null;

    const item: ItemInput = {
      sku: sku || name,
      name: name || sku,
      category: cell(col.category) || null,
      subcategory: cell(col.subcategory) || null,
      brand: cell(col.brand) || null,
      unit: cell(col.unit) || null,
      shelfLifeDays,
      storage: cell(col.storage) || null,
      supplier: cell(col.supplier) || null,
      stock,
      reserved,
      cost,
      price: price !== null && price > 0 ? price : null,
      leadTimeDays,
      moq,
      monthly,
      totalSold,
      totalRevenue: revenue,
    };

    const existing = bySku.get(item.sku);
    if (existing) {
      // Same article twice (common when a file contains several warehouses).
      existing.stock += item.stock;
      existing.reserved = (existing.reserved ?? 0) + (item.reserved ?? 0);
      existing.totalSold += item.totalSold;
      if (existing.monthly && item.monthly) {
        existing.monthly = existing.monthly.map((v, i) => v + (item.monthly![i] ?? 0));
      }
      if (existing.totalRevenue !== null && item.totalRevenue !== null) {
        existing.totalRevenue += item.totalRevenue;
      }
      stats.duplicatesMerged++;
    } else {
      bySku.set(item.sku, item);
    }
  });

  stats.itemsImported = bySku.size;

  if (skippedExamples.length > 0) {
    warnings.push(
      `${stats.rowsSkipped} rader hoppades över eftersom saldo eller inköpspris saknades eller inte var ett tal. Exempel: ${skippedExamples.join("; ")}.`,
    );
  }
  if (stats.duplicatesMerged > 0) {
    warnings.push(
      `${stats.duplicatesMerged} dubbletter på artikelnummer slogs ihop (saldo och försäljning summerades).`,
    );
  }
  if (stats.negativeStock > 0) {
    warnings.push(
      `${stats.negativeStock} artiklar hade negativt saldo och sattes till 0. Kontrollera om det beror på ej registrerade inleveranser.`,
    );
  }
  if (stats.zeroCost > 0) {
    warnings.push(
      `${stats.zeroCost} artiklar saknar inköpspris. Deras lagervärde räknas som 0, vilket underskattar det bundna kapitalet.`,
    );
  }
  if (stats.missingPrice > 0) {
    warnings.push(
      `${stats.missingPrice} artiklar saknar försäljningspris. ABC-analysen använder då inköpspris i stället, vilket ger samma rangordning men lägre belopp.`,
    );
  }
  if (mapping.demandMode === "wide" && mapping.periodMonths < 6) {
    warnings.push(
      `Endast ${mapping.periodMonths} månader av försäljningshistorik hittades. XYZ-analys kräver minst 6 månader och hoppas över.`,
    );
  }
  if (mapping.demandMode === "total") {
    warnings.push(
      "Ingen månadsuppdelad historik hittades. Säsong och variation kan inte beräknas, så XYZ-analysen hoppas över. Inaktivt lager bedöms på hela perioden.",
    );
  }
  for (const w of parsed.warnings) warnings.push(w);

  return { items: [...bySku.values()], warnings: warnings.slice(0, MAX_WARNINGS), errors, stats };
}
