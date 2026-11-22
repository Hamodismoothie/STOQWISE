/**
 * CSV parsing written for the files that Swedish POS/ERP systems actually
 * export: semicolon separated, decimal commas, BOM, CRLF, quoted fields and
 * thousands separators with spaces.
 *
 * No dependency, because the parsing rules here are the product's problem
 * domain - not something to outsource to a generic library.
 */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
  warnings: string[];
}

const DELIMITERS = [";", ",", "\t", "|"] as const;

/** Picks the delimiter that produces the most consistent column count. */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).filter((l) => l.trim().length > 0);
  let best = ";";
  let bestScore = -1;

  for (const d of DELIMITERS) {
    const counts = sample.map((line) => countOutsideQuotes(line, d));
    if (counts.length === 0) continue;
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    const consistent = counts.filter((c) => c === first).length / counts.length;
    const score = consistent * 100 + first;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delimiter) count++;
  }
  return count;
}

export function parseCsv(input: string, forcedDelimiter?: string): ParsedCsv {
  const warnings: string[] = [];
  let text = input.replace(/^\uFEFF/, "");
  if (text.includes("\u0000")) {
    text = text.replace(/\u0000/g, "");
    warnings.push("Filen innehöll null-tecken som rensades bort.");
  }

  const delimiter = forcedDelimiter ?? detectDelimiter(text);
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }
  // Last field / row if the file does not end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  const cleaned = records.filter((r) => r.some((c) => c.trim() !== ""));
  if (cleaned.length === 0) {
    return { headers: [], rows: [], delimiter, warnings: ["Filen innehåller inga rader."] };
  }

  const headers = cleaned[0]!.map((h, idx) => {
    const clean = h.trim().replace(/^"|"$/g, "");
    return clean === "" ? `Kolumn ${idx + 1}` : clean;
  });
  const rows = cleaned.slice(1);

  // Compare against the header width, not only against other rows: a single
  // short row in an otherwise perfect file is exactly the case that breaks the
  // importer quietly.
  const mismatched = rows.filter((r) => r.length !== headers.length).length;
  if (mismatched > 0) {
    const variants = [...new Set(rows.map((r) => r.length))].sort((a, b) => a - b);
    warnings.push(
      `${mismatched} rader hade ett annat antal kolumner än rubrikraden (${variants.join(", ")} mot ${headers.length}). Korta rader fylldes ut med tomma värden.`,
    );
    for (const r of rows) {
      while (r.length < headers.length) r.push("");
      if (r.length > headers.length) r.length = headers.length;
    }
  }

  return { headers, rows, delimiter, warnings };
}

/**
 * Parses a number from the messy strings spreadsheets produce.
 * Handles: "1 234,56", "1,234.56", "1.234,56", "12,5", "-45", "(45)", "45 kr",
 * "12 %", non-breaking spaces and stray quotes.
 */
export function parseNumber(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim();
  if (s === "" || s === "-" || s === "–") return null;

  s = s.replace(/[\u00A0\u202F\u2007]/g, " ");
  s = s.replace(/[^\d.,()\-+]/g, "").trim();
  if (s === "" || s === "-" || s === "+") return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  s = s.replace(/^\+/, "").replace(/\s/g, "");
  if (s === "") return null;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    const parts = s.split(",");
    if (parts.length > 2) {
      s = parts.join("");
    } else if (/^\d{1,3}$/.test(parts[1] ?? "") && parts[1]!.length === 3 && /^\d{1,3}$/.test(parts[0] ?? "")) {
      // "1,234" is almost always a thousands separator in Swedish exports.
      s = parts.join("");
    } else {
      s = s.replace(",", ".");
    }
  } else if (hasDot) {
    const parts = s.split(".");
    if (parts.length > 2) {
      s = parts.join("");
    } else if (
      parts.length === 2 &&
      (parts[1] ?? "").length === 3 &&
      /^\d{1,3}$/.test(parts[0] ?? "")
    ) {
      s = parts.join("");
    }
  }

  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** True when a column's non-empty values look numeric for the most part. */
export function numericRatio(values: string[]): number {
  const nonEmpty = values.filter((v) => v.trim() !== "");
  if (nonEmpty.length === 0) return 0;
  const numeric = nonEmpty.filter((v) => parseNumber(v) !== null).length;
  return numeric / nonEmpty.length;
}

/** Normalises a header for matching: lowercase, no diacritics, no punctuation. */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
