/**
 * PDF report.
 *
 * This is the artefact the customer actually pays for, so it is laid out like a
 * consultancy deliverable: cover with headline numbers, an economic summary, the
 * prioritised actions, the article lists, and an explicit method section.
 *
 * Everything is drawn with deterministic coordinates - no browser, no
 * screenshotting, no headless Chrome.
 */
import PDFDocument from "pdfkit";
import { join } from "node:path";
import type { AnalysisResult, AnalyzedItem } from "./analysis.ts";
import { appDate, appDynamic, appNum, appSek, appText } from "./i18n-app.ts";
import type { Locale } from "./i18n.ts";
import type { Narrative } from "./insights.ts";

const A4 = { width: 595.28, height: 841.89 };
const M = 46;
const W = A4.width - M * 2;

/** Printed matter in the same Nordic Intelligence system as the product. */
const C = {
  midnight: "#0E1A18",
  ink: "#17211F",
  inkSoft: "#46534F",
  muted: "#74807A",
  line: "#D7D5CA",
  bg: "#F6F4EF",
  teal: "#163D38",
  tealSoft: "#E9EDE6",
  mint: "#A65F3F",
  green: "#2F6B53",
  amber: "#A77B32",
  amberSoft: "#F5EDDD",
  red: "#A64B42",
  white: "#FFFFFF",
  copper: "#A65F3F",
  brass: "#8F5A4A",
};

const FONT_DIR = join(import.meta.dir, "..", "public", "fonts");

/** The supplied artwork as vectors: the same paths, drawn in the report. */
const LOGO_PATHS: ReadonlyArray<readonly [string, string]> = [
  [
    "M12 12 L72 12 L92 32 L32 32 L32 44 L39 44 L59 64 L12 64 Z",
    "#111214",
  ],
  [
    "M92 96 L32 96 L12 76 L72 76 L72 64 L65 64 L45 44 L92 44 Z",
    "#111214",
  ],
  [
    "M39 44 L45 44 L65 64 L59 64 Z",
    "#C8A66A",
  ],
  [
    "M120 34 L139.2 34 L145.6 40.4 L126.4 40.4 L126.4 50.8 L145.6 50.8 L145.6 74 L126.4 74 L120 67.6 L139.2 67.6 L139.2 57.2 L120 57.2 Z M149.6 34 L175.2 34 L175.2 40.4 L165.6 40.4 L165.6 74 L159.2 74 L159.2 40.4 L149.6 40.4 Z M184 34 L201.6 34 L207.2 39.6 L207.2 68.4 L201.6 74 L184 74 L178.4 68.4 L178.4 39.6 Z M187.2 40.4 L198.4 40.4 L200.8 42.8 L200.8 65.2 L198.4 67.6 L187.2 67.6 L184.8 65.2 L184.8 42.8 Z",
    "#111214",
  ],
  [
    "M 217.78 34 L 233.42 34 L 238.4 39.6 L 238.4 68.4 L 233.42 74 L 217.78 74 L 212.8 68.4 L 212.8 39.6 Z M 220.62 40.4 L 230.58 40.4 L 232.71 42.8 L 232.71 65.2 L 230.58 67.6 L 220.62 67.6 L 218.49 65.2 L 218.49 42.8 Z",
    "#111214",
  ],
  [
    "M233.5 71 L238.4 71 L238.4 80.5 L235 80.5 Z",
    "#111214",
  ],
  [
    "M 244 34 L 251.2 34 L 256.8 58.8 L 263.2 34 L 268 34 L 274.4 58.8 L 280 34 L 287.2 34 L 278.4 74 L 271.2 74 L 265.6 46 L 260 74 L 252.8 74Z M 292 34 L 298.4 34 L 298.4 74 L 292 74Z M 304 34 L 323.2 34 L 329.6 40.4 L 310.4 40.4 L 310.4 50.8 L 329.6 50.8 L 329.6 74 L 310.4 74 L 304 67.6 L 323.2 67.6 L 323.2 57.2 L 304 57.2Z M 335.2 34 L 357.6 34 L 357.6 40.4 L 341.6 40.4 L 341.6 50.8 L 354.4 50.8 L 354.4 57.2 L 341.6 57.2 L 341.6 67.6 L 357.6 67.6 L 357.6 74 L 335.2 74Z",
    "#111214",
  ],
];
const LOGO_VIEWBOX = { width: 369.6, height: 108 };

function drawLogo(doc: PDFKit.PDFDocument, x: number, y: number, width: number): void {
  const scale = width / LOGO_VIEWBOX.width;
  for (const [d, fill] of LOGO_PATHS) {
    const tokens = d.match(/[MLZ]|-?\d+(?:\.\d+)?/g) ?? [];
    doc.save();
    let j = 0;
    while (j < tokens.length) {
      const command = tokens[j++]!;
      if (command === "Z") {
        doc.closePath();
        continue;
      }
      const px = Number(tokens[j++]);
      const py = Number(tokens[j++]);
      if (command === "M") doc.moveTo(x + px * scale, y + py * scale);
      else doc.lineTo(x + px * scale, y + py * scale);
    }
    doc.fill(fill, "even-odd");
    doc.restore();
  }
}

export interface ReportMeta {
  company: string;
  locale?: Locale;
  orgNumber?: string | null;
  filename: string;
  generatedAt: string;
  contactEmail?: string | null;
  fictional?: boolean;
}

type Align = "left" | "right";

/** Localised download name. The report id stays in the name so two exports
 * from the same organisation never overwrite each other. */
export function reportFileName(locale: Locale, analysisId?: string): string {
  if (!analysisId) return locale === "sv" ? "exempelrapport.pdf" : "sample-report.pdf";
  const base = locale === "sv" ? "lagerrapport" : "inventory-report";
  return `${base}-${analysisId.slice(0, 8)}.pdf`;
}

interface Column {
  label: string;
  width: number;
  align?: Align;
}

export function buildPdf(
  analysis: AnalysisResult,
  narrative: Narrative,
  meta: ReportMeta,
): Promise<Buffer> {
  const locale = meta.locale ?? "sv";
  const t = (source: string, vars?: Record<string, string | number>) => appText(locale, source, vars);
  const num = (value: number, decimals = 0) => appNum(locale, value, decimals);
  const sek = (value: number, compact = false) => appSek(locale, value, compact);
  const date = (iso: string) => appDate(locale, iso);
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    bufferPages: true,
    info: {
      Title: t("Inventory analysis: {company}", { company: meta.company }),
      Author: "STOQWISE",
      Subject: t("Lagerkapitalanalys, inaktivt lager och lageroptimering"),
      Keywords: t("lager, inaktivt lager, ABC, XYZ, rörelsekapital"),
    },
  });

  // Print uses static TTF instances. The screen face (Geist Sans) ships as
  // one variable font, which PDFKit would flatten to a single weight, so the
  // report keeps Geist here rather than losing its bold/medium hierarchy.
  doc.registerFont("Sans", join(FONT_DIR, "geist-sans-400.ttf"));
  doc.registerFont("Sans-Medium", join(FONT_DIR, "geist-sans-500.ttf"));
  doc.registerFont("Sans-Bold", join(FONT_DIR, "geist-sans-700.ttf"));
  // The italic accent uses the 600 cut of the same family.
  doc.registerFont("Serif", join(FONT_DIR, "geist-sans-600.ttf"));
  doc.registerFont("Serif-Light", join(FONT_DIR, "geist-sans-400.ttf"));
  doc.registerFont("Serif-Italic", join(FONT_DIR, "newsreader-400-italic.ttf"));
  doc.registerFont("Courier", join(FONT_DIR, "geist-mono-400.ttf"));
  doc.registerFont("Courier-Bold", join(FONT_DIR, "geist-mono-500.ttf"));

  const chunks: Uint8Array[] = [];
  doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  let y = 0;

  /* ------------------------------------------------------------- cover ---- */
  doc.rect(0, 0, A4.width, A4.height).fill(C.bg);
  doc.rect(0, 0, A4.width, 7).fill(C.teal);
  doc.rect(0, 7, A4.width * 0.34, 7).fill(C.mint);
  // The artwork carries 12 units of internal padding; pull it so the mark's
  // optical edge sits on the text margin.
  drawLogo(doc, M - 5, 44, 172);
  doc.rect(M, 96, W, 0.8).fill(C.teal);

  doc
    .font("Courier")
    .fontSize(7.6)
    .fillColor(C.muted)
    .text(meta.fictional ? t("DEMOMILJÖ  ·  EXEMPELDATA") : t("LAGERANALYS  ·  KONFIDENTIELLT"), M, 110, { width: W, characterSpacing: 1.6 });

  doc.font("Serif").fontSize(32).fillColor(C.ink).text(t("Lagerkapitalanalys"), M, 132, { width: W });
  doc.font("Sans").fontSize(14).fillColor(C.inkSoft).text(meta.company, M, 186, { width: W });
  doc.rect(M, 218, 56, 3).fill(C.brass);

  doc
    .font("Courier")
    .fontSize(8)
    .fillColor(C.muted)
    .text(
      t("Underlag: {file}   ·   {months} månaders historik   ·   {n} artiklar", { file: meta.filename, months: analysis.dataQuality.months, n: num(analysis.kpis.skuCount) }),
      M,
      236,
      { width: W },
    );
  doc.text(t("Upprättad {date}   ·   Datadriven lageranalys för svensk handel och industri", { date: date(meta.generatedAt) }), M, 250, { width: W });

  /* ------------------------------------------------------------ headline -- */
  y = 300;
  doc.font("Serif").fontSize(22).fillColor(C.ink).text(narrative.headline, M, y, { width: W });
  y = doc.y + 10;

  doc
    .font("Sans")
    .fontSize(10)
    .fillColor(C.inkSoft)
    .text(narrative.summary[0] ?? "", M, y, { width: W, lineGap: 3 });
  y = doc.y + 16;

  /* ------------------------------------------------------------ KPI grid -- */
  const k = analysis.kpis;
  const cards: Array<{ label: string; value: string; tone: "plain" | "warn" | "good" }> = [
    { label: t("Lagervärde"), value: sek(k.inventoryValue), tone: "plain" },
    { label: t("Inaktivt lager"), value: sek(k.deadStockValue), tone: "warn" },
    { label: t("Överlager"), value: sek(k.overstockValue), tone: "warn" },
    { label: t("Lageromsättning"), value: t("{n} ggr/år", { n: num(k.turns, 1) }), tone: "plain" },
    {
      label: t("Frigjort kapital (intervall)"),
      value: `${sek(k.potentialReleaseLow, true)}–${sek(k.potentialReleaseHigh, true)}`,
      tone: "good",
    },
    { label: t("Artiklar med bristrisk"), value: num(k.stockoutRiskCount), tone: "warn" },
  ];

  const cardW = (W - 12) / 2;
  const cardH = 58;
  cards.forEach((card, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = M + col * (cardW + 12);
    const cy = y + row * (cardH + 10);
    const tone = card.tone === "warn" ? C.amber : card.tone === "good" ? C.green : C.ink;
    // Ledger entries: a rule, a mono label, a figure. No cards, no shadows.
    doc.rect(cx, cy, cardW, 0.8).fill(tone);
    doc
      .font("Courier")
      .fontSize(7.2)
      .fillColor(C.muted)
      .text(card.label.toUpperCase(), cx, cy + 9, { width: cardW, characterSpacing: 0.5 });
    doc.font("Courier-Bold").fontSize(18).fillColor(tone).text(card.value, cx, cy + 24, { width: cardW });
  });

  y += 3 * (cardH + 10) + 8;

  /* --------------------------------------------------------- summary body - */
  for (const paragraph of narrative.summary.slice(1)) {
    y = ensureSpace(doc, y, 46);
    doc.font("Sans").fontSize(9.5).fillColor(C.inkSoft).text(paragraph, M, y, {
      width: W,
      lineGap: 3,
    });
    y = doc.y + 9;
  }

  /* ------------------------------------------------------- page 2: economy */
  doc.addPage();
  y = M;
  y = sectionTitle(doc, t("Ekonomisk sammanfattning"), y);

  y = table(
    doc,
    y,
    [
      { label: t("Nyckeltal"), width: W * 0.42 },
      { label: t("Värde"), width: W * 0.22, align: "right" },
      { label: t("Kommentar"), width: W * 0.36 },
    ],
    [
      [t("Lagervärde"), sek(k.inventoryValue), t("{n} artiklar", { n: num(k.skuCount) })],
      [t("Varuflöde per år (COGS)"), sek(k.annualCogs), t("Till inköpspris")],
      [t("Lageromsättning"), t("{n} ggr/år", { n: num(k.turns, 1) }), t("Median artikel: {n}", { n: num(k.turnoverMedian, 1) })],
      [t("Genomsnittlig liggtid"), k.daysOfInventory === null ? "–" : t("{n} dagar", { n: num(k.daysOfInventory) }), t("365 / omsättning")],
      [t("Inaktivt lager"), sek(k.deadStockValue), t("{n} artiklar", { n: k.deadStockCount })],
      [t("Överlager"), sek(k.overstockValue), t("{n} artiklar", { n: k.overstockCount })],
      [t("Långsamt omsatta artiklar"), sek(k.slowMoverValue), t("{n} artiklar, >180 d täckning", { n: k.slowMoverCount })],
      [t("Bristrisk"), sek(k.stockoutRiskValue), t("{n} artiklar under ledtid", { n: k.stockoutRiskCount })],
      [t("Kapitalkostnad per år"), sek(k.capitalCostAnnual), t("{n} % kalkylränta", { n: Math.round(analysis.settings.capitalCostRate * 100) })],
      [
        t("Frigjort kapital"),
        `${sek(k.potentialReleaseLow, true)}–${sek(k.potentialReleaseHigh, true)}`,
        t("Intervall, se antaganden"),
      ],
    ],
  );

  y += 18;
  y = ensureSpace(doc, y, 150);
  y = sectionTitle(doc, t("Lagrets ålder"), y, 12);

  const maxAging = Math.max(...analysis.aging.map((b) => b.value), 1);
  for (const bucket of analysis.aging) {
    const barW = (bucket.value / maxAging) * (W - 210);
    doc.font("Sans").fontSize(8.5).fillColor(C.inkSoft).text(t(bucket.label), M, y + 1, { width: 150 });
    doc.rect(M + 156, y, Math.max(1, barW), 9).fill(barW > 0 ? C.teal : C.line);
    doc
      .font("Sans-Bold")
      .fontSize(8.5)
      .fillColor(C.ink)
      .text(`${sek(bucket.value, true)} (${bucket.count})`, M + 156 + barW + 8, y + 1, {
        width: 120,
        align: "left",
      });
    y += 17;
  }

  y += 10;
  y = ensureSpace(doc, y, 130);
  y = sectionTitle(doc, t("ABC-klassificering"), y, 12);
  y = table(
    doc,
    y,
    [
      { label: t("Klass"), width: W * 0.28 },
      { label: t("Artiklar"), width: W * 0.18, align: "right" },
      { label: t("Lagervärde"), width: W * 0.20, align: "right" },
      { label: t("Försäljningsvärde"), width: W * 0.20, align: "right" },
      { label: t("Andel"), width: W * 0.14, align: "right" },
    ],
    analysis.abc.map((a) => [
      a.class,
      num(a.count),
      sek(a.value),
      sek(a.revenue),
      `${num(a.revenueShare, 0)} %`,
    ]),
  );
  doc
    .font("Sans")
    .fontSize(7.5)
    .fillColor(C.muted)
    .text(
      t("ABC räknas på kumulativ andel av försäljningsvärdet. A: andelen före artikeln < 80 %, B: 80–95 %, C: resten. Artikeln som passerar en gräns stannar i klassen före den."),
      M,
      y + 6,
      { width: W },
    );
  y = doc.y + 6;

  if (analysis.matrix) {
    y += 14;
    y = ensureSpace(doc, y, 110);
    y = sectionTitle(doc, t("ABC/XYZ-matris (antal artiklar)"), y, 12);
    y = table(
      doc,
      y,
      [
        { label: t("ABC \\ XYZ"), width: W * 0.28 },
        { label: t("X: jämn"), width: W * 0.18, align: "right" },
        { label: t("Y: varierande"), width: W * 0.18, align: "right" },
        { label: t("Z: oregelbunden"), width: W * 0.18, align: "right" },
        { label: t("Utan XYZ"), width: W * 0.18, align: "right" },
      ],
      analysis.matrix.map((row) => [
        row.abc,
        num(row.x),
        num(row.y),
        num(row.z),
        num(row.unclassified ?? 0),
      ]),
    );
    doc
      .font("Sans")
      .fontSize(7.5)
      .fillColor(C.muted)
      .text(
        t("X = variationskoefficient under 0,5. Y = 0,5–1,0. Z = över 1,0. Z-artiklar kräver manuell styrning eftersom efterfrågan är svår att prognosticera."),
        M,
        y + 6,
        { width: W },
      );
    y = doc.y + 6;
  }

  /* ------------------------------------------------- page 3: actions ----- */
  doc.addPage();
  y = M;
  y = sectionTitle(doc, t("Prioriterade åtgärder"), y);
  doc
    .font("Sans")
    .fontSize(9)
    .fillColor(C.muted)
    .text(
      t("Åtgärderna är ordnade efter ekonomisk effekt. Beloppen är uppskattningar utifrån analysens antaganden, inte garantier."),
      M,
      y,
      { width: W },
    );
  y = doc.y + 14;

  narrative.priorities.forEach((priority, index) => {
    const blockH = 96;
    y = ensureSpace(doc, y, blockH + 8);
    doc.rect(M, y, W, 0.8).fill(C.ink);
    doc
      .font("Courier-Bold")
      .fontSize(11)
      .fillColor(C.copper)
      .text(String(index + 1).padStart(2, "0"), M, y + 15, { width: 30 });
    doc.rect(M, y + blockH - 0.8, W, 0.8).fill(C.line);

    doc
      .font("Sans-Bold")
      .fontSize(11.5)
      .fillColor(C.ink)
      .text(priority.title, M + 46, y + 15, { width: W - 200 });
    if (priority.impactHigh > 0) {
      doc
        .font("Sans-Bold")
        .fontSize(9)
        .fillColor(C.teal)
        .text(
          `${sek(priority.impactLow, true)}–${sek(priority.impactHigh, true)}`,
          M + W - 150,
          y + 16,
          { width: 136, align: "right" },
        );
    }
    doc
      .font("Sans")
      .fontSize(8.6)
      .fillColor(C.inkSoft)
      .text(priority.why, M + 46, y + 33, { width: W - 62, height: 32, ellipsis: true });
    doc
      .font("Sans")
      .fontSize(8.2)
      .fillColor(C.muted)
      .text(t("Så gör ni: {action}", { action: priority.action }), M + 46, y + 68, { width: W - 62, height: 24, ellipsis: true });
    y += blockH + 10;
  });

  /* ------------------------------------------------ page 4: observations - */
  y = ensureSpace(doc, y, 160);
  y = sectionTitle(doc, t("Observationer"), y, 12);
  for (const observation of narrative.observations) {
    doc.circle(M + 3, y + 5, 1.6).fill(C.teal);
    doc
      .font("Sans")
      .fontSize(8.8)
      .fillColor(C.inkSoft)
      .text(observation, M + 12, y, { width: W - 12, lineGap: 2 });
    y = doc.y + 5;
  }

  y += 8;
  doc.font("Sans").fontSize(8.6);
  const closingWidth = W - 28;
  const closingHeight = doc.heightOfString(narrative.closing, { width: closingWidth, lineGap: 2 });
  const closingBox = 34 + closingHeight;
  y = ensureSpace(doc, y, closingBox + 10);
  doc.rect(M, y, W, closingBox).fill(C.tealSoft);
  doc
    .font("Sans-Bold")
    .fontSize(9)
    .fillColor(C.teal)
    .text(t("Nästa steg"), M + 14, y + 11, { width: closingWidth });
  doc
    .font("Sans")
    .fontSize(8.6)
    .fillColor(C.inkSoft)
    .text(narrative.closing, M + 14, y + 24, { width: closingWidth, lineGap: 2 });
  y += closingBox + 12;

  /* --------------------------------------------- page 5: article tables --- */
  doc.addPage();
  y = M;
  y = sectionTitle(doc, t("Största kapitalbindningen"), y);
  y = itemTable(doc, y, analysis.topCapital.slice(0, 12), "value", locale);

  y += 16;
  y = ensureSpace(doc, y, 90);
  y = sectionTitle(doc, t("Artiklar utan registrerad försäljning: åtgärder"), y, 12);
  doc
    .font("Sans")
    .fontSize(8.2)
    .fillColor(C.muted)
    .text(
      t("Artiklar utan försäljning de senaste {days} dagarna, sorterade på lagervärde.", { days: analysis.settings.deadStockDays }),
      M,
      y,
      { width: W },
    );
  y = doc.y + 8;
  y = itemTable(doc, y, analysis.deadStock.slice(0, 25), "value", locale);

  if (analysis.overstock.length > 0) {
    y += 16;
    y = ensureSpace(doc, y, 120);
    y = sectionTitle(doc, t("Överlager"), y);
    doc
      .font("Sans")
      .fontSize(8.2)
      .fillColor(C.muted)
      .text(
        t("Saldo utöver förväntad efterfrågan under ledtid plus granskningsperiod. Minska nästa beställning."),
        M,
        y,
        { width: W },
      );
    y = doc.y + 8;
    y = itemTable(doc, y, analysis.overstock.slice(0, 22), "overstock", locale);
  }

  if (analysis.reorder.length > 0) {
    y += 16;
    y = ensureSpace(doc, y, 100);
    y = sectionTitle(doc, t("Bristrisk: beställ nu"), y, 12);
    y = itemTable(doc, y, analysis.reorder.slice(0, 15), "cover", locale);
  }

  /* ---------------------------------------------------- last: method ----- */
  doc.addPage();
  y = M;
  y = sectionTitle(doc, t("Metod och antaganden"), y);
  const method: Array<[string, string]> = [
    [t("Datakälla"), t("Kundens export: {file}. Inga uppgifter har hämtats från tredje part.", { file: meta.filename })],
    [t("Period"), t("{n} månaders försäljningshistorik.", { n: analysis.dataQuality.months })],
    [t("Lagervärde"), t("Saldo × inköpspris. Försäljningspris används aldrig för lagervärde.")],
    [t("Inaktivt lager"), t("Ingen försäljning under {days} dagar trots saldo > 0.", { days: analysis.settings.deadStockDays })],
    [t("Överlager"), t("Saldo utöver förväntad efterfrågan under ledtid + {days} dagar, plus säkerhetslager.", { days: analysis.settings.overstockReviewDays })],
    [    t("Säkerhetslager"), t("z × standardavvikelse × roten ur (ledtid/30,44) med servicenivå {n} %.", { n: Math.round(analysis.settings.serviceLevel * 100) })],
    [t("ABC"), t("Kumulativ andel av försäljningsvärde, räknad före aktuell artikel: A < 80 %, B 80–95 %, C resterande. Artikeln som passerar en gräns stannar i klassen före den.")],
    [t("XYZ"), t("Variationskoefficient i månadsförsäljning: X < 0,5, Y 0,5–1,0, Z > 1,0. Kräver minst 6 månader; medelvärde 0 eller saknade värden ger ingen klass.")],
    [t("Frigjort kapital"), t("Kapital i inaktiva artiklar × 25–55 % + överlager × 15–35 %. Realisationsgraden är en bedömning, inte ett utfall.")],
    [t("Kapitalkostnad"), t("{n} % kalkylränta på bundet lagervärde.", { n: Math.round(analysis.settings.capitalCostRate * 100) })],
  ];
  for (const [label, text] of method) {
    y = ensureSpace(doc, y, 34);
    doc.font("Sans-Bold").fontSize(8.6).fillColor(C.ink).text(label, M, y, { width: 130 });
    doc
      .font("Sans")
      .fontSize(8.6)
      .fillColor(C.inkSoft)
      .text(text, M + 138, y, { width: W - 138 });
    y = doc.y + 7;
  }

  y += 10;
  y = ensureSpace(doc, y, 80);
  y = sectionTitle(doc, t("Datakvalitet"), y, 12);
  const warnings = analysis.dataQuality.warnings;
  if (warnings.length === 0) {
    doc.font("Sans").fontSize(8.6).fillColor(C.inkSoft).text(t("Inga anmärkningar på underlaget."), M, y, { width: W });
    y = doc.y + 6;
  } else {
    for (const warning of warnings) {
      y = ensureSpace(doc, y, 26);
      doc.circle(M + 3, y + 4.5, 1.6).fill(C.amber);
      doc
        .font("Sans")
        .fontSize(8.4)
        .fillColor(C.inkSoft)
        .text(appDynamic(locale, warning), M + 12, y, { width: W - 12, lineGap: 2 });
      y = doc.y + 5;
    }
  }

  y += 12;
  y = ensureSpace(doc, y, 62);
  doc.rect(M, y, W, 52).stroke(C.line);
  doc.font("Sans-Bold").fontSize(8.4).fillColor(C.ink).text(t("Om underlaget"), M + 14, y + 10, { width: W - 28 });
  doc
    .font("Sans")
    .fontSize(8)
    .fillColor(C.muted)
    .text(
      t("Analysen är framtagen av STOQWISE på uppdrag av {company}. Siffrorna är beräknade med deterministisk metod på det underlag som angivits ovan. Rapporten är beslutsunderlag, inte en garanti för ekonomiskt utfall.{contact}", { company: meta.company, contact: meta.contactEmail ? t(" Frågor: {email}", { email: meta.contactEmail }) : "" }),
      M + 14,
      y + 22,
      { width: W - 28, height: 26, ellipsis: true },
    );

  /* --------------------------------------------------------------- footers */
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (i === range.start) continue; // cover has no footer
    doc
      .font("Sans")
      .fontSize(7.5)
      .fillColor(C.muted)
      .text(`STOQWISE · ${meta.company} · ${date(meta.generatedAt)}`, M, A4.height - 34, {
        width: W * 0.7,
      });
    doc.text(t("Sida {page} av {pages}", { page: i - range.start + 1, pages: range.count }), M + W * 0.7, A4.height - 34, {
      width: W * 0.3,
      align: "right",
    });
    doc.rect(M, A4.height - 42, W, 0.5).fill(C.line);
  }

  doc.end();
  return done;
}

/* ------------------------------------------------------------------ utils */

function ensureSpace(doc: PDFKit.PDFDocument, y: number, needed: number): number {
  if (y + needed > A4.height - 60) {
    doc.addPage();
    return M;
  }
  return y;
}

function sectionTitle(
  doc: PDFKit.PDFDocument,
  title: string,
  y: number,
  size = 16,
): number {
  doc.font("Serif").fontSize(size).fillColor(C.ink).text(title, M, y, { width: W });
  const next = doc.y + 6;
  doc.rect(M, next, 38, 2).fill(C.mint);
  return next + 12;
}

function truncate(doc: PDFKit.PDFDocument, text: string, maxWidth: number): string {
  if (doc.widthOfString(text) <= maxWidth) return text;
  let s = text;
  while (s.length > 3 && doc.widthOfString(s + "…") > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + "…";
}

function table(
  doc: PDFKit.PDFDocument,
  startY: number,
  columns: Column[],
  rows: string[][],
): number {
  const rowH = 19;
  let y = startY;

  const drawHeader = () => {
    doc.rect(M, y, W, rowH).fill(C.ink);
    let x = M;
    columns.forEach((col) => {
      doc
        .font("Sans-Bold")
        .fontSize(7.8)
        .fillColor(C.white)
        .text(col.label, x + 6, y + 6, {
          width: col.width - 12,
          height: rowH - 8,
          ellipsis: true,
          align: col.align ?? "left",
        });
      x += col.width;
    });
    y += rowH;
  };

  drawHeader();

  rows.forEach((row, index) => {
    if (y + rowH > A4.height - 60) {
      doc.addPage();
      y = M;
      drawHeader();
    }
    if (index % 2 === 1) doc.rect(M, y, W, rowH).fill(C.bg);
    let x = M;
    row.forEach((cell, i) => {
      const col = columns[i]!;
      doc
        .font("Sans")
        .fontSize(8.2)
        .fillColor(C.inkSoft)
        .text(cell, x + 6, y + 6, {
          width: col.width - 12,
          // Fixed row height, so a wrapped cell must be clipped rather than
          // allowed to bleed into the row below.
          height: rowH - 8,
          ellipsis: true,
          align: col.align ?? "left",
        });
      x += col.width;
    });
    doc.rect(M, y + rowH, W, 0.4).fill(C.line);
    y += rowH;
  });

  return y;
}

function itemTable(
  doc: PDFKit.PDFDocument,
  startY: number,
  items: AnalyzedItem[],
  mode: "value" | "overstock" | "cover",
  locale: Locale,
): number {
  const t = (source: string) => appText(locale, source);
  const num = (value: number, decimals = 0) => appNum(locale, value, decimals);
  const sek = (value: number) => appSek(locale, value);
  if (items.length === 0) {
    doc.font("Sans").fontSize(8.6).fillColor(C.muted).text(t("Inga artiklar i kategorin."), M, startY, { width: W });
    return doc.y + 6;
  }

  const columns: Column[] =
    mode === "cover"
      ? [
          { label: t("Artikel"), width: W * 0.44 },
          { label: t("Saldo"), width: W * 0.12, align: "right" },
          { label: t("Täckning"), width: W * 0.14, align: "right" },
          { label: t("Ledtid"), width: W * 0.12, align: "right" },
          { label: t("Beställningspunkt"), width: W * 0.18, align: "right" },
        ]
      : mode === "overstock"
        ? [
            { label: t("Artikel"), width: W * 0.40 },
            { label: t("Saldo"), width: W * 0.11, align: "right" },
            { label: t("Överlager"), width: W * 0.13, align: "right" },
            { label: t("Värde"), width: W * 0.16, align: "right" },
            { label: t("Täckning"), width: W * 0.20, align: "right" },
          ]
        : [
            { label: t("Artikel"), width: W * 0.40 },
            { label: t("Saldo"), width: W * 0.11, align: "right" },
            { label: t("Pris"), width: W * 0.13, align: "right" },
            { label: t("Lagervärde"), width: W * 0.18, align: "right" },
            { label: t("Täckning"), width: W * 0.18, align: "right" },
          ];

  // Set the drawing font before measuring, otherwise truncation is calculated
  // against the previous section's font size and a name can wrap.
  doc.font("Sans").fontSize(8.2);
  const rows = items.map((item) => {
    const label = truncate(doc, `${item.sku}  ${item.name}`, columns[0]!.width - 14);
    if (mode === "cover") {
      return [
        label,
        num(item.stock),
        item.coverDays === null ? "–" : `${num(item.coverDays)} d`,
        `${num(item.leadTimeDays)} d`,
        num(item.reorderPoint, 0),
      ];
    }
    if (mode === "overstock") {
      return [
        label,
        num(item.stock),
        num(item.overstockQty),
        sek(item.overstockValue),
        item.coverDays === null ? "–" : `${num(item.coverDays)} d`,
      ];
    }
    return [
      label,
      num(item.stock),
      sek(item.cost),
      sek(item.value),
      item.coverDays === null ? "–" : `${num(item.coverDays)} d`,
    ];
  });

  return table(doc, startY, columns, rows);
}
