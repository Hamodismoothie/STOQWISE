import { describe, expect, test } from "bun:test";
import { parseCsv } from "../src/csv.ts";
import { buildDemoDataset, demoCsv } from "../src/demo.ts";
import { detectMapping } from "../src/mapping.ts";
import {
  detectIndustry,
  INDUSTRY_ORDER,
  INDUSTRY_PROFILES,
  industryProfile,
} from "../src/industry.ts";
import { readXlsx, writeXlsx } from "../src/xlsx.ts";

const cases = [
  { environment: "industri", expected: "industri" },
  { environment: "livsmedel", expected: "livsmedel" },
  { environment: "foodservice", expected: "foodservice" },
  { environment: "ecommerce", expected: "ecommerce" },
] as const;

function detectFromCsv(id: (typeof cases)[number]["environment"]) {
  const parsed = parseCsv(demoCsv(buildDemoDataset(id)));
  const mapping = detectMapping(parsed.headers, parsed.rows);
  return { parsed, mapping, detection: detectIndustry(parsed.headers, parsed.rows, mapping) };
}

describe("industry detection", () => {
  test("all four synthetic datasets get the right profile from CSV", () => {
    for (const entry of cases) {
      const { detection } = detectFromCsv(entry.environment);
      expect(detection.selected).toBe(entry.expected);
      expect(detection.uncertain).toBe(false);
      expect(detection.confidence).toBeGreaterThanOrEqual(0.45);
      expect(detection.suggestions.length).toBeGreaterThanOrEqual(2);
      expect(detection.suggestions.some((suggestion) => suggestion.id === "generic")).toBe(true);
      expect(detection.evidence.length).toBeGreaterThan(0);
    }
  });

  test("XLSX is read with the same result as CSV", () => {
    const dataset = buildDemoDataset("livsmedel");
    const parsed = parseCsv(demoCsv(dataset));
    const bytes = writeXlsx({
      name: "Lager",
      columns: parsed.headers.map((header) => ({ header, width: 18 })),
      rows: parsed.rows,
    });
    const matrix = readXlsx(bytes);
    const headers = matrix[0]!;
    const rows = matrix.slice(1);
    const mapping = detectMapping(headers, rows);
    const detection = detectIndustry(headers, rows, mapping);
    expect(detection.selected).toBe("livsmedel");
    expect(detection.uncertain).toBe(false);
  });

  test("detection is read-only and never touches imported values", () => {
    const parsed = parseCsv(demoCsv(buildDemoDataset("foodservice")));
    const mapping = detectMapping(parsed.headers, parsed.rows);
    const beforeHeaders = JSON.stringify(parsed.headers);
    const beforeRows = JSON.stringify(parsed.rows);
    const beforeMapping = JSON.stringify(mapping.columns);
    detectIndustry(parsed.headers, parsed.rows, mapping);
    expect(JSON.stringify(parsed.headers)).toBe(beforeHeaders);
    expect(JSON.stringify(parsed.rows)).toBe(beforeRows);
    expect(JSON.stringify(mapping.columns)).toBe(beforeMapping);
  });

  test("thin data falls back to the general profile instead of guessing", () => {
    const headers = ["Artikel", "Saldo"];
    const rows = [
      ["A-1", "4"],
      ["A-2", "7"],
    ];
    const mapping = detectMapping(headers, rows);
    const detection = detectIndustry(headers, rows, mapping);
    expect(detection.selected).toBe("generic");
    expect(detection.uncertain).toBe(true);
    expect(detection.confidence).toBeLessThan(0.45);
  });

  test("profiles share one model but carry different defaults and zones", () => {
    expect(new Set(INDUSTRY_ORDER).size).toBe(9);
    const ids = new Set(INDUSTRY_ORDER.map((id) => INDUSTRY_PROFILES[id].id));
    expect(ids.size).toBe(9);
    for (const id of INDUSTRY_ORDER) {
      const profile = industryProfile(id);
      expect(profile.zones.length).toBeGreaterThan(0);
      expect(profile.serviceLevel).toBeGreaterThanOrEqual(0.9);
      expect(profile.deadStockDays).toBeGreaterThan(0);
    }
    expect(industryProfile("livsmedel").serviceLevel).toBeGreaterThan(industryProfile("generic").serviceLevel);
    expect(industryProfile("livsmedel").deadStockDays).toBeLessThan(industryProfile("generic").deadStockDays);
    expect(industryProfile("livsmedel").attributes).toContain("shelfLife");
    expect(industryProfile("livsmedel").zones.some((zone) => zone.tone === "frozen")).toBe(true);
    expect(industryProfile("ecommerce").attributes).toContain("returns");
  });
});
