/**
 * XLSX read/write with no dependencies.
 *
 * An .xlsx file is a ZIP archive of XML. Writing one needs a ZIP container with
 * correct CRCs; reading one needs to inflate the parts back. Both are done here
 * with node:zlib, which keeps the dependency count at one (pdfkit) and means
 * exports work offline and in any environment.
 *
 * Limits, stated openly: we read the first worksheet, values only (no formulas,
 * no styling), and we write a single sheet with inline strings and a bold header
 * row. That covers "export the analysis to Excel" and "import a spreadsheet the
 * customer already has", which is the whole requirement.
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";

/* ------------------------------------------------------------------- zip */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
  compressed: Uint8Array;
  method: number;
  crc: number;
  offset: number;
}

function zip(files: Array<{ name: string; content: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const compressed = deflateRawSync(data);
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? new Uint8Array(compressed) : data;
    const nameBytes = encoder.encode(file.name);

    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, useDeflate ? 8 : 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, payload.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);

    entries.push({ name: file.name, data, compressed: payload, method: useDeflate ? 8 : 0, crc, offset });
    chunks.push(header, payload);
    offset += header.length + payload.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const record = new Uint8Array(46 + nameBytes.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, entry.method, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.compressed.length, true);
    view.setUint32(24, entry.data.length, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint32(42, entry.offset, true);
    record.set(nameBytes, 46);
    chunks.push(record);
    centralSize += record.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralStart, true);
  chunks.push(end);

  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

function unzip(buffer: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // Locate the end-of-central-directory record (max 64 KiB comment).
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("Filen är inte en giltig xlsx-fil (ZIP-struktur saknas).");

  const entryCount = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(pointer, true) !== 0x02014b50) break;
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(buffer.subarray(pointer + 46, pointer + 46 + nameLength));

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    files.set(name, method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw);

    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/* ------------------------------------------------------------------ write */

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Strip control characters that Excel refuses to open.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

export type CellValue = string | number | null | undefined;

export interface SheetSpec {
  name: string;
  columns: Array<{ header: string; width?: number }>;
  rows: CellValue[][];
}

export function writeXlsx(sheet: SheetSpec): Uint8Array {
  const rowsXml: string[] = [];

  // Header row uses style 1 (bold, frozen).
  const headerCells = sheet.columns
    .map((col, i) => `<c r="${columnName(i)}1" s="1" t="inlineStr"><is><t>${xmlEscape(col.header)}</t></is></c>`)
    .join("");
  rowsXml.push(`<row r="1" ht="20" customHeight="1">${headerCells}</row>`);

  sheet.rows.forEach((row, r) => {
    const rowIndex = r + 2;
    const cells = row
      .map((value, c) => {
        if (value === null || value === undefined || value === "") return "";
        const ref = `${columnName(c)}${rowIndex}`;
        if (typeof value === "number" && Number.isFinite(value)) {
          return `<c r="${ref}"><v>${value}</v></c>`;
        }
        return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(String(value))}</t></is></c>`;
      })
      .join("");
    rowsXml.push(`<row r="${rowIndex}">${cells}</row>`);
  });

  const cols = sheet.columns
    .map((col, i) => `<col min="${i + 1}" max="${i + 1}" width="${col.width ?? 18}" customWidth="1"/>`)
    .join("");

  const lastCol = columnName(Math.max(0, sheet.columns.length - 1));
  const lastRow = Math.max(1, sheet.rows.length + 1);
  const dimension = `A1:${lastCol}${lastRow}`;

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="${dimension}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${rowsXml.join("")}</sheetData>
<autoFilter ref="${dimension}"/>
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0E1A17"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
</styleSheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xmlEscape(sheet.name.slice(0, 31) || "Blad1")}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  return zip([
    { name: "[Content_Types].xml", content: contentTypes },
    { name: "_rels/.rels", content: rootRels },
    { name: "xl/workbook.xml", content: workbook },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRels },
    { name: "xl/styles.xml", content: stylesXml },
    { name: "xl/worksheets/sheet1.xml", content: sheetXml },
  ]);
}

/* ------------------------------------------------------------------- read */

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

function columnIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

/** Reads the first worksheet into a matrix of strings. */
export function readXlsx(buffer: Uint8Array): string[][] {
  const files = unzip(buffer);
  const decoder = new TextDecoder();
  const sharedXml = files.get("xl/sharedStrings.xml");
  const shared: string[] = [];

  if (sharedXml) {
    const text = decoder.decode(sharedXml);
    for (const match of text.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const parts = [...match[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXmlEntities(m[1]!));
      shared.push(parts.join(""));
    }
  }

  // The first sheet, following the workbook relationship when it is present.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const workbook = files.get("xl/workbook.xml");
  const rels = files.get("xl/_rels/workbook.xml.rels");
  if (workbook && rels) {
    const relText = decoder.decode(rels);
    const firstSheet = decoder.decode(workbook).match(/<sheet[^>]*r:id="([^"]+)"/);
    if (firstSheet) {
      const id = firstSheet[1]!;
      const rel = relText.match(new RegExp(`<Relationship[^>]*Id="${id}"[^>]*Target="([^"]+)"`));
      if (rel) {
        const target = rel[1]!.replace(/^\//, "");
        sheetPath = target.startsWith("xl/") ? target : `xl/${target}`;
      }
    }
  }

  const sheetXml = files.get(sheetPath) ?? files.get("xl/worksheets/sheet1.xml");
  if (!sheetXml) throw new Error("Kunde inte hitta något kalkylblad i xlsx-filen.");

  const text = decoder.decode(sheetXml);
  const rows: string[][] = [];

  for (const rowMatch of text.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1]!.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1]!;
      const body = cellMatch[2]!;
      const refMatch = attrs.match(/r="([A-Z]+\d+)"/);
      const index = refMatch ? columnIndex(refMatch[1]!) : row.length;
      const type = attrs.match(/t="([^"]+)"/)?.[1] ?? "n";

      let value = "";
      if (type === "s") {
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        value = v !== undefined ? (shared[Number(v)] ?? "") : "";
      } else if (type === "inlineStr") {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXmlEntities(m[1]!)).join("");
      } else if (type === "str") {
        value = decodeXmlEntities(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
      } else {
        value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      }

      while (row.length < index) row.push("");
      row[index] = value.trim();
    }
    rows.push(row);
  }

  return rows.filter((row) => row.some((cell) => cell !== ""));
}
