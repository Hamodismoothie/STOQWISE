/**
 * Public demo world: one payload for the 3D/scroll experience and one endpoint
 * for the "what if" sliders.
 *
 * Everything is computed by the same analysis engine as the app (`analyze`)
 * and mapped through the same scene adapter as the dashboard
 * (`buildWarehouseScene`). The browser never calculates inventory figures of
 * its own, so the world can never disagree with the numbers next to it.
 */
import { analyze, type AnalysisResult, type AnalyzedItem } from "./analysis.ts";
import { buildDemoDataset, DEMO_ENVIRONMENTS, type DemoEnvironmentId } from "./demo.ts";
import type { ItemInput } from "./dataset.ts";
import type { Locale } from "./i18n.ts";
import { buildStory, type Story } from "./story.ts";
import { industryProfile, type IndustryId, type IndustryZone } from "./industry.ts";
import { buildWarehouseScene, type SceneArticle, type SceneModel } from "./ui/scene.ts";
import {
  buildLiveWarehouse,
  LIVE_DETAIL_SLOT_BUDGET,
  liveStatus,
  type LiveModel,
  type LiveSlot,
  type LiveStatus,
} from "./ui/live-warehouse.ts";

export interface WorldKpis {
  inventoryValue: number;
  skuCount: number;
  stockUnits: number;
  turns: number;
  daysOfInventory: number | null;
  overstockValue: number;
  overstockCount: number;
  stockoutRiskCount: number;
  stockoutRiskValue: number;
  deadStockCount: number;
  deadStockValue: number;
  potentialReleaseLow: number;
  potentialReleaseHigh: number;
}

export interface WorldWhatIf {
  leadDeltaDays: number;
  serviceLevel: number;
  demandPct: number;
}

export interface WorldEnvironment {
  id: DemoEnvironmentId;
  company: string;
  industry: string;
  industryId: IndustryId;
  zones: Array<{ id: string; label: string; tone: IndustryZone["tone"] }>;
  attributes: string[];
  /** Demo data only: never a customer dataset. */
  scene: SceneModel;
  kpis: WorldKpis;
  baseline: WorldKpis;
  /** The four-step demonstration, computed from the same dataset as the scene. */
  story: Story;
}

/** Slider ranges, fixed here so client and server clamp identically. */
export const WHAT_IF_LIMITS = {
  leadDeltaDays: { min: -10, max: 20, step: 1 },
  serviceLevel: { options: [0.9, 0.95, 0.98, 0.99] as number[], fallback: 0.95 },
  demandPct: { min: -30, max: 30, step: 5 },
} as const;

const round = (n: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

const num = (value: unknown, fallback: number): number => {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

export function normalizeWhatIf(input: Partial<WorldWhatIf> = {}): WorldWhatIf {
  const lead = clamp(Math.round(num(input.leadDeltaDays, 0)), WHAT_IF_LIMITS.leadDeltaDays.min, WHAT_IF_LIMITS.leadDeltaDays.max);
  const rawService = num(input.serviceLevel, WHAT_IF_LIMITS.serviceLevel.fallback);
  const service =
    WHAT_IF_LIMITS.serviceLevel.options.find((option) => Math.abs(option - rawService) < 0.005) ??
    WHAT_IF_LIMITS.serviceLevel.fallback;
  const demand = clamp(Math.round(num(input.demandPct, 0) / 5) * 5, WHAT_IF_LIMITS.demandPct.min, WHAT_IF_LIMITS.demandPct.max);
  return { leadDeltaDays: lead, serviceLevel: service, demandPct: demand };
}

const kpisOf = (result: AnalysisResult): WorldKpis => ({
  inventoryValue: result.kpis.inventoryValue,
  skuCount: result.kpis.skuCount,
  stockUnits: result.kpis.stockUnits,
  turns: result.kpis.turns,
  daysOfInventory: result.kpis.daysOfInventory,
  overstockValue: result.kpis.overstockValue,
  overstockCount: result.kpis.overstockCount,
  stockoutRiskCount: result.kpis.stockoutRiskCount,
  stockoutRiskValue: result.kpis.stockoutRiskValue,
  deadStockCount: result.kpis.deadStockCount,
  deadStockValue: result.kpis.deadStockValue,
  potentialReleaseLow: result.kpis.potentialReleaseLow,
  potentialReleaseHigh: result.kpis.potentialReleaseHigh,
});

const asSceneArticle = (item: AnalyzedItem): SceneArticle => ({
  sku: item.sku,
  name: item.name,
  category: item.category,
  stock: item.stock,
  value: item.value,
  abc: item.abc,
  xyz: item.xyz,
  action: item.action,
  overstockQty: item.overstockQty,
  stockoutRisk: item.stockoutRisk,
});

/** Applies the three sliders to the demo items, without touching the source. */
function applyWhatIf(items: ItemInput[], params: WorldWhatIf, defaultLeadTimeDays: number): ItemInput[] {
  const factor = 1 + params.demandPct / 100;
  return items.map((item) => {
    const monthly = item.monthly ? item.monthly.map((value) => Math.max(0, Math.round(value * factor))) : null;
    const totalSold = Math.max(0, Math.round(item.totalSold * factor));
    const baseLead = item.leadTimeDays ?? defaultLeadTimeDays;
    return {
      ...item,
      monthly,
      totalSold,
      totalRevenue: item.price === null ? null : round(totalSold * item.price, 2),
      leadTimeDays: clamp(baseLead + params.leadDeltaDays, 0, 365),
    };
  });
}

function analyzeEnvironment(id: DemoEnvironmentId, _locale: Locale, params?: WorldWhatIf) {
  const dataset = buildDemoDataset(id);
  const profile = industryProfile(dataset.environment.industryId);
  const items = params ? applyWhatIf(dataset.items, params, 30) : dataset.items;
  const result = analyze(items, {
    months: dataset.months,
    serviceLevel: params ? params.serviceLevel : profile.serviceLevel,
    deadStockDays: profile.deadStockDays,
  });
  return { dataset, result, profile };
}

export function worldMetrics(id: DemoEnvironmentId, params: WorldWhatIf): WorldKpis {
  return kpisOf(analyzeEnvironment(id, "sv", params).result);
}

/** One demo environment, analysed and mapped to a scene model. */
export function worldEnvironment(id: DemoEnvironmentId, locale: Locale = "sv"): WorldEnvironment {
  const meta = DEMO_ENVIRONMENTS.find((environment) => environment.id === id);
  if (!meta) throw new Error(`Unknown demo environment: ${id}`);
  const { dataset, result, profile } = analyzeEnvironment(meta.id, locale);
  const kpis = kpisOf(result);
  return {
    id: meta.id,
    company: dataset.company,
    industry: locale === "sv" ? meta.industry : meta.industryEn,
    industryId: profile.id,
    zones: profile.zones.map((z) => ({ id: z.id, label: z.label[locale === "en" ? "en" : "sv"], tone: z.tone })),
    attributes: profile.attributes,
    scene: buildWarehouseScene(kpis, result.items.map(asSceneArticle), { locale, profile }),
    kpis,
    baseline: kpis,
    story: buildStory(dataset, result, locale === "en" ? "en" : "sv"),
  };
}

/** All four demo environments, analysed and mapped to scene models. */
export function worldEnvironments(locale: Locale = "sv"): WorldEnvironment[] {
  return DEMO_ENVIRONMENTS.map((meta) => worldEnvironment(meta.id, locale));
}

export interface WhatIfResult {
  environment: DemoEnvironmentId;
  params: WorldWhatIf;
  kpis: WorldKpis;
  delta: {
    overstockValue: number;
    stockoutRiskValue: number;
    stockoutRiskCount: number;
    potentialReleaseLow: number;
    potentialReleaseHigh: number;
    turns: number;
  };
  counts: SceneModel["counts"];
  statusBySku: Record<string, string>;
}

/**
 * Re-runs the analysis for one environment with the sliders applied.
 * Identical parameters to the baseline return the identical figures.
 */
export function whatIf(id: DemoEnvironmentId, input: Partial<WorldWhatIf> = {}, locale: Locale = "sv"): WhatIfResult {
  // The zero state uses the active industry's service level, so the sliders
  // start from the same baseline the server rendered.
  const activeProfile = industryProfile(buildDemoDataset(id).environment.industryId);
  const params = normalizeWhatIf({ serviceLevel: activeProfile.serviceLevel, ...input });
  const { result, profile } = analyzeEnvironment(id, locale, params);
  const baseline = kpisOf(analyzeEnvironment(id, locale).result);
  const kpis = kpisOf(result);
  const scene = buildWarehouseScene(kpis, result.items.map(asSceneArticle), { locale, profile });
  const statusBySku: Record<string, string> = {};
  for (const rack of scene.racks) statusBySku[rack.sku] = rack.status;
  return {
    environment: id,
    params,
    kpis,
    delta: {
      overstockValue: kpis.overstockValue - baseline.overstockValue,
      stockoutRiskValue: kpis.stockoutRiskValue - baseline.stockoutRiskValue,
      stockoutRiskCount: kpis.stockoutRiskCount - baseline.stockoutRiskCount,
      potentialReleaseLow: kpis.potentialReleaseLow - baseline.potentialReleaseLow,
      potentialReleaseHigh: kpis.potentialReleaseHigh - baseline.potentialReleaseHigh,
      turns: round(kpis.turns - baseline.turns, 2),
    },
    counts: scene.counts,
    statusBySku,
  };
}

/* ------------------------------------------------------------ app world */

export interface AppWorldRack extends LiveSlot {
  /** Compatibility fields used by the table and older clients. */
  aisle: number;
  depth: number;
  boxes: number;
  pick: { x: number; z: number } | null;
}

export interface AppWorldCategory {
  index: number;
  category: string;
  racks: number;
  value: number;
  status: Record<string, number>;
}

export interface AppWorldModel extends LiveModel {
  /** Individual racks, or no racks above the detail budget (clusters instead). */
  racks: AppWorldRack[];
  categories: AppWorldCategory[];
}

/** Full-detail slot budget before the browser switches to clusters. */
export const APP_WORLD_LIMIT = LIVE_DETAIL_SLOT_BUDGET;

/**
 * The signed-in world. One rack per article, placed by the layout engine so the
 * spatial strategy (A near dispatch, C far away, inactive quarantined) is the
 * same one the table describes. A portfolio above the detail budget becomes
 * expandable clusters; the table and server-side search still expose every article.
 */
export function buildAppWorld(
  items: AnalyzedItem[],
  _metrics: WorldKpis,
  locale: Locale = "sv",
  options: { limit?: number } = {},
): AppWorldModel {
  const live = buildLiveWarehouse(items, locale === "en" ? "en" : "sv", options);
  const pickBySku = new Map(live.picks.map((pick) => [pick.sku, { x: pick.x, z: pick.z }]));
  const aisleXs = [...new Set(live.frames.filter((frame) => frame.band !== "pick").map((frame) => frame.x))].sort((a, b) => a - b);

  const categories: AppWorldCategory[] = [];
  const categoryIndex = new Map<string, number>();
  const addCategory = (category: string, value: number, status: LiveStatus): number => {
    let index = categoryIndex.get(category);
    if (index === undefined) {
      index = categories.length;
      categoryIndex.set(category, index);
      categories.push({
        index,
        category,
        racks: 0,
        value: 0,
        status: { balanced: 0, overstock: 0, stockout: 0, inactive: 0 },
      });
    }
    const entry = categories[index]!;
    entry.racks++;
    entry.value = Math.round(entry.value + value);
    entry.status[status] = (entry.status[status] ?? 0) + 1;
    return index;
  };

  if (live.mode === "hierarchical") {
    // Category filters still describe the full portfolio. Every article is
    // counted once even though the 3D layer aggregates them into clusters.
    for (const item of items) {
      addCategory(item.category ?? (locale === "en" ? "Uncategorised" : "Utan kategori"), item.value, liveStatus(item));
    }
    return { ...live, racks: [], categories };
  }

  const racks: AppWorldRack[] = live.slots.map((slot) => {
    const aisle = Math.max(0, aisleXs.indexOf(slot.x));
    const depth = Math.min(1, Math.max(0, (slot.z + 16) / 26));
    addCategory(slot.category ?? (locale === "en" ? "Uncategorised" : "Utan kategori"), slot.value, slot.status);
    return {
      ...slot,
      aisle,
      depth: Math.round(depth * 1000) / 1000,
      boxes: slot.pallets,
      pick: pickBySku.get(slot.sku) ?? null,
    };
  });

  return { ...live, racks, categories };
}

export interface OwnSimulation {
  params: WorldWhatIf;
  kpis: WorldKpis;
  counts: SceneModel["counts"];
  statusBySku: Record<string, string>;
}

/**
 * "What if" on the customer's own imported rows. Purely computational: the
 * caller decides whether anything is saved, and this function never writes.
 */
export function simulatePortfolio(
  items: ItemInput[],
  settings: { months: number; serviceLevel?: number },
  input: Partial<WorldWhatIf> = {},
  locale: Locale = "sv",
): OwnSimulation {
  const params = normalizeWhatIf(input);
  const adjusted = applyWhatIf(items, params, 30);
  const result = analyze(adjusted, { months: settings.months, serviceLevel: params.serviceLevel });
  const kpis = kpisOf(result);
  const scene = buildWarehouseScene(kpis, result.items.map(asSceneArticle), { locale });
  const statusBySku: Record<string, string> = {};
  for (const rack of scene.racks) statusBySku[rack.sku] = rack.status;
  return { params, kpis, counts: scene.counts, statusBySku };
}
