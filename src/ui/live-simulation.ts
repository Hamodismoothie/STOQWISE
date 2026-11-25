/**
 * Live Warehouse: deterministic warehouse simulation.
 *
 * This is the functional engine behind the Live Warehouse playback. It works on
 * the same analysed articles and simulated slots as the 3D model and never
 * reads or writes the customer's real stock. A run is a pure function of
 * (articles, scenario, seed, start date): the same inputs always produce the
 * same states and events, which is what makes what-if scenarios reproducible.
 *
 * The engine is also transpiled and served to the browser as
 * `/world/sim-engine.js`, so playback, the table and the tests use one model.
 */

import type { AnalyzedItem } from "../analysis.ts";
import type { LiveModel } from "./live-warehouse.ts";

export type SimStatus = "balanced" | "overstock" | "stockout" | "inactive";
export type SimPreset = "normal" | "peak" | "supply" | "stress" | "custom";

export type SimEventType =
  | "delivery_arrived"
  | "delivery_delayed"
  | "order_picked"
  | "shipment_sent"
  | "replenishment_needed"
  | "low_stock"
  | "overstock"
  | "stockout"
  | "count_mismatch"
  | "transfer"
  | "demand_spike";

export type SimZone = "inbound" | "storage" | "picking" | "packing" | "outbound" | "inactive";

export interface SimArticle {
  sku: string;
  name: string;
  category: string | null;
  abc: "A" | "B" | "C";
  xyz: "X" | "Y" | "Z" | null;
  status: SimStatus;
  zone: SimZone;
  stock: number;
  cost: number;
  price: number | null;
  avgMonthly: number;
  leadTimeDays: number;
  safetyStock: number;
  reorderPoint: number;
  overstockQty: number;
  moq: number;
  hasPick: boolean;
}

export interface SimulationScenario {
  preset: SimPreset;
  days: number;
  /** Percent change in demand, -50…100. */
  demandPct: number;
  /** Added days to every new purchase order's lead time. */
  leadDays: number;
  /** Percent change in safety stock, -50…100. */
  safetyPct: number;
  /** Percent change in MOQ, -50…200. */
  moqPct: number;
  /** Make late deliveries part of the scenario. */
  delayDeliveries: boolean;
  /** Share of deliveries that arrive late when delayDeliveries is on. */
  delayRate: number;
  /** One article gets an extra sales boost; null means none. */
  sku: string | null;
  boostPct: number;
}

export interface SimEvent {
  id: string;
  day: number;
  date: string;
  type: SimEventType;
  severity: "info" | "warning" | "critical";
  sku: string | null;
  name: string;
  qty: number;
  zone: SimZone;
  message: string;
  stockAfter: number | null;
}

export interface SimMove {
  sku: string;
  qty: number;
  kind: "in" | "out" | "transfer";
}

export interface SimMetrics {
  onHand: number;
  inboundUnits: number;
  outboundUnits: number;
  shippedOrders: number;
  openOrders: number;
  openOrderUnits: number;
  purchaseNeedUnits: number;
  stockoutCount: number;
  overstockCount: number;
  inactiveCount: number;
  capital: number;
  lostUnits: number;
  fillRate: number | null;
}

export interface SimSupport {
  risks: SimRisk[];
  overstock: SimOverstock[];
  purchaseNeeds: SimPurchaseNeed[];
}

export interface SimDay {
  day: number;
  date: string;
  events: SimEvent[];
  moves: SimMove[];
  changed: Array<{ sku: string; stock: number; status: SimStatus }>;
  metrics: SimMetrics;
  /** Decision support as it looked at the end of this simulated day. Portfolio
   * playback omits it; the client then shows the run summary. */
  support?: SimSupport;
}

export interface SimRisk {
  sku: string;
  name: string;
  stock: number;
  reorderPoint: number;
  openUnits: number;
  coverDays: number | null;
  status: SimStatus;
}

export interface SimOverstock {
  sku: string;
  name: string;
  stock: number;
  excess: number;
  value: number;
}

export interface SimPurchaseNeed {
  sku: string;
  name: string;
  qty: number;
  cost: number;
  leadTimeDays: number;
}

export interface SimulationRun {
  scenario: SimulationScenario;
  seed: string;
  startDate: string;
  days: SimDay[];
  summary: {
    onHand: number;
    inboundUnits: number;
    outboundUnits: number;
    ordersCreated: number;
    delayedDeliveries: number;
    stockoutEvents: number;
    overstockEvents: number;
    countMismatches: number;
    capital: number;
    peakCapital: number;
    fillRate: number | null;
    events: number;
    risks: SimRisk[];
    overstock: SimOverstock[];
    purchaseNeeds: SimPurchaseNeed[];
  };
}

/** Fixed simulated clock start; the period is simulated, not the real date. */
export const SIM_START_DATE = "2026-11-01";

export const SIM_PRESETS: Record<Exclude<SimPreset, "custom">, Omit<SimulationScenario, "days" | "sku">> = {
  normal: {
    preset: "normal",
    demandPct: 0,
    leadDays: 0,
    safetyPct: 0,
    moqPct: 0,
    delayDeliveries: false,
    delayRate: 0.04,
    boostPct: 0,
  },
  peak: {
    preset: "peak",
    demandPct: 25,
    leadDays: 2,
    safetyPct: 10,
    moqPct: 0,
    delayDeliveries: false,
    delayRate: 0.04,
    boostPct: 0,
  },
  supply: {
    preset: "supply",
    demandPct: 0,
    leadDays: 7,
    safetyPct: 15,
    moqPct: 0,
    delayDeliveries: true,
    delayRate: 0.35,
    boostPct: 0,
  },
  stress: {
    preset: "stress",
    demandPct: 40,
    leadDays: 12,
    safetyPct: 25,
    moqPct: 0,
    delayDeliveries: true,
    delayRate: 0.5,
    boostPct: 0,
  },
};

const clamp = (min: number, max: number, value: number) => Math.min(max, Math.max(min, value));

export function normalizeSimulation(input: Partial<SimulationScenario> = {}): SimulationScenario {
  const preset = (["normal", "peak", "supply", "stress", "custom"] as const).includes(input.preset as never)
    ? (input.preset as SimPreset)
    : "normal";
  return {
    preset,
    days: Math.round(clamp(7, 365, Number(input.days) || 90)),
    demandPct: clamp(-50, 100, Number(input.demandPct) || 0),
    leadDays: Math.round(clamp(-10, 30, Number(input.leadDays) || 0)),
    safetyPct: clamp(-50, 100, Number(input.safetyPct) || 0),
    moqPct: clamp(-50, 200, Number(input.moqPct) || 0),
    delayDeliveries: Boolean(input.delayDeliveries),
    delayRate: clamp(0, 1, Number(input.delayRate) || 0.04),
    sku: input.sku ? String(input.sku) : null,
    boostPct: clamp(0, 200, Number(input.boostPct) || 0),
  };
}

/** Deterministic 32-bit hash; stable across browsers and runtimes. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rand(seed: string, sku: string, day: number, salt: string): number {
  return hash(`${seed}|${sku}|${day}|${salt}`) / 4294967296;
}

function isoDate(start: string, day: number): string {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + day);
  return date.toISOString().slice(0, 10);
}

interface Order {
  qty: number;
  dueDay: number;
  orderedDay: number;
  delayed: boolean;
}

interface ItemState {
  article: SimArticle;
  stock: number;
  status: SimStatus;
  safetyStock: number;
  reorderPoint: number;
  leadTime: number;
  moq: number;
  avgDaily: number;
  overstockAt: number;
  open: Order[];
  lastLow: number;
  lastOver: number;
  lastStatus: SimStatus;
  prevStock: number;
}

interface EngineEvent {
  item: ItemState | null;
  type: SimEventType;
  severity: SimEvent["severity"];
  qty: number;
  zone: SimZone;
  message: string;
  stockAfter: number | null;
}

/**
 * Run the simulation. Pure: no I/O, no database, no real stock.
 */
export function runSimulation(
  articles: SimArticle[],
  input: Partial<SimulationScenario> = {},
  options: { seed?: string; startDate?: string } = {},
): SimulationRun {
  const scenario = normalizeSimulation(input);
  const seed = String(options.seed ?? "stoqwise");
  const startDate = options.startDate ?? SIM_START_DATE;
  const demandFactor = 1 + scenario.demandPct / 100;

  const states: ItemState[] = articles
    .filter((article) => Number.isFinite(article.stock))
    .map((article) => {
      const safetyStock = Math.max(0, article.safetyStock * (1 + scenario.safetyPct / 100));
      const avgDaily = Math.max(0, article.avgMonthly) / 30;
      const overstockAt = Math.max(
        article.reorderPoint * 2,
        avgDaily * 60,
        article.stock - Math.max(0, article.overstockQty),
      );
      return {
        article,
        stock: Math.max(0, article.stock),
        status: article.status,
        safetyStock,
        reorderPoint: Math.max(0, article.reorderPoint),
        leadTime: Math.max(1, article.leadTimeDays + scenario.leadDays),
        moq: Math.max(1, Math.ceil(Math.max(1, article.moq) * (1 + scenario.moqPct / 100))),
        avgDaily,
        overstockAt,
        open: [],
        lastLow: -999,
        lastOver: -999,
        lastStatus: article.status,
        prevStock: Math.max(0, article.stock),
      };
    });

  const initialChanged = states.map((state) => ({
    sku: state.article.sku,
    stock: state.stock,
    status: state.status,
  }));

  let capital = states.reduce((sum, state) => sum + state.stock * state.article.cost, 0);
  let peakCapital = capital;
  let totalInbound = 0;
  let totalOutbound = 0;
  let totalOrders = 0;
  let totalDelayed = 0;
  let totalStockoutEvents = 0;
  let totalOverstockEvents = 0;
  let totalMismatch = 0;
  let totalLost = 0;
  let eventCounter = 0;

  const days: SimDay[] = [
    {
      day: 0,
      date: isoDate(startDate, 0),
      events: [],
      moves: [],
      changed: initialChanged,
      metrics: metricsFor(states, 0, 0, 0, 0, capital, 0),
      support: supportFor(states),
    },
  ];

  for (let day = 1; day <= scenario.days; day++) {
    const date = isoDate(startDate, day);
    const ev: EngineEvent[] = [];
    // Capture the article balance at the moment of the event, before later
    // events in the same day change it again.
    const push = (entry: Omit<EngineEvent, "stockAfter">) =>
      ev.push({ ...entry, stockAfter: entry.item ? round2(entry.item.stock) : null });
    const moves: SimMove[] = [];
    const changed: SimDay["changed"] = [];
    let inboundUnits = 0;
    let outboundUnits = 0;
    let shippedOrders = 0;
    let lostToday = 0;
    let delayedToday = 0;

    for (const state of states) {
      const article = state.article;
      if (state.status === "inactive" || article.zone === "inactive") {
        state.status = "inactive";
        continue;
      }

      const skuSeed = article.sku;
      const boost = scenario.sku === article.sku ? 1 + scenario.boostPct / 100 : 1;
      const spike = rand(seed, skuSeed, day, "spike") < 0.02;
      const noise = 0.55 + rand(seed, skuSeed, day, "demand") * 0.9;
      const demand = Math.max(
        0,
        Math.round(state.avgDaily * demandFactor * boost * noise * (spike ? 2.2 : 1)),
      );

      // Deliveries due today: on time, or delayed by this scenario.
      for (let i = state.open.length - 1; i >= 0; i--) {
        const order = state.open[i]!;
        if (order.dueDay > day) continue;
        const late =
          rand(seed, skuSeed, day, `late-${order.orderedDay}-${order.qty}`) <
          (scenario.delayDeliveries ? scenario.delayRate : 0.04);
        if (late && !order.delayed) {
          order.delayed = true;
          order.dueDay = day + 2 + Math.floor(rand(seed, skuSeed, day, "late-days") * 3);
          delayedToday++;
          push({
            item: state,
            type: "delivery_delayed",
            severity: "warning",
            qty: order.qty,
            zone: "inbound",
            message: `Leverans försenad till dag ${order.dueDay}`,
          });
          continue;
        }
        state.open.splice(i, 1);
        state.stock += order.qty;
        inboundUnits += order.qty;
        moves.push({ sku: article.sku, qty: order.qty, kind: "in" });
        push({
          item: state,
          type: "delivery_arrived",
          severity: "info",
          qty: order.qty,
          zone: "inbound",
          message: `Inleverans registrerad (${order.qty} st)`,
        });
      }

      // Picking and shipping.
      if (demand > 0) {
        const fulfilled = Math.min(state.stock, demand);
        if (fulfilled > 0) {
          state.stock -= fulfilled;
          outboundUnits += fulfilled;
          shippedOrders++;
          moves.push({ sku: article.sku, qty: fulfilled, kind: "out" });
          push({
            item: state,
            type: "order_picked",
            severity: "info",
            qty: fulfilled,
            zone: "picking",
            message: `Plockad order ${fulfilled} st`,
          });
        }
        const lost = demand - fulfilled;
        if (lost > 0) {
          lostToday += lost;
          push({
            item: state,
            type: "stockout",
            severity: "critical",
            qty: lost,
            zone: "outbound",
            message: `Brist: ${lost} st kunde inte levereras`,
          });
        }
        if (spike) {
          push({
            item: state,
            type: "demand_spike",
            severity: "warning",
            qty: demand,
            zone: "outbound",
            message: `Efterfrågetopp: ${demand} st`,
          });
        }
      }

      // Replenishment: one open order at a time, based on projected stock.
      const openUnits = state.open.reduce((sum, order) => sum + order.qty, 0);
      const projected = state.stock + openUnits;
      if (projected <= state.reorderPoint && state.open.length === 0) {
        const target = state.reorderPoint + state.safetyStock + state.avgDaily * state.leadTime * 1.5;
        // A purchase order must be a whole multiple of the supplier's minimum
        // order quantity, never merely "at least" the MOQ.
        const qty = Math.max(state.moq, Math.ceil((target - projected) / state.moq) * state.moq);
        if (qty > 0) {
          state.open.push({ qty, dueDay: day + state.leadTime, orderedDay: day, delayed: false });
          totalOrders++;
          push({
            item: state,
            type: "replenishment_needed",
            severity: "warning",
            qty,
            zone: "inbound",
            message: `Påfyllning: beställ ${qty} st (ledtid ${state.leadTime} d)`,
          });
        }
      }

      // Transfer from storage to the pick face: same SKU, same total stock.
      if (article.hasPick && state.stock > 0 && day % 3 === 0) {
        const qty = Math.min(state.stock, Math.max(1, Math.ceil(state.avgDaily * 2)));
        if (qty > 0) {
          moves.push({ sku: article.sku, qty, kind: "transfer" });
          push({
            item: state,
            type: "transfer",
            severity: "info",
            qty,
            zone: "picking",
            message: `Förflyttning till plockfront: ${qty} st`,
          });
        }
      }

      // A rare stock-count mismatch changes the physical balance.
      if (rand(seed, skuSeed, day, "count") < 0.0015) {
        const qty = 1 + Math.floor(rand(seed, skuSeed, day, "count-qty") * 3);
        const sign = rand(seed, skuSeed, day, "count-sign") < 0.5 ? -1 : 1;
        const delta = sign * qty;
        if (state.stock + delta >= 0) {
          state.stock += delta;
          totalMismatch++;
          push({
            item: state,
            type: "count_mismatch",
            severity: "critical",
            qty: Math.abs(delta),
            zone: article.zone,
            message: `Lageravvikelse: ${delta > 0 ? "+" : "−"}${Math.abs(delta)} st vid inventering`,
          });
        }
      }

      // Status transitions; low/overstock events are debounced per article.
      const nextStatus = classify(state);
      if (nextStatus !== state.status) {
        if (nextStatus === "stockout" && day - state.lastLow >= 5) {
          state.lastLow = day;
          totalStockoutEvents++;
          push({
            item: state,
            type: "low_stock",
            severity: "critical",
            qty: state.stock,
            zone: article.zone,
            message:
              state.stock <= 0
                ? "Lagret är slut"
                : `Låg lagernivå: ${state.stock} st (beställningspunkt ${Math.round(state.reorderPoint)})`,
          });
        }
        if (nextStatus === "overstock" && day - state.lastOver >= 7) {
          state.lastOver = day;
          totalOverstockEvents++;
          push({
            item: state,
            type: "overstock",
            severity: "warning",
            qty: Math.round(state.stock - state.overstockAt),
            zone: article.zone,
            message: `Överlager: ${Math.round(state.stock - state.overstockAt)} st över målnivån`,
          });
        }
        state.status = nextStatus;
      }

      if (state.stock !== state.prevStock || state.status !== state.lastStatus) {
        changed.push({ sku: article.sku, stock: round2(state.stock), status: state.status });
        state.lastStatus = state.status;
        state.prevStock = state.stock;
      }
    }

    if (outboundUnits > 0) {
      push({
        item: null,
        type: "shipment_sent",
        severity: "info",
        qty: outboundUnits,
        zone: "outbound",
        message: `${shippedOrders} order skickade (${outboundUnits} st)`,
      });
    }

    capital = states.reduce((sum, state) => sum + state.stock * state.article.cost, 0);
    peakCapital = Math.max(peakCapital, capital);
    totalInbound += inboundUnits;
    totalOutbound += outboundUnits;
    totalDelayed += delayedToday;
    totalLost += lostToday;

    const events: SimEvent[] = ev.map((entry) => {
      eventCounter++;
      return {
        id: `${day}-${eventCounter}`,
        day,
        date,
        type: entry.type,
        severity: entry.severity,
        sku: entry.item?.article.sku ?? null,
        name: entry.item?.article.name ?? "Utgående leverans",
        qty: round2(entry.qty),
        zone: entry.zone,
        message: entry.message,
        stockAfter: entry.stockAfter,
      };
    });

    days.push({
      day,
      date,
      events,
      moves,
      changed,
      metrics: metricsFor(states, inboundUnits, outboundUnits, shippedOrders, openOrders(states), capital, lostToday),
      support: supportFor(states),
    });
  }

  const last = days[days.length - 1]!;
  const finalSupport = supportFor(states);
  const eventCount = days.reduce((sum, day) => sum + day.events.length, 0);
  const demandTotal = totalOutbound + totalLost;
  return {
    scenario,
    seed,
    startDate,
    days,
    summary: {
      onHand: round2(states.reduce((sum, state) => sum + state.stock, 0)),
      inboundUnits: totalInbound,
      outboundUnits: totalOutbound,
      ordersCreated: totalOrders,
      delayedDeliveries: totalDelayed,
      stockoutEvents: totalStockoutEvents,
      overstockEvents: totalOverstockEvents,
      countMismatches: totalMismatch,
      capital: Math.round(capital),
      peakCapital: Math.round(peakCapital),
      fillRate: demandTotal > 0 ? Math.round((totalOutbound / demandTotal) * 1000) / 10 : null,
      events: eventCount,
      risks: finalSupport.risks,
      overstock: finalSupport.overstock,
      purchaseNeeds: finalSupport.purchaseNeeds,
    },
  };
}

function supportFor(states: ItemState[]): SimSupport {
  const risks: SimRisk[] = states
    .filter((state) => state.status !== "inactive")
    .map((state) => {
      const openUnits = state.open.reduce((sum, order) => sum + order.qty, 0);
      return {
        sku: state.article.sku,
        name: state.article.name,
        stock: round2(state.stock),
        reorderPoint: round2(state.reorderPoint),
        openUnits: round2(openUnits),
        coverDays: state.avgDaily > 0 ? Math.round((state.stock / state.avgDaily) * 10) / 10 : null,
        status: state.status,
      };
    })
    .filter((risk) => risk.status === "stockout" || (risk.coverDays !== null && risk.coverDays < 7))
    .sort((a, b) => (a.coverDays ?? 0) - (b.coverDays ?? 0))
    .slice(0, 8);

  const overstock: SimOverstock[] = states
    .filter((state) => state.stock > state.overstockAt && state.article.overstockQty > 0)
    .map((state) => ({
      sku: state.article.sku,
      name: state.article.name,
      stock: round2(state.stock),
      excess: Math.round(state.stock - state.overstockAt),
      value: Math.round((state.stock - state.overstockAt) * state.article.cost),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const purchaseNeeds: SimPurchaseNeed[] = states
    .filter((state) => state.status !== "inactive")
    .map((state) => {
      const openUnits = state.open.reduce((sum, order) => sum + order.qty, 0);
      const qty = Math.ceil(state.reorderPoint + state.safetyStock - state.stock - openUnits);
      return {
        sku: state.article.sku,
        name: state.article.name,
        qty,
        cost: Math.round(qty * state.article.cost),
        leadTimeDays: state.leadTime,
      };
    })
    .filter((need) => need.qty > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8);

  return { risks, overstock, purchaseNeeds };
}

function classify(state: ItemState): SimStatus {
  if (state.article.zone === "inactive") return "inactive";
  const projected = state.stock + state.open.reduce((sum, order) => sum + order.qty, 0);
  if (state.stock <= 0 || projected < state.reorderPoint * 0.5) return "stockout";
  if (state.stock > state.overstockAt) return "overstock";
  return "balanced";
}

function openOrders(states: ItemState[]): number {
  return states.reduce((sum, state) => sum + state.open.length, 0);
}

function metricsFor(
  states: ItemState[],
  inboundUnits: number,
  outboundUnits: number,
  shippedOrders: number,
  open: number,
  capital: number,
  lostUnits: number,
): SimMetrics {
  const active = states.filter((state) => state.status !== "inactive");
  const openOrderUnits = states.reduce(
    (sum, state) => sum + state.open.reduce((inner, order) => inner + order.qty, 0),
    0,
  );
  const need = active.reduce((sum, state) => {
    const openUnits = state.open.reduce((inner, order) => inner + order.qty, 0);
    return sum + Math.max(0, state.reorderPoint + state.safetyStock - state.stock - openUnits);
  }, 0);
  return {
    onHand: round2(states.reduce((sum, state) => sum + state.stock, 0)),
    inboundUnits,
    outboundUnits,
    shippedOrders,
    openOrders: open,
    openOrderUnits: round2(openOrderUnits),
    purchaseNeedUnits: Math.ceil(need),
    stockoutCount: active.filter(
      (state) =>
        state.status === "stockout" || (state.avgDaily > 0 && state.stock / state.avgDaily < 7),
    ).length,
    overstockCount: active.filter(
      (state) => state.stock > state.overstockAt && state.article.overstockQty > 0,
    ).length,
    inactiveCount: states.filter((state) => state.status === "inactive").length,
    capital: Math.round(capital),
    lostUnits,
    fillRate: outboundUnits + lostUnits > 0 ? Math.round((outboundUnits / (outboundUnits + lostUnits)) * 1000) / 10 : null,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}


export interface SimulationInput {
  seed: string;
  startDate: string;
  articles: SimArticle[];
}

/* --------------------------------------------------------- portfolio mode */

/**
 * A compact article view for the portfolio engine.
 *
 * The detailed engine keeps one state object per article and one row per
 * article and day. That is exact and fast up to a few thousand articles, but a
 * 500k-row analysis would allocate tens of millions of objects. The portfolio
 * engine reads only these fields and walks each article's replenishment cycles,
 * so every article still contributes to every total while memory stays flat.
 */
export interface PortfolioArticle {
  sku: string;
  name: string;
  stock: number;
  cost: number;
  avgMonthly: number;
  leadTimeDays: number;
  safetyStock: number;
  reorderPoint: number;
  overstockQty: number;
  moq: number;
  status: SimStatus;
}

export function portfolioArticlesFromItems(items: AnalyzedItem[]): PortfolioArticle[] {
  return items.map((item) => ({
    sku: item.sku,
    name: item.name,
    stock: item.stock,
    cost: item.cost,
    avgMonthly: item.avgMonthlyDemand,
    leadTimeDays: item.leadTimeDays,
    safetyStock: item.safetyStock,
    reorderPoint: item.reorderPoint,
    overstockQty: item.overstockQty,
    moq: Math.max(1, Math.ceil(item.moq ?? item.avgMonthlyDemand / 4)),
    status: item.action === "write_off" || item.action === "liquidate" ? "inactive" : item.stockoutRisk ? "stockout" : item.overstockQty > 0 ? "overstock" : "balanced",
  }));
}

function keepTop<T>(list: T[], entry: T, compare: (a: T, b: T) => number, limit: number): void {
  if (list.length < limit) {
    list.push(entry);
    list.sort(compare);
    return;
  }
  if (compare(entry, list[list.length - 1]!) < 0) {
    list[list.length - 1] = entry;
    list.sort(compare);
  }
}

/**
 * Deterministic portfolio playback.
 *
 * Every article is included in stock, capital, flow, stockout and overstock
 * totals. Instead of stepping 500k articles through 90 days, each article's
 * replenishment cycles are walked directly and their constant daily flows are
 * written once as interval deltas. A prefix sum at the end produces the same
 * day-by-day series the detailed engine produces for small portfolios.
 *
 * Event messages come from a deterministic sample of articles so the feed stays
 * small; the totals never depend on that sample.
 */
export function runPortfolioSimulation(
  articles: Iterable<PortfolioArticle>,
  input: Partial<SimulationScenario> = {},
  options: { seed?: string; startDate?: string } = {},
): SimulationRun {
  const scenario = normalizeSimulation(input);
  const seed = String(options.seed ?? "stoqwise");
  const startDate = options.startDate ?? SIM_START_DATE;
  const horizon = scenario.days;
  const demandFactor = 1 + scenario.demandPct / 100;
  const size = horizon + 2;
  const outDiff = new Float64Array(size);
  const inDiff = new Float64Array(size);
  const lostDiff = new Float64Array(size);
  const valueDiff = new Float64Array(size);
  const openUnitsDiff = new Float64Array(size);
  const openCountDiff = new Float64Array(size);
  const stockoutDiff = new Float64Array(size);
  const overstockDiff = new Float64Array(size);
  const dates: string[] = Array.from({ length: horizon + 1 }, (_, day) => isoDate(startDate, day));
  const events: SimEvent[][] = Array.from({ length: horizon + 1 }, () => []);
  const eventLoad = new Uint8Array(horizon + 1);
  const MAX_EVENTS_PER_DAY = 5;

  const addRange = (diff: Float64Array, from: number, to: number): void => {
    if (to < from) return;
    const start = Math.max(1, from);
    const end = Math.min(horizon, to);
    if (end < start) return;
    diff[start] += 1;
    diff[end + 1] -= 1;
  };
  const addFlow = (diff: Float64Array, from: number, to: number, perDay: number): void => {
    if (to < from || perDay === 0) return;
    const start = Math.max(1, from);
    const end = Math.min(horizon, to);
    if (end < start) return;
    diff[start] += perDay;
    diff[end + 1] -= perDay;
  };

  let units0 = 0;
  let capital0 = 0;
  let stockout0 = 0;
  let overstock0 = 0;
  let inactive = 0;
  let activeCount = 0;
  let totalIn = 0;
  let totalOut = 0;
  let totalLost = 0;
  let ordersCreated = 0;
  let delayedDeliveries = 0;
  let peakCapital = 0;
  let sampledArticles = 0;
  const risks: SimRisk[] = [];
  const overstock: SimOverstock[] = [];
  const purchaseNeeds: SimPurchaseNeed[] = [];

  for (const article of articles) {
    const stock0 = Number.isFinite(article.stock) ? Math.max(0, article.stock) : 0;
    const cost = Math.max(0, article.cost);
    units0 += stock0;
    capital0 += stock0 * cost;
    if (article.status === "inactive") {
      inactive++;
      continue;
    }
    activeCount++;

    const daily = (Math.max(0, article.avgMonthly) / 30) * demandFactor;
    const want = Math.max(0, Math.round(daily));
    const safety = Math.max(0, article.safetyStock * (1 + scenario.safetyPct / 100));
    const rop = Math.max(0, article.reorderPoint);
    const lead = Math.max(1, Math.round(article.leadTimeDays + scenario.leadDays));
    const moq = Math.max(1, Math.ceil(Math.max(1, article.moq) * (1 + scenario.moqPct / 100)));
    const overstockAt = Math.max(rop * 2, daily * 60, stock0 - Math.max(0, article.overstockQty));
    const coverDays = daily > 0 ? Math.round((stock0 / daily) * 10) / 10 : null;

    if (stock0 <= 0 || stock0 < rop * 0.5) {
      stockout0++;
      keepTop(risks, { sku: article.sku, name: article.name, stock: round2(stock0), reorderPoint: round2(rop), openUnits: 0, coverDays, status: "stockout" }, (a, b) => a.stock - b.stock, 6);
    } else if (stock0 > overstockAt) {
      overstock0++;
    }
    if (stock0 > overstockAt && overstockAt >= 0) {
      const excess = Math.round(stock0 - overstockAt);
      keepTop(overstock, { sku: article.sku, name: article.name, stock: round2(stock0), excess, value: Math.round(excess * cost) }, (a, b) => b.value - a.value, 6);
    }
    if (stock0 <= rop && want > 0) {
      const target = rop + safety + daily * lead * 1.5;
      const qty = Math.max(moq, Math.ceil((target - stock0) / moq) * moq);
      keepTop(purchaseNeeds, { sku: article.sku, name: article.name, qty, cost: Math.round(qty * cost), leadTimeDays: lead }, (a, b) => b.cost - a.cost, 6);
    } else if (coverDays !== null && coverDays < lead) {
      keepTop(risks, { sku: article.sku, name: article.name, stock: round2(stock0), reorderPoint: round2(rop), openUnits: 0, coverDays, status: "balanced" }, (a, b) => (a.coverDays ?? 0) - (b.coverDays ?? 0), 6);
    }

    // A deterministic sample keeps the event feed readable. Totals are never
    // sampled: every article below runs through the same arithmetic.
    const sampled = hash(`${seed}|${article.sku}|sample`) % 50 === 0;
    if (sampled) sampledArticles++;
    const pushEvent = (day: number, entry: Omit<SimEvent, "id" | "day" | "date" | "sku" | "name">): void => {
      if (!sampled || day < 1 || day > horizon || eventLoad[day]! >= MAX_EVENTS_PER_DAY) return;
      eventLoad[day] = (eventLoad[day] ?? 0) + 1;
      events[day]!.push({
        ...entry,
        id: `${day}-${events[day]!.length}`,
        day,
        date: dates[day]!,
        sku: article.sku,
        name: article.name,
      });
    };

    let stock = stock0;
    let pendingQty = 0;
    let due = 0;
    let day = 1;
    let guard = 0;
    while (day <= horizon && guard++ < horizon + 5) {
      if (pendingQty > 0 && due <= day) {
        stock += pendingQty;
        inDiff[day] += pendingQty;
        valueDiff[day] += pendingQty * cost;
        openUnitsDiff[day] -= pendingQty;
        openCountDiff[day] -= 1;
        totalIn += pendingQty;
        pushEvent(due, {
          type: "delivery_arrived",
          severity: "info",
          qty: pendingQty,
          zone: "inbound",
          message: `Inleverans registrerad (${pendingQty} st)`,
          stockAfter: round2(stock),
        });
        pendingQty = 0;
      }

      if (pendingQty === 0 && want > 0 && stock <= rop) {
        const target = rop + safety + daily * lead * 1.5;
        const qty = Math.max(moq, Math.ceil((target - stock) / moq) * moq);
        const late = rand(seed, article.sku, day, "late") < (scenario.delayDeliveries ? scenario.delayRate : 0.04);
        const delay = late ? 2 + Math.floor(rand(seed, article.sku, day, "late-days") * 3) : 0;
        pendingQty = qty;
        due = day + lead + delay;
        openUnitsDiff[day] += qty;
        openCountDiff[day] += 1;
        ordersCreated++;
        if (late) delayedDeliveries++;
        pushEvent(day, {
          type: "replenishment_needed",
          severity: "warning",
          qty,
          zone: "inbound",
          message: `Påfyllning: beställ ${qty} st (ledtid ${lead} d)`,
          stockAfter: round2(stock),
        });
      }

      if (want === 0) {
        if (stock <= 0) addRange(stockoutDiff, day, horizon);
        if (stock > overstockAt) addRange(overstockDiff, day, horizon);
        break;
      }

      // A day that cannot be fulfilled completely ships what is left and
      // records the shortfall; the following days are stockout days until the
      // next delivery arrives.
      if (stock < want) {
        const shipped = stock;
        const short = want - shipped;
        if (shipped > 0) {
          addFlow(outDiff, day, day, shipped);
          addFlow(valueDiff, day, day, -shipped * cost);
          totalOut += shipped;
        }
        addFlow(lostDiff, day, day, short);
        addRange(stockoutDiff, day, day);
        totalLost += short;
        if (stock > overstockAt) addRange(overstockDiff, day, day);
        stock = 0;
        if (sampled && short > 0) {
          pushEvent(day, {
            type: "stockout",
            severity: "critical",
            qty: short,
            zone: "outbound",
            message: `Brist: ${short} st kunde inte levereras`,
            stockAfter: 0,
          });
        }
        day += 1;
        continue;
      }

      const nextArrival = pendingQty > 0 ? due : horizon + 1;
      const reorderDay = pendingQty === 0 ? day + Math.max(0, Math.floor((stock - rop) / want)) : horizon + 1;
      const stop = Math.min(nextArrival, Math.max(day + 1, reorderDay), horizon + 1);
      const fulfilledTo = stop - 1;
      if (fulfilledTo >= day) {
        const days = fulfilledTo - day + 1;
        addFlow(outDiff, day, fulfilledTo, want);
        addFlow(valueDiff, day, fulfilledTo, -want * cost);
        totalOut += want * days;
        if (stock > overstockAt) {
          const lastOver = day + Math.min(days - 1, Math.floor((stock - overstockAt - 1) / want));
          addRange(overstockDiff, day, lastOver);
        }
        stock = Math.max(0, stock - want * days);
        day = fulfilledTo + 1;
        continue;
      }
      day = Math.min(day + 1, horizon + 1);
    }
  }

  if (activeCount === 0) {
    stockout0 = 0;
  }

  const prefix = (diff: Float64Array): Float64Array => {
    const out = new Float64Array(size);
    let sum = 0;
    for (let i = 1; i <= horizon; i++) {
      sum += diff[i]!;
      out[i] = sum;
    }
    return out;
  };
  const outDay = prefix(outDiff);
  const inDay = prefix(inDiff);
  const lostDay = prefix(lostDiff);
  const valueDay = prefix(valueDiff);
  const openUnitsDay = prefix(openUnitsDiff);
  const openCountDay = prefix(openCountDiff);
  const stockoutDayCount = prefix(stockoutDiff);
  const overstockDayCount = prefix(overstockDiff);

  let onHand = units0;
  let capital = capital0;
  let cumulativeOut = 0;
  let cumulativeLost = 0;
  peakCapital = capital0;
  const days: SimDay[] = [
    {
      day: 0,
      date: dates[0]!,
      events: [],
      moves: [],
      changed: [],
      metrics: {
        onHand: round2(units0),
        inboundUnits: 0,
        outboundUnits: 0,
        shippedOrders: 0,
        openOrders: 0,
        openOrderUnits: 0,
        purchaseNeedUnits: 0,
        stockoutCount: stockout0,
        overstockCount: overstock0,
        inactiveCount: inactive,
        capital: Math.round(capital0),
        lostUnits: 0,
        fillRate: null,
      },
      support: { risks, overstock, purchaseNeeds },
    },
  ];
  for (let index = 1; index <= horizon; index++) {
    onHand += inDay[index]! - outDay[index]!;
    capital += valueDay[index]!;
    cumulativeOut += outDay[index]!;
    cumulativeLost += lostDay[index]!;
    if (capital > peakCapital) peakCapital = capital;
    const demandToday = outDay[index]! + lostDay[index]!;
    days.push({
      day: index,
      date: dates[index]!,
      events: events[index]!,
      moves: [],
      changed: [],
      metrics: {
        onHand: round2(onHand),
        inboundUnits: round2(inDay[index]!),
        outboundUnits: round2(outDay[index]!),
        shippedOrders: 0,
        openOrders: Math.round(openCountDay[index]!),
        openOrderUnits: round2(openUnitsDay[index]!),
        purchaseNeedUnits: 0,
        stockoutCount: Math.round(stockout0 + stockoutDayCount[index]!),
        overstockCount: Math.round(overstock0 + overstockDayCount[index]!),
        inactiveCount: inactive,
        capital: Math.round(capital),
        lostUnits: round2(lostDay[index]!),
        fillRate: demandToday > 0 ? Math.round((outDay[index]! / demandToday) * 1000) / 10 : null,
      },
    });
  }

  const demandTotal = totalOut + totalLost;
  const eventCount = events.reduce((sum, dayEvents) => sum + dayEvents.length, 0);
  return {
    scenario,
    seed,
    startDate,
    days,
    summary: {
      onHand: round2(onHand),
      inboundUnits: totalIn,
      outboundUnits: totalOut,
      ordersCreated,
      delayedDeliveries,
      stockoutEvents: Math.round(stockout0 + stockoutDayCount[horizon]!),
      overstockEvents: Math.round(overstock0 + overstockDayCount[horizon]!),
      countMismatches: 0,
      capital: Math.round(capital),
      peakCapital: Math.round(peakCapital),
      fillRate: demandTotal > 0 ? Math.round((totalOut / demandTotal) * 1000) / 10 : null,
      events: eventCount,
      risks,
      overstock,
      purchaseNeeds,
    },
  };
}


/**
 * Build the engine input from the same model the page already renders. The
 * simulation never reads storage or the customer's live balances: it starts
 * from the analysis snapshot and runs entirely in memory.
 */
export function buildSimulationInput(model: LiveModel, items: AnalyzedItem[], analysisId: string): SimulationInput {
  const bySku = new Map(items.map((item) => [item.sku, item] as const));
  const pickSkus = new Set(model.picks.map((pick) => pick.sku));
  const articles: SimArticle[] = [];
  for (const slot of model.slots) {
    const item = bySku.get(slot.sku);
    if (!item) continue;
    articles.push({
      sku: slot.sku,
      name: slot.name,
      category: slot.category,
      abc: slot.abc,
      xyz: slot.xyz,
      status: slot.status,
      zone: slot.zone,
      stock: slot.stock,
      cost: item.cost,
      price: item.price,
      avgMonthly: item.avgMonthlyDemand,
      leadTimeDays: item.leadTimeDays,
      safetyStock: item.safetyStock,
      reorderPoint: item.reorderPoint,
      overstockQty: item.overstockQty,
      // Use the supplier's real minimum order quantity. A quarter of a month's
      // demand is only a fallback when the item record has no MOQ at all.
      moq: Math.max(1, Math.ceil(item.moq ?? item.avgMonthlyDemand / 4)),
      hasPick: pickSkus.has(slot.sku),
    });
  }
  return { seed: analysisId || "stoqwise", startDate: SIM_START_DATE, articles };
}
