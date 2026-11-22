import { describe, expect, test } from "bun:test";
import { detectDelimiter, parseCsv, parseNumber } from "../src/csv.ts";

describe("parseNumber", () => {
  test("svenska decimaler och tusentalsavgränsare", () => {
    expect(parseNumber("1 234,56")).toBe(1234.56);
    expect(parseNumber("12,5")).toBe(12.5);
    expect(parseNumber("1 000")).toBe(1000);
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("1,234.56")).toBe(1234.56);
  });

  test("valutor, procent och parenteser", () => {
    expect(parseNumber("45 kr")).toBe(45);
    expect(parseNumber("12 %")).toBe(12);
    expect(parseNumber("(45)")).toBe(-45);
    expect(parseNumber("-45,50")).toBe(-45.5);
    expect(parseNumber("  € 19,90 ")).toBe(19.9);
  });

  test("tomma och ogiltiga värden blir null", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("   ")).toBeNull();
    expect(parseNumber("-")).toBeNull();
    expect(parseNumber("saknas")).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
  });

  test("tusental med punkt som inte är decimal", () => {
    // "1.234" i en svensk export är nästan alltid 1234, inte 1,234.
    expect(parseNumber("1.234")).toBe(1234);
    expect(parseNumber("12.50")).toBe(12.5);
  });
});

describe("parseCsv", () => {
  test("semikolon med citattecken och radbrytning i fält", () => {
    const csv = 'Artikelnummer;Benämning;Saldo\r\n123;"Skruv, 4 mm";10\r\n124;"Rad\nbruten";5\r\n';
    const parsed = parseCsv(csv);
    expect(parsed.delimiter).toBe(";");
    expect(parsed.headers).toEqual(["Artikelnummer", "Benämning", "Saldo"]);
    expect(parsed.rows.length).toBe(2);
    expect(parsed.rows[0]![1]).toBe("Skruv, 4 mm");
    expect(parsed.rows[1]![1]).toBe("Rad\nbruten");
  });

  test("escapade citattecken", () => {
    const parsed = parseCsv('a,b\n"Han sa ""hej""",2\n');
    expect(parsed.rows[0]![0]).toBe('Han sa "hej"');
  });

  test("BOM och komma som avgränsare", () => {
    const parsed = parseCsv("\uFEFFartikel,saldo\nA1,5\n");
    expect(parsed.headers[0]).toBe("artikel");
    expect(parsed.rows[0]![1]).toBe("5");
  });

  test("tabb-separerad fil", () => {
    const parsed = parseCsv("artikel\tsaldo\nA1\t5\nA2\t7\n");
    expect(parsed.delimiter).toBe("\t");
    expect(parsed.rows.length).toBe(2);
  });

  test("rader med olika bredd fylls ut och varnar", () => {
    const parsed = parseCsv("a;b;c\n1;2\n");
    expect(parsed.rows[0]![2]).toBe("");
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  test("tom fil ger tomt resultat", () => {
    expect(parseCsv("").headers).toEqual([]);
  });

  test("detectDelimiter väljer semikolon framför komma i decimaltal", () => {
    const text = "artikel;pris\nA;12,50\nB;19,90\nC;7,25\n";
    expect(detectDelimiter(text)).toBe(";");
  });
});
