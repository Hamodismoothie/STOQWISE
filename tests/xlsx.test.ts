import { describe, expect, test } from "bun:test";
import { readXlsx, writeXlsx } from "../src/xlsx.ts";

describe("xlsx", () => {
  test("skriver en giltig ZIP-container", () => {
    const bytes = writeXlsx({
      name: "Test",
      columns: [{ header: "A" }, { header: "B" }],
      rows: [[1, 2]],
    });
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
    expect(bytes.length).toBeGreaterThan(500);
  });

  test("runt-tripp bevarar tal och text", () => {
    const bytes = writeXlsx({
      name: "Artiklar",
      columns: [{ header: "Artikel" }, { header: "Benämning" }, { header: "Värde" }],
      rows: [
        ["10001", "Skruvdragare Proffs", 1234.5],
        ["10002", "Häcksax Eco", 0],
        ["10003", "Förvaringslåda", 99],
      ],
    });
    const matrix = readXlsx(bytes);
    expect(matrix[0]).toEqual(["Artikel", "Benämning", "Värde"]);
    expect(matrix[1]![0]).toBe("10001");
    expect(matrix[1]![1]).toBe("Skruvdragare Proffs");
    expect(Number(matrix[1]![2])).toBe(1234.5);
    expect(matrix).toHaveLength(4);
  });

  test("klarar svenska tecken och citattecken", () => {
    const bytes = writeXlsx({
      name: "ÅÄÖ",
      columns: [{ header: "Benämning" }],
      rows: [['Blandare "Classic" 3/4"'], ["Rör & koppling <12 mm>"]],
    });
    const matrix = readXlsx(bytes);
    expect(matrix[1]![0]).toBe('Blandare "Classic" 3/4"');
    expect(matrix[2]![0]).toBe("Rör & koppling <12 mm>");
  });

  test("tomma celler bevaras som tomma", () => {
    const bytes = writeXlsx({
      name: "Tom",
      columns: [{ header: "A" }, { header: "B" }, { header: "C" }],
      rows: [["x", "", "z"]],
    });
    const matrix = readXlsx(bytes);
    expect(matrix[1]![0]).toBe("x");
    expect(matrix[1]![2]).toBe("z");
  });

  test("avvisar filer som inte är xlsx", () => {
    expect(() => readXlsx(new Uint8Array([1, 2, 3, 4, 5]))).toThrow();
  });

  test("hanterar 5000 rader", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => [`SKU-${i}`, `Artikel ${i}`, i * 1.5]);
    const bytes = writeXlsx({ name: "Stor", columns: [{ header: "S" }, { header: "N" }, { header: "V" }], rows });
    const matrix = readXlsx(bytes);
    expect(matrix).toHaveLength(5001);
    expect(Number(matrix[5000]![2])).toBe(4999 * 1.5);
  });
});
