/**
 * Scene adapter: turns the analysed portfolio into a warehouse model.
 *
 * This is a pure function on purpose. The 3D renderer (phase 3–4) consumes a
 * `SceneModel`; the model itself can be tested, snapshotted and reasoned about
 * without WebGL. Nothing here formats money or demand on its own: every label
 * comes from `analysis.ts` figures and the app dictionary.
 *
 * Mapping (fixed by the product brief):
 *   category → aisle
 *   ABC      → distance from the outbound dock (A nearest, C farthest)
 *   stock    → number/height of the stacked boxes (logarithmic, capped)
 *   XYZ      → surface finish (X smooth, Y striped, Z dotted)
 *   status   → overstock: amber glow · stockout: slow red pulse (≤ 1 Hz)
 *              inactive: grey with dust · balanced: neutral
 *
 * Colour is never the only carrier: every rack also carries a pattern, a signal
 * kind and a text label.
 */
import type { AbcClass, AnalysisResult, ItemAction, XyzClass } from "../analysis.ts";
import { appNum, appSek, appText } from "../i18n-app.ts";
import type { Locale } from "../i18n.ts";
import { localizeCategory } from "../terminology.ts";

/** The metrics subset a scene is allowed to read. */
export type SceneMetrics = Pick<
  AnalysisResult["kpis"],
  | "inventoryValue"
  | "skuCount"
  | "stockUnits"
  | "overstockValue"
  | "overstockCount"
  | "deadStockValue"
  | "deadStockCount"
  | "stockoutRiskCount"
  | "stockoutRiskValue"
  | "turns"
  | "daysOfInventory"
  | "potentialReleaseLow"
  | "potentialReleaseHigh"
>;

/** The article fields the scene needs. Structurally satisfied by `AnalyzedItem`. */
export interface SceneArticle {
  sku: string;
  name: string;
  category: string | null;
  stock: number;
  value: number;
  abc: AbcClass;
  xyz: XyzClass | null;
  action: ItemAction;
  overstockQty: number;
  stockoutRisk: boolean;
}

export type ScenePattern = "smooth" | "striped" | "dotted";
export type SceneStatus = "balanced" | "overstock" | "stockout" | "inactive";
export type SceneSignal = "none" | "glow" | "pulse" | "dust";

export interface SceneRack {
  id: string;
  sku: string;
  name: string;
  /** Aisle index, 0 = first aisle from the dock. */
  aisle: number;
  category: string;
  /** 0 = at the dock, 1 = the far wall. */
  depth: number;
  abc: AbcClass;
  xyz: XyzClass | null;
  pattern: ScenePattern;
  /** Boxes in the stack: 0 when the article has no stock, capped by `STACK_CAP`. */
  boxes: number;
  /** Boxes normalised to 0–1, ready for a renderer. */
  stackHeight: number;
  status: SceneStatus;
  signal: { kind: SceneSignal; hz: number | null };
  label: { title: string; value: string; status: string; pattern: string };
}

export interface SceneAisle {
  index: number;
  category: string;
  racks: number;
  value: number;
  /** Temperature or handling zone from the active industry profile. */
  zone: string | null;
}

type SceneZone = { id: string; label: string; tone: string };

export interface SceneIndustry {
  id: string;
  label: string;
  attributes: string[];
  zones: Array<{ id: string; label: string; tone: string }>;
}

export interface SceneHudTile {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "critical" | "good";
}

export interface SceneHud {
  title: string;
  subtitle: string;
  tiles: SceneHudTile[];
  /** How the scene is drawn, for the legend. */
  legend: Array<{ key: SceneStatus | ScenePattern; label: string }>;
  caption: string;
}

export interface SceneModel {
  racks: SceneRack[];
  aisles: SceneAisle[];
  /** Present when a demo environment carries an industry profile. */
  industry: SceneIndustry | null;
  hud: SceneHud;
  counts: {
    racks: number;
    byStatus: Record<SceneStatus, number>;
    byAbc: Record<AbcClass, number>;
    byPattern: Record<ScenePattern, number>;
  };
  palette: {
    background: string;
    floor: string;
    structure: string;
    neutral: string;
    overstock: string;
    stockout: string;
    inactive: string;
  };
}

/** Highest stack the scene draws. Taller stock still reads through the label. */
export const STACK_CAP = 12;

/** ABC depth bands, as a share of the aisle length from the dock. */
export const DEPTH_BANDS: Record<AbcClass, { from: number; to: number }> = {
  A: { from: 0.04, to: 0.3 },
  B: { from: 0.36, to: 0.64 },
  C: { from: 0.7, to: 0.96 },
};

/** Slow enough to stay under the 1 Hz limit in the brief. */
export const STOCKOUT_PULSE_HZ = 0.5;

export const PATTERN_BY_XYZ: Record<XyzClass, ScenePattern> = { X: "smooth", Y: "striped", Z: "dotted" };

/** Boxes needed for a stock level: logarithmic so 5 and 5 000 both read. */
export function stackBoxes(stock: number): number {
  if (!Number.isFinite(stock) || stock <= 0) return 0;
  return Math.max(1, Math.min(STACK_CAP, Math.ceil(Math.log10(1 + stock) * 2.2)));
}

/** Status is exclusive and ordered by urgency: inactive → stockout → overstock. */
export function rackStatus(article: Pick<SceneArticle, "action" | "stockoutRisk" | "overstockQty">): SceneStatus {
  if (article.action === "write_off" || article.action === "liquidate") return "inactive";
  if (article.stockoutRisk) return "stockout";
  if (article.overstockQty > 0) return "overstock";
  return "balanced";
}

const signalFor = (status: SceneStatus): SceneRack["signal"] => {
  switch (status) {
    case "overstock":
      return { kind: "glow", hz: null };
    case "stockout":
      return { kind: "pulse", hz: STOCKOUT_PULSE_HZ };
    case "inactive":
      return { kind: "dust", hz: null };
    default:
      return { kind: "none", hz: null };
  }
};

const statusLabel = (locale: Locale, status: SceneStatus): string => {
  switch (status) {
    case "overstock":
      return appText(locale, "Överlager");
    case "stockout":
      return appText(locale, "Bristrisk");
    case "inactive":
      return appText(locale, "Inaktivt lager");
    default:
      return appText(locale, "Balanserat");
  }
};

const patternLabel = (locale: Locale, pattern: ScenePattern): string => {
  switch (pattern) {
    case "striped":
      return appText(locale, "Streckad yta");
    case "dotted":
      return appText(locale, "Prickad yta");
    default:
      return appText(locale, "Slät yta");
  }
};

/**
 * Builds the scene. Deterministic: the same analysis always yields the same
 * aisles, depths and stacks, so screenshots and tests are stable.
 */
export function buildWarehouseScene(
  metrics: SceneMetrics,
  articles: SceneArticle[],
  options: { locale?: Locale; profile?: { id: string; label: { sv: string; en: string }; attributes: string[]; zones: Array<{ id: string; label: { sv: string; en: string }; tone: string }> } } = {},
): SceneModel {
  const locale = options.locale ?? "sv";
  const profile = options.profile;

  // Aisles: one per category. Industry profiles group temperature/handling
  // zones first (frozen, chilled, heavy), then tied-up capital within a zone.
  const zoneFor = (category: string): SceneZone | null => {
    if (!profile) return null;
    const text = category.toLocaleLowerCase("sv-SE");
    const tone = /fryst|frys|glass|frozen/.test(text)
      ? "frozen"
      : /kyl|mejeri|chark|kött|frukt|grönt|sallad|bageri|färdigmat|dryck|ost|smör/.test(text)
        ? "chilled"
        : /tung|stål|bygg|betong|virke/.test(text)
          ? "heavy"
          : "ambient";
    const found = profile.zones.find((z) => z.tone === tone) ?? profile.zones.find((z) => z.tone === "ambient") ?? profile.zones[0];
    return found ? { id: found.id, label: found.label[locale === "en" ? "en" : "sv"], tone: found.tone } : null;
  };
  const categoryValue = new Map<string, number>();
  for (const article of articles) {
    const key = localizeCategory(article.category, locale);
    categoryValue.set(key, (categoryValue.get(key) ?? 0) + (Number.isFinite(article.value) ? article.value : 0));
  }
  const zoneRank = (category: string): number => {
    const zone = zoneFor(category);
    if (!zone || !profile) return 0;
    const index = profile.zones.findIndex((z) => z.id === zone.id);
    return index < 0 ? 0 : index;
  };
  const aisleOrder = [...categoryValue.entries()].sort(
    (a, b) => zoneRank(a[0]) - zoneRank(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const aisleIndex = new Map(aisleOrder.map(([category], index) => [category, index]));

  // Within an ABC class, more capital sits closer to the dock.
  const rankByClass = new Map<AbcClass, Map<string, number>>();
  for (const cls of ["A", "B", "C"] as AbcClass[]) {
    const sorted = articles
      .filter((a) => a.abc === cls)
      .sort((a, b) => b.value - a.value || a.sku.localeCompare(b.sku));
    rankByClass.set(cls, new Map(sorted.map((article, index) => [article.sku, index])));
  }

  const racks: SceneRack[] = articles.map((article) => {
    const category = localizeCategory(article.category, locale);
    const rank = rankByClass.get(article.abc);
    const rankIndex = rank?.get(article.sku) ?? 0;
    const position = rank && rank.size > 1 ? rankIndex / (rank.size - 1) : 0;
    const band = DEPTH_BANDS[article.abc];
    const depth = band.from + (band.to - band.from) * position;
    const boxes = stackBoxes(article.stock);
    const status = rackStatus(article);
    const pattern = article.xyz ? PATTERN_BY_XYZ[article.xyz] : "dotted";

    return {
      id: `${article.sku}-${aisleIndex.get(category) ?? 0}`,
      sku: article.sku,
      name: article.name,
      aisle: aisleIndex.get(category) ?? 0,
      category,
      depth: Math.round(depth * 1000) / 1000,
      abc: article.abc,
      xyz: article.xyz,
      pattern,
      boxes,
      stackHeight: Math.round((boxes / STACK_CAP) * 1000) / 1000,
      status,
      signal: signalFor(status),
      label: {
        title: article.name,
        value: `${appNum(locale, article.stock, 0)} ${appText(locale, "st")} · ${appSek(locale, article.value, true)}`,
        status: statusLabel(locale, status),
        pattern: patternLabel(locale, pattern),
      },
    };
  });

  const racksPerAisle = new Array(aisleOrder.length).fill(0) as number[];
  for (const rack of racks) racksPerAisle[rack.aisle] = (racksPerAisle[rack.aisle] ?? 0) + 1;
  const aisles: SceneAisle[] = aisleOrder.map(([category, value], index) => ({
    index,
    category,
    racks: racksPerAisle[index] ?? 0,
    value: Math.round(value),
    zone: zoneFor(category)?.label ?? null,
  }));

  const byStatus: Record<SceneStatus, number> = { balanced: 0, overstock: 0, stockout: 0, inactive: 0 };
  const byAbc: Record<AbcClass, number> = { A: 0, B: 0, C: 0 };
  const byPattern: Record<ScenePattern, number> = { smooth: 0, striped: 0, dotted: 0 };
  for (const rack of racks) {
    byStatus[rack.status]++;
    byAbc[rack.abc]++;
    byPattern[rack.pattern]++;
  }

  const release =
    metrics.potentialReleaseHigh > 0
      ? `${appSek(locale, metrics.potentialReleaseLow, true)}–${appSek(locale, metrics.potentialReleaseHigh, true)}`
      : appText(locale, "Inget kapital att frigöra");

  const hud: SceneHud = {
    title: appText(locale, "Lageröversikt"),
    subtitle: appText(locale, "{n} artiklar i {aisles} kategorier. A närmast docken, C längst bort.").replace(
      "{n}",
      appNum(locale, metrics.skuCount, 0),
    ).replace("{aisles}", appNum(locale, aisles.length, 0)),
    tiles: [
      { label: appText(locale, "Lagervärde"), value: appSek(locale, metrics.inventoryValue, true), tone: "neutral" },
      {
        label: appText(locale, "Lageromsättning"),
        value: appText(locale, "{n} ggr/år").replace("{n}", appNum(locale, metrics.turns, 2)),
        tone: "neutral",
      },
      { label: appText(locale, "Överlager"), value: appSek(locale, metrics.overstockValue, true), tone: "warning" },
      {
        label: appText(locale, "Bristrisk"),
        value: `${appNum(locale, metrics.stockoutRiskCount, 0)} ${appText(locale, "artiklar")}`,
        tone: "critical",
      },
      { label: appText(locale, "Frigjort kapital"), value: release, tone: "good" },
    ],
    legend: [
      { key: "overstock", label: statusLabel(locale, "overstock") },
      { key: "stockout", label: statusLabel(locale, "stockout") },
      { key: "inactive", label: statusLabel(locale, "inactive") },
      { key: "smooth", label: patternLabel(locale, "smooth") },
      { key: "striped", label: patternLabel(locale, "striped") },
      { key: "dotted", label: patternLabel(locale, "dotted") },
    ],
    caption: appText(locale, "Syntetisk demodata, inte verkliga kunddata"),
  };

  return {
    racks,
    aisles,
    industry: profile
      ? {
          id: profile.id,
          label: profile.label[locale === "en" ? "en" : "sv"],
          attributes: profile.attributes,
          zones: profile.zones.map((zone) => ({ id: zone.id, label: zone.label[locale === "en" ? "en" : "sv"], tone: zone.tone })),
        }
      : null,
    hud,
    counts: { racks: racks.length, byStatus, byAbc, byPattern },
    palette: {
      background: "var(--midnight)",
      floor: "var(--paper-3)",
      structure: "var(--rule-strong)",
      neutral: "var(--sage)",
      overstock: "var(--warning)",
      stockout: "var(--critical)",
      inactive: "var(--ink-muted)",
    },
  };
}
