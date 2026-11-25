/**
 * Column detection.
 *
 * Goal: a user should be able to drop a file and see the mapping already
 * correct. Detection combines three weak signals that together are strong:
 *   1. exact alias match on the normalised header
 *   2. partial alias match (header contains alias)
 *   3. the shape of the data in the column (numeric, integer, month sequence)
 */
import { normalizeHeader, numericRatio, parseNumber } from "./csv.ts";

export type FieldKey =
  | "sku"
  | "name"
  | "category"
  | "subcategory"
  | "brand"
  | "unit"
  | "shelfLife"
  | "storage"
  | "supplier"
  | "stock"
  | "reserved"
  | "cost"
  | "price"
  | "leadTime"
  | "moq"
  | "totalSold"
  | "totalRevenue";

export const FIELD_LABELS: Record<FieldKey, string> = {
  sku: "Artikelnummer",
  name: "Benämning",
  category: "Kategori",
  subcategory: "Underkategori",
  brand: "Varumärke",
  unit: "Enhet",
  shelfLife: "Hållbarhet (dagar)",
  storage: "Förvaring",
  supplier: "Leverantör",
  stock: "Lagersaldo",
  reserved: "Reserverat",
  cost: "Inköpspris",
  price: "Försäljningspris",
  leadTime: "Ledtid (dagar)",
  moq: "Minsta orderkvantitet",
  totalSold: "Såld kvantitet (period)",
  totalRevenue: "Såld intäkt (period)",
};

const ALIASES: Record<FieldKey, string[]> = {
  sku: [
    "artikelnummer", "artikelnr", "art nr", "artnr", "artikel", "sku", "itemno",
    "item no", "item number", "itemcode", "item code", "produktnummer", "varunummer",
    "kod", "id", "product code", "productcode", "article number", "artikelkod", "no",
  ],
  name: [
    "benamning", "benamning artikel", "artikelnamn", "namn", "name", "beskrivning",
    "description", "produkt", "produktnamn", "product", "product name", "title",
    "varubenamning", "text",
  ],
  category: [
    "kategori", "varugrupp", "produktgrupp", "grupp", "category", "avdelning",
    "segment", "typ", "product category", "sortiment", "categories",
  ],
  subcategory: ["underkategori", "underkategorier", "subcategory", "sub category", "undergrupp"],
  brand: ["varumarke", "varumärke", "brand", "fabrikat", "marke", "märke"],
  unit: ["enhet", "enheter", "unit", "uom", "matt", "mått"],
  shelfLife: ["hallbarhet", "hallbarhet dagar", "hallbarhetstid", "shelf life", "shelf life days", "expiry days"],
  storage: ["forvaring", "förvaring", "lagring", "storage", "storage condition", "temperatur"],
  supplier: [
    "leverantor", "supplier", "vendor", "lev", "leverantor namn", "supplier name",
    "fabrikat", "brand", "marke",
  ],
  stock: [
    "saldo", "lagersaldo", "lager", "i lager", "lagerantal", "behallning",
    "antal i lager", "stock", "on hand", "onhand", "qty", "quantity", "inventory",
    "lagervarde antal", "fysiskt lager", "disponibelt", "disponibelt antal", "tillgangligt antal",
  ],
  reserved: [
    "reserverat", "reserverad", "reserverat antal", "reservationer",
    "reserved", "allocated", "allokerat", "bundet lager",
  ],
  cost: [
    "inkopspris", "inkops pris", "kostpris", "sjalvkostnad", "cost", "cost price",
    "unit cost", "inkopspris per st", "pris in", "gav", "gvk", "lagervarde pris",
    "kalkylkostnad", "inpris", "lagerpris", "senaste inkopspris", "kostnad",
  ],
  price: [
    "forsaljningspris", "utpris", "forsaljnings pris", "pris", "price",
    "sales price", "sell price", "listpris", "rekommenderat pris", "utpris inkl moms",
  ],
  leadTime: [
    "ledtid", "ledtid dagar", "lead time", "leadtime", "leveranstid",
    "leveranstid dagar", "delivery time", "genomloppstid",
  ],
  moq: [
    "moq", "minsta orderkvantitet", "min order", "minsta bestallning",
    "bestallningskvantitet", "min qty", "minimum order quantity", "min antal",
  ],
  totalSold: [
    "salt", "salda", "antal salda", "salda antal", "sald kvantitet", "sold",
    "units sold", "qty sold", "quantity sold", "totalt salt", "forsaljning antal",
    "forsaljning st", "antal sailda", "utlevererat antal", "volym",
    "omsatt antal", "omsatt kvantitet", "sales qty",
  ],
  totalRevenue: [
    "forsaljning", "omsattning", "forsaljning belopp", "forsaljning kr",
    "revenue", "sales", "sales value", "forsaljningsvarde", "omsattning kr",
    "nettoomsattning", "belopp",
  ],
};

/** Fields an import cannot work without. Identity may be `sku` or `name`. */
export const REQUIRED_HEADER_FIELDS: FieldKey[] = ["stock", "cost"];

export interface HeaderCheck {
  /** Required fields that no header matched. */
  missing: FieldKey[];
  /** Fields that were found, with the header that satisfied them. */
  matched: Array<{ field: FieldKey; header: string }>;
}

/**
 * The pre-upload check. It answers one question only: will the engine have a
 * stock and a cost column? It is advisory, never a gate, and it uses the same
 * aliases as the real mapping so the browser cannot promise more than the
 * server delivers.
 */
export function checkHeaders(headers: string[]): HeaderCheck {
  const fields: FieldKey[] = [...REQUIRED_HEADER_FIELDS, "sku", "name"];
  const pairs: Array<{ field: FieldKey; index: number; header: string; score: number }> = [];
  headers.forEach((header, index) => {
    for (const field of fields) {
      const score = matchScore(header, field);
      if (score > 0) pairs.push({ field, index, header, score });
    }
  });
  pairs.sort((a, b) => b.score - a.score || a.index - b.index);

  const taken = new Set<number>();
  const found = new Map<FieldKey, string>();
  for (const pair of pairs) {
    if (found.has(pair.field) || taken.has(pair.index) || pair.score < 0.6) continue;
    found.set(pair.field, pair.header);
    taken.add(pair.index);
  }

  const matched = [...found.entries()].map(([field, header]) => ({ field, header }));
  const missing = REQUIRED_HEADER_FIELDS.filter((field) => !found.has(field));
  if (!found.has("sku") && !found.has("name")) missing.push("sku");
  return { missing, matched };
}

/** Alias lists for the browser-side pre-check, so the rules keep one source. */
export function clientRules(): { required: Array<{ key: FieldKey; aliases: string[] }>; identity: string[] } {
  return {
    required: REQUIRED_HEADER_FIELDS.map((key) => ({ key, aliases: ALIASES[key] })),
    identity: [...ALIASES.sku, ...ALIASES.name],
  };
}

export interface MonthColumn {
  index: number;
  month: string; // YYYY-MM
  label: string;
}

export interface DetectedMapping {
  columns: Record<FieldKey, number | null>;
  monthColumns: MonthColumn[];
  demandMode: "wide" | "total" | "none";
  periodMonths: number;
  confidence: Record<FieldKey, number>;
  missingRequired: FieldKey[];
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dec: 12,
};

/** Returns YYYY-MM if the header looks like a month column, otherwise null. */
export function parseMonthHeader(header: string): string | null {
  const h = normalizeHeader(header);
  if (!h) return null;

  // 2024 01 | 2024-01 | 2024/1 | 202401
  let m = h.match(/^(\d{4})\s*(\d{1,2})$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
      return `${year}-${String(month).padStart(2, "0")}`;
    }
  }
  m = h.match(/^(\d{1,2})\s*(\d{4})$/);
  if (m) {
    const month = Number(m[1]);
    const year = Number(m[2]);
    if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
      return `${year}-${String(month).padStart(2, "0")}`;
    }
  }
  // jan 2024 | januari 2024 | 2024 jan
  m = h.match(/^([a-z]{3,10})\s*(\d{4})$/);
  if (m) {
    const key = m[1]!.slice(0, 3);
    const month = MONTH_NAMES[key];
    if (month) return `${m[2]}-${String(month).padStart(2, "0")}`;
  }
  m = h.match(/^(\d{4})\s*([a-z]{3,10})$/);
  if (m) {
    const key = m[2]!.slice(0, 3);
    const month = MONTH_NAMES[key];
    if (month) return `${m[1]}-${String(month).padStart(2, "0")}`;
  }
  return null;
}

function matchScore(header: string, field: FieldKey): number {
  const norm = normalizeHeader(header);
  if (!norm) return 0;
  const aliases = ALIASES[field];
  if (aliases.includes(norm)) return 1;
  for (const alias of aliases) {
    if (norm === alias) return 1;
    if (norm.startsWith(alias + " ") || norm.endsWith(" " + alias)) return 0.85;
    if (norm.includes(alias)) return 0.7;
    if (alias.length > 4 && alias.includes(norm)) return 0.6;
  }
  return 0;
}

export function detectMapping(headers: string[], rows: string[][]): DetectedMapping {
  const sample = rows.slice(0, 200);

  const monthColumns: MonthColumn[] = [];
  const monthIndexes = new Set<number>();
  headers.forEach((h, index) => {
    const month = parseMonthHeader(h);
    if (month) {
      monthColumns.push({ index, month, label: h });
      monthIndexes.add(index);
    }
  });
  monthColumns.sort((a, b) => a.month.localeCompare(b.month));

  const columns: Record<FieldKey, number | null> = {
    sku: null, name: null, category: null, subcategory: null, brand: null,
    unit: null, shelfLife: null, storage: null, supplier: null, stock: null, reserved: null,
    cost: null, price: null, leadTime: null, moq: null,
    totalSold: null, totalRevenue: null,
  };
  const confidence: Record<FieldKey, number> = {
    sku: 0, name: 0, category: 0, subcategory: 0, brand: 0, unit: 0,
    shelfLife: 0, storage: 0, supplier: 0, stock: 0, reserved: 0, cost: 0, price: 0,
    leadTime: 0, moq: 0, totalSold: 0, totalRevenue: 0,
  };

  const taken = new Set<number>(monthIndexes);
  const fields = Object.keys(columns) as FieldKey[];

  // Pass 1: score every (field, column) pair, then assign greedily by score.
  const candidates: Array<{ field: FieldKey; index: number; score: number }> = [];
  for (const field of fields) {
    headers.forEach((header, index) => {
      if (taken.has(index)) return;
      let score = matchScore(header, field);
      if (score === 0) return;

      const columnValues = sample.map((r) => r[index] ?? "");
      const ratio = numericRatio(columnValues);

      // Data-shape adjustments.
      if (["stock", "reserved", "shelfLife", "cost", "price", "leadTime", "moq", "totalSold", "totalRevenue"].includes(field)) {
        score *= 0.5 + ratio; // numeric columns are far more likely
      }
      if (field === "leadTime" && ratio > 0.8) {
        const ints = columnValues
          .map(parseNumber)
          .filter((v): v is number => v !== null && v >= 0 && v <= 365);
        if (ints.length > 0) score += 0.05;
      }

      candidates.push({ field, index, score });
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates) {
    if (columns[c.field] !== null) continue;
    if (taken.has(c.index)) continue;
    if (c.score < 0.35) continue;
    columns[c.field] = c.index;
    confidence[c.field] = Math.min(1, c.score);
    taken.add(c.index);
  }

  // Fallbacks that make a barely-labelled export usable.
  if (columns.sku === null) {
    // First text column that is unique per row is almost always the article id.
    for (let i = 0; i < headers.length; i++) {
      if (taken.has(i)) continue;
      const values = sample.map((r) => (r[i] ?? "").trim()).filter(Boolean);
      if (values.length >= Math.min(5, sample.length) && new Set(values).size === values.length) {
        columns.sku = i;
        confidence.sku = 0.4;
        taken.add(i);
        break;
      }
    }
  }
  if (columns.name === null) {
    for (let i = 0; i < headers.length; i++) {
      if (taken.has(i)) continue;
      const values = sample.map((r) => (r[i] ?? "").trim()).filter(Boolean);
      const avgLen = values.reduce((a, v) => a + v.length, 0) / Math.max(1, values.length);
      if (avgLen > 6 && numericRatio(values) < 0.3) {
        columns.name = i;
        confidence.name = 0.4;
        taken.add(i);
        break;
      }
    }
  }

  const demandMode: DetectedMapping["demandMode"] =
    monthColumns.length >= 2 ? "wide" : columns.totalSold !== null ? "total" : "none";

  const periodMonths =
    demandMode === "wide"
      ? monthColumns.length
      : 12; // documented default: a total column is assumed to cover 12 months

  const missingRequired: FieldKey[] = [];
  if (columns.stock === null) missingRequired.push("stock");
  if (columns.cost === null) missingRequired.push("cost");
  if (columns.sku === null && columns.name === null) missingRequired.push("sku");

  return {
    columns,
    monthColumns,
    demandMode,
    periodMonths,
    confidence,
    missingRequired,
  };
}
