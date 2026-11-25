/**
 * Narrative layer.
 *
 * Two rules govern this file:
 *   1. The deterministic template is always good enough to ship. AI is an
 *      enhancement, never a dependency.
 *   2. AI may never introduce a number. Every digit sequence in AI output is
 *      checked against the fact sheet; if anything is new, the whole AI text is
 *      discarded and the template is used instead.
 */
import { config } from "./config.ts";
import type { AnalysisResult } from "./analysis.ts";
import { appNum, appSek, appText } from "./i18n-app.ts";
import type { Locale } from "./i18n.ts";

export interface NarrativePriority {
  title: string;
  why: string;
  action: string;
  impactLow: number;
  impactHigh: number;
}

export interface Narrative {
  headline: string;
  summary: string[];
  observations: string[];
  priorities: NarrativePriority[];
  closing: string;
  source: "template" | "ai";
  model: string | null;
}

export interface NarrativeContext {
  company: string;
  filename: string;
}

export function buildFacts(analysis: AnalysisResult) {
  const k = analysis.kpis;
  return {
    foretag: "",
    lagervarde: k.inventoryValue,
    antal_artiklar: k.skuCount,
    dodlager_varde: k.deadStockValue,
    dodlager_antal: k.deadStockCount,
    over_lager_varde: k.overstockValue,
    over_lager_antal: k.overstockCount,
    lageromsattning: k.turns,
    lagerdagar: k.daysOfInventory,
    frigjort_kapital_lag: k.potentialReleaseLow,
    frigjort_kapital_hog: k.potentialReleaseHigh,
    brist_antal: k.stockoutRiskCount,
    brist_varde: k.stockoutRiskValue,
    kapitalkostnad_per_ar: k.capitalCostAnnual,
    varuflode_per_ar: k.annualCogs,
    andel_dodlager_procent:
      k.inventoryValue > 0 ? Math.round((k.deadStockValue / k.inventoryValue) * 100) : 0,
    serviceniva_procent: Math.round(analysis.settings.serviceLevel * 100),
    kalkylranta_procent: Math.round(analysis.settings.capitalCostRate * 100),
    historik_manader: analysis.dataQuality.months,
  };
}

export function buildTemplateNarrative(
  analysis: AnalysisResult,
  ctx: NarrativeContext,
  locale: Locale = "sv",
): Narrative {
  const k = analysis.kpis;
  const t = (source: string, vars?: Record<string, string | number>) => appText(locale, source, vars);
  const num = (value: number, decimals = 0) => appNum(locale, value, decimals);
  const sek = (value: number, compact = false) => appSek(locale, value, compact);
  const facts = buildFacts(analysis);
  const company = ctx.company || t("Företaget");
  const share =
    k.inventoryValue > 0 ? Math.round((k.deadStockValue / k.inventoryValue) * 100) : 0;

  const headline =
    k.deadStockValue > 0
      ? locale === "en"
        ? t("{value} is tied up in stock that is not selling", { value: sek(k.deadStockValue, true) })
        : `${sek(k.deadStockValue, true)} är bundet i artiklar utan registrerad försäljning`
      : locale === "en"
        ? t("Inventory is turning in line with demand")
        : "Lagret omsätts i nivå med efterfrågan";

  const summary: string[] = [];
  summary.push(
    locale === "en"
      ? t("{company} holds {items} items worth {value}. Annual goods flow is {cogs}, giving {turns} turns per year{days}.", {
          company,
          items: num(k.skuCount),
          value: sek(k.inventoryValue),
          cogs: sek(k.annualCogs),
          turns: num(k.turns, 1),
          days: k.daysOfInventory !== null ? t(" and {n} days of cover", { n: num(k.daysOfInventory) }) : "",
        })
      : `${company} har ${num(k.skuCount)} artiklar i lager till ett värde av ${sek(k.inventoryValue)}. Varuflödet motsvarar ${sek(k.annualCogs)} per år, vilket ger en lageromsättning på ${num(k.turns, 1)} gånger per år${
          k.daysOfInventory !== null ? ` och en genomsnittlig liggtid på ${num(k.daysOfInventory)} dagar` : ""
        }.`,
  );
  if (k.deadStockValue > 0) {
    summary.push(
      locale === "en"
        ? t("{value}, or {share}% of inventory value, sits in {n} items that have not sold in the last {days} days. That is the single largest release opportunity in the analysis.", {
            value: sek(k.deadStockValue),
            share,
            n: k.deadStockCount,
            days: analysis.settings.deadStockDays,
          })
        : `${sek(k.deadStockValue)}, eller ${share} % av lagervärdet, sitter i ${k.deadStockCount} artiklar som inte sålt något under de senaste ${analysis.settings.deadStockDays} dagarna. Det är den enskilt största frigöringspotentialen i analysen.`,
    );
  }
  if (k.overstockValue > 0) {
    summary.push(
      locale === "en"
        ? t("A further {value} sits in overstock across {n} items: goods that sell, but more slowly than lead time and demand justify.", {
            value: sek(k.overstockValue),
            n: k.overstockCount,
          })
        : `Utöver det ligger ${sek(k.overstockValue)} i överlager på ${k.overstockCount} artiklar, alltså varor som säljer men i högre takt än vad ledtid och efterfrågan motiverar.`,
    );
  }
  summary.push(
    locale === "en"
      ? t("In total, {low}–{high} is assessed as releasable within 6–12 months, at a realisation rate of 25–55% of capital in inactive items and 15–35% of overstock. The range is conservatively set.", {
          low: sek(k.potentialReleaseLow, true),
          high: sek(k.potentialReleaseHigh, true),
        })
      : `Sammantaget bedöms ${sek(k.potentialReleaseLow, true)}–${sek(k.potentialReleaseHigh, true)} kunna frigöras inom 6–12 månader, vid en realisationsgrad på 25–55 % av kapitalet i inaktiva artiklar och 15–35 % av överlagret. Intervallet är försiktigt satt.`,
  );
  if (k.stockoutRiskCount > 0) {
    summary.push(
      locale === "en"
        ? t("At the same time, {n} items sell but cover less than their own lead time. The risk runs the other way there: around {value} in lost sales if nothing is done.", {
            n: k.stockoutRiskCount,
            value: sek(k.stockoutRiskValue),
          })
        : `Samtidigt finns ${k.stockoutRiskCount} artiklar som säljer men täcker mindre än sin egen ledtid. Där ligger risken i andra riktningen: utebliven försäljning på cirka ${sek(k.stockoutRiskValue)} om inget görs.`,
    );
  }

  const observations: string[] =
    locale === "en"
      ? [
          t("Inventory value: {value} across {n} items.", { value: sek(k.inventoryValue), n: num(k.skuCount) }),
          t("Inactive stock: {value} ({n} items, {share}% of inventory value).", { value: sek(k.deadStockValue), n: k.deadStockCount, share }),
          t("Overstock: {value} ({n} items).", { value: sek(k.overstockValue), n: k.overstockCount }),
          t("Slow movers: {value} ({n} items with more than 180 days of cover).", { value: sek(k.slowMoverValue), n: k.slowMoverCount }),
          t("Inventory turns: {turns}× per year{turnsSuffix}.", {
            turns: num(k.turns, 1),
            turnsSuffix: k.daysOfInventory !== null ? t(", {n} days of cover", { n: num(k.daysOfInventory) }) : "",
          }),
          t("Capital cost: {value} per year at a {rate}% capital cost rate.", { value: sek(k.capitalCostAnnual), rate: facts.kalkylranta_procent }),
        ]
      : [
          `Lagervärde: ${sek(k.inventoryValue)} fördelat på ${num(k.skuCount)} artiklar.`,
          `Inaktivt lager: ${sek(k.deadStockValue)} (${k.deadStockCount} artiklar, ${share} % av lagervärdet).`,
          `Överlager: ${sek(k.overstockValue)} (${k.overstockCount} artiklar).`,
          `Långsamt omsatta artiklar: ${sek(k.slowMoverValue)} (${k.slowMoverCount} artiklar med mer än 180 dagars täckning).`,
          `Lageromsättning: ${num(k.turns, 1)} ggr/år${k.daysOfInventory !== null ? `, ${num(k.daysOfInventory)} dagars liggtid` : ""}.`,
          `Kapitalkostnad: ${sek(k.capitalCostAnnual)} per år vid ${facts.kalkylranta_procent} % kalkylränta.`,
        ];
  const classA = analysis.abc.find((a) => a.class === "A");
  if (classA) {
    observations.push(
      locale === "en"
        ? t("ABC: {n} A-items account for {share}% of sales value.", { n: classA.count, share: num(classA.revenueShare, 0) })
        : `ABC: ${classA.count} A-artiklar står för ${num(classA.revenueShare, 0)} % av försäljningsvärdet.`,
    );
  }

  const priorities: NarrativePriority[] = analysis.recommendations
    .filter((r) => r.kind !== "process")
    .slice(0, 4)
    .map((r) => ({
      title: locale === "en" ? recommendationTitle(r.id) : r.title,
      why: locale === "en" ? recommendationWhy(r.id, analysis) : r.detail,
      action: actionFor(r.id, locale),
      impactLow: r.impactLow,
      impactHigh: r.impactHigh,
    }));

  const closing =
    locale === "en"
      ? k.deadStockValue > 0
        ? t("The next step is to go through the inactive-stock list item by item and decide the action: campaign, return to supplier or write-off. Experience suggests roughly half can be realised within a quarter if decisions are taken together rather than one at a time.")
        : t("Inventory is in balance. Focus instead on keeping reorder points current so the level does not drift as demand changes.")
      : k.deadStockValue > 0
        ? `Nästa steg är att gå igenom listan över inaktiva artiklar, artikel för artikel och besluta åtgärd: kampanj, retur till leverantör eller nedskrivning. Erfarenhetsmässigt går ungefär hälften att realisera inom ett kvartal om besluten fattas samlat i stället för löpande.`
        : `Lagret är i balans. Fokus bör i stället ligga på att hålla beställningspunkterna uppdaterade så att nivån inte glider iväg när efterfrågan förändras.`;

  return {
    headline,
    summary,
    observations,
    priorities,
    closing,
    source: "template",
    model: null,
  };
}

function recommendationTitle(id: string): string {
  switch (id) {
    case "dead-stock":
      return "Realise inactive stock";
    case "overstock":
      return "Reduce overstock";
    case "stockout":
      return "Avoid stockouts on selling items";
    case "capital-cost":
      return "Set an inventory capital budget";
    default:
      return "Complete lead times and suppliers";
  }
}

function recommendationWhy(id: string, analysis: AnalysisResult): string {
  const k = analysis.kpis;
  switch (id) {
    case "dead-stock":
      return `${k.deadStockCount} items have not sold in the last ${analysis.settings.deadStockDays} days and tie up ${appSek("en", k.deadStockValue)}. Start with the ${Math.min(20, k.deadStockCount)} largest: campaign, outlet, return to supplier or write-off.`;
    case "overstock":
      return `${k.overstockCount} items sit above what lead time and demand justify. Reduce the next order or stop replenishment until stock reaches the desired level.`;
    case "stockout":
      return `${k.stockoutRiskCount} items cover less than their own lead time, representing about ${appSek("en", k.stockoutRiskValue)} in sales at risk during the next lead time.`;
    case "capital-cost":
      return `At a ${Math.round(analysis.settings.capitalCostRate * 100)}% capital cost rate, tied-up inventory costs ${appSek("en", k.inventoryValue * analysis.settings.capitalCostRate)} per year in lost return. A target of releasing ${appSek("en", (k.potentialReleaseLow + k.potentialReleaseHigh) / 2)} corresponds to about ${appSek("en", ((k.potentialReleaseLow + k.potentialReleaseHigh) / 2) * analysis.settings.capitalCostRate)} per year.`;
    default:
      return "The analysis uses a default lead time where data is missing. Real lead times per supplier make reorder points considerably more accurate.";
  }
}

function actionFor(id: string, locale: Locale = "sv"): string {
  if (locale === "en") {
    switch (id) {
      case "dead-stock":
        return "Sort the list by inventory value, decide on the 20 largest items first, and set an end date for the clearance.";
      case "overstock":
        return "Stop replenishment until stock falls below the reorder point, and adjust the minimum order quantity with the supplier.";
      case "stockout":
        return "Raise the reorder point for items covering less than their lead time and place an extra order for the most critical.";
      case "capital-cost":
        return "Set a quarterly inventory-value target and follow it up in the same report every month.";
      default:
        return "Review the item manually and confirm stock and price.";
    }
  }
  switch (id) {
    case "dead-stock":
      return "Sortera listan på lagervärde, besluta åtgärd för de 20 största posterna först, och sätt ett slutdatum för realiseringen.";
    case "overstock":
      return "Stoppa påfyllning till dess att saldot sjunkit under beställningspunkten, och justera minsta orderkvantitet mot leverantör.";
    case "stockout":
      return "Höj beställningspunkten för de artiklar som täcker mindre än ledtiden och lägg en extra order på de mest kritiska.";
    case "capital-cost":
      return "Sätt ett mål för lagervärdet per kvartal och följ upp det i samma rapport varje månad.";
    default:
      return "Gå igenom artikeln manuellt och bekräfta saldo och pris.";
  }
}

/** Collects every number-like token in a string, normalised to digits only. */
function numberTokens(text: string): string[] {
  return (text.match(/\d[\d\s.,]*/g) ?? []).map((t) => t.replace(/[\s.,]/g, ""));
}

/**
 * Verifies that AI text only contains numbers that exist in the fact sheet.
 * Percentage figures derived from the facts are allowed too.
 */
export function aiTextIsGrounded(text: string, facts: Record<string, unknown>): boolean {
  const allowed = new Set<string>();
  const addVariants = (n: number) => {
    if (!Number.isFinite(n)) return;
    for (const v of [n, Math.round(n), Math.round(n / 1000), Math.round(n / 100000) * 100, Math.abs(n)]) {
      allowed.add(String(Math.round(Math.abs(v) * 10) / 10).replace(".", ""));
      allowed.add(String(Math.round(Math.abs(v))));
    }
  };
  for (const value of Object.values(facts)) {
    if (typeof value === "number") addVariants(value);
  }
  // Structural numbers that are always acceptable in prose.
  for (let i = 1; i <= 12; i++) allowed.add(String(i));

  for (const token of numberTokens(text)) {
    if (token.length <= 2) continue; // small numbers as words/ordinals are fine
    if (allowed.has(token)) continue;
    // Allow tokens that are the digits of an allowed number plus trailing zeros.
    if ([...allowed].some((a) => token.startsWith(a) && /^0*$/.test(token.slice(a.length)))) {
      continue;
    }
    return false;
  }
  return true;
}

interface AiPayload {
  headline?: string;
  summary?: string[];
  observations?: string[];
  priorities?: Array<{ title?: string; why?: string; action?: string }>;
  closing?: string;
}

/**
 * Optional enrichment. If anything at all goes wrong - no key, network error,
 * malformed JSON, ungrounded numbers - the deterministic narrative is returned.
 */
export async function enrichWithAi(
  analysis: AnalysisResult,
  ctx: NarrativeContext,
): Promise<Narrative> {
  const fallback = buildTemplateNarrative(analysis, ctx);
  const { provider, apiKey, model, baseUrl, dataProcessingApproved } = config.ai;
  if (provider === "none" || !apiKey || !dataProcessingApproved) return fallback;

  const facts = { ...buildFacts(analysis), foretag: ctx.company };
  const factsJson = JSON.stringify(facts, null, 2);

  const system = [
    "Du är en svensk lageranalytiker som skriver en kort sammanfattning åt en företagsledare.",
    "Du får ett FAKTA-objekt med färdigberäknade siffror. Du får aldrig införa nya siffror, gissa eller räkna själv.",
    "Alla belopp i texten måste komma direkt från FAKTA. Använd svenska, professionell och konkret ton. Inga floskler.",
    'Svara ENDAST med JSON: {"headline": string, "summary": string[], "observations": string[], "priorities": [{"title": string, "why": string, "action": string}], "closing": string}',
    "summary: 2-4 stycken. observations: 4-6 punkter. priorities: max 4.",
  ].join(" ");

  const user = `FAKTA:\n${factsJson}\n\nSkriv rapporttexten på svenska för ${ctx.company || "företaget"}.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let raw = "";

    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1600,
          system,
          messages: [{ role: "user", content: user }],
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}`);
      const json = (await res.json()) as { content?: Array<{ text?: string }> };
      raw = json.content?.map((c) => c.text ?? "").join("") ?? "";
    } else {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`openai ${res.status}`);
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      raw = json.choices?.[0]?.message?.content ?? "";
    }
    clearTimeout(timeout);

    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const payload = JSON.parse(cleaned) as AiPayload;

    const allText = [
      payload.headline ?? "",
      ...(payload.summary ?? []),
      ...(payload.observations ?? []),
      ...(payload.priorities ?? []).flatMap((p) => [p.title ?? "", p.why ?? "", p.action ?? ""]),
      payload.closing ?? "",
    ].join(" ");

    if (!aiTextIsGrounded(allText, facts as Record<string, unknown>)) {
      return fallback;
    }

    // Impact figures always come from the deterministic engine, never from the model.
    const priorities: NarrativePriority[] = (payload.priorities ?? [])
      .slice(0, 4)
      .map((p, i) => {
        const source = fallback.priorities[i] ?? fallback.priorities[0];
        return {
          title: (p.title ?? source?.title ?? "Åtgärd").slice(0, 120),
          why: (p.why ?? source?.why ?? "").slice(0, 600),
          action: (p.action ?? source?.action ?? "").slice(0, 400),
          impactLow: source?.impactLow ?? 0,
          impactHigh: source?.impactHigh ?? 0,
        };
      });

    if (!payload.summary?.length || !payload.headline) return fallback;

    return {
      headline: payload.headline.slice(0, 160),
      summary: payload.summary.slice(0, 4).map((s) => s.slice(0, 1200)),
      observations: (payload.observations ?? fallback.observations).slice(0, 6),
      priorities: priorities.length > 0 ? priorities : fallback.priorities,
      closing: (payload.closing ?? fallback.closing).slice(0, 800),
      source: "ai",
      model,
    };
  } catch {
    return fallback;
  }
}
