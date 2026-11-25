/**
 * The supply chain copilot.
 *
 * Architecture decision: the copilot is a deterministic query router, not a
 * chatbot that reasons over raw data. A question is parsed into an intent, the
 * intent runs a real computation on the analysis result, and the answer is built
 * from those numbers. A language model is used at most to rephrase an answer
 * that already exists - and its output is rejected unless every number in it can
 * be found in the computed facts.
 *
 * That is why the copilot can answer "varfor har lagervardet okat" without ever
 * inventing a reason: if the data cannot explain the change, it says so.
 */
import type { AnalysisResult } from "../analysis.ts";
import { formatNumber, formatSek } from "../analysis.ts";
import { appText } from "../i18n-app.ts";
import type { Locale } from "../i18n.ts";
import type { ItemInput } from "../dataset.ts";
import type { IntelligenceItem, IntelligenceSnapshot } from "./intelligence.ts";
import { buildBaseline, simulate } from "./simulate.ts";
import { supplyPlan, forecastSeries } from "./forecast.ts";

export interface CopilotContext {
  result: AnalysisResult;
  intelligence: IntelligenceSnapshot;
  items: ItemInput[];
  company: string;
  months: number;
  /** Optional: stored snapshots for "why did the value move" questions. */
  snapshots?: Array<{ date: string; value: number }>;
}

export interface CopilotTable {
  columns: string[];
  rows: Array<Array<string | number>>;
  align?: Array<"left" | "right">;
}

/**
 * The six auditable parts of a recommendation. They are filled from computed
 * facts, never generated prose, so the UI can show the basis next to the action.
 */
export interface DecisionBrief {
  identified: string;
  why: string;
  data: string;
  action: string;
  effect: string;
  uncertainty: string;
}

export interface CopilotAnswer {
  intent: string;
  question: string;
  answer: string;
  facts: Array<{ label: string; value: string }>;
  table: CopilotTable | null;
  followUps: string[];
  sources: string[];
  confidence: "high" | "medium" | "low";
  notes: string[];
  /** Carried into the conversation so follow-ups can refine instead of restart. */
  params: Record<string, string | number>;
  grounded: boolean;
  brief: DecisionBrief;
}

export interface ConversationTurn {
  question: string;
  intent: string;
  params: Record<string, string | number>;
}

const sv = (n: number): string => formatNumber(n, 0);
const sek = (n: number): string => formatSek(n);
const pctf = (n: number): string => `${formatNumber(n, 1)} %`;

function topBy<T>(rows: T[], n: number, key: (row: T) => number): T[] {
  return [...rows].sort((a, b) => key(b) - key(a)).slice(0, n);
}

/** Extracts every numeric token, in both Swedish and English notation. */
export function extractNumbers(text: string): number[] {
  const cleaned = text.replace(/(\d)[\s\u00a0](?=\d{3}\b)/g, "$1");
  const matches = cleaned.match(/-?\d+(?:[.,]\d+)?/g) ?? [];
  return matches
    .map((m) => Number(m.replace(",", ".")))
    .filter((n) => Number.isFinite(n));
}

/**
 * A language model may only restate numbers we computed. Any new number means the
 * text is discarded - that is cheaper than auditing a hallucinated figure later.
 */
export function isGrounded(text: string, allowedTexts: string[]): boolean {
  const allowed = new Set<number>();
  for (const t of allowedTexts) {
    for (const n of extractNumbers(t)) {
      allowed.add(Math.round(n));
      allowed.add(Math.round(n * 10));
      allowed.add(Math.round(n * 100));
    }
  }
  // Small integers occur naturally in prose ("de 10 största", "3 av 4") and are
  // not claims about the business, so they are always permitted.
  for (let i = 0; i <= 100; i++) allowed.add(i);
  return extractNumbers(text).every((n) => {
    const r = Math.round(n);
    return allowed.has(r) || allowed.has(Math.round(Math.abs(n)));
  });
}

interface Intent {
  id: string;
  patterns: RegExp[];
  run: (ctx: CopilotContext, params: Params) => CopilotAnswer;
}

interface Params {
  limit: number;
  percent: number;
  sku: string | null;
  raw: string;
}

const DEFAULT_LIMIT = 10;

function answer(
  intent: string,
  question: string,
  text: string,
  rest: Partial<CopilotAnswer> & { params?: Record<string, string | number> } = {},
): CopilotAnswer {
  const facts = rest.facts ?? [];
  const sources = rest.sources ?? [];
  const notes = rest.notes ?? [];
  const brief: DecisionBrief = rest.brief ?? {
    identified: text.split(/(?<=[.!?])\s/)[0] ?? text,
    why: facts.length ? facts.map((fact) => `${fact.label}: ${fact.value}`).join(" · ") : "Se det beräknade underlaget i svaret.",
    data: sources.length ? sources.join(" · ") : "Analysmotorn och den importerade datamängden.",
    action: rest.followUps?.[0] ?? "Granska artikeln och bekräfta åtgärden innan beslut.",
    effect: facts.length ? facts.map((fact) => `${fact.label}: ${fact.value}`).join(" · ") : "Ingen kvantifierad effekt anges för den här frågan.",
    uncertainty: notes.length
      ? notes.join(" ")
      : "Siffrorna är deterministiska beräkningar från underlaget. Effekter är uppskattningar och ska bekräftas mot avtal och verkligt utfall.",
  };
  return {
    intent,
    question,
    answer: text,
    facts,
    table: rest.table ?? null,
    followUps: rest.followUps ?? [],
    sources,
    confidence: rest.confidence ?? "high",
    notes,
    params: rest.params ?? {},
    grounded: true,
    brief,
  };
}

const itemRow = (i: IntelligenceItem): Array<string | number> => [
  i.sku,
  i.name.slice(0, 42),
  Math.round(i.stock),
  sek(i.value),
  i.coverDays === null ? "–" : `${i.coverDays} d`,
  i.abcValue,
];

const ITEM_COLUMNS = ["Artikel", "Benämning", "Saldo", "Lagervärde", "Täckning", "ABC"];

/* ------------------------------------------------------------------ intents */

const intents: Intent[] = [
  {
    id: "top_capital",
    patterns: [
      /(mest|störst|binder).{0,30}kapital/i,
      /top.{0,10}capital/i,
      /största lagervärde/i,
      /högst lagervärde/i,
      /which items.{0,20}capital/i,
    ],
    run: (ctx, params) => {
      const rows = topBy(ctx.intelligence.items, params.limit, (i) => i.value);
      const total = rows.reduce((a, i) => a + i.value, 0);
      const share = ctx.result.kpis.inventoryValue > 0 ? (total / ctx.result.kpis.inventoryValue) * 100 : 0;
      const dead = rows.filter((i) => i.action === "write_off" || i.action === "liquidate");
      return answer(
        "top_capital",
        params.raw,
        `De ${rows.length} artiklarna med störst kapitalbindning står för ${sek(total)}, vilket är ${pctf(share)} av hela lagervärdet (${sek(ctx.result.kpis.inventoryValue)}). ` +
          (dead.length > 0
            ? `${dead.length} av dem är inaktiva och binder ${sek(dead.reduce((a, i) => a + i.value, 0))} utan att sälja. `
            : "") +
          `Högst ligger ${rows[0]!.name} (${rows[0]!.sku}) med ${sek(rows[0]!.value)} och ${rows[0]!.coverDays === null ? "ingen försäljning" : `${rows[0]!.coverDays} dagars täckning`}.`,
        {
          facts: [
            { label: "Summa topplista", value: sek(total) },
            { label: "Andel av lagervärdet", value: pctf(share) },
            { label: "Inaktiva artiklar i listan", value: `${dead.length} artiklar` },
          ],
          table: { columns: ITEM_COLUMNS, rows: rows.map(itemRow) },
          followUps: ["Vilka av dessa bör vi agera på först?", "Hur mycket kan frigöras?", "Visa 20 i stället"],
          sources: ["analysis.kpis.inventoryValue", "intelligence.items[].value"],
          params: { limit: params.limit },
        },
      );
    },
  },
  {
    id: "stockout_risk",
    patterns: [/(risk|riskerar).{0,20}brist/i, /ta slut/i, /stockout/i, /bristrisk/i, /slut i lager/i],
    run: (ctx, params) => {
      const risky = ctx.intelligence.items
        .filter((i) => i.coverDays !== null && i.coverDays < i.leadTimeDays && i.avgMonthlyDemand > 0)
        .sort((a, b) => (a.coverDays ?? 0) - (b.coverDays ?? 0));
      const value = risky.reduce((a, i) => a + Math.max(0, i.reorderPoint - i.available) * (i.price ?? i.cost), 0);

      // Forecast-based check for the most urgent articles, so the answer is not
      // only "days of cover" but a probability from the forecast model.
      const rawBySku = new Map(ctx.items.map((i) => [i.sku, i]));
      const enriched = risky.slice(0, 20).map((i) => {
        const raw = rawBySku.get(i.sku);
        if (!raw?.monthly) return { item: i, probability: null as number | null, units: null as number | null };
        const f = forecastSeries(raw.monthly, { horizon: 3 });
        const plan = supplyPlan(raw, f, { serviceLevel: ctx.result.settings.serviceLevel, horizonMonths: 3 });
        return { item: i, probability: plan.stockoutProbability, units: plan.expectedShortageUnits };
      });
      const rows = enriched.slice(0, params.limit);

      return answer(
        "stockout_risk",
        params.raw,
        risky.length === 0
          ? "Ingen artikel täcker kortare tid än sin egen ledtid just nu. Det finns ingen akut bristrisk i materialet."
          : `${risky.length} artiklar täcker kortare tid än sin ledtid. Sammanlagt handlar det om cirka ${sek(value)} i försäljning som riskerar att utebli under en ledtid. ` +
            `Mest akut: ${risky.slice(0, 3).map((i) => `${i.name} (${i.coverDays} d mot ${i.leadTimeDays} d)`).join(", ")}.` +
            (rows.some((r) => r.probability !== null)
              ? ` Prognosmodellen uppskattar bristrisken för de mest utsatta artiklarna till mellan ${pctf(Math.min(...rows.filter((r) => r.probability !== null).map((r) => (r.probability ?? 0) * 100)))} och ${pctf(Math.max(...rows.filter((r) => r.probability !== null).map((r) => (r.probability ?? 0) * 100)))}.`
              : ""),
        {
          facts: [
            { label: "Artiklar i riskzonen", value: `${risky.length}` },
            { label: "Riskerad försäljning", value: sek(value) },
          ],
          table: {
            columns: ["Artikel", "Benämning", "Täckning", "Ledtid", "Bristrisk", "Förväntad brist"],
            rows: rows.map((r) => [
              r.item.sku,
              r.item.name.slice(0, 38),
              `${r.item.coverDays} d`,
              `${r.item.leadTimeDays} d`,
              r.probability === null ? "–" : `${Math.round(r.probability * 100)} %`,
              r.units === null ? "–" : `${Math.round(r.units)} st`,
            ]),
          },
          followUps: ["Vad bör vi beställa nu?", "Simulera 20 % högre efterfrågan", "Visa inaktivt lager i stället"],
          sources: ["analysis.items[].coverDays", "forecast.supplyPlan"],
          confidence: risky.length > 0 ? "high" : "medium",
          brief: {
            identified: `${risky.length} artiklar har kortare täckning än sin ledtid.`,
            why: "Om täckningen är kortare än ledtiden hinner en ny leverans inte fram innan lagret tar slut.",
            data: "Saldo, reserverat lager, ledtid, månadshistorik och prognosens bristrisk.",
            action: "Beställ de mest utsatta artiklarna först och kontrollera MOQ och leverantörens ledtid.",
            effect: `Cirka ${sek(value)} i försäljning riskerar att utebli under en ledtid om ingen åtgärd görs.`,
            uncertainty: "Prognosens bristrisk bygger på historisk variation och antagen leveransprecision. Verklig efterfrågan kan avvika.",
          },
          params: { limit: params.limit },
        },
      );
    },
  },
  {
    id: "release_capital",
    patterns: [/frig(ö|o)ra?.{0,25}kapital/i, /hur mycket.{0,20}frig/i, /release.{0,15}capital/i, /frigjort r(ö|o)relsekapital/i],
    run: (ctx) => {
      const low = ctx.result.kpis.potentialReleaseLow;
      const high = ctx.result.kpis.potentialReleaseHigh;
      const dead = ctx.result.kpis.deadStockValue;
      const over = ctx.result.kpis.overstockValue;
      return answer(
        "release_capital",
        "Hur mycket kapital kan frigöras?",
        `Realistiskt frigjort kapital ligger mellan ${sek(low)} och ${sek(high)}. ` +
          `Det bygger på ${sek(dead)} i kapital i inaktiva artiklar och ${sek(over)} i överlager, med realisationsgrad 25–55 % på inaktiva artiklar och 15–35 % på överlager. ` +
          `Intervallet är brett med flit: hellre att du överträffar en låg siffra än försvarar en hög. ` +
          `Med 8 % kalkylränta motsvarar det ${sek(low * 0.08)}–${sek(high * 0.08)} per år i lägre kapitalkostnad.`,
        {
          facts: [
            { label: "Inaktivt lager", value: sek(dead) },
            { label: "Överlager", value: sek(over) },
            { label: "Frigjort kapital", value: `${sek(low)}–${sek(high)}` },
          ],
          followUps: ["Vilka artiklar ska realiseras först?", "Simulera 15 % lagerreduktion", "Visa prioriterade åtgärder"],
          sources: ["analysis.kpis.potentialReleaseLow", "analysis.kpis.potentialReleaseHigh"],
        },
      );
    },
  },
  {
    id: "reorder",
    patterns: [/n(ä|a)sta ink(ö|o)p/i, /vad.{0,15}best(ä|a)lla/i, /reorder/i, /beställningsf(ö|o)rslag/i, /order proposal/i],
    run: (ctx, params) => {
      const rawBySku = new Map(ctx.items.map((i) => [i.sku, i]));
      const candidates = ctx.intelligence.items
        .filter((i) => i.coverDays !== null && i.coverDays <= i.leadTimeDays * 1.2 && i.avgMonthlyDemand > 0)
        .sort((a, b) => (a.coverDays ?? 0) - (b.coverDays ?? 0))
        .slice(0, params.limit);

      const rows = candidates.map((i) => {
        const raw = rawBySku.get(i.sku)!;
        const f = forecastSeries(raw.monthly ?? [], { horizon: 3 });
        const plan = supplyPlan(raw, f, { serviceLevel: ctx.result.settings.serviceLevel });
        return { i, plan };
      });
      const totalValue = rows.reduce((a, r) => a + r.plan.orderQuantity * r.i.cost, 0);

      return answer(
        "reorder",
        params.raw,
        rows.length === 0
          ? "Ingen artikel behöver beställas utifrån nuvarande täckning och ledtid. Det är ett giltigt svar, inte ett tomt."
          : `${rows.length} artiklar ligger nära eller under beställningspunkt. Rekommenderad order är ${rows.reduce((a, r) => a + r.plan.orderQuantity, 0)} enheter till ett varuvärde av ${sek(totalValue)}. ` +
            `Kvantiteterna är EOQ avrundat uppåt till minsta orderkvantitet, med beställningskostnad 350 kr och lagerhållningsränta 22 %.`,
        {
          facts: [
            { label: "Artiklar att beställa", value: `${rows.length}` },
            { label: "Ordernivå (varuvärde)", value: sek(totalValue) },
          ],
          table: {
            columns: ["Artikel", "Benämning", "Saldo", "Beställningspunkt", "Orderqty", "Värde"],
            rows: rows.map((r) => [
              r.i.sku,
              r.i.name.slice(0, 36),
              Math.round(r.i.stock),
              Math.round(r.plan.reorderPoint),
              r.plan.orderQuantity,
              sek(r.plan.orderQuantity * r.i.cost),
            ]),
          },
          followUps: ["Visa bristrisken i procent", "Simulera längre ledtid", "Exportera förslaget"],
          sources: ["forecast.supplyPlan.reorderPoint", "forecast.supplyPlan.orderQuantity (EOQ)"],
          brief: {
            identified: `${rows.length} artiklar ligger nära eller under beställningspunkt.`,
            why: "Utan beställning fortsätter försäljningen att minska saldot under säkerhetslagret.",
            data: "Aktuellt saldo, ledtid, säkerhetslager, beställningspunkt, prognos och MOQ.",
            action: "Godkänn de föreslagna kvantiteterna eller justera mot leverantörens avtal innan beställning.",
            effect: `Ordern om ${rows.reduce((a, r) => a + r.plan.orderQuantity, 0)} enheter motsvarar ${sek(totalValue)} i varuvärde.`,
            uncertainty: "EOQ antar 350 kr per order och 22 % lagerhållningsränta. MOQ och pris kan ändra den ekonomiska kvantiteten.",
          },
          params: { limit: params.limit },
        },
      );
    },
  },
  {
    id: "value_change",
    patterns: [/varf(ö|o)r.{0,40}lagerv(ä|a)rde/i, /lagerv(ä|a)rde.{0,20}(ö|o)kat/i, /v(ä|a)rde.{0,20}utveckling/i, /why.{0,20}inventory value/i],
    run: (ctx) => {
      const snaps = ctx.snapshots ?? [];
      if (snaps.length < 2) {
        return answer(
          "value_change",
          "Varför har lagervärdet förändrats?",
          "Underlaget innehåller bara en mätpunkt, så en förändring kan inte förklaras ännu. Lagervärdets utveckling kräver minst två importer vid olika tillfällen. Då jämför systemet dem automatiskt. Det som däremot går att säga nu är vad värdet består av.",
          {
            facts: [{ label: "Lagervärde idag", value: sek(ctx.result.kpis.inventoryValue) }],
            followUps: ["Vad består lagervärdet av?", "Vilka artiklar binder mest?", "Visa inaktivt lager"],
            confidence: "low",
            notes: ["Endast en historisk mätpunkt finns. Importera igen om en månad för att få en trend."],
            sources: ["snapshots"],
          },
        );
      }
      const first = snaps[0]!;
      const last = snaps[snaps.length - 1]!;
      const change = last.value - first.value;
      const changePct = first.value > 0 ? (change / first.value) * 100 : 0;
      const dead = ctx.result.kpis.deadStockValue;
      const over = ctx.result.kpis.overstockValue;
      return answer(
        "value_change",
        "Varför har lagervärdet förändrats?",
        `Lagervärdet har gått från ${sek(first.value)} (${first.date.slice(0, 10)}) till ${sek(last.value)} (${last.date.slice(0, 10)}), en förändring på ${change >= 0 ? "+" : ""}${sek(change)} (${pctf(changePct)}). ` +
          `I den senaste mätningen uppgår inaktivt lager till ${sek(dead)} och överlager till ${sek(over)}. ` +
          `Om ökningen inte förklaras av inköp är det här de två posterna att granska först, men exakt vilka artiklar som drev förändringen kräver att båda importerna innehåller samma artikelnummer.`,
        {
          facts: [
            { label: "Första mätning", value: sek(first.value) },
            { label: "Senaste mätning", value: sek(last.value) },
            { label: "Förändring", value: `${change >= 0 ? "+" : ""}${sek(change)}` },
          ],
          followUps: ["Visa inaktivt lager", "Vilka kategorier binder mest?", "Simulera 15 % reduktion"],
          sources: ["snapshots", "analysis.kpis.deadStockValue"],
          confidence: snaps.length >= 3 ? "high" : "medium",
          notes: ["Förklaringen bygger på lagervärde per importeringstillfälle, inte på transaktionsdata."],
        },
      );
    },
  },
  {
    id: "suppliers",
    patterns: [/leverant(ö|o)r/i, /supplier/i, /ink(ö|o)pskanal/i],
    run: (ctx) => {
      const groups = ctx.intelligence.capital.bySupplier.slice(0, 10);
      const total = ctx.intelligence.capital.total;
      const worst = groups.filter((g) => g.deadValue > 0).sort((a, b) => b.deadValue - a.deadValue)[0];
      return answer(
        "suppliers",
        "Vilka leverantörer påverkar lagerhållningen mest?",
        groups.length === 0
          ? "Underlaget saknar leverantörskolumn, så leverantörsanalys kan inte göras. Lägg till en kolumn med leverantörsnamn i exporten."
          : `${groups[0]!.label} är störst med ${sek(groups[0]!.value)} (${pctf(groups[0]!.share)} av lagervärdet) fördelat på ${groups[0]!.count} artiklar. ` +
            (worst
              ? `Mest kapital i inaktiva artiklar finns hos ${worst.label}: ${sek(worst.deadValue)} i artiklar som inte säljer. Det är den leverantörsrelationen som först bör omförhandlas.`
              : "Ingen enskild leverantör sticker ut med inaktivt lager."),
        {
          facts: groups.slice(0, 4).map((g) => ({ label: g.label, value: `${sek(g.value)} · ${pctf(g.share)}` })),
          table: {
            columns: ["Leverantör", "Artiklar", "Lagervärde", "Andel", "Inaktivt lager"],
            rows: groups.map((g) => [g.label, g.count, sek(g.value), pctf(g.share), sek(g.deadValue)]),
          },
          followUps: ["Vilka artiklar från den största leverantören är inaktiva?", "Visa kategorier i stället", "Hur mycket kan frigöras?"],
          sources: ["intelligence.capital.bySupplier"],
          confidence: groups[0]!.label === "Okänd leverantör" ? "low" : "high",
          notes: groups[0]!.label === "Okänd leverantör" ? ["Leverantörskolumnen saknas i underlaget."] : [],
        },
      );
    },
  },
  {
    id: "slowing",
    patterns: [/f(ö|o)rs(ä|a)mrad.{0,25}oms(ä|a)ttning/i, /l(å|a)ngsam.{0,20}oms(ä|a)ttning/i, /slow.{0,20}(moving|turn)/i, /oms(ä|a)ttningshastighet/i],
    run: (ctx, params) => {
      const median = ctx.intelligence.velocity.medianTurns;
      const slow = ctx.intelligence.items
        .filter((i) => i.soldPeriod > 0 && i.turns < median * 0.5 && i.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, params.limit);
      return answer(
        "slowing",
        params.raw,
        `${slow.length} artiklar roterar mindre än halva medianhastigheten (${formatNumber(median, 2)} ggr/år) och binder tillsammans ${sek(slow.reduce((a, i) => a + i.value, 0))}. ` +
          `Snabbast roterande grupp ligger på ${formatNumber(ctx.intelligence.velocity.fast, 0)} artiklar, medan ${ctx.intelligence.velocity.dead} artiklar inte roterar alls.`,
        {
          facts: [
            { label: "Median omsättning", value: `${formatNumber(median, 2)} ggr/år` },
            { label: "Långsamma artiklar", value: `${slow.length}` },
            { label: "Kapital i långsamma", value: sek(slow.reduce((a, i) => a + i.value, 0)) },
          ],
          table: {
            columns: ["Artikel", "Benämning", "Omsättning", "DIO", "Lagervärde"],
            rows: slow.map((i) => [i.sku, i.name.slice(0, 40), `${formatNumber(i.turns, 2)} ggr`, i.dio === null ? "–" : `${i.dio} d`, sek(i.value)]),
          },
          followUps: ["Visa de snabbaste i stället", "Vilka har låg marginal?", "Simulera 15 % reduktion"],
          sources: ["intelligence.items[].turns", "intelligence.velocity"],
          params: { limit: params.limit },
        },
      );
    },
  },
  {
    id: "demand_increase",
    patterns: [/efterfr(å|a)gan.{0,30}(ö|o)kar/i, /demand.{0,20}(increase|up)/i, /vad h(ä|a)nder om/i, /simulera/i],
    run: (ctx, params) => {
      const percent = params.percent || 20;
      const baseline = buildBaseline(ctx.items, ctx.months);
      const outcome = simulate(baseline, {
        name: `Efterfrågan +${percent} %`,
        demandMultiplier: 1 + percent / 100,
        holdingRate: 0.22,
        costMultiplier: 1,
        priceMultiplier: 1,
        leadTimeMultiplier: 1,
        serviceLevel: ctx.result.settings.serviceLevel,
        stockReductionPct: 0,
        orderQtyMultiplier: 1,
        supplierDelayDays: 0,
        supplierDelayProbability: 0,
      });
      return answer(
        "demand_increase",
        params.raw,
        `Om efterfrågan ökar ${percent} % behöver lagervärdet bli ${sek(outcome.totals.inventoryValue)} för att hålla samma servicenivå, en ökning med ${sek(outcome.delta.inventoryValue)}. ` +
          `Utan extra kapital faller uppfyllnadsgraden till ${pctf(outcome.totals.serviceLevel * 100)} och ${outcome.totals.stockoutRiskCount} artiklar hamnar i riskzonen. ` +
          `Förväntad utebliven marginal blir ${sek(outcome.totals.lostMargin)} under en ledtid.`,
        {
          facts: [
            { label: "Nytt lagervärde", value: sek(outcome.totals.inventoryValue) },
            { label: "Kapitalbehov", value: `+${sek(outcome.delta.inventoryValue)}` },
            { label: "Uppfyllnadsgrad", value: pctf(outcome.totals.serviceLevel * 100) },
          ],
          table: {
            columns: ["Mått", "Idag", "Scenariot", "Förändring"],
            rows: [
              ["Lagervärde", sek(outcome.totals.inventoryValue - outcome.delta.inventoryValue), sek(outcome.totals.inventoryValue), `+${sek(outcome.delta.inventoryValue)}`],
              ["Bristrisk (artiklar)", String(outcome.totals.stockoutRiskCount - outcome.delta.stockoutRiskCount), String(outcome.totals.stockoutRiskCount), `+${outcome.delta.stockoutRiskCount}`],
              ["Uppfyllnadsgrad", pctf((outcome.totals.serviceLevel - outcome.delta.serviceLevel) * 100), pctf(outcome.totals.serviceLevel * 100), `${formatNumber(outcome.delta.serviceLevel * 100, 1)} pp`],
              ["Utebliven marginal", sek(outcome.totals.lostMargin - outcome.delta.lostMargin), sek(outcome.totals.lostMargin), `+${sek(outcome.delta.lostMargin)}`],
            ],
          },
          followUps: [`Simulera ${percent + 10} % i stället`, "Vad händer vid 30 dagars försening?", "Visa prioriterade åtgärder"],
          sources: ["simulate.buildBaseline", "simulate.runItems"],
          params: { percent },
          notes: ["Simuleringen antar att prognosen skalas proportionellt och att ledtiderna är oförändrade."],
        },
      );
    },
  },
  {
    id: "best_actions",
    patterns: [/st(ö|o)rst.{0,20}ekonomisk/i, /b(ä|a)sta (å|a)tg(ä|a)rd/i, /vad b(ö|o)r vi g(ö|o)ra/i, /prioritera/i, /best actions/i, /rekommendation/i],
    run: (ctx, params) => {
      const recs = ctx.result.recommendations.slice(0, params.limit);
      const top = ctx.intelligence.priorities.slice(0, 5);
      return answer(
        "best_actions",
        params.raw,
        recs.length === 0
          ? "Analysen hittar inga åtgärder som flyttar ekonomin. Det är ett resultat, inte en brist."
          : `De åtgärder som ger störst effekt är: ${recs.map((r, i) => `${i + 1}) ${r.title} (${sek(r.impactLow)}–${sek(r.impactHigh)})`).join("; ")}. ` +
            `På artikelnivå toppar ${top[0]?.name ?? "–"} med prioritetspoäng ${top[0]?.score ?? 0} av 100.`,
        {
          facts: recs.map((r) => ({ label: r.title, value: `${sek(r.impactLow)}–${sek(r.impactHigh)}` })),
          table: {
            columns: ["Prioritet", "Åtgärd", "Artikel", "Poäng", "Kapital"],
            rows: top.map((p, i) => [i + 1, p.reasons[0] ?? p.action, `${p.sku} ${p.name.slice(0, 30)}`, p.score, sek(p.value)]),
          },
          followUps: ["Visa de 20 högst prioriterade artiklarna", "Hur mycket kan frigöras?", "Exportera åtgärdslistan"],
          sources: ["analysis.recommendations", "intelligence.priorities"],
          brief: {
            identified: recs.length ? `${recs.length} åtgärder med beräknad ekonomisk effekt.` : "Inga åtgärder med materiell effekt hittades.",
            why: recs.length ? "De största posterna är kapital som inte rör sig i takt med efterfrågan eller riskerar att ta slut." : "Lagret ligger inom de definierade styrgränserna.",
            data: "Kapitalbindning, inaktivt lager, överlager, bristrisk, marginal och artikelprioritet.",
            action: recs.length ? "Arbeta igenom åtgärderna i prioritetsordning och öppna artikeln för att se beräkningen." : "Ingen åtgärd krävs; följ upp vid nästa import.",
            effect: recs.length ? `${sek(recs.reduce((a, r) => a + r.impactLow, 0))}–${sek(recs.reduce((a, r) => a + r.impactHigh, 0))} i uppskattad effekt.` : "0 kr beräknad effekt.",
            uncertainty: "Effektintervallen bygger på realisationsgrader och antaganden som visas i analysen. De är uppskattningar, inte bokförda värden.",
          },
          params: { limit: params.limit },
        },
      );
    },
  },
  {
    id: "dead_stock",
    patterns: [/inaktivt lager/i, /inaktiva artiklar/i, /inactive stock/i, /inkurans/i, /obsolet/i, /inte s(å|a)lt/i],
    run: (ctx, params) => {
      const dead = ctx.intelligence.items
        .filter((i) => i.action === "write_off" || i.action === "liquidate")
        .sort((a, b) => b.value - a.value);
      const total = dead.reduce((a, i) => a + i.value, 0);
      const share = ctx.result.kpis.inventoryValue > 0 ? (total / ctx.result.kpis.inventoryValue) * 100 : 0;
      return answer(
        "dead_stock",
        params.raw,
        dead.length === 0
          ? `Ingen artikel saknar försäljning de senaste ${ctx.result.settings.deadStockDays} dagarna.`
          : `${dead.length} artiklar är inaktiva och binder ${sek(total)}, ${pctf(share)} av lagervärdet. ` +
            `De ${Math.min(3, dead.length)} största står för ${sek(dead.slice(0, 3).reduce((a, i) => a + i.value, 0))}. ` +
            `Vid 25–55 % realisationsgrad frigör de ${sek(total * 0.25)}–${sek(total * 0.55)}.`,
        {
          facts: [
            { label: "Antal artiklar", value: `${dead.length}` },
            { label: "Bundet kapital", value: sek(total) },
            { label: "Andel av lagret", value: pctf(share) },
          ],
          table: { columns: ITEM_COLUMNS, rows: dead.slice(0, params.limit).map(itemRow) },
          followUps: ["Vilka ska realiseras först?", "Visa överlager", "Hur påverkar en realisering marginalen?"],
          sources: ["analysis.items[].action", "analysis.kpis.deadStockValue"],
          params: { limit: params.limit },
        },
      );
    },
  },
  {
    id: "margin",
    patterns: [/l(å|a)g l(ö|o)nsamhet/i, /l(å|a)g marginal/i, /marginal/i, /t(ä|a)ckningsbidrag/i, /profitab/i, /unprofitable/i],
    run: (ctx, params) => {
      const low = ctx.intelligence.items
        .filter((i) => i.marginPct !== null && i.marginPct < 15 && i.value > 0)
        .sort((a, b) => a.marginPct! - b.marginPct!)
        .slice(0, params.limit);
      const neg = ctx.intelligence.profitability.negativeMarginCount;
      return answer(
        "margin",
        params.raw,
        `Bruttomarginalen i underlaget är ${pctf(ctx.intelligence.profitability.marginPct)} (${sek(ctx.intelligence.profitability.grossProfit)} på ${sek(ctx.intelligence.profitability.revenue)} i försäljning). ` +
          `${neg} artiklar säljs med negativt täckningsbidrag och ${ctx.intelligence.profitability.lowMarginCount} ligger under 15 % marginal, med ${sek(ctx.intelligence.profitability.lowMarginValue)} bundet i lager.`,
        {
          facts: [
            { label: "Bruttomarginal", value: pctf(ctx.intelligence.profitability.marginPct) },
            { label: "Negativ marginal", value: `${neg} artiklar` },
            { label: "Kapital i lågmarginal", value: sek(ctx.intelligence.profitability.lowMarginValue) },
          ],
          table: {
            columns: ["Artikel", "Benämning", "Marginal", "TB", "Lagervärde"],
            rows: low.map((i) => [i.sku, i.name.slice(0, 40), pctf(i.marginPct ?? 0), sek(i.profitPeriod), sek(i.value)]),
          },
          followUps: ["Vilka kategorier har sämst marginal?", "Visa inaktivt lager", "Vad ger störst effekt?"],
          sources: ["intelligence.profitability", "intelligence.items[].marginPct"],
          confidence: ctx.result.dataQuality.hasPrice ? "high" : "low",
          notes: ctx.result.dataQuality.hasPrice ? [] : ["Försäljningspris saknas i underlaget, så marginalen bygger på inköpspris."],
          params: { limit: params.limit },
        },
      );
    },
  },
  {
    id: "category",
    patterns: [/kategori/i, /produktgrupp/i, /category/i, /segment/i],
    run: (ctx, params) => {
      const groups = ctx.intelligence.capital.byCategory.slice(0, params.limit);
      return answer(
        "category",
        params.raw,
        groups.length === 0
          ? "Underlaget saknar kategori, så analysen kan inte brytas ner per produktgrupp."
          : `${groups[0]!.label} binder mest kapital: ${sek(groups[0]!.value)} (${pctf(groups[0]!.share)}). ` +
            `Kategorierna med mest kapital i inaktiva artiklar är ${ctx.intelligence.capital.byCategory
              .filter((g) => g.deadValue > 0)
              .sort((a, b) => b.deadValue - a.deadValue)
              .slice(0, 2)
              .map((g) => `${g.label} (${sek(g.deadValue)})`)
              .join(" och ") || "inga"}.`,
        {
          facts: groups.slice(0, 4).map((g) => ({ label: g.label, value: `${sek(g.value)} · ${pctf(g.share)}` })),
          table: {
            columns: ["Kategori", "Artiklar", "Lagervärde", "Andel", "Inaktivt lager", "Överlager"],
            rows: groups.map((g) => [g.label, g.count, sek(g.value), pctf(g.share), sek(g.deadValue), sek(g.overstockValue)]),
          },
          followUps: ["Vilken kategori har bäst omsättning?", "Visa artiklarna i den största kategorin", "Vilka leverantörer?"],
          sources: ["intelligence.capital.byCategory"],
          params: { limit: params.limit },
        },
      );
    },
  },
  {
    id: "seasonality",
    patterns: [/s(ä|a)song/i, /seasonal/i, /topp(ar|m(å|a)nad)/i],
    run: (ctx) => {
      const rows = ctx.intelligence.seasonality.slice(0, 10);
      return answer(
        "seasonality",
        "Vilka artiklar är säsongsberoende?",
        rows.length === 0
          ? `Ingen artikel har tillräckligt tydligt säsongsmönster i ${ctx.months} månaders historik. Säsongsanalys kräver minst 12 månader och en variation som överstiger 25 %.`
          : `${rows.length} artiklar har ett tydligt säsongsmönster. Starkast är ${rows[0]!.name} med ${formatNumber(rows[0]!.ratio, 1)} gånger högre efterfrågan i toppmånaden än i bottenmånaden. ` +
            `För dessa bör beställningspunkten höjas inför säsong och sänkas efter. Annars riskerar resten att bli inaktiva artiklar.`,
        {
          facts: rows.slice(0, 3).map((r) => ({ label: r.name.slice(0, 30), value: `${formatNumber(r.ratio, 1)}× säsongsskillnad` })),
          table: {
            columns: ["Artikel", "Benämning", "Säsongsstyrka", "Peak/botten"],
            rows: rows.map((r) => [r.sku, r.name.slice(0, 40), pctf(r.strength * 100), `${formatNumber(r.ratio, 1)}×`]),
          },
          followUps: ["Simulera 20 % högre efterfrågan", "Visa inaktivt lager", "Vilka artiklar har avvikelser?"],
          sources: ["intelligence.seasonality"],
          confidence: ctx.months >= 12 ? "high" : "low",
        },
      );
    },
  },
  {
    id: "anomalies",
    patterns: [/avvikelse/i, /onormal/i, /anomal/i, /konstig/i, /pl(ö|o)tslig/i],
    run: (ctx, params) => {
      const rows = ctx.intelligence.anomalies.slice(0, params.limit);
      return answer(
        "anomalies",
        params.raw,
        rows.length === 0
          ? "Inga statistiskt avvikande rörelser hittades i materialet."
          : `${rows.length} avvikelser hittades. Allvarligast: ${rows[0]!.detail}`,
        {
          facts: [{ label: "Antal avvikelser", value: `${ctx.intelligence.anomalies.length}` }],
          table: {
            columns: ["Artikel", "Benämning", "Typ", "Förklaring"],
            rows: rows.map((a) => [a.sku, a.name.slice(0, 30), a.kind, a.detail.slice(0, 90)]),
          },
          followUps: ["Visa inaktivt lager", "Vilka artiklar säljer sämst?", "Hur påverkar det prognosen?"],
          sources: ["intelligence.anomalies"],
          params: { limit: params.limit },
        },
      );
    },
  },
];

/* ---------------------------------------------------------------- dispatch */

function parseParams(question: string, previous: ConversationTurn | null): Params {
  const lower = question.toLowerCase();
  let limit = DEFAULT_LIMIT;
  let percent = 0;
  let sku: string | null = null;

  const limitMatch = lower.match(/\b(\d{1,3})\b/);
  const wantsCount = /(de|top|st(ö|o)rsta|f(ö|o)rsta|visa)\s+\d{1,3}/.test(lower) || /\b\d{1,3}\s+(st(ö|o)rsta|artiklar|i st(ä|l)let)/.test(lower);
  if (limitMatch && wantsCount) limit = Math.min(100, Math.max(1, Number(limitMatch[1])));

  const percentMatch = lower.match(/(\d{1,3})\s*(%|procent)/);
  if (percentMatch) percent = Math.min(200, Math.max(1, Number(percentMatch[1])));

  // Article numbers are either prefixed (AB-1234) or pure digits (48213).
  // Requiring at least four digits keeps the match from catching years and
  // percentages while still recognising the numeric SKUs most POS exports use.
  const skuMatch = question.match(/\b([A-Z]{2,6}[-_]?\d{2,8}|\d{4,9})\b/);
  if (skuMatch) sku = skuMatch[1]!;

  // Follow-up phrasing ("och de 10 största?", "varför då?") keeps the previous
  // intent and merges the new parameters into it.
  const isFollowUp = /^(och|varf(ö|o)r|d(å|a)\b|samma|utveckla|mer)/i.test(question.trim()) && previous !== null;
  if (isFollowUp && !percent) percent = Number(previous!.params.percent ?? 0);

  return { limit, percent, sku, raw: question };
}

function detectIntent(question: string, previous: ConversationTurn | null): Intent {
  const isFollowUp = /^(och|varf(ö|o)r|d(å|a)\b|samma|utveckla|mer)/i.test(question.trim());
  if (isFollowUp && previous) {
    const prev = intents.find((i) => i.id === previous.intent);
    if (prev) return prev;
  }
  for (const intent of intents) {
    if (intent.patterns.some((p) => p.test(question))) return intent;
  }
  return intentById("best_actions");
}

function intentById(id: string): Intent {
  return intents.find((i) => i.id === id) ?? intents[intents.length - 1]!;
}

export function ask(
  ctx: CopilotContext,
  question: string,
  conversation: ConversationTurn[] = [],
): CopilotAnswer {
  const previous = conversation.length > 0 ? conversation[conversation.length - 1]! : null;
  const params = parseParams(question, previous);
  const intent = detectIntent(question, previous);

  // A SKU mentioned in the question always wins: the user is asking about one
  // article, whatever else the wording resembles.
  if (params.sku) {
    const item = ctx.intelligence.items.find(
      (i) => i.sku.toLowerCase() === params.sku!.toLowerCase() || i.sku.toLowerCase().includes(params.sku!.toLowerCase()),
    );
    if (item) {
      const raw = ctx.items.find((i) => i.sku === item.sku);
      const forecast = raw?.monthly ? forecastSeries(raw.monthly, { horizon: 6 }) : null;
      const plan = raw && forecast ? supplyPlan(raw, forecast, { serviceLevel: ctx.result.settings.serviceLevel }) : null;
      return answer(
        "item_lookup",
        question,
        `${item.name} (${item.sku}) har ${Math.round(item.stock)} enheter i lager till ett värde av ${sek(item.value)}. ` +
          `Omsättningen är ${formatNumber(item.turns, 2)} gånger per år och täckningen ${item.coverDays === null ? "obefintlig" : `${item.coverDays} dagar`}. ` +
          `Klassning: ABC ${item.abcRevenue} (försäljningsvärde), ABC ${item.abcValue} (lagervärde) och XYZ ${item.xyz ?? "saknas"}. ` +
          (plan
            ? `Prognosen pekar på ${formatNumber(plan.forecastMonthly, 1)} enheter per månad, en beställningspunkt på ${Math.round(plan.reorderPoint)} och en rekommenderad order på ${plan.orderQuantity} enheter.`
            : "Artikeln saknar månadshistorik, så någon prognos kan inte göras."),
        {
          facts: [
            { label: "Lagervärde", value: sek(item.value) },
            { label: "Omsättning", value: `${formatNumber(item.turns, 2)} ggr/år` },
            { label: "Marginal", value: item.marginPct === null ? "saknas" : pctf(item.marginPct) },
            { label: "ABC/XYZ", value: `${item.abcRevenue} / ${item.xyz ?? "–"}` },
          ],
          followUps: [`Prognos för ${item.sku}`, "Visa inaktivt lager", "Vad bör vi beställa?"],
          sources: ["intelligence.items", "forecast.supplyPlan"],
          brief: {
            identified: `${item.name} (${item.sku}) har ${Math.round(item.stock)} enheter i lager och ${item.coverDays ?? 0} dagars täckning.`,
            why: item.stockoutRisk ? "Täckningen är kortare än ledtiden." : item.overstockQty > 0 ? "Lagret är högre än ledtid och efterfrågan motiverar." : "Artikeln ligger inom sina styrgränser.",
            data: "Saldo, inköpspris, försäljningspris, ledtid, MOQ, månadshistorik och prognos.",
            action: plan ? `Beställningspunkt ${Math.round(plan.reorderPoint)} och rekommenderad order ${plan.orderQuantity} enheter vid påfyllning.` : "Komplettera månadshistorik för att få beställningspunkt.",
            effect: plan ? `Ordern motsvarar ${sek(plan.orderQuantity * item.cost)} i varuvärde.` : "Ingen order beräknad.",
            uncertainty: "Marginal och orderkvantitet bygger på angivna priser och antaganden. Kontrollera mot aktuellt avtal.",
          },
          params: { sku: item.sku },
        },
      );
    }
    return answer(
      "item_lookup",
      question,
      `Jag hittar ingen artikel med beteckningen ${params.sku} i underlaget. Kontrollera artikelnumret eller sök i artikelvyn.`,
      { confidence: "low", followUps: ["Vilka artiklar binder mest kapital?", "Visa inaktivt lager"] },
    );
  }

  return intent.run(ctx, params);
}

/* --------------------------------------------------------------- AI polish */

/**
 * Optional rephrasing. The deterministic answer is always the fallback, and a
 * suggestion that introduces a single unknown number is thrown away.
 */
export async function polishWithAi(
  answerIn: CopilotAnswer,
  config: { provider: string; apiKey: string; model: string; baseUrl: string; dataProcessingApproved: boolean },
): Promise<CopilotAnswer> {
  // A key is not consent. External processing stays off until the operator has
  // explicitly confirmed a DPA/transfer basis with AI_DATA_PROCESSING_APPROVED.
  if (!config.apiKey || config.provider === "none" || !config.dataProcessingApproved) return answerIn;

  const allowed = [answerIn.answer, ...answerIn.facts.map((f) => `${f.label} ${f.value}`)];
  const prompt = [
    "Du formulerar om en färdig lageranalys på svenska. Ändra inte sakinnehållet.",
    "Du får bara använda tal som finns i texten nedan. Hitta inte på något.",
    "Svara med ren text, högst 120 ord, ingen markdown.",
    "",
    `Fråga: ${answerIn.question}`,
    `Svar: ${answerIn.answer}`,
  ].join("\n");

  try {
    const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return answerIn;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return answerIn;
    if (!isGrounded(text, allowed)) {
      return { ...answerIn, notes: [...answerIn.notes, "AI-formuleringen avvisades eftersom den innehöll tal som inte fanns i underlaget."] };
    }
    return { ...answerIn, answer: text };
  } catch {
    return answerIn;
  }
}

const SUGGESTIONS = [
  "Vilka 20 artiklar binder mest onödigt kapital?",
  "Vilka produkter riskerar att ta slut inom 14 dagar?",
  "Hur mycket kapital kan frigöras genom att minska överlagret?",
  "Vilka leverantörer har störst påverkan på vår lagerhållning?",
  "Vilka produkter har försämrad omsättningshastighet?",
  "Vad händer om efterfrågan ökar med 20 procent?",
  "Vilka åtgärder skulle ge störst ekonomisk effekt?",
];

export function copilotSuggestions(locale: Locale = "sv"): string[] {
  return SUGGESTIONS.map((s) => appText(locale, s));
}
