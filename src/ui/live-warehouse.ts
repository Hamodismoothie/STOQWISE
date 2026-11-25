/**
 * Live Warehouse 2.0: layout engine.
 *
 * The warehouse is a *simulated* layout derived from the same analysis the rest
 * of the app shows: no coordinates, quantities or statuses are invented here.
 * What this module adds is spatial strategy:
 *
 *   - Small layouts: A-band nearest dispatch, B in the middle, C farthest away.
 *   - Large layouts: category is the primary cluster, then ABC and XYZ so the
 *     warehouse filters remain exact without serialising every article.
 *   - Fast movers also get a pick face in the picking zone.
 *   - Inactive/obsolete articles are moved to a separate quarantine zone.
 *   - Pallet counts follow the article's stock, with a fill grade on the last
 *     pallet so "nearly empty" and "full" read differently.
 *
 * The renderer only draws what this module returns, which is what keeps the
 * digital twin and the table in agreement.
 */
import type { AbcClass, AnalyzedItem, XyzClass } from "../analysis.ts";
import { CLUSTER_BAYS, CLUSTER_LEVELS, LIVE_CLUSTER_SIZE, LIVE_DETAIL_SLOT_BUDGET, TECHNICAL_ITEM_CAPACITY } from "../capacity.ts";
export { LIVE_DETAIL_SLOT_BUDGET, TECHNICAL_ITEM_CAPACITY } from "../capacity.ts";

export type LiveStatus = "balanced" | "overstock" | "stockout" | "inactive";
export type LiveZoneId = "inbound" | "storage" | "picking" | "packing" | "outbound" | "inactive";
export type LiveBand = "A" | "B" | "C" | "inactive";

export interface LiveZone {
  id: LiveZoneId;
  label: string;
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface LiveFrame {
  x: number;
  z: number;
  bays: number;
  levels: number;
  band: LiveBand | "pick";
}

export interface LiveSlot {
  sku: string;
  name: string;
  category: string | null;
  abc: AbcClass;
  xyz: XyzClass | null;
  status: LiveStatus;
  pattern: "smooth" | "striped" | "dotted";
  zone: LiveZoneId;
  band: LiveBand;
  x: number;
  z: number;
  level: number;
  bay: number;
  pallets: number;
  fill: number;
  stock: number;
  value: number;
  reorderPoint: number;
  coverDays: number | null;
  leadTimeDays: number;
  avgMonthly: number;
  overstockQty: number;
  action: string;
  demand: number[];
}

export interface LivePick {
  sku: string;
  x: number;
  z: number;
  cartons: number;
  abc: AbcClass;
  xyz: XyzClass | null;
  status: LiveStatus;
}

export interface LiveBlock {
  /** Stable cluster identity at large volumes; absent for category blocks. */
  id?: string;
  band?: LiveBand;
  xyz?: XyzClass | null;
  articles?: number;
  firstSku?: string;
  lastSku?: string;
  /** Exact category represented by this block, used by warehouse filters. */
  categoryName?: string;
  category: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  value: number;
  racks: number;
  status: Record<LiveStatus, number>;
}

/** One expandable spatial cluster. It represents many articles without
 * serialising one slot object per article to the browser. */
export interface LiveCluster {
  id: string;
  index: number;
  band: LiveBand;
  xyz: XyzClass | null;
  zone: LiveZoneId;
  label: string;
  categoryName: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  articles: number;
  value: number;
  pallets: number;
  status: Record<LiveStatus, number>;
  firstSku: string;
  lastSku: string;
}

export interface LiveReplenishment {
  sku: string;
  name: string;
  qty: number;
  reason: "below_reorder" | "cover_short" | "empty";
  coverDays: number | null;
  reorderPoint: number;
  stock: number;
}

export interface LiveModel {
  mode: "racks" | "hierarchical";
  /** Maximum articles rendered in full detail before clusters are used. */
  limit: number;
  technicalCapacity: number;
  omitted: number;
  locale: "sv" | "en";
  floor: { w: number; d: number };
  zones: LiveZone[];
  frames: LiveFrame[];
  picks: LivePick[];
  slots: LiveSlot[];
  blocks: LiveBlock[];
  clusters: LiveCluster[];
  replenishment: LiveReplenishment[];
  summary: {
    articles: number;
    pallets: number;
    pickFaces: number;
    aisles: number;
    inboundDocks: number;
    outboundDocks: number;
    inactive: number;
    clusters: number;
    detailSlots: number;
  };
}

export const LEVELS = 5;
const BAY = 2.0;
const BAND_GAP = 0.55;
const AISLE_SPACING = 3.6;
const PICK_STEP = 1.7;
const PICK_ROWS: Array<{ z: number; band: "A" | "B"; xStart: number; xEnd: number }> = [
  { z: 12.1, band: "A", xStart: 3.4, xEnd: -18.6 },
  { z: 14.4, band: "B", xStart: 3.4, xEnd: -18.6 },
];

const BAND_Z: Record<Exclude<LiveBand, "inactive">, number> = { A: 1.6, B: -4.95, C: -11.5 };
const CLUSTER_W = 5.8;
const CLUSTER_D = 3.8;
const CLUSTER_GAP_X = 1.4;
const CLUSTER_GAP_Z = 1.4;

const round = (n: number, d = 2): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

export function liveStatus(item: Pick<AnalyzedItem, "action" | "stockoutRisk" | "overstockQty">): LiveStatus {
  if (item.action === "write_off" || item.action === "liquidate") return "inactive";
  if (item.stockoutRisk) return "stockout";
  if (item.overstockQty > 0) return "overstock";
  return "balanced";
}

const patternFor = (xyz: XyzClass | null): LiveSlot["pattern"] =>
  xyz === "X" ? "smooth" : xyz === "Y" ? "striped" : "dotted";

const lastMonths = (monthly: number[] | null, count = 12): number[] =>
  monthly ? monthly.slice(Math.max(0, monthly.length - count)) : [];

/** 75th percentile of positive stock, used to size a pallet so 2–4 pallets read. */
function palletUnit(items: AnalyzedItem[]): number {
  const stocks = items
    .map((item) => item.stock)
    .filter((stock) => Number.isFinite(stock) && stock > 0)
    .sort((a, b) => a - b);
  if (stocks.length === 0) return 1;
  const p75 = stocks[Math.floor((stocks.length - 1) * 0.75)] ?? stocks[stocks.length - 1]!;
  return Math.max(1, Math.round(p75 / 3));
}

export function buildLiveWarehouse(
  items: AnalyzedItem[],
  locale: "sv" | "en" = "sv",
  options: { limit?: number; detailLimit?: number } = {},
): LiveModel {
  const limit = options.detailLimit ?? options.limit ?? LIVE_DETAIL_SLOT_BUDGET;
  if (items.length > limit) return hierarchicalWarehouse(items, locale, limit);

  const floor = { w: 96, d: 54 };
  const zones: LiveZone[] = [
    { id: "inbound", label: locale === "en" ? "Inbound" : "Inleverans", x: -30, z: -21.5, w: 34, d: 7 },
    { id: "storage", label: locale === "en" ? "Storage" : "Lagring", x: 0, z: -2.5, w: 84, d: 24 },
    { id: "picking", label: locale === "en" ? "Picking" : "Plockzon", x: -8, z: 13.2, w: 32, d: 6.6 },
    { id: "packing", label: locale === "en" ? "Packing" : "Packning", x: 18, z: 17.2, w: 20, d: 6.4 },
    { id: "outbound", label: locale === "en" ? "Outbound" : "Utlastning", x: 24, z: 23, w: 40, d: 7 },
    { id: "inactive", label: locale === "en" ? "Inactive stock" : "Inaktivt lager", x: -43, z: 11, w: 10, d: 14 },
  ];

  const unit = palletUnit(items);
  const withStatus = items.map((item) => ({ item, status: liveStatus(item) }));
  const inactive = withStatus.filter((entry) => entry.status === "inactive");
  const active = withStatus.filter((entry) => entry.status !== "inactive");

  const levels = LEVELS;
  const bays = 3;
  const frameBands: Array<Exclude<LiveBand, "inactive">> = ["A", "B", "C"];
  const byBand: Record<"A" | "B" | "C", typeof active> = { A: [], B: [], C: [] };
  for (const entry of active) byBand[entry.item.abc].push(entry);
  for (const band of frameBands) byBand[band].sort((a, b) => b.item.value - a.item.value || a.item.sku.localeCompare(b.item.sku));

  // Each band gets exactly the aisles its own articles need. The old fixed 22
  // aisle ceiling silently stacked overflow into the last aisle, which is why
  // the previous hard 900-article display limit existed. This has no ceiling.
  const aislesByBand: Record<"A" | "B" | "C", number> = {
    A: Math.max(6, Math.ceil(byBand.A.length / (bays * levels))),
    B: Math.max(6, Math.ceil(byBand.B.length / (bays * levels))),
    C: Math.max(6, Math.ceil(byBand.C.length / (bays * levels))),
  };
  const aisleXByBand: Record<"A" | "B" | "C", number[]> = {
    A: [],
    B: [],
    C: [],
  };
  for (const band of frameBands) {
    const count = aislesByBand[band];
    aisleXByBand[band] = Array.from({ length: count }, (_, index) => round((index - (count - 1) / 2) * AISLE_SPACING));
  }
  const maxAisles = Math.max(...frameBands.map((band) => aislesByBand[band]));
  floor.w = round(Math.max(96, maxAisles * AISLE_SPACING + 52));
  zones[1] = { ...zones[1]!, w: floor.w - 12 };
  zones[0] = { ...zones[0]!, x: -floor.w / 2 + 20 };
  zones[5] = { ...zones[5]!, x: -floor.w / 2 + 7 };

  const frames: LiveFrame[] = [];
  for (const band of frameBands) {
    // Bands stay in one x grid and are separated in z. The previous x shift
    // made band B/C overlap the next aisle once the rack count grew.
    for (const x of aisleXByBand[band]) frames.push({ x, z: BAND_Z[band], bays, levels, band });
  }

  const pickFrames: LiveFrame[] = PICK_ROWS.map((row) => ({ x: (row.xStart + row.xEnd) / 2, z: row.z, bays: 10, levels: 1, band: "pick" }));
  frames.push(...pickFrames);

  const inactivePerRack = 4 * 4;
  const inactiveRacks = Math.max(2, Math.ceil(inactive.length / inactivePerRack));
  const inactiveCols = Math.min(8, Math.max(2, Math.ceil(Math.sqrt(inactiveRacks))));
  const inactiveX: number[] = [];
  const inactiveZ: number[] = [];
  for (let index = 0; index < inactiveRacks; index++) {
    const col = index % inactiveCols;
    const row = Math.floor(index / inactiveCols);
    inactiveX.push(round(-floor.w / 2 + 7 + col * 3.2));
    inactiveZ.push(round(4.6 + row * (4 * BAY + 1.2)));
    frames.push({ x: inactiveX[index]!, z: inactiveZ[index]!, bays: 4, levels: 4, band: "inactive" });
  }
  const inactiveDepth = (Math.ceil(inactiveRacks / inactiveCols) - 1) * (4 * BAY + 1.2) + 4 * BAY + 1;
  floor.d = round(Math.max(floor.d, 4.6 + inactiveDepth + 3));
  zones[5] = { ...zones[5]!, w: inactiveCols * 3.2 + 3, d: inactiveDepth };

  /* ---- slot assignment -------------------------------------------------- */
  const slots: LiveSlot[] = [];
  const ordered = byBand;

  let pickA = 0;
  let pickB = 0;
  const picks: LivePick[] = [];

  function place(entry: (typeof active)[number], band: "A" | "B" | "C", index: number, zone: LiveZoneId = "storage"): LiveSlot {
    const perAisle = bays * levels;
    const aisleIndex = Math.floor(index / perAisle);
    const inAisle = index % perAisle;
    const bay = Math.floor(inAisle / levels);
    const level = inAisle % levels;
    const x = aisleXByBand[band][aisleIndex] ?? aisleXByBand[band][aisleXByBand[band].length - 1]!;
    // Bay 0 is nearest the dispatch end of the band.
    const z = round(BAND_Z[band] + (bays - 1 - bay) * BAY + BAY / 2 + BAND_GAP / 2);
    const stock = entry.item.stock;
    const pallets = stock > 0 ? clamp(Math.ceil(stock / unit), 1, 4) : 0;
    const fill = stock > 0 ? clamp((stock % unit === 0 ? unit : stock % unit) / unit, 0.12, 1) : 0;
    return {
      sku: entry.item.sku,
      name: entry.item.name,
      category: entry.item.category,
      abc: entry.item.abc,
      xyz: entry.item.xyz,
      status: entry.status,
      pattern: patternFor(entry.item.xyz),
      zone,
      band,
      x,
      z,
      level,
      bay,
      pallets,
      fill: round(fill, 3),
      stock,
      value: round(entry.item.value, 2),
      reorderPoint: round(entry.item.reorderPoint, 1),
      coverDays: entry.item.coverDays,
      leadTimeDays: entry.item.leadTimeDays,
      avgMonthly: entry.item.avgMonthlyDemand,
      overstockQty: entry.item.overstockQty,
      action: entry.item.action,
      demand: lastMonths(entry.item.monthlyDemand, 12),
    };
  }

  for (const band of frameBands) {
    ordered[band].forEach((entry, index) => slots.push(place(entry, band, index)));
  }

  // Pick faces: A first (nearest dispatch), then B. Capacity is the number of
  // pick positions on the two rows.
  const pickCapacityA = 13;
  const pickCapacityB = 13;
  for (const band of ["A", "B"] as const) {
    const list = ordered[band];
    const capacity = band === "A" ? pickCapacityA : pickCapacityB;
    const row = PICK_ROWS.find((entry) => entry.band === band)!;
    list.slice(0, capacity).forEach((entry) => {
      const index = band === "A" ? pickA++ : pickB++;
      const x = round(row.xStart + (row.xEnd - row.xStart) * (index / Math.max(1, capacity - 1)));
      picks.push({
        sku: entry.item.sku,
        x,
        z: row.z,
        cartons: clamp(Math.ceil((entry.item.coverDays ?? 30) / 30), 1, 6),
        abc: entry.item.abc,
        xyz: entry.item.xyz,
        status: entry.status,
      });
    });
  }

  // Inactive items get their own fenced zone. The rack count follows the data,
  // so quarantine never spills back into the C-band racks.
  inactive.forEach((entry, index) => {
    const rack = Math.floor(index / inactivePerRack);
    const inRack = index % inactivePerRack;
    const bay = Math.floor(inRack / 4);
    const level = inRack % 4;
    const stock = entry.item.stock;
    const pallets = stock > 0 ? clamp(Math.ceil(stock / unit), 1, 3) : 0;
    slots.push({
      sku: entry.item.sku,
      name: entry.item.name,
      category: entry.item.category,
      abc: entry.item.abc,
      xyz: entry.item.xyz,
      status: "inactive",
      pattern: patternFor(entry.item.xyz),
      zone: "inactive",
      band: "inactive",
      x: inactiveX[rack] ?? inactiveX[0]!,
      z: round((inactiveZ[rack] ?? 4.6) + (4 - 1 - bay) * BAY + BAY / 2),
      level,
      bay,
      pallets,
      fill: stock > 0 ? clamp((stock % unit === 0 ? unit : stock % unit) / unit, 0.12, 1) : 0,
      stock,
      value: round(entry.item.value, 2),
      reorderPoint: round(entry.item.reorderPoint, 1),
      coverDays: entry.item.coverDays,
      leadTimeDays: entry.item.leadTimeDays,
      avgMonthly: entry.item.avgMonthlyDemand,
      overstockQty: entry.item.overstockQty,
      action: entry.item.action,
      demand: lastMonths(entry.item.monthlyDemand, 12),
    });
  });

  return {
    mode: "racks",
    limit,
    technicalCapacity: TECHNICAL_ITEM_CAPACITY,
    omitted: 0,
    locale,
    floor,
    zones,
    frames,
    picks,
    slots,
    blocks: [],
    clusters: [],
    replenishment: replenishList(items, 8),
    summary: {
      articles: slots.length,
      pallets: slots.reduce((sum, slot) => sum + slot.pallets, 0),
      pickFaces: picks.length,
      aisles: frameBands.reduce((sum, band) => sum + aislesByBand[band], 0) + inactiveRacks,
      inboundDocks: 2,
      outboundDocks: 3,
      inactive: inactive.length,
      clusters: 0,
      detailSlots: slots.length,
    },
  };
}

type ClusterGroup = { category: string; band: LiveBand; xyz: XyzClass | null; items: AnalyzedItem[]; active: boolean };

export function liveCategory(item: Pick<AnalyzedItem, "category">, locale: "sv" | "en" = "sv"): string {
  return item.category?.trim() || (locale === "en" ? "Uncategorised" : "Utan kategori");
}

function bandOf(item: AnalyzedItem): LiveBand {
  return liveStatus(item) === "inactive" ? "inactive" : item.abc;
}

function xyzKey(item: AnalyzedItem): string {
  return item.xyz ?? "none";
}

/**
 * Deterministic category + ABC groups used by the overview, cluster expansion
 * and search locator. Grouping on category first makes the category filter
 * meaningful in aggregate mode; grouping on band keeps ABC filters exact.
 */
function clusterGroups(items: AnalyzedItem[], locale: "sv" | "en"): ClusterGroup[] {
  const byCategory = new Map<string, AnalyzedItem[]>();
  for (const item of items) {
    const category = liveCategory(item, locale);
    const list = byCategory.get(category);
    if (list) list.push(item);
    else byCategory.set(category, [item]);
  }
  const ranked = [...byCategory.entries()]
    .map(([category, list]) => ({
      category,
      list,
      total: list.reduce((sum, item) => sum + item.value, 0),
    }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category, locale === "en" ? "en" : "sv"));
  const order: LiveBand[] = ["A", "B", "C", "inactive"];
  const xyzOrder: Array<XyzClass | null> = ["X", "Y", "Z", null];
  const groups: ClusterGroup[] = [];
  for (const category of ranked) {
    const bands: Record<LiveBand, AnalyzedItem[]> = { A: [], B: [], C: [], inactive: [] };
    for (const item of category.list) bands[bandOf(item)].push(item);
    for (const band of order) {
      if (!bands[band].length) continue;
      for (const xyz of xyzOrder) {
        const chunk = bands[band].filter((item) => (item.xyz ?? null) === xyz);
        if (!chunk.length) continue;
        groups.push({
          category: category.category,
          band,
          xyz,
          items: chunk.sort((a, b) => b.value - a.value || a.sku.localeCompare(b.sku)),
          active: band !== "inactive",
        });
      }
    }
  }
  return groups;
}

function clusterGrid(total: number): { columns: number; rows: number; width: number; depth: number } {
  const columns = Math.max(4, Math.ceil(Math.sqrt(Math.max(1, total))));
  const rows = Math.max(1, Math.ceil(total / columns));
  return {
    columns,
    rows,
    width: columns * CLUSTER_W + (columns - 1) * CLUSTER_GAP_X,
    depth: rows * CLUSTER_D + (rows - 1) * CLUSTER_GAP_Z,
  };
}

function clusterPoint(index: number, total: number): { x: number; z: number; columns: number; width: number; depth: number } {
  const grid = clusterGrid(total);
  const col = index % grid.columns;
  const row = Math.floor(index / grid.columns);
  return {
    columns: grid.columns,
    width: grid.width,
    depth: grid.depth,
    x: round((col - (grid.columns - 1) / 2) * (CLUSTER_W + CLUSTER_GAP_X)),
    z: round((row - (grid.rows - 1) / 2) * (CLUSTER_D + CLUSTER_GAP_Z)),
  };
}

/** Cluster layout above the detail budget: every article belongs to exactly one
 * cluster, and every cluster can be expanded into its individual slots. */
function hierarchicalWarehouse(items: AnalyzedItem[], locale: "sv" | "en", limit: number): LiveModel {
  const groups = clusterGroups(items, locale);
  const totalClusters = groups.reduce((sum, group) => sum + Math.ceil(group.items.length / LIVE_CLUSTER_SIZE), 0);
  const grid = clusterGrid(totalClusters);
  const floor = { w: round(grid.width + 26), d: round(grid.depth + 26) };
  const zones: LiveZone[] = [
    { id: "inbound", label: locale === "en" ? "Inbound" : "Inleverans", x: -floor.w / 2 + 20, z: -floor.d / 2 - 4, w: 34, d: 7 },
    { id: "storage", label: locale === "en" ? "Storage" : "Lagring", x: 0, z: 0, w: floor.w - 10, d: floor.d - 8 },
    { id: "picking", label: locale === "en" ? "Picking" : "Plockzon", x: -8, z: floor.d / 2 - 1, w: 32, d: 6.6 },
    { id: "packing", label: locale === "en" ? "Packing" : "Packning", x: 18, z: floor.d / 2 + 3, w: 20, d: 6.4 },
    { id: "outbound", label: locale === "en" ? "Outbound" : "Utlastning", x: 24, z: floor.d / 2 + 9, w: 40, d: 7 },
    { id: "inactive", label: locale === "en" ? "Inactive stock" : "Inaktivt lager", x: -floor.w / 2 + 8, z: floor.d / 2 - 1, w: 10, d: 14 },
  ];
  const unit = palletUnit(items);
  const clusters: LiveCluster[] = [];
  const blocks: LiveBlock[] = [];
  let globalIndex = 0;
  let totalPallets = 0;
  const inactiveCount = groups.filter((group) => group.band === "inactive").reduce((sum, group) => sum + group.items.length, 0);

  for (const group of groups) {
    for (let start = 0; start < group.items.length; start += LIVE_CLUSTER_SIZE) {
      const chunk = group.items.slice(start, start + LIVE_CLUSTER_SIZE);
      const point = clusterPoint(globalIndex, totalClusters);
      let value = 0;
      let pallets = 0;
      const status: Record<LiveStatus, number> = { balanced: 0, overstock: 0, stockout: 0, inactive: 0 };
      for (const item of chunk) {
        value += item.value;
        pallets += item.stock > 0 ? clamp(Math.ceil(item.stock / unit), 1, 4) : 0;
        status[liveStatus(item)]++;
      }
      totalPallets += pallets;
      const first = start + 1;
      const last = start + chunk.length;
      const label = `${group.category} · ${group.band}${group.xyz ?? "–"} · ${first.toLocaleString(locale === "en" ? "en-US" : "sv-SE")}–${last.toLocaleString(locale === "en" ? "en-US" : "sv-SE")}`;
      const height = round(clamp(1.2 + Math.log10(1 + value) * 0.72 + Math.log10(1 + chunk.length) * 0.55, 1.2, 14));
      const cluster: LiveCluster = {
        id: `cluster-${globalIndex}`,
        index: globalIndex,
        band: group.band,
        xyz: group.xyz,
        zone: group.active ? "storage" : "inactive",
        label,
        categoryName: group.category,
        x: point.x,
        z: point.z,
        w: CLUSTER_W,
        d: CLUSTER_D,
        h: height,
        articles: chunk.length,
        value: Math.round(value),
        pallets,
        status,
        firstSku: chunk[0]!.sku,
        lastSku: chunk[chunk.length - 1]!.sku,
      };
      clusters.push(cluster);
      blocks.push({
        id: cluster.id,
        band: cluster.band,
        xyz: cluster.xyz,
        articles: cluster.articles,
        firstSku: cluster.firstSku,
        lastSku: cluster.lastSku,
        categoryName: group.category,
        category: label,
        x: cluster.x,
        z: cluster.z,
        w: cluster.w,
        d: cluster.d,
        h: cluster.h,
        value: cluster.value,
        racks: cluster.articles,
        status: cluster.status,
      });
      globalIndex++;
    }
  }

  return {
    mode: "hierarchical",
    limit,
    technicalCapacity: TECHNICAL_ITEM_CAPACITY,
    omitted: 0,
    locale,
    floor,
    zones,
    frames: [],
    picks: [],
    slots: [],
    blocks,
    clusters,
    replenishment: replenishList(items, 8),
    summary: {
      articles: items.length,
      pallets: totalPallets,
      pickFaces: 0,
      aisles: clusters.length,
      inboundDocks: 2,
      outboundDocks: 3,
      inactive: inactiveCount,
      clusters: clusters.length,
      detailSlots: 0,
    },
  };
}

export interface LiveLocation {
  x: number;
  z: number;
  level: number;
  bay: number;
  clusterId: string | null;
  clusterIndex: number | null;
  clusterLabel: string | null;
  slotInCluster: number | null;
  band: LiveBand;
  zone: LiveZoneId;
  aisle: number;
}

function clusterDetailPoint(cluster: Pick<LiveCluster, "x" | "z" | "w" | "d">, index: number): { x: number; z: number; level: number } {
  const level = Math.floor(index / (CLUSTER_BAYS * CLUSTER_BAYS)) % CLUSTER_LEVELS;
  const floor = index % (CLUSTER_BAYS * CLUSTER_BAYS);
  const col = floor % CLUSTER_BAYS;
  const depth = Math.floor(floor / CLUSTER_BAYS);
  return {
    x: round(cluster.x + (col - (CLUSTER_BAYS - 1) / 2) * (cluster.w / (CLUSTER_BAYS + 0.5))),
    z: round(cluster.z + (depth - (CLUSTER_BAYS - 1) / 2) * (cluster.d / (CLUSTER_BAYS + 0.5))),
    level,
  };
}

/**
 * Resolve any SKU to its exact logical and spatial position without building
 * the whole world. This is what makes every article individually accessible
 * while the overview only renders clusters.
 */
export function locateLiveArticle(
  items: AnalyzedItem[],
  sku: string,
  locale: "sv" | "en" = "sv",
  options: { detailLimit?: number } = {},
): LiveLocation | null {
  const limit = options.detailLimit ?? LIVE_DETAIL_SLOT_BUDGET;
  const target = items.find((item) => item.sku === sku);
  if (!target) return null;
  const status = liveStatus(target);
  const band: LiveBand = status === "inactive" ? "inactive" : target.abc;

  if (items.length <= limit) {
    const model = buildLiveWarehouse(items, locale, { detailLimit: limit });
    const slot = model.slots.find((entry) => entry.sku === sku);
    if (!slot) return null;
    return {
      x: slot.x,
      z: slot.z,
      level: slot.level,
      bay: slot.bay,
      clusterId: null,
      clusterIndex: null,
      clusterLabel: null,
      slotInCluster: null,
      band: slot.band,
      zone: slot.zone,
      aisle: Math.max(0, model.frames.filter((frame) => frame.band === slot.band).findIndex((frame) => Math.abs(frame.x - slot.x) < 0.01)),
    };
  }

  // Above the detail budget we only need the target's rank inside its
  // category, band and XYZ class. Counting the items ranked before it is O(n)
  // and avoids sorting 500k rows on every keystroke.
  const order: LiveBand[] = ["A", "B", "C", "inactive"];
  const xyzOrder = ["X", "Y", "Z", "none"];
  const emptyGroups = (): Record<LiveBand, Record<string, number>> => ({
    A: { X: 0, Y: 0, Z: 0, none: 0 },
    B: { X: 0, Y: 0, Z: 0, none: 0 },
    C: { X: 0, Y: 0, Z: 0, none: 0 },
    inactive: { X: 0, Y: 0, Z: 0, none: 0 },
  });
  const targetCategory = liveCategory(target, locale);
  const targetXyz = xyzKey(target);
  const categories = new Map<string, { total: number; groups: Record<LiveBand, Record<string, number>> }>();
  let index = 0;
  for (const item of items) {
    const category = liveCategory(item, locale);
    const entry = categories.get(category) ?? { total: 0, groups: emptyGroups() };
    const itemBand = bandOf(item);
    const itemXyz = xyzKey(item);
    entry.total += item.value;
    entry.groups[itemBand][itemXyz] = (entry.groups[itemBand][itemXyz] ?? 0) + 1;
    categories.set(category, entry);
    if (
      category === targetCategory &&
      itemBand === band &&
      itemXyz === targetXyz &&
      item.sku !== target.sku &&
      (item.value > target.value || (item.value === target.value && item.sku.localeCompare(target.sku) < 0))
    ) {
      index++;
    }
  }
  const rankedCategories = [...categories.entries()].sort(
    (a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0], locale === "en" ? "en" : "sv"),
  );
  const clusterCount = (entry: { groups: Record<LiveBand, Record<string, number>> }): number =>
    order.reduce(
      (sum, bandKey) => sum + xyzOrder.reduce((xyzSum, key) => xyzSum + Math.ceil((entry.groups[bandKey][key] ?? 0) / LIVE_CLUSTER_SIZE), 0),
      0,
    );
  const totalClusters = rankedCategories.reduce(
    (sum, [, entry]) => sum + clusterCount(entry),
    0,
  );
  let offset = 0;
  for (const [category, entry] of rankedCategories) {
    if (category === targetCategory) break;
    offset += clusterCount(entry);
  }
  const counts = categories.get(targetCategory)!.groups;
  for (const bandKey of order.slice(0, order.indexOf(band))) {
    for (const key of xyzOrder) offset += Math.ceil((counts[bandKey][key] ?? 0) / LIVE_CLUSTER_SIZE);
  }
  for (const key of xyzOrder.slice(0, xyzOrder.indexOf(targetXyz))) {
    offset += Math.ceil((counts[band][key] ?? 0) / LIVE_CLUSTER_SIZE);
  }
  const clusterIndex = offset + Math.floor(index / LIVE_CLUSTER_SIZE);
  const slotInCluster = index % LIVE_CLUSTER_SIZE;
  const point = clusterPoint(clusterIndex, totalClusters);
  const chunkStart = Math.floor(index / LIVE_CLUSTER_SIZE) * LIVE_CLUSTER_SIZE;
  const groupCount = counts[band][targetXyz] ?? 0;
  const chunkLength = Math.min(LIVE_CLUSTER_SIZE, groupCount - chunkStart);
  const label = `${targetCategory} · ${band}${target.xyz ?? "–"} · ${(chunkStart + 1).toLocaleString(locale === "en" ? "en-US" : "sv-SE")}–${(chunkStart + chunkLength).toLocaleString(locale === "en" ? "en-US" : "sv-SE")}`;
  const detail = clusterDetailPoint({ x: point.x, z: point.z, w: CLUSTER_W, d: CLUSTER_D }, slotInCluster);
  return {
    ...detail,
    bay: Math.floor(slotInCluster / CLUSTER_LEVELS) % CLUSTER_BAYS,
    clusterId: `cluster-${clusterIndex}`,
    clusterIndex,
    clusterLabel: label,
    slotInCluster,
    band,
    zone: band === "inactive" ? "inactive" : "storage",
    aisle: Math.floor(index / 60) + 1,
  };
}

/**
 * Resolve several SKUs in one pass. The warehouse search shows up to 12 hits;
 * calling the single-SKU locator for each would scan the 500k portfolio 12
 * times and break the search latency target. Small portfolios reuse one built
 * model; large ones share category totals and cluster offsets across all hits.
 */
export function locateLiveArticles(
  items: AnalyzedItem[],
  skus: string[],
  locale: "sv" | "en" = "sv",
  options: { detailLimit?: number } = {},
): Map<string, LiveLocation> {
  const limit = options.detailLimit ?? LIVE_DETAIL_SLOT_BUDGET;
  const wanted = new Set(skus);
  const targets = new Map<string, AnalyzedItem>();
  for (const item of items) if (wanted.has(item.sku)) targets.set(item.sku, item);
  const result = new Map<string, LiveLocation>();

  if (items.length <= limit) {
    const model = buildLiveWarehouse(items, locale, { detailLimit: limit });
    const slotBySku = new Map(model.slots.map((slot) => [slot.sku, slot]));
    for (const sku of targets.keys()) {
      const slot = slotBySku.get(sku);
      if (!slot) continue;
      result.set(sku, {
        x: slot.x,
        z: slot.z,
        level: slot.level,
        bay: slot.bay,
        clusterId: null,
        clusterIndex: null,
        clusterLabel: null,
        slotInCluster: null,
        band: slot.band,
        zone: slot.zone,
        aisle: Math.max(0, model.frames.filter((frame) => frame.band === slot.band).findIndex((frame) => Math.abs(frame.x - slot.x) < 0.01)),
      });
    }
    return result;
  }

  const order: LiveBand[] = ["A", "B", "C", "inactive"];
  const xyzOrder = ["X", "Y", "Z", "none"];
  const groupsOf = (): Record<LiveBand, Record<string, number>> => ({
    A: { X: 0, Y: 0, Z: 0, none: 0 },
    B: { X: 0, Y: 0, Z: 0, none: 0 },
    C: { X: 0, Y: 0, Z: 0, none: 0 },
    inactive: { X: 0, Y: 0, Z: 0, none: 0 },
  });
  const categories = new Map<string, { total: number; groups: Record<LiveBand, Record<string, number>> }>();
  type Pending = { sku: string; target: AnalyzedItem; band: LiveBand; category: string; xyz: string; rank: number };
  const pending: Pending[] = [];
  const byGroup = new Map<string, Pending[]>();
  for (const [sku, target] of targets) {
    const band = bandOf(target);
    const category = liveCategory(target, locale);
    const xyz = xyzKey(target);
    const entry: Pending = { sku, target, band, category, xyz, rank: 0 };
    pending.push(entry);
    const key = `${category}\u0000${band}\u0000${xyz}`;
    const list = byGroup.get(key);
    if (list) list.push(entry);
    else byGroup.set(key, [entry]);
  }

  for (const item of items) {
    const category = liveCategory(item, locale);
    const band = bandOf(item);
    const xyz = xyzKey(item);
    const stats = categories.get(category) ?? { total: 0, groups: groupsOf() };
    stats.total += item.value;
    stats.groups[band][xyz] = (stats.groups[band][xyz] ?? 0) + 1;
    categories.set(category, stats);
    const candidates = byGroup.get(`${category}\u0000${band}\u0000${xyz}`);
    if (!candidates) continue;
    for (const entry of candidates) {
      if (
        item.sku !== entry.sku &&
        (item.value > entry.target.value ||
          (item.value === entry.target.value && item.sku.localeCompare(entry.sku) < 0))
      ) {
        entry.rank++;
      }
    }
  }

  const rankedCategories = [...categories.entries()].sort(
    (a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0], locale === "en" ? "en" : "sv"),
  );
  const offsets = new Map<string, { offset: number; count: number }>();
  let totalClusters = 0;
  for (const [category, entry] of rankedCategories) {
    for (const band of order) {
      for (const xyz of xyzOrder) {
        const count = entry.groups[band][xyz] ?? 0;
        if (!count) continue;
        offsets.set(`${category}\u0000${band}\u0000${xyz}`, { offset: totalClusters, count });
        totalClusters += Math.ceil(count / LIVE_CLUSTER_SIZE);
      }
    }
  }

  for (const entry of pending) {
    const group = offsets.get(`${entry.category}\u0000${entry.band}\u0000${entry.xyz}`);
    if (!group) continue;
    const clusterIndex = group.offset + Math.floor(entry.rank / LIVE_CLUSTER_SIZE);
    const slotInCluster = entry.rank % LIVE_CLUSTER_SIZE;
    const point = clusterPoint(clusterIndex, totalClusters);
    const chunkStart = Math.floor(entry.rank / LIVE_CLUSTER_SIZE) * LIVE_CLUSTER_SIZE;
    const chunkLength = Math.min(LIVE_CLUSTER_SIZE, group.count - chunkStart);
    const label = `${entry.category} · ${entry.band}${entry.target.xyz ?? "–"} · ${(chunkStart + 1).toLocaleString(locale === "en" ? "en-US" : "sv-SE")}–${(chunkStart + chunkLength).toLocaleString(locale === "en" ? "en-US" : "sv-SE")}`;
    const detail = clusterDetailPoint({ x: point.x, z: point.z, w: CLUSTER_W, d: CLUSTER_D }, slotInCluster);
    result.set(entry.sku, {
      ...detail,
      bay: Math.floor(slotInCluster / CLUSTER_LEVELS) % CLUSTER_BAYS,
      clusterId: `cluster-${clusterIndex}`,
      clusterIndex,
      clusterLabel: label,
      slotInCluster,
      band: entry.band,
      zone: entry.band === "inactive" ? "inactive" : "storage",
      aisle: Math.floor(entry.rank / 60) + 1,
    });
  }
  return result;
}

/** Expand one cluster into individual selectable articles. The returned
 * positions use the same grid as locateLiveArticle, so search and cluster
 * expansion always point at the same place. */
export function liveClusterDetail(
  items: AnalyzedItem[],
  clusterIndex: number,
  locale: "sv" | "en" = "sv",
): { cluster: LiveCluster; slots: Array<Pick<LiveSlot, "sku" | "name" | "category" | "abc" | "xyz" | "status" | "stock" | "value" | "pallets" | "level" | "x" | "z" | "band" | "zone">> } | null {
  // A cluster is opened repeatedly while a user inspects its articles. Cache the
  // tiny 250-row result per analysis array; the analysis itself stays weakly
  // referenced and can be collected normally.
  const cacheKey = `${locale}:${clusterIndex}`;
  const cached = clusterCache.get(items)?.get(cacheKey);
  if (cached) return cached;
  const groups = clusterGroups(items, locale);
  const totalClusters = groups.reduce((sum, group) => sum + Math.ceil(group.items.length / LIVE_CLUSTER_SIZE), 0);
  if (!Number.isInteger(clusterIndex) || clusterIndex < 0 || clusterIndex >= totalClusters) return null;
  let offset = 0;
  for (const group of groups) {
    const count = Math.ceil(group.items.length / LIVE_CLUSTER_SIZE);
    if (clusterIndex < offset + count) {
      const local = clusterIndex - offset;
      const start = local * LIVE_CLUSTER_SIZE;
      const chunk = group.items.slice(start, start + LIVE_CLUSTER_SIZE);
      const point = clusterPoint(clusterIndex, totalClusters);
      const first = start + 1;
      const last = start + chunk.length;
      const label = `${group.category} · ${group.band}${group.xyz ?? "–"} · ${first.toLocaleString(locale === "en" ? "en-US" : "sv-SE")}–${last.toLocaleString(locale === "en" ? "en-US" : "sv-SE")}`;
      const zone: LiveZoneId = group.active ? "storage" : "inactive";
      const unit = palletUnit(items);
      let value = 0;
      const status: Record<LiveStatus, number> = { balanced: 0, overstock: 0, stockout: 0, inactive: 0 };
      const slots = chunk.map((item, index) => {
        value += item.value;
        status[liveStatus(item)]++;
        const detail = clusterDetailPoint({ x: point.x, z: point.z, w: CLUSTER_W, d: CLUSTER_D }, index);
        return {
          sku: item.sku,
          name: item.name,
          category: item.category,
          abc: item.abc,
          xyz: item.xyz,
          status: liveStatus(item),
          stock: item.stock,
          value: round(item.value, 2),
          pallets: item.stock > 0 ? clamp(Math.ceil(item.stock / unit), 1, 4) : 0,
          ...detail,
          band: group.band,
          zone,
        };
      });
      const detail = {
        cluster: {
          id: `cluster-${clusterIndex}`,
          index: clusterIndex,
          band: group.band,
          xyz: group.xyz,
          zone,
          label,
          categoryName: group.category,
          x: point.x,
          z: point.z,
          w: CLUSTER_W,
          d: CLUSTER_D,
          h: round(clamp(1.2 + Math.log10(1 + value) * 0.72 + Math.log10(1 + chunk.length) * 0.55, 1.2, 14)),
          articles: chunk.length,
          value: Math.round(value),
          pallets: slots.reduce((sum, slot) => sum + slot.pallets, 0),
          status,
          firstSku: chunk[0]!.sku,
          lastSku: chunk[chunk.length - 1]!.sku,
        },
        slots,
      };
      let byIndex = clusterCache.get(items);
      if (!byIndex) {
        byIndex = new Map();
        clusterCache.set(items, byIndex);
      }
      byIndex.set(cacheKey, detail);
      return detail;
    }
    offset += count;
  }
  return null;
}

const clusterCache = new WeakMap<AnalyzedItem[], Map<string, { cluster: LiveCluster; slots: Array<Pick<LiveSlot, "sku" | "name" | "category" | "abc" | "xyz" | "status" | "stock" | "value" | "pallets" | "level" | "x" | "z" | "band" | "zone">> }>>();

/** Articles a purchaser should refill first, straight from the analysis engine. */
export function replenishList(items: AnalyzedItem[], limit = 8): LiveReplenishment[] {
  return items
    .map((item) => {
      const available = item.available;
      const belowReorder = available <= item.reorderPoint;
      const shortCover = item.coverDays !== null && item.coverDays < item.leadTimeDays;
      if (!belowReorder && !shortCover) return null;
      const qty = Math.max(1, Math.ceil(item.reorderPoint - available));
      const reason: LiveReplenishment["reason"] = item.stock <= 0 ? "empty" : belowReorder ? "below_reorder" : "cover_short";
      return {
        sku: item.sku,
        name: item.name,
        qty,
        reason,
        coverDays: item.coverDays,
        reorderPoint: round(item.reorderPoint, 1),
        stock: item.stock,
      };
    })
    .filter((entry): entry is LiveReplenishment => entry !== null)
    .sort((a, b) => {
      const rank = { empty: 0, below_reorder: 1, cover_short: 2 } as const;
      return rank[a.reason] - rank[b.reason] || (a.coverDays ?? 999) - (b.coverDays ?? 999);
    })
    .slice(0, limit);
}
