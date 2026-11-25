/**
 * Purchase-order file.
 *
 * The procurement view is a decision surface; this module turns it into the
 * artefact a buyer actually sends: one file, grouped by supplier, with the
 * quantity to order, the MOQ it was rounded to and the reorder point it
 * restores. The file and the page read the same `ProcurementView`, so a number
 * can never differ between what was reviewed and what was sent.
 *
 * No prices, addresses or supplier contacts are invented. The file carries only
 * what the analysis knows, and the page states the assumptions.
 */
import { csvCell } from "./csv.ts";
import type { Locale } from "./i18n.ts";
import { appText } from "./i18n-app.ts";
import type { ProcurementPriority, ProcurementSuggestion, ProcurementView } from "./pages/procurement.ts";
import { writeXlsx, type CellValue } from "./xlsx.ts";

const PRIORITY_RANK: Record<ProcurementPriority, number> = { critical: 0, high: 1, planned: 2 };
const PRIORITY_LABEL: Record<ProcurementPriority, string> = {
  critical: "Kritisk",
  high: "Hög",
  planned: "Planerad",
};

export interface OrderGroup {
  /** Supplier as it appears in the export; null when the rows have no supplier. */
  supplier: string | null;
  suggestions: ProcurementSuggestion[];
  orderValue: number;
}

export interface OrderColumn {
  header: string;
  width: number;
}

/**
 * Rounds exactly as the page displays a number (`appNum` with zero decimals),
 * including halves away from zero, so the file can never show 146,6 where the
 * screen says 147.
 */
function screenWhole(value: number): number {
  return Number.isFinite(value) ? Math.sign(value) * Math.round(Math.abs(value)) : 0;
}

/**
 * A number as it belongs in the CSV: no group separators, and the locale's
 * decimal comma, so a Swedish Excel opens the cell as a number instead of text.
 * Whole numbers are unaffected, which is what every column produces today.
 */
export function csvNumber(value: number, locale: Locale): string {
  return locale === "sv" ? String(value).replace(".", ",") : String(value);
}

function compareSuggestions(a: ProcurementSuggestion, b: ProcurementSuggestion): number {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    b.orderValue - a.orderValue ||
    a.sku.localeCompare(b.sku, "sv")
  );
}

/**
 * Suggestions grouped by supplier: alphabetically by name, rows without a
 * supplier last, and the most urgent article first inside each group. The page
 * renders these same groups, so the screen and the file are ordered alike.
 */
export function orderGroups(view: ProcurementView): OrderGroup[] {
  const groups = new Map<string, ProcurementSuggestion[]>();
  for (const suggestion of view.suggestions) {
    const key = suggestion.supplier?.trim() ?? "";
    const list = groups.get(key);
    if (list) list.push(suggestion);
    else groups.set(key, [suggestion]);
  }
  return [...groups]
    .map<OrderGroup>(([supplier, list]) => ({
      supplier: supplier || null,
      suggestions: [...list].sort(compareSuggestions),
      orderValue: list.reduce((sum, suggestion) => sum + suggestion.orderValue, 0),
    }))
    .sort((a, b) =>
      a.supplier === null || b.supplier === null
        ? (a.supplier === null ? 1 : 0) - (b.supplier === null ? 1 : 0)
        : a.supplier.localeCompare(b.supplier, "sv"),
    );
}

export function orderColumns(locale: Locale): OrderColumn[] {
  return [
    { header: appText(locale, "Leverantör"), width: 24 },
    { header: appText(locale, "Artikelnummer"), width: 16 },
    { header: appText(locale, "Benämning"), width: 38 },
    { header: appText(locale, "Att beställa"), width: 12 },
    { header: "MOQ", width: 8 },
    { header: appText(locale, "Beställningspunkt"), width: 16 },
    { header: appText(locale, "Saldo"), width: 9 },
    { header: appText(locale, "Tillgängligt"), width: 12 },
    { header: appText(locale, "Säkerhetslager"), width: 15 },
    { header: appText(locale, "Ledtid (dagar)"), width: 13 },
    { header: appText(locale, "Förväntad efterfrågan"), width: 19 },
    { header: appText(locale, "Efter leverans"), width: 14 },
    { header: appText(locale, "Inköpsvärde"), width: 13 },
    { header: appText(locale, "Prioritet"), width: 11 },
  ];
}

/** One array per suggestion, in the column order above. Every number is rounded
 * with the same rule the page uses, so screen and file agree to the digit. */
function orderRows(view: ProcurementView, locale: Locale): CellValue[][] {
  return orderGroups(view).flatMap((group) =>
    group.suggestions.map((suggestion) => [
      group.supplier ?? appText(locale, "Okänd leverantör"),
      suggestion.sku,
      suggestion.name,
      screenWhole(suggestion.suggestedQty),
      screenWhole(suggestion.moq),
      screenWhole(suggestion.reorderPoint),
      screenWhole(suggestion.stock),
      screenWhole(suggestion.available),
      screenWhole(suggestion.safetyStock),
      // The page clamps a missing lead time at zero before showing it.
      Math.max(0, screenWhole(suggestion.leadTimeDays)),
      screenWhole(suggestion.expectedDemand),
      screenWhole(suggestion.stockAfter),
      screenWhole(suggestion.orderValue),
      appText(locale, PRIORITY_LABEL[suggestion.priority]),
    ]),
  );
}

/** Semicolon-separated, UTF-8 with a BOM added by the route, matching the other exports. */
export function orderCsv(view: ProcurementView, locale: Locale): string {
  // Numbers bypass csvCell on purpose: it would prefix a negative number with
  // an apostrophe and turn a number into text.
  const cell = (value: CellValue): string =>
    typeof value === "number" ? csvNumber(value, locale) : csvCell(value);
  const rows: CellValue[][] = [orderColumns(locale).map((column) => column.header), ...orderRows(view, locale)];
  return rows.map((row) => row.map(cell).join(";")).join("\r\n");
}

export function orderXlsx(view: ProcurementView, locale: Locale): Uint8Array {
  return writeXlsx({
    name: appText(locale, "Beställning"),
    columns: orderColumns(locale),
    rows: orderRows(view, locale),
  });
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** ASCII-safe name: a supplier-qualified order, dated so two files never collide. */
export function orderFileName(view: ProcurementView, extension: "csv" | "xlsx", today = new Date()): string {
  const date = today.toISOString().slice(0, 10);
  const supplier = view.filter.supplier ? `-${slug(view.filter.supplier) || "leverantor"}` : "";
  return `bestallning${supplier}-${date}.${extension}`;
}
