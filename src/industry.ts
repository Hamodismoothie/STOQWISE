/**
 * Industry profiles and local industry detection.
 *
 * Detection runs on the parsed upload (headers, sample rows and the detected
 * mapping) inside our own server. No row values leave the installation and the
 * result is only a proposal: the import step can confirm or override it, and a
 * wrong proposal never rewrites the imported data.
 *
 * The profiles extend one shared inventory model. They change defaults and
 * which attributes/analyses are surfaced, not the calculation of stock, value,
 * ABC/XYZ, cover or reorder points.
 */
import type { DetectedMapping } from "./mapping.ts";

export type IndustryId =
  | "industri"
  | "livsmedel"
  | "foodservice"
  | "ecommerce"
  | "grossist"
  | "bygg"
  | "pharma"
  | "reservdelar"
  | "generic";

export type IndustryAttribute =
  | "shelfLife"
  | "batch"
  | "temperature"
  | "serial"
  | "heavy"
  | "packaging"
  | "criticality"
  | "project"
  | "returns"
  | "moq";

export interface IndustryZone {
  id: string;
  label: { sv: string; en: string };
  tone: "ambient" | "chilled" | "frozen" | "heavy" | "pick";
}

export interface IndustryProfile {
  id: IndustryId;
  label: { sv: string; en: string };
  summary: { sv: string; en: string };
  /** Service level used when the article data does not override it. */
  serviceLevel: number;
  deadStockDays: number;
  attributes: IndustryAttribute[];
  zones: IndustryZone[];
  /** How the profile changes the demo warehouse layout. */
  layout: "industrial" | "cold-chain" | "foodservice" | "ecommerce" | "bulk" | "construction" | "pharma" | "spare-parts" | "generic";
}

const zone = (id: string, sv: string, en: string, tone: IndustryZone["tone"]): IndustryZone => ({ id, label: { sv, en }, tone });

export const INDUSTRY_PROFILES: Record<IndustryId, IndustryProfile> = {
  industri: {
    id: "industri",
    label: { sv: "Industri och tillverkning", en: "Industry and manufacturing" },
    summary: {
      sv: "Komponenter, kritiska artiklar och långa ledtider. Fokus på tillgänglighet och bristrisk.",
      en: "Components, critical items and long lead times. Focus on availability and stockout risk.",
    },
    serviceLevel: 0.95,
    deadStockDays: 180,
    attributes: ["criticality", "serial", "heavy"],
    zones: [zone("components", "Komponenter", "Components", "ambient"), zone("heavy", "Tungt gods", "Heavy goods", "heavy"), zone("spares", "Reservdelar", "Spare parts", "ambient")],
    layout: "industrial",
  },
  livsmedel: {
    id: "livsmedel",
    label: { sv: "Livsmedel och dagligvaror", en: "Food and groceries" },
    summary: {
      sv: "Hållbarhet, batch och temperaturzoner. Fokus på svinn, FEFO och hög omsättning.",
      en: "Shelf life, batches and temperature zones. Focus on waste, FEFO and high turnover.",
    },
    serviceLevel: 0.98,
    deadStockDays: 30,
    attributes: ["shelfLife", "batch", "temperature"],
    zones: [zone("frozen", "Fryst −18 °C", "Frozen −18 °C", "frozen"), zone("chilled", "Kyld 2–8 °C", "Chilled 2–8 °C", "chilled"), zone("ambient", "Torrt 15–25 °C", "Dry 15–25 °C", "ambient")],
    layout: "cold-chain",
  },
  foodservice: {
    id: "foodservice",
    label: { sv: "Foodservice och restauranggrossist", en: "Foodservice and restaurant supply" },
    summary: {
      sv: "Kylda, frysta och torra varor i samma flöde. Fokus på leveransfrekvens, förpackning och säsong.",
      en: "Chilled, frozen and dry goods in one flow. Focus on delivery frequency, packaging and season.",
    },
    serviceLevel: 0.98,
    deadStockDays: 21,
    attributes: ["shelfLife", "batch", "temperature", "packaging"],
    zones: [zone("frozen", "Fryst", "Frozen", "frozen"), zone("chilled", "Kyld", "Chilled", "chilled"), zone("dry", "Torrvaror", "Dry goods", "ambient"), zone("pick", "Orderkonsolidering", "Order consolidation", "pick")],
    layout: "foodservice",
  },
  ecommerce: {
    id: "ecommerce",
    label: { sv: "E-handel och detaljhandel", en: "E-commerce and retail" },
    summary: {
      sv: "Hög transaktionsvolym, kampanjer och kortlivade varianter. Fokus på plock, returer och överlager.",
      en: "High transaction volume, campaigns and short-lived variants. Focus on picking, returns and overstock.",
    },
    serviceLevel: 0.95,
    deadStockDays: 90,
    attributes: ["returns", "packaging"],
    zones: [zone("pick", "Plock", "Picking", "pick"), zone("pack", "Pack och retur", "Packing and returns", "ambient"), zone("bulk", "Överlager", "Bulk storage", "ambient")],
    layout: "ecommerce",
  },
  grossist: {
    id: "grossist",
    label: { sv: "Grossistverksamhet", en: "Wholesale distribution" },
    summary: {
      sv: "Brett sortiment, pallvolymer och leverantörsstyrda minimum. Fokus på kapitalbindning och MOQ.",
      en: "Broad range, pallet volumes and supplier minimums. Focus on tied-up capital and MOQ.",
    },
    serviceLevel: 0.95,
    deadStockDays: 120,
    attributes: ["moq", "packaging"],
    zones: [zone("bulk", "Pallager", "Pallet storage", "heavy"), zone("pick", "Plock", "Picking", "pick"), zone("outbound", "Utlastning", "Dispatch", "ambient")],
    layout: "bulk",
  },
  bygg: {
    id: "bygg",
    label: { sv: "Byggmaterial och byggvaror", en: "Building materials and supplies" },
    summary: {
      sv: "Tunga och skrymmande artiklar, projektbehov och säsong. Fokus på utomhuslager och täckning.",
      en: "Heavy and bulky items, project demand and season. Focus on outdoor storage and cover.",
    },
    serviceLevel: 0.95,
    deadStockDays: 180,
    attributes: ["heavy", "project"],
    zones: [zone("heavy", "Tungt gods", "Heavy goods", "heavy"), zone("outdoor", "Utomhus", "Outdoor", "ambient"), zone("pick", "Kortplock", "Short picks", "pick")],
    layout: "construction",
  },
  pharma: {
    id: "pharma",
    label: { sv: "Läkemedel och medicinteknik", en: "Pharmaceuticals and medtech" },
    summary: {
      sv: "Batch, utgångsdatum och kylkedja. Fokus på spårbarhet, hög servicenivå och kassation.",
      en: "Batches, expiry dates and cold chain. Focus on traceability, high service and write-offs.",
    },
    serviceLevel: 0.99,
    deadStockDays: 60,
    attributes: ["shelfLife", "batch", "temperature", "serial", "criticality"],
    zones: [zone("cold", "Kyl 2–8 °C", "Cold 2–8 °C", "chilled"), zone("ambient", "Rumstemperatur", "Room temperature", "ambient"), zone("secure", "Säker förvaring", "Secure storage", "heavy")],
    layout: "pharma",
  },
  reservdelar: {
    id: "reservdelar",
    label: { sv: "Reservdelar och teknisk distribution", en: "Spare parts and technical distribution" },
    summary: {
      sv: "Långa artikelhistoriker, serialnummer och kritikalitet. Fokus på tillgänglighet och inkurans.",
      en: "Long item histories, serial numbers and criticality. Focus on availability and obsolescence.",
    },
    serviceLevel: 0.96,
    deadStockDays: 365,
    attributes: ["serial", "criticality"],
    zones: [zone("spares", "Reservdelar", "Spare parts", "ambient"), zone("heavy", "Tungt gods", "Heavy goods", "heavy"), zone("pick", "Plock", "Picking", "pick")],
    layout: "spare-parts",
  },
  generic: {
    id: "generic",
    label: { sv: "Övrig lagerverksamhet", en: "General inventory" },
    summary: {
      sv: "Generell lagerprofil. Alla kärnanalyser körs på importerad data.",
      en: "General inventory profile. All core analyses run on the imported data.",
    },
    serviceLevel: 0.95,
    deadStockDays: 180,
    attributes: [],
    zones: [zone("storage", "Lager", "Storage", "ambient"), zone("pick", "Plock", "Picking", "pick")],
    layout: "generic",
  },
};

export const INDUSTRY_ORDER: IndustryId[] = [
  "industri",
  "livsmedel",
  "foodservice",
  "ecommerce",
  "grossist",
  "bygg",
  "pharma",
  "reservdelar",
  "generic",
];

export function isIndustryId(value: unknown): value is IndustryId {
  return typeof value === "string" && value in INDUSTRY_PROFILES;
}

export function industryProfile(id: IndustryId | null | undefined): IndustryProfile {
  return INDUSTRY_PROFILES[id ?? "generic"] ?? INDUSTRY_PROFILES.generic;
}

export interface IndustryEvidence {
  sv: string;
  en: string;
}

export interface IndustrySuggestion {
  id: IndustryId;
  label: { sv: string; en: string };
  score: number;
  confidence: number;
  evidence: IndustryEvidence[];
}

export interface IndustryDetection {
  /** Profile the import step preselects. `generic` when the evidence is weak. */
  selected: IndustryId;
  confidence: number;
  suggestions: IndustrySuggestion[];
  evidence: IndustryEvidence[];
  /** True when the data cannot support a specific profile. */
  uncertain: boolean;
}

const fold = (value: string): string =>
  value
    .toLocaleLowerCase("sv-SE")
    .replaceAll("å", "a")
    .replaceAll("ä", "a")
    .replaceAll("ö", "o")
    .replaceAll("é", "e")
    .replaceAll("ü", "u")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

interface Signal {
  id: IndustryId;
  terms: string[];
  weight: number;
  evidence: IndustryEvidence;
}

/** Weak signals are 1 point, strong and specific signals 2–3. */
const SIGNALS: Signal[] = [
  { id: "industri", terms: ["komponent", "maskin", "tillverkning", "industri", "svets", "pump", "motor", "lagerhylsa", "stans", "fixtur", "verkstad", "fastelement", "skyddsutrustning"], weight: 3, evidence: { sv: "Artikelnamn och kategorier innehåller komponent- och tillverkningsbegrepp", en: "Item names and categories contain component and manufacturing terms" } },
  { id: "industri", terms: ["elverktyg", "handverktyg", "elkomponenter", "skyddsutrustning", "verkstad", "ror och kopplingar", "fastelement"], weight: 4, evidence: { sv: "Sortimentet är byggt kring verktyg, komponenter och installation", en: "The range is built around tools, components and installation" } },
  { id: "industri", terms: ["verktyg", "bult", "skruv", "gäng", "tätning", "lagerenhet", "vvs", "ror och kopplingar"], weight: 1, evidence: { sv: "Insatsvaror och verktyg dominerar sortimentet", en: "Consumables and tools dominate the range" } },
  { id: "livsmedel", terms: ["mjolk", "gradde", "ost", "kott", "kyckling", "brod", "frukt", "gronsak", "mejeri", "yoghurt", "smor", "agg", "livsmedel", "dagligvara", "sallad", "fisk", "juice", "glass", "bageri", "fardigmat", "kott och chark", "frukt och gront"], weight: 3, evidence: { sv: "Flera artiklar är livsmedel med korta hållbarhetstider", en: "Several items are food products with short shelf life" } },
  { id: "livsmedel", terms: ["frukt och gront", "bageri", "fardigmat", "kott och chark", "dagligvaror"], weight: 5, evidence: { sv: "Dagligvarukategorier som frukt, bageri och färdigmat förekommer", en: "Grocery categories such as produce, bakery and ready meals appear" } },
  { id: "livsmedel", terms: ["torrvaror", "konserv", "fryst", "kyl", "kolonial", "forpackning", "mejeri"], weight: 1, evidence: { sv: "Kategorierna följer livsmedlets lagringsformer", en: "Categories follow food storage types" } },
  { id: "foodservice", terms: ["restaurang", "storkok", "pizzeria", "pommes", "matslada", "engang", "servering", "catering", "portion", "gastronorm", "kafe", "foodservice", "bricka", "bestick"], weight: 3, evidence: { sv: "Sortimentet riktar sig till restaurang och storkök", en: "The range targets restaurants and institutional kitchens" } },
  { id: "foodservice", terms: ["restaurangutrustning", "engangsmaterial", "forpackningshuset", "matslada", "serveringsmaterial", "storkoksutrustning"], weight: 5, evidence: { sv: "Förpackning, engångsmaterial och restaurangutrustning är egna sortiment", en: "Packaging, disposables and restaurant equipment form their own ranges" } },
  { id: "foodservice", terms: ["kyld", "fryst", "torr", "forpackning", "dryck", "konservering"], weight: 1, evidence: { sv: "Kylda, frysta och torra varor blandas i samma lager", en: "Chilled, frozen and dry goods share one warehouse" } },
  { id: "ecommerce", terms: ["t-shirt", "hoodie", "jacka", "skor", "accessoar", "horlurar", "telefon", "smink", "leksak", "mode", "klader", "e-handel", "retur", "smycke", "vaska", "tights", "elektronik", "personvard"], weight: 4, evidence: { sv: "Artiklarna är konsumentvarianter med kampanj- och returmönster", en: "Items are consumer variants with campaign and return patterns" } },
  { id: "ecommerce", terms: ["ryggsack", "vattenflaska", "troja", "strumpor", "mossa", "halsduk", "handske", "byxor", "lopar", "yogamatta", "barbar", "laddkabel"], weight: 2, evidence: { sv: "Kläder, accessoarer och konsumentelektronik dominerar", en: "Apparel, accessories and consumer electronics dominate" } },
  { id: "ecommerce", terms: ["kundretur", "webb", "butik", "kollektion", "storlek", "farg", "sport"], weight: 1, evidence: { sv: "Storlekar, färger och kollektioner tyder på detaljhandel", en: "Sizes, colours and collections indicate retail" } },
  { id: "grossist", terms: ["grossist", "partihandel", "distribution", "pall", "emballage", "kampanj", "aterforsaljare", "leverantorslager"], weight: 2, evidence: { sv: "Verksamheten beskrivs som grossist eller distributör", en: "The business is described as wholesale or distribution" } },
  { id: "bygg", terms: ["bygg", "betong", "gips", "spik", "isolering", "farg", "virke", "tegel", "cement", "beslag", "osb", "mineralull", "fogskum", "stallning"], weight: 2, evidence: { sv: "Byggmaterial och installationstillbehör dominerar", en: "Building materials and installation supplies dominate" } },
  { id: "bygg", terms: ["skruv", "bult", "ankare", "verktyg"], weight: 1, evidence: { sv: "Fästelement och arbetsmaterial är vanliga", en: "Fasteners and site consumables are common" } },
  { id: "pharma", terms: ["lakemedel", "medicin", "tablett", "vaccin", "medtech", "diagnostik", "recept", "apotek", "forband", "spruta", "infusion", "halso", "steril"], weight: 3, evidence: { sv: "Läkemedel, sterila varor eller medicinteknik identifierades", en: "Pharmaceuticals, sterile goods or medtech were identified" } },
  { id: "pharma", terms: ["batch", "utgangsdatum", "hallbarhet", "kylkedja", "sparbarhet"], weight: 2, evidence: { sv: "Batch- och utgångsdatum är centrala attribut", en: "Batch and expiry dates are central attributes" } },
  { id: "reservdelar", terms: ["reservdel", "slitdel", "filter", "packning", "rem", "kedja", "munstycke", "tatning", "reparation"], weight: 3, evidence: { sv: "Reservdelar och slitdelar med lång artikelhistorik", en: "Spare and wear parts with long item histories" } },
  { id: "reservdelar", terms: ["maskin", "motor", "pump", "ventil", "lager"], weight: 1, evidence: { sv: "Tekniska komponenter och reservdelar förekommer", en: "Technical components and spare parts appear" } },
];

interface SignalHit {
  id: IndustryId;
  score: number;
  evidence: IndustryEvidence[];
}

function emptyHits(): Map<IndustryId, SignalHit> {
  return new Map(INDUSTRY_ORDER.map((id) => [id, { id, score: 0, evidence: [] }]));
}

function add(hits: Map<IndustryId, SignalHit>, id: IndustryId, score: number, evidence: IndustryEvidence): void {
  const hit = hits.get(id);
  if (!hit) return;
  hit.score += score;
  if (!hit.evidence.some((entry) => entry.sv === evidence.sv)) hit.evidence.push(evidence);
}

/**
 * Scores a parsed upload. The function is deterministic, reads only the
 * headers, up to 40 sample rows and the detected mapping, and never mutates its
 * input.
 */
export function detectIndustry(
  headers: string[],
  rows: string[][],
  mapping: Pick<DetectedMapping, "columns">,
): IndustryDetection {
  const hits = emptyHits();
  const headerText = fold(headers.join(" "));
  const sample = rows.slice(0, 40);
  const cell = (row: string[], index: number | null): string => (index === null ? "" : (row[index] ?? "").trim());
  const textual = sample
    .map((row) =>
      [
        cell(row, mapping.columns.sku),
        cell(row, mapping.columns.name),
        cell(row, mapping.columns.category),
        cell(row, mapping.columns.subcategory),
        cell(row, mapping.columns.supplier),
        cell(row, mapping.columns.unit),
      ].join(" "),
    )
    .join(" ");
  const corpus = fold(`${headerText} ${textual}`);

  const hasTerm = (term: string): boolean => {
    if (term.length > 4 && !term.includes(" ")) return corpus.includes(term);
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(corpus);
  };
  for (const signal of SIGNALS) {
    const found = signal.terms.filter(hasTerm);
    if (found.length === 0) continue;
    const score = signal.weight * Math.min(2, found.length);
    add(hits, signal.id, score, signal.evidence);
  }

  /* Structural signals: the columns an export exposes say as much as words. */
  const filledRatio = (col: number | null): number => {
    if (col === null || sample.length === 0) return 0;
    const filled = sample.filter((row) => (row[col] ?? "").trim() !== "").length;
    return filled / sample.length;
  };
  const shelfFilled = mapping.columns.shelfLife !== null && filledRatio(mapping.columns.shelfLife) >= 0.2;
  if (shelfFilled || /utgangsdatum|bast fore|expiry date|best before/.test(headerText)) {
    for (const [id, score] of [["livsmedel", 3], ["foodservice", 3], ["pharma", 2]] as Array<[IndustryId, number]>) {
      add(hits, id, score, {
        sv: "Filen har ett hållbarhets- eller utgångsdatumfält med värden",
        en: "The file carries a shelf-life or expiry field with values",
      });
    }
  }
  if (/batch|partinummer|serienummer|serial|imei|chassi|utgangsdatum/.test(headerText)) {
    for (const [id, score] of [["pharma", 3], ["livsmedel", 2], ["foodservice", 2], ["reservdelar", 1]] as Array<[IndustryId, number]>) {
      add(hits, id, score, {
        sv: "Batchnummer eller serienummer finns i underlaget",
        en: "Batch or serial numbers are present",
      });
    }
  }
  const storageFilled = mapping.columns.storage !== null && filledRatio(mapping.columns.storage) >= 0.2;
  if (storageFilled || /temperatur|kylzon|fryszon/.test(headerText)) {
    for (const [id, score] of [["livsmedel", 2], ["foodservice", 2], ["pharma", 2]] as Array<[IndustryId, number]>) {
      add(hits, id, score, {
        sv: "Förvaring och temperatur anges per artikel",
        en: "Storage and temperature are stated per item",
      });
    }
  }

  const leadTimes = sample
    .map((row) => Number.parseFloat((cell(row, mapping.columns.leadTime) || "").replace(",", ".")))
    .filter((value) => Number.isFinite(value) && value > 0);
  const avgLead = leadTimes.length ? leadTimes.reduce((sum, value) => sum + value, 0) / leadTimes.length : null;
  if (avgLead !== null && avgLead >= 30) {
    for (const [id, score] of [["industri", 2], ["pharma", 1], ["reservdelar", 1]] as Array<[IndustryId, number]>) {
      add(hits, id, score, { sv: `Genomsnittlig ledtid är ${Math.round(avgLead)} dagar`, en: `Average lead time is ${Math.round(avgLead)} days` });
    }
  } else if (avgLead !== null && avgLead <= 10) {
    for (const [id, score] of [["foodservice", 1], ["livsmedel", 1]] as Array<[IndustryId, number]>) {
      add(hits, id, score, { sv: "Korta ledtider, typiskt för färskvaruflöden", en: "Short lead times, typical of fresh goods" });
    }
  }

  const costs = sample
    .map((row) => Number.parseFloat((cell(row, mapping.columns.cost) || "").replace(",", ".")))
    .filter((value) => Number.isFinite(value) && value > 0);
  const avgCost = costs.length ? costs.reduce((sum, value) => sum + value, 0) / costs.length : null;
  if (avgCost !== null && avgCost >= 1500) {
    for (const [id, score] of [["industri", 2], ["pharma", 2], ["reservdelar", 1]] as Array<[IndustryId, number]>) {
      add(hits, id, score, {
        sv: `Genomsnittligt inköpspris är ${Math.round(avgCost)} kr per artikel`,
        en: `Average unit cost is SEK ${Math.round(avgCost)} per item`,
      });
    }
  } else if (avgCost !== null && avgCost <= 120) {
    for (const [id, score] of [["ecommerce", 1], ["livsmedel", 1], ["foodservice", 1]] as Array<[IndustryId, number]>) {
      add(hits, id, score, { sv: "Låga genomsnittliga inköpspriser", en: "Low average unit costs" });
    }
  }

  const units = sample.map((row) => fold(cell(row, mapping.columns.unit))).join(" ");
  if (/\b(kg|liter|l|pase|flaska|burk|dunk|sack)\b/.test(units)) {
    add(hits, "livsmedel", 1, { sv: "Enheterna är vikt-, volym- eller förpackningsbaserade", en: "Units are weight, volume or pack based" });
    add(hits, "foodservice", 1, { sv: "Förpackningsstorlekar förekommer i enhetsfältet", en: "Pack sizes appear in the unit field" });
  }

  const ranked = [...hits.values()]
    .filter((hit) => hit.id !== "generic" && hit.score > 0)
    .sort((a, b) => b.score - a.score || INDUSTRY_ORDER.indexOf(a.id) - INDUSTRY_ORDER.indexOf(b.id));
  const top = ranked[0];
  const second = ranked[1];
  const total = ranked.reduce((sum, hit) => sum + hit.score, 0);
  const confidenceOf = (hit: SignalHit | undefined, other: SignalHit | undefined): number => {
    if (!hit) return 0;
    const separation = hit.score / Math.max(1, hit.score + (other?.score ?? 0) * 0.8);
    return Math.round(Math.min(0.96, separation * Math.min(1, hit.score / 10)) * 100) / 100;
  };
  const confidence = confidenceOf(top, second);
  const uncertain = !top || top.score < 6 || (second ? top.score - second.score < 3 : false) || confidence < 0.45;
  const selected: IndustryId = uncertain ? "generic" : top.id;
  const suggestions: IndustrySuggestion[] = ranked.slice(0, 3).map((hit, index) => ({
    id: hit.id,
    label: INDUSTRY_PROFILES[hit.id].label,
    score: hit.score,
    confidence: confidenceOf(hit, index === 0 ? second : top),
    evidence: hit.evidence.slice(0, 4),
  }));
  const genericSuggestion: IndustrySuggestion = {
    id: "generic",
    label: INDUSTRY_PROFILES.generic.label,
    score: 0,
    confidence: 0,
    evidence: [{ sv: "Generell profil utan branschantaganden", en: "General profile without industry assumptions" }],
  };
  if (!suggestions.some((suggestion) => suggestion.id === "generic")) suggestions.push(genericSuggestion);

  return {
    selected,
    confidence,
    suggestions,
    evidence: top ? top.evidence.slice(0, 4) : [],
    uncertain,
  };
}

/** Shape used when a stored detection is missing or unreadable. */
export function emptyIndustryDetection(): IndustryDetection {
  return {
    selected: "generic",
    confidence: 0,
    suggestions: [
      {
        id: "generic",
        label: INDUSTRY_PROFILES.generic.label,
        score: 0,
        confidence: 0,
        evidence: [{ sv: "Generell profil utan branschantaganden", en: "General profile without industry assumptions" }],
      },
    ],
    evidence: [],
    uncertain: true,
  };
}
