/**
 * Supply chain simulation.
 *
 * The engine answers "what happens if" with the same arithmetic every time. A
 * scenario is a set of multipliers on demand, lead time, cost and stock; the
 * outcome is the difference between two computed worlds, never an estimate.
 *
 * Deliberate modelling choices, all visible in `formulas`:
 * - Demand uncertainty is normal around the forecast, with sigma scaled by
 *   sqrt(lead time), which is the standard inventory-theory assumption.
 * - Stock reductions are only applied where there is something to reduce
 *   (above the reorder point), because cutting into safety stock is a different
 *   decision than trimming overstock, and the customer must see that difference.
 * - Lost sales are valued at gross margin, not revenue: losing a sale costs the
 *   contribution, not the turnover.
 */
import type { ItemInput } from "../dataset.ts";
import { zScore } from "../analysis.ts";
import { normalCdf, normalLoss } from "./forecast.ts";

const DAYS_PER_MONTH = 30.44;

export interface ScenarioInput {
  name: string;
  /** 1.2 = demand up 20 %. */
  demandMultiplier: number;
  leadTimeMultiplier: number;
  /** Extra days of delay weighted by the probability below. */
  supplierDelayDays: number;
  supplierDelayProbability: number;
  costMultiplier: number;
  priceMultiplier: number;
  serviceLevel: number;
  /** Share of the reducible stock that is released (0-1). */
  stockReductionPct: number;
  orderQtyMultiplier: number;
  holdingRate: number;
}

export const defaultScenario: ScenarioInput = {
  name: "Basfall",
  demandMultiplier: 1,
  leadTimeMultiplier: 1,
  supplierDelayDays: 0,
  supplierDelayProbability: 0,
  costMultiplier: 1,
  priceMultiplier: 1,
  serviceLevel: 0.95,
  stockReductionPct: 0,
  orderQtyMultiplier: 1,
  holdingRate: 0.22,
};

export interface ScenarioTotals {
  inventoryValue: number;
  /**
   * Capital needed to hold the reorder point across every article under this
   * scenario. Current stock does not change when demand changes - the money the
   * scenario requires does, which is what a buyer has to fund.
   */
  requiredInventoryValue: number;
  freedCapital: number;
  unitsReduced: number;
  stockoutRiskCount: number;
  stockoutRiskValue: number;
  serviceLevel: number;
  expectedShortageUnits: number;
  lostSalesValue: number;
  lostMargin: number;
  holdingCostAnnual: number;
  capitalCostAnnual: number;
  purchaseValueDelta: number;
  annualNetEffect: number;
  deadStockValue: number;
  overstockValue: number;
  turns: number;
}

export interface ScenarioRow {
  sku: string;
  name: string;
  category: string | null;
  stockBefore: number;
  stockAfter: number;
  valueBefore: number;
  valueAfter: number;
  freed: number;
  stockoutBefore: number;
  stockoutAfter: number;
  shortageValueAfter: number;
  marginPerUnit: number;
}

export interface ScenarioRisk {
  level: "high" | "medium" | "low";
  title: string;
  detail: string;
}

export interface ScenarioOutcome {
  input: ScenarioInput;
  totals: ScenarioTotals;
  /** Absolute and relative change against the baseline. */
  delta: ScenarioTotals;
  rows: ScenarioRow[];
  byCategory: Array<{ category: string; valueBefore: number; valueAfter: number; freed: number; riskAfter: number }>;
  risks: ScenarioRisk[];
  formulas: string[];
}

export interface BaselineItem {
  item: ItemInput;
  /** Recent demand level, units per month. */
  monthlyDemand: number;
  /** Residual sigma of the demand series, units per month. */
  sigmaMonthly: number;
  value: number;
  marginPerUnit: number;
}

export function buildBaseline(items: ItemInput[], months: number): BaselineItem[] {
  return items.map((item) => {
    const history = item.monthly ?? [];
    const sold = history.length > 0 ? history.reduce((a, b) => a + b, 0) : item.totalSold;
    const monthlyDemand = sold / Math.max(1, months);
    let sigma = 0;
    if (history.length > 1) {
      const m = monthlyDemand;
      sigma = Math.sqrt(history.reduce((a, v) => a + (v - m) ** 2, 0) / (history.length - 1));
    }
    const sellPrice = item.price ?? item.cost;
    return {
      item,
      monthlyDemand,
      sigmaMonthly: sigma,
      value: item.stock * item.cost,
      marginPerUnit: Math.max(0, sellPrice - item.cost),
    };
  });
}

/** Per-item simulation. Pure: no clock, no randomness, no I/O. */
function runItems(baseline: BaselineItem[], input: ScenarioInput): { totals: ScenarioTotals; rows: ScenarioRow[] } {
  const z = zScore(input.serviceLevel);
  let inventoryValue = 0;
  let requiredInventoryValue = 0;
  let freedCapital = 0;
  let unitsReduced = 0;
  let stockoutRiskCount = 0;
  let stockoutRiskValue = 0;
  let shortageUnits = 0;
  let lostSalesValue = 0;
  let lostMargin = 0;
  let holdingCostAnnual = 0;
  let capitalCostAnnual = 0;
  let purchaseValueDelta = 0;
  let deadStockValue = 0;
  let overstockValue = 0;
  const rows: ScenarioRow[] = [];

  for (const b of baseline) {
    const item = b.item;
    const demand = b.monthlyDemand * input.demandMultiplier;
    const daily = demand / DAYS_PER_MONTH;
    const baseLead = item.leadTimeDays ?? 30;
    const delay = input.supplierDelayProbability * input.supplierDelayDays;
    const lead = baseLead * input.leadTimeMultiplier + delay;
    const sigmaLead = b.sigmaMonthly * input.demandMultiplier * Math.sqrt(lead / DAYS_PER_MONTH);
    const safety = z * sigmaLead;
    const reorderPoint = daily * lead + safety;

    // Reducible stock = everything above the reorder point. The reduction share
    // applies only there, so a "reduce 15 %" scenario can never eat the buffer
    // that protects sales - it trims what is genuinely excess.
    const reducible = Math.max(0, item.stock - reorderPoint);
    const reduction = reducible * input.stockReductionPct;
    const stockAfter = item.stock - reduction;

    const cost = item.cost * input.costMultiplier;
    const price = (item.price ?? item.cost) * input.priceMultiplier;
    const valueBefore = item.stock * item.cost;
    const valueAfter = stockAfter * cost;

    const stockoutBefore = item.stock < reorderPoint ? 1 : 0;
    const stockoutAfter = stockAfter < reorderPoint ? 1 : 0;

    const muLead = daily * lead;
    const shortage = sigmaLead > 0 ? sigmaLead * normalLoss((stockAfter - muLead) / sigmaLead) : Math.max(0, muLead - stockAfter);
    const probability =
      sigmaLead > 0 ? 1 - normalCdf((stockAfter - muLead) / sigmaLead) : stockAfter < muLead ? 1 : 0;

    // Expected sales shortfall is capped by expected demand: an item cannot lose
    // more sales than it would have had.
    const lostUnits = Math.min(muLead, Math.max(0, shortage));
    const lostRevenue = lostUnits * price;
    const lostContribution = lostUnits * Math.max(0, price - cost);

    if (probability > 0.5 && demand > 0) {
      stockoutRiskCount++;
      stockoutRiskValue += lostRevenue;
    }

    inventoryValue += valueAfter;
    requiredInventoryValue += reorderPoint * cost;
    freedCapital += Math.max(0, valueBefore - valueAfter);
    unitsReduced += reduction;
    shortageUnits += lostUnits;
    lostSalesValue += lostRevenue;
    lostMargin += lostContribution;
    holdingCostAnnual += valueAfter * input.holdingRate;
    capitalCostAnnual += valueAfter * 0.08;
    purchaseValueDelta += (input.demandMultiplier - 1) * daily * 365 * cost;

    const dead = demand === 0 && item.stock > 0;
    if (dead) deadStockValue += valueAfter;
    else if (stockAfter > reorderPoint) overstockValue += (stockAfter - reorderPoint) * cost;

    rows.push({
      sku: item.sku,
      name: item.name,
      category: item.category,
      stockBefore: item.stock,
      stockAfter: Math.round(stockAfter),
      valueBefore,
      valueAfter,
      freed: Math.max(0, valueBefore - valueAfter),
      stockoutBefore,
      stockoutAfter,
      shortageValueAfter: lostRevenue,
      marginPerUnit: b.marginPerUnit,
    });
  }

  const annualCogs = baseline.reduce((a, b) => a + b.monthlyDemand * 12 * (b.item.cost * input.costMultiplier), 0);
  const turns = inventoryValue > 0 ? annualCogs / inventoryValue : 0;

  // Service level is reported as the fill rate implied by expected shortages,
  // not as the nominal parameter - a scenario can promise 95 % and still deliver
  // less, and the customer should see the difference.
  const totalDemandUnits = baseline.reduce((a, b) => a + b.monthlyDemand * input.demandMultiplier * 12, 0);
  const serviceLevel = totalDemandUnits > 0 ? Math.max(0, 1 - shortageUnits / totalDemandUnits) : 1;

  const annualNetEffect =
    freedCapital * input.holdingRate - lostMargin - Math.max(0, purchaseValueDelta) * 0.08;

  return {
    totals: {
      inventoryValue,
      requiredInventoryValue,
      freedCapital,
      unitsReduced,
      stockoutRiskCount,
      stockoutRiskValue,
      serviceLevel,
      expectedShortageUnits: shortageUnits,
      lostSalesValue,
      lostMargin,
      holdingCostAnnual,
      capitalCostAnnual,
      purchaseValueDelta,
      annualNetEffect,
      deadStockValue,
      overstockValue,
      turns,
    },
    rows,
  };
}

const round = (n: number, d = 0): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

function roundTotals(t: ScenarioTotals): ScenarioTotals {
  return {
    inventoryValue: round(t.inventoryValue),
    requiredInventoryValue: round(t.requiredInventoryValue),
    freedCapital: round(t.freedCapital),
    unitsReduced: round(t.unitsReduced),
    stockoutRiskCount: t.stockoutRiskCount,
    stockoutRiskValue: round(t.stockoutRiskValue),
    serviceLevel: round(t.serviceLevel, 4),
    expectedShortageUnits: round(t.expectedShortageUnits),
    lostSalesValue: round(t.lostSalesValue),
    lostMargin: round(t.lostMargin),
    holdingCostAnnual: round(t.holdingCostAnnual),
    capitalCostAnnual: round(t.capitalCostAnnual),
    purchaseValueDelta: round(t.purchaseValueDelta),
    annualNetEffect: round(t.annualNetEffect),
    deadStockValue: round(t.deadStockValue),
    overstockValue: round(t.overstockValue),
    turns: round(t.turns, 2),
  };
}

export function simulate(
  baseline: BaselineItem[],
  inputInput: Partial<ScenarioInput> = {},
): ScenarioOutcome {
  const input: ScenarioInput = { ...defaultScenario, ...inputInput };
  const base = runItems(baseline, defaultScenario);
  const scenario = runItems(baseline, input);

  const delta = Object.fromEntries(
    Object.entries(scenario.totals).map(([k, v]) => [k, (v as number) - (base.totals as unknown as Record<string, number>)[k]!]),
  ) as unknown as ScenarioTotals;

  // Risks are derived from the numbers, not written by a model.
  const risks: ScenarioRisk[] = [];
  const serviceDrop = base.totals.serviceLevel - scenario.totals.serviceLevel;
  if (serviceDrop > 0.02) {
    risks.push({
      level: serviceDrop > 0.06 ? "high" : "medium",
      title: "Lägre servicenivå",
      detail: `Beräknad uppfyllnadsgrad faller från ${(base.totals.serviceLevel * 100).toFixed(1)} % till ${(scenario.totals.serviceLevel * 100).toFixed(1)} %. Det motsvarar ${Math.round(delta.expectedShortageUnits).toLocaleString("sv-SE")} enheter i förväntad brist.`,
    });
  }
  if (scenario.totals.stockoutRiskCount > base.totals.stockoutRiskCount) {
    risks.push({
      level: "medium",
      title: "Fler artiklar i riskzonen",
      detail: `${scenario.totals.stockoutRiskCount - base.totals.stockoutRiskCount} artiklar till hamnar under sin beställningspunkt.`,
    });
  }
  if (input.supplierDelayProbability > 0.2) {
    risks.push({
      level: input.supplierDelayProbability > 0.5 ? "high" : "medium",
      title: "Leverantörsförsening",
      detail: `${Math.round(input.supplierDelayProbability * 100)} % sannolikhet för ${input.supplierDelayDays} dagars försening ökar säkerhetslagret med ${Math.round(scenario.totals.inventoryValue - base.totals.inventoryValue).toLocaleString("sv-SE")} kr i bundet kapital.`,
    });
  }
  if (scenario.totals.lostMargin > base.totals.lostMargin) {
    risks.push({
      level: "medium",
      title: "Förlorat täckningsbidrag",
      detail: `Beräknad utebliven marginal ökar med ${Math.round(scenario.totals.lostMargin - base.totals.lostMargin).toLocaleString("sv-SE")} kr under en ledtid.`,
    });
  }
  if (input.stockReductionPct > 0.3) {
    risks.push({
      level: "high",
      title: "Stor reduktion",
      detail: "Reduktion över 30 % av överskottslagret kräver att efterfrågeprognosen är stabil. Backtesta prognosen innan beslutet.",
    });
  }

  const byCategoryMap = new Map<string, { valueBefore: number; valueAfter: number; freed: number; riskAfter: number }>();
  for (const row of scenario.rows) {
    const key = row.category ?? "Utan kategori";
    const entry = byCategoryMap.get(key) ?? { valueBefore: 0, valueAfter: 0, freed: 0, riskAfter: 0 };
    entry.valueBefore += row.valueBefore;
    entry.valueAfter += row.valueAfter;
    entry.freed += row.freed;
    if (row.stockoutAfter) entry.riskAfter++;
    byCategoryMap.set(key, entry);
  }

  return {
    input,
    totals: roundTotals(scenario.totals),
    delta: roundTotals(delta),
    rows: scenario.rows.sort((a, b) => b.freed - a.freed).slice(0, 100),
    byCategory: [...byCategoryMap.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.freed - a.freed)
      .slice(0, 12),
    risks,
    formulas: [
      "Efterfrågan under ledtid = dygnsefterfrågan × ledtid (prognos, justerad med scenariots multiplikator).",
      "Säkerhetslager = z(servicenivå) × σ_månad × √(ledtid / 30,44).",
      "Reducibelt lager = saldo − beställningspunkt. Reduktionen tillämpas endast där.",
      "Förväntad brist = σ_LT × normalförlust(z), z = (saldo − μ_LT) / σ_LT.",
      "Förlorad marginal = förväntad brist i enheter × (försäljningspris − inköpspris).",
      "Kapitalbehov = Σ(beställningspunkt × inköpspris). Det är den nivå scenariot kräver, till skillnad från dagens saldo.",
      "Årlig nettoeffekt = frigjort kapital × lagerhållningsränta − förlorad marginal − ökad kapitalbindning i inköp × 8 %.",
      "Uppfyllnadsgrad = 1 − förväntad brist / förväntad årsefterfrågan.",
    ],
  };
}

/** Runs several scenarios on the same baseline so they are directly comparable. */
export function compareScenarios(baseline: BaselineItem[], inputs: Array<Partial<ScenarioInput>>): ScenarioOutcome[] {
  const base = runItems(baseline, defaultScenario).totals;
  return inputs.map((input) => {
    const outcome = simulate(baseline, input);
    // The comparison view needs the same baseline for every column.
    outcome.delta = roundTotals(
      Object.fromEntries(
        Object.entries(outcome.totals).map(([k, v]) => [k, (v as number) - (base as unknown as Record<string, number>)[k]!]),
      ) as unknown as ScenarioTotals,
    );
    return outcome;
  });
}
