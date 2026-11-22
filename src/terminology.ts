/**
 * STOQWISE terminology service.
 *
 * One central, language-specific resource for product categories, verified
 * synonyms, translations, abbreviations and search expansion.
 *
 * Design rules:
 *  - A synonym is a word in the SAME language that can replace the term in the
 *    stated context. It is never a translation and never a related concept.
 *  - Translations live in their own field. Related and broader/narrower terms
 *    are separate relationships and never enter synonym search.
 *  - Only `verified` synonyms are used for automatic query expansion.
 *    Context-dependent synonyms are exposed for editors but not treated as
 *    universal equivalents.
 *  - Swedish and English are populated from established dictionary and industry
 *    usage. Other languages are registered as supported but deliberately carry
 *    no machine-generated terminology until a native reviewer verifies it.
 */

export const SUPPORTED_LANGUAGES = [
  { code: "sv", name: "Svenska", english: "Swedish", rtl: false, populated: true },
  { code: "en", name: "English", english: "English", rtl: false, populated: true },
  { code: "ar", name: "العربية", english: "Arabic", rtl: true, populated: false },
  { code: "de", name: "Deutsch", english: "German", rtl: false, populated: false },
  { code: "fr", name: "Français", english: "French", rtl: false, populated: false },
  { code: "es", name: "Español", english: "Spanish", rtl: false, populated: false },
  { code: "nl", name: "Nederlands", english: "Dutch", rtl: false, populated: false },
  { code: "nb", name: "Norsk bokmål", english: "Norwegian Bokmål", rtl: false, populated: false },
  { code: "da", name: "Dansk", english: "Danish", rtl: false, populated: false },
  { code: "fi", name: "Suomi", english: "Finnish", rtl: false, populated: false },
  { code: "it", name: "Italiano", english: "Italian", rtl: false, populated: false },
  { code: "pl", name: "Polski", english: "Polish", rtl: false, populated: false },
  { code: "tr", name: "Türkçe", english: "Turkish", rtl: false, populated: false },
  { code: "pt", name: "Português", english: "Portuguese", rtl: false, populated: false },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["code"];
export type PopulatedLanguage = "sv" | "en";
export type VerificationStatus = "verified" | "context-dependent" | "pending" | "deprecated" | "rejected";
export type RelationType =
  | "exact-synonym"
  | "contextual-synonym"
  | "translation"
  | "broader"
  | "narrower"
  | "related"
  | "abbreviation"
  | "alternative-spelling"
  | "singular"
  | "plural"
  | "inflection"
  | "historical"
  | "deprecated";

export interface Synonym {
  term: string;
  status: Extract<VerificationStatus, "verified" | "context-dependent">;
  note?: string;
}

export interface LocalizedSeed {
  term: string;
  definition: string;
  synonyms?: Synonym[];
  forms?: string[];
}

export interface ConceptSeed {
  key: string;
  category: string;
  sv: LocalizedSeed;
  en: LocalizedSeed;
  abbreviation?: string;
  broader?: string[];
  narrower?: string[];
  related?: string[];
  source?: string;
}

export interface TermRecord {
  id: string;
  term: string;
  language: PopulatedLanguage;
  definition: string;
  synonyms: Synonym[];
  translations: Partial<Record<SupportedLanguage, string>>;
  category: string;
  broader: string[];
  narrower: string[];
  related: string[];
  abbreviation?: { short: string; full: string };
  forms: string[];
  context: string;
  source: string;
  status: VerificationStatus;
  lastVerified: string;
}

const VERIFIED = "2026-11-21";
const SV_SOURCE = "Svenska Akademiens ordlista (SAOL 15); Svensk ordbok; Rikstermbanken";
const EN_SOURCE = "Oxford English Dictionary; Cambridge Dictionary; APICS Dictionary";

const s = (term: string, status: Synonym["status"] = "verified", note?: string): Synonym => ({ term, status, note });

/**
 * Populated concepts. Definitions describe the operational meaning used by
 * STOQWISE, not every possible everyday sense of the word.
 */
export const CONCEPTS: ConceptSeed[] = [
  {
    key: "inventory",
    category: "Inventory management",
    sv: {
      term: "Lager",
      definition: "Varor som innehas för framtida försäljning, förbrukning eller bearbetning.",
      synonyms: [s("varulager"), s("lagerbestånd"), s("lagerhållning", "context-dependent", "Avser innehavet, inte funktionen lagerhållning.")],
      forms: ["lagret", "lagrets", "lager"],
    },
    en: {
      term: "Inventory",
      definition: "Goods held for future sale, consumption or processing.",
      synonyms: [s("stock"), s("inventory holdings")],
      forms: ["inventories"],
    },
    narrower: ["safety-stock", "cycle-stock", "pipeline-inventory"],
    related: ["inventory-value", "inventory-turnover", "warehouse"],
  },
  {
    key: "inventory-management",
    category: "Inventory management",
    sv: { term: "Lagerhantering", definition: "Planering, styrning och uppföljning av lagerverksamheten.", synonyms: [s("lagerförvaltning", "context-dependent")] },
    en: { term: "Inventory management", definition: "Planning, control and follow-up of inventory operations.", synonyms: [s("stock management")] },
    broader: ["supply-chain-management"],
    narrower: ["inventory-control"],
  },
  {
    key: "inventory-control",
    category: "Inventory management",
    sv: { term: "Lagerstyrning", definition: "Regler och metoder som bestämmer när och hur mycket som ska beställas.", synonyms: [s("lagerkontroll", "context-dependent")] },
    en: { term: "Inventory control", definition: "Rules and methods that determine when and how much to order.", synonyms: [s("stock control")] },
    broader: ["inventory-management"],
    related: ["reorder-point", "order-quantity"],
  },
  {
    key: "inventory-level",
    category: "Inventory management",
    sv: { term: "Lagernivå", definition: "Kvantiteten som finns tillgänglig på en viss lagerplats eller i ett visst lager.", synonyms: [s("lagerläge")] },
    en: { term: "Inventory level", definition: "The quantity available at a location or in an inventory.", synonyms: [s("stock level")] },
    related: ["inventory-quantity", "reorder-point"],
  },
  {
    key: "inventory-quantity",
    category: "Inventory management",
    sv: { term: "Lagerkvantitet", definition: "Antalet enheter som finns i lager vid en given tidpunkt." },
    en: { term: "Inventory quantity", definition: "The number of units held in stock at a given time.", synonyms: [s("stock quantity")] },
    related: ["inventory-level"],
  },
  {
    key: "storage-capacity",
    category: "Inventory management",
    sv: { term: "Lagerkapacitet", definition: "Den volym eller det antal enheter ett lager kan rymma." },
    en: { term: "Storage capacity", definition: "The volume or number of units a facility can hold.", synonyms: [s("warehouse capacity", "context-dependent")] },
    related: ["warehouse"],
  },
  {
    key: "storage-location",
    category: "Inventory management",
    sv: { term: "Lagerplats", definition: "En identifierad plats i lagret där en artikel förvaras.", synonyms: [s("lagringsplats")] , forms: ["lagerplatsen", "lagerplatser"] },
    en: { term: "Storage location", definition: "An identified place in a warehouse where an item is held.", synonyms: [s("bin location"), s("stock location")] },
    related: ["picking-location"],
  },
  {
    key: "inventory-balance",
    category: "Inventory management",
    sv: { term: "Lagerbalans", definition: "Saldo som visar tillgänglig och reserverad kvantitet per artikel." },
    en: { term: "Inventory balance", definition: "The recorded available and reserved quantity per item.", synonyms: [s("stock balance")] },
  },
  {
    key: "inventory-movement",
    category: "Inventory management",
    sv: { term: "Lagerförändring", definition: "En registrerad ökning eller minskning av lagret.", synonyms: [s("lagerrörelse")] },
    en: { term: "Inventory movement", definition: "A recorded increase or decrease in inventory.", synonyms: [s("stock movement")] },
  },
  {
    key: "inventory-turnover",
    category: "Inventory management",
    sv: {
      term: "Lageromsättning",
      definition: "Varukostnaden för en period delad med genomsnittligt lagervärde.",
      synonyms: [s("lagerrotation", "context-dependent")],
      forms: ["lageromsättningen"],
    },
    en: {
      term: "Inventory turnover",
      definition: "Cost of goods sold for a period divided by average inventory value.",
      synonyms: [s("stock turnover")],
    },
    related: ["inventory-turnover-rate", "average-inventory"],
  },
  {
    key: "inventory-turnover-rate",
    category: "Inventory management",
    sv: { term: "Lageromsättningshastighet", definition: "Antalet gånger lagret omsätts under en period.", synonyms: [s("omsättningshastighet")] },
    en: { term: "Inventory turnover rate", definition: "The number of times inventory turns over in a period.", synonyms: [s("stock turnover rate")] },
    related: ["inventory-turnover"],
  },
  {
    key: "average-inventory",
    category: "Inventory management",
    sv: { term: "Genomsnittligt lager", definition: "Medelvärdet av lagernivån under en period." },
    en: { term: "Average inventory", definition: "The mean inventory level over a period." },
  },
  {
    key: "safety-stock",
    category: "Inventory management",
    sv: { term: "Säkerhetslager", definition: "Extra lager som skyddar mot variation i efterfrågan och ledtid.", synonyms: [s("säkerhetsbuffert")] },
    en: { term: "Safety stock", definition: "Extra inventory held against demand and lead-time variability.", synonyms: [s("buffer stock")] },
    abbreviation: "SS",
    related: ["service-level", "reorder-point"],
  },
  {
    key: "minimum-stock",
    category: "Inventory management",
    sv: { term: "Minimilager", definition: "Den lägsta nivå som lagret inte bör understiga." },
    en: { term: "Minimum stock", definition: "The lowest level inventory should not fall below.", synonyms: [s("minimum inventory")] },
  },
  {
    key: "maximum-stock",
    category: "Inventory management",
    sv: { term: "Maxlager", definition: "Den högsta nivå som lagret inte bör överstiga." },
    en: { term: "Maximum stock", definition: "The highest level inventory should not exceed.", synonyms: [s("maximum inventory")] },
  },
  {
    key: "reorder-point",
    category: "Inventory management",
    sv: { term: "Beställningspunkt", definition: "Lagernivån som utlöser en ny beställning.", synonyms: [s("orderpunkt")], forms: ["beställningspunkten"] },
    en: { term: "Reorder point", definition: "The inventory level that triggers a new order.", synonyms: [s("order point")] },
    abbreviation: "ROP",
    related: ["safety-stock", "lead-time"],
  },
  {
    key: "order-quantity",
    category: "Inventory management",
    sv: { term: "Beställningskvantitet", definition: "Den kvantitet som beställs vid en beställning." },
    en: { term: "Order quantity", definition: "The quantity requested in a single order." },
    narrower: ["economic-order-quantity"],
  },
  {
    key: "replenishment",
    category: "Inventory management",
    sv: { term: "Påfyllnad", definition: "Återförsel av lager till önskad nivå.", synonyms: [s("lagerpåfyllnad")] },
    en: { term: "Replenishment", definition: "Restoring inventory to a desired level.", synonyms: [s("stock replenishment")] },
    related: ["forecast-based-replenishment"],
  },
  {
    key: "stock-shortage",
    category: "Inventory management",
    sv: { term: "Lagerbrist", definition: "Situation där efterfrågan överstiger tillgängligt lager." },
    en: { term: "Stock shortage", definition: "A situation where demand exceeds available stock.", synonyms: [s("inventory shortage")] },
    related: ["stockout-risk"],
  },
  {
    key: "backorder",
    category: "Inventory management",
    sv: { term: "Restorder", definition: "En kundorder som inte kan levereras direkt och levereras senare." },
    en: { term: "Backorder", definition: "A customer order that cannot be filled immediately and is delivered later.", synonyms: [s("back order")] },
  },
  {
    key: "overstock",
    category: "Inventory management",
    sv: { term: "Överlager", definition: "Lager utöver förväntad efterfrågan under ledtid och granskningsperiod.", synonyms: [s("överskottslager")] },
    en: { term: "Overstock", definition: "Inventory above expected demand during lead time and review period.", synonyms: [s("excess inventory")] },
    related: ["obsolete-inventory", "dead-stock"],
  },
  {
    key: "obsolete-inventory",
    category: "Inventory management",
    sv: { term: "Inkurant lager", definition: "Lager som sannolikt inte kan säljas till normalt pris på grund av föråldring.", synonyms: [s("inkurans", "context-dependent")] },
    en: { term: "Obsolete inventory", definition: "Inventory unlikely to sell at normal price because it is outdated.", synonyms: [s("obsolete stock")] },
    related: ["write-down"],
  },
  {
    key: "dead-stock",
    category: "Inventory management",
    sv: { term: "Inaktivt lager", definition: "Lager av artiklar utan försäljning under en definierad period.", synonyms: [s("inaktiv artikel", "context-dependent")] },
    en: { term: "Inactive stock", definition: "Inventory of items with no sales during a defined period." },
    related: ["slow-moving-inventory", "obsolete-inventory"],
  },
  {
    key: "slow-moving-inventory",
    category: "Inventory management",
    sv: { term: "Långsamt omsatta artiklar", definition: "Artiklar med låg försäljningshastighet och lång täckningstid." },
    en: { term: "Slow-moving inventory", definition: "Inventory of items with low sales velocity.", synonyms: [s("slow-moving stock")] },
    related: ["dead-stock"],
  },
  {
    key: "cycle-stock",
    category: "Inventory management",
    sv: { term: "Omsättningslager", definition: "Den del av lagret som täcker efterfrågan mellan två beställningar." },
    en: { term: "Cycle stock", definition: "The portion of inventory that covers demand between orders." },
    broader: ["inventory"],
  },
  {
    key: "pipeline-inventory",
    category: "Inventory management",
    sv: { term: "Transitlager", definition: "Varor som är beställda men ännu inte mottagna." },
    en: { term: "Pipeline inventory", definition: "Goods ordered but not yet received.", synonyms: [s("in-transit inventory")] },
    broader: ["inventory"],
  },
  {
    key: "tied-up-capital",
    category: "Finance",
    sv: { term: "Bundet kapital", definition: "Kapital som är investerat i lager och därför inte fritt tillgängligt.", synonyms: [s("kapitalbindning")] },
    en: { term: "Tied-up capital", definition: "Capital invested in inventory and therefore not freely available.", synonyms: [s("capital tied up in inventory")] },
    related: ["inventory-value", "working-capital"],
  },
  {
    key: "inventory-value",
    category: "Finance",
    sv: { term: "Lagervärde", definition: "Värdet av lagret beräknat enligt vald värderingsmetod.", synonyms: [s("lagervärdering", "context-dependent")] },
    en: { term: "Inventory value", definition: "The value of inventory under the chosen valuation method.", synonyms: [s("stock value")] },
    related: ["inventory-valuation", "tied-up-capital"],
  },
  {
    key: "holding-cost",
    category: "Finance",
    sv: { term: "Lagerhållningskostnad", definition: "Kostnad för att inneha lager, inklusive kapital, utrymme och risk.", synonyms: [s("lagerkostnad")] },
    en: { term: "Holding cost", definition: "The cost of holding inventory, including capital, space and risk.", synonyms: [s("inventory holding cost")] },
  },
  {
    key: "stockout-cost",
    category: "Finance",
    sv: { term: "Lagerbristkostnad", definition: "Kostnad som uppstår när lagret inte kan möta efterfrågan." },
    en: { term: "Stockout cost", definition: "The cost incurred when inventory cannot meet demand.", synonyms: [s("out-of-stock cost")] },
    related: ["stockout-risk"],
  },
  {
    key: "inventory-accuracy",
    category: "Inventory management",
    sv: { term: "Lagerprecision", definition: "Överensstämmelsen mellan registrerat saldo och fysiskt lager.", synonyms: [s("inventeringsprecision", "context-dependent")] },
    en: { term: "Inventory accuracy", definition: "The agreement between recorded and physical inventory.", synonyms: [s("stock accuracy")] },
    related: ["cycle-counting"],
  },

  {
    key: "warehouse",
    category: "Warehouse operations",
    sv: { term: "Lagerlokal", definition: "Byggnad eller utrymme där varor förvaras.", synonyms: [s("lagerbyggnad"), s("lager", "context-dependent", "Avser den fysiska anläggningen.")] },
    en: { term: "Warehouse", definition: "A building or space where goods are stored.", synonyms: [s("storage facility", "context-dependent"), s("distribution center", "context-dependent")] },
    related: ["distribution-center", "storage-capacity"],
  },
  {
    key: "warehouse-operations",
    category: "Warehouse operations",
    sv: { term: "Lagerverksamhet", definition: "De operativa processerna i ett lager, från mottagning till utleverans." },
    en: { term: "Warehouse operations", definition: "The operational processes in a warehouse, from receiving to dispatch." },
  },
  {
    key: "distribution-center",
    category: "Warehouse operations",
    sv: { term: "Distributionscentral", definition: "Anläggning som tar emot varor och distribuerar dem vidare till butiker eller kunder.", synonyms: [s("distributionslager")] },
    en: { term: "Distribution center", definition: "A facility that receives goods and distributes them to stores or customers.", synonyms: [s("distribution centre")] },
    related: ["warehouse"],
  },
  {
    key: "receiving",
    category: "Warehouse operations",
    sv: { term: "Godsmottagning", definition: "Processen där inkommande gods kontrolleras och registreras.", synonyms: [s("varumottagning")] },
    en: { term: "Goods receiving", definition: "The process of checking and recording incoming goods.", synonyms: [s("receiving")] },
    related: ["inbound-delivery"],
  },
  {
    key: "inbound-delivery",
    category: "Warehouse operations",
    sv: { term: "Inleverans", definition: "Registrering av gods som anländer till lagret." },
    en: { term: "Inbound delivery", definition: "The recorded arrival of goods at a warehouse." },
  },
  {
    key: "put-away",
    category: "Warehouse operations",
    sv: { term: "Inlagring", definition: "Flytt av mottaget gods till dess lagringsplats." },
    en: { term: "Put-away", definition: "Moving received goods to their storage location.", synonyms: [s("putaway")] },
  },
  {
    key: "picking",
    category: "Warehouse operations",
    sv: { term: "Plockning", definition: "Uttag av artiklar från lager enligt en order.", synonyms: [s("orderplock")] },
    en: { term: "Order picking", definition: "Retrieving items from storage to fulfil an order.", synonyms: [s("picking")] },
    related: ["picking-list"],
  },
  {
    key: "picking-list",
    category: "Warehouse operations",
    sv: { term: "Plocklista", definition: "Lista som anger vilka artiklar och kvantiteter som ska plockas." },
    en: { term: "Picking list", definition: "A list specifying the items and quantities to be picked." },
  },
  {
    key: "packing",
    category: "Warehouse operations",
    sv: { term: "Packning", definition: "Förberedelse av plockade varor för transport eller lagring.", synonyms: [s("emballering")] },
    en: { term: "Packing", definition: "Preparing picked goods for transport or storage.", synonyms: [s("packaging")] },
  },
  {
    key: "pallet",
    category: "Warehouse operations",
    sv: { term: "Pall", definition: "Lastbärare som används för att hantera varor som en enhet." },
    en: { term: "Pallet", definition: "A load carrier used to handle goods as a unit." },
  },
  {
    key: "lead-time",
    category: "Procurement",
    sv: { term: "Ledtid", definition: "Tiden från beställning till att varan är tillgänglig.", synonyms: [s("leveranstid", "context-dependent", "Leveranstid kan avse själva transporten.")], forms: ["ledtiden", "ledtider"] },
    en: { term: "Lead time", definition: "The time from ordering until the item is available.", synonyms: [s("delivery lead time")] },
    related: ["safety-stock", "reorder-point"],
  },
  {
    key: "stocktaking",
    category: "Warehouse operations",
    sv: { term: "Inventering", definition: "Räkning och kontroll av det fysiska lagret mot registrerat saldo." },
    en: { term: "Stocktaking", definition: "Counting and checking physical inventory against records.", synonyms: [s("physical inventory count")] },
    narrower: ["cycle-counting"],
  },
  {
    key: "cycle-counting",
    category: "Warehouse operations",
    sv: { term: "Cykelinventering", definition: "Löpande inventering av delar av lagret enligt ett schema." },
    en: { term: "Cycle counting", definition: "Ongoing counting of parts of inventory on a schedule." },
    broader: ["stocktaking"],
  },
  {
    key: "throughput",
    category: "Warehouse operations",
    sv: { term: "Genomströmning", definition: "Mängden varor som passerar en process under en period.", synonyms: [s("genomflöde")] },
    en: { term: "Throughput", definition: "The quantity of goods passing through a process in a period." },
  },

  {
    key: "procurement",
    category: "Procurement",
    sv: { term: "Inköp", definition: "Anskaffning av varor eller tjänster från leverantör.", synonyms: [s("anskaffning", "context-dependent"), s("upphandling", "context-dependent", "Avser särskilt formell upphandling.")], forms: ["inköpet", "inköp"] },
    en: { term: "Procurement", definition: "The acquisition of goods or services from a supplier.", synonyms: [s("purchasing"), s("sourcing", "context-dependent")] },
    abbreviation: "SCM",
    broader: ["supply-chain-management"],
  },
  {
    key: "procurement-management",
    category: "Procurement",
    sv: { term: "Inköpsstyrning", definition: "Ledning och styrning av inköpsprocessen och leverantörsbasen." },
    en: { term: "Procurement management", definition: "Management and control of the procurement process and supplier base." },
    related: ["supplier-evaluation"],
  },
  {
    key: "strategic-procurement",
    category: "Procurement",
    sv: { term: "Strategiskt inköp", definition: "Långsiktig anskaffning som kopplar leverantörsval till affärsmål." },
    en: { term: "Strategic procurement", definition: "Long-term acquisition linking supplier choices to business goals." },
    related: ["procurement"],
  },
  {
    key: "tendering",
    category: "Procurement",
    sv: { term: "Upphandling", definition: "Konkurrensutsatt förfarande för att välja leverantör.", synonyms: [s("anbudsförfarande")] },
    en: { term: "Tendering", definition: "A competitive procedure for selecting a supplier.", synonyms: [s("tender process")] },
    related: ["procurement"],
  },
  {
    key: "purchase-order",
    category: "Procurement",
    sv: { term: "Inköpsorder", definition: "Bindande beställning som skickas till en leverantör.", synonyms: [s("inköpsbeställning")] },
    en: { term: "Purchase order", definition: "A binding order sent to a supplier.", synonyms: [s("purchase requisition", "context-dependent")] },
    related: ["order"],
  },
  {
    key: "purchase-requisition",
    category: "Procurement",
    sv: { term: "Beställningsunderlag", definition: "Internt underlag som begär att en beställning ska göras." },
    en: { term: "Purchase requisition", definition: "An internal request to make a purchase." },
  },
  {
    key: "purchase-price",
    category: "Procurement",
    sv: { term: "Inköpspris", definition: "Priset som betalas till leverantören vid inköp." },
    en: { term: "Purchase price", definition: "The price paid to the supplier for purchased goods.", synonyms: [s("buying price")] },
  },
  {
    key: "framework-agreement",
    category: "Procurement",
    sv: { term: "Ramavtal", definition: "Avtal som anger villkor för framtida beställningar under en period." },
    en: { term: "Framework agreement", definition: "An agreement setting terms for future orders over a period." },
  },
  {
    key: "supplier",
    category: "Procurement",
    sv: { term: "Leverantör", definition: "Företag eller person som levererar varor eller tjänster.", synonyms: [s("tillhandahållare", "context-dependent")], forms: ["leverantören", "leverantörer", "leverantörerna"] },
    en: { term: "Supplier", definition: "A company or person that supplies goods or services.", synonyms: [s("vendor"), s("provider", "context-dependent")] },
    related: ["supplier-risk", "supplier-evaluation"],
  },
  {
    key: "supplier-evaluation",
    category: "Procurement",
    sv: { term: "Leverantörsutvärdering", definition: "Systematisk bedömning av leverantörens kvalitet, leverans och risk." },
    en: { term: "Supplier evaluation", definition: "Systematic assessment of a supplier's quality, delivery and risk.", synonyms: [s("vendor evaluation")] },
  },
  {
    key: "supplier-risk",
    category: "Procurement",
    sv: { term: "Leverantörsrisk", definition: "Risk att en leverantör inte kan leverera enligt avtal." },
    en: { term: "Supplier risk", definition: "The risk that a supplier cannot deliver as agreed.", synonyms: [s("vendor risk")] },
    broader: ["supply-chain-risk"],
  },
  {
    key: "wholesaler",
    category: "Procurement",
    sv: { term: "Grossist", definition: "Företag som köper varor och säljer vidare till återförsäljare." },
    en: { term: "Wholesaler", definition: "A business that buys goods and resells them to retailers." },
  },
  {
    key: "distributor",
    category: "Procurement",
    sv: { term: "Distributör", definition: "Företag som förmedlar och levererar en tillverkares produkter." },
    en: { term: "Distributor", definition: "A business that markets and delivers a manufacturer's products." },
  },
  {
    key: "minimum-order-quantity",
    category: "Procurement",
    sv: { term: "Minsta orderkvantitet", definition: "Den minsta kvantitet en leverantör accepterar per order." },
    en: { term: "Minimum order quantity", definition: "The smallest quantity a supplier accepts per order." },
    abbreviation: "MOQ",
  },
  {
    key: "economic-order-quantity",
    category: "Procurement",
    sv: { term: "Ekonomisk orderkvantitet", definition: "Orderkvantitet som minimerar summan av order- och lagerhållningskostnad." },
    en: { term: "Economic order quantity", definition: "The order quantity that minimises the sum of ordering and holding costs." },
    abbreviation: "EOQ",
  },
  {
    key: "delivery-reliability",
    category: "Procurement",
    sv: { term: "Leveransprecision", definition: "Andelen leveranser som anländer i tid och med rätt kvantitet." },
    en: { term: "Delivery reliability", definition: "The share of deliveries arriving on time and in the right quantity.", synonyms: [s("on-time delivery")] },
    abbreviation: "OTIF",
  },

  {
    key: "supply-chain",
    category: "Supply chain",
    sv: { term: "Försörjningskedja", definition: "Nätverket av leverantörer, lager, transporter och kunder som förser en marknad.", synonyms: [s("leveranskedja")] },
    en: { term: "Supply chain", definition: "The network of suppliers, warehouses, transport and customers serving a market.", synonyms: [s("supply network")] },
    related: ["supply-chain-management"],
  },
  {
    key: "supply-chain-management",
    category: "Supply chain",
    sv: { term: "Försörjningskedjehantering", definition: "Samordning av material, information och kapital genom försörjningskedjan." },
    en: { term: "Supply chain management", definition: "Coordination of material, information and capital across the supply chain.", synonyms: [s("SCM", "context-dependent")] },
    abbreviation: "SCM",
    narrower: ["demand-planning", "procurement", "inventory-management"],
  },
  {
    key: "demand-planning",
    category: "Supply chain",
    sv: { term: "Efterfrågeplanering", definition: "Planering av framtida efterfrågan som underlag för inköp och produktion." },
    en: { term: "Demand planning", definition: "Planning future demand as a basis for purchasing and production." },
    related: ["demand-forecast"],
  },
  {
    key: "supply-planning",
    category: "Supply chain",
    sv: { term: "Försörjningsplanering", definition: "Planering av hur efterfrågan ska täckas med lager, inköp och produktion." },
    en: { term: "Supply planning", definition: "Planning how demand will be met through inventory, purchasing and production." },
  },
  {
    key: "value-chain",
    category: "Supply chain",
    sv: { term: "Värdekedja", definition: "De aktiviteter som tillsammans skapar värde för kunden." },
    en: { term: "Value chain", definition: "The activities that together create value for the customer." },
  },
  {
    key: "upstream",
    category: "Supply chain",
    sv: { term: "Uppströms", definition: "Riktningen mot leverantörer och tidigare led i försörjningskedjan." },
    en: { term: "Upstream", definition: "The direction toward suppliers and earlier stages of the supply chain." },
  },
  {
    key: "downstream",
    category: "Supply chain",
    sv: { term: "Nedströms", definition: "Riktningen mot kunder och senare led i försörjningskedjan." },
    en: { term: "Downstream", definition: "The direction toward customers and later stages of the supply chain." },
  },
  {
    key: "supply-chain-risk",
    category: "Supply chain",
    sv: { term: "Försörjningsrisk", definition: "Risk att störningar hindrar försörjningskedjan från att leverera." },
    en: { term: "Supply chain risk", definition: "The risk that disruptions prevent the supply chain from delivering.", synonyms: [s("supply risk")] },
    narrower: ["supplier-risk", "stockout-risk"],
  },
  {
    key: "supply-chain-disruption",
    category: "Supply chain",
    sv: { term: "Störning i leveranskedjan", definition: "Avbrott som påverkar flödet av varor eller information." },
    en: { term: "Supply chain disruption", definition: "An interruption affecting the flow of goods or information.", synonyms: [s("supply disruption")] },
  },
  {
    key: "supply-chain-resilience",
    category: "Supply chain",
    sv: { term: "Försörjningskedjans motståndskraft", definition: "Förmågan att återhämta sig från störningar." },
    en: { term: "Supply chain resilience", definition: "The ability to recover from disruptions.", synonyms: [s("supply resilience")] },
  },
  {
    key: "supply-chain-visibility",
    category: "Supply chain",
    sv: { term: "Försörjningskedjans synlighet", definition: "Insyn i lager, order och transporter genom kedjan." },
    en: { term: "Supply chain visibility", definition: "Insight into inventory, orders and transport across the chain." },
  },

  {
    key: "product",
    category: "Product management",
    sv: { term: "Produkt", definition: "En vara eller tjänst som erbjuds till försäljning.", forms: ["produkten", "produkter", "produkterna"] },
    en: { term: "Product", definition: "A good or service offered for sale.", forms: ["products"] },
  },
  {
    key: "item",
    category: "Product management",
    sv: { term: "Artikel", definition: "En identifierad lagerförd vara med eget artikelnummer.", synonyms: [s("lagerartikel")], forms: ["artikeln", "artiklar", "artiklarna"] },
    en: { term: "Item", definition: "An identified stock-keeping unit with its own item number.", synonyms: [s("inventory item"), s("article", "context-dependent")] },
    related: ["sku"],
  },
  {
    key: "sku",
    category: "Product management",
    sv: { term: "Artikelnummer", definition: "Unik identifierare för en lagerförd artikel.", synonyms: [s("artikelidentitet", "context-dependent")] },
    en: { term: "Stock keeping unit", definition: "A unique identifier for an item held in inventory.", synonyms: [s("SKU", "context-dependent")] },
    abbreviation: "SKU",
  },
  {
    key: "item-name",
    category: "Product management",
    sv: { term: "Artikelnamn", definition: "Benämningen som identifierar en artikel i register och gränssnitt.", synonyms: [s("artikelbenämning"), s("produktnamn", "context-dependent")] },
    en: { term: "Item name", definition: "The name identifying an item in records and interfaces.", synonyms: [s("item description")] },
  },
  {
    key: "product-category",
    category: "Product management",
    sv: { term: "Produktkategori", definition: "Gruppering av produkter efter liknande användning eller egenskaper.", synonyms: [s("varukategori")] },
    en: { term: "Product category", definition: "A grouping of products by similar use or characteristics.", synonyms: [s("product group")] },
  },
  {
    key: "product-classification",
    category: "Product management",
    sv: { term: "Produktklassificering", definition: "Systematisk indelning av produkter i kategorier och klasser." },
    en: { term: "Product classification", definition: "Systematic grouping of products into categories and classes." },
  },
  {
    key: "substitute-item",
    category: "Product management",
    sv: { term: "Ersättningsartikel", definition: "Artikel som kan användas i stället för en annan artikel." },
    en: { term: "Substitute item", definition: "An item that can be used in place of another item.", synonyms: [s("substitute product")] },
  },
  {
    key: "pack-size",
    category: "Product management",
    sv: { term: "Förpackningsstorlek", definition: "Antalet enheter i en förpackning." },
    en: { term: "Pack size", definition: "The number of units in a package." },
  },
  {
    key: "unit-of-measure",
    category: "Product management",
    sv: { term: "Måttenhet", definition: "Enhet för att mäta kvantitet, vikt eller volym.", synonyms: [s("enhet", "context-dependent")] },
    en: { term: "Unit of measurement", definition: "A unit for measuring quantity, weight or volume.", synonyms: [s("unit of measure")] },
  },
  {
    key: "batch-number",
    category: "Product management",
    sv: { term: "Batchnummer", definition: "Identifierare för ett tillverknings- eller leveransparti." },
    en: { term: "Batch number", definition: "An identifier for a production or delivery lot.", synonyms: [s("lot number")] },
  },
  {
    key: "barcode",
    category: "Product management",
    sv: { term: "Streckkod", definition: "Maskinläsbar kod som identifierar en produkt eller enhet." },
    en: { term: "Barcode", definition: "A machine-readable code identifying a product or unit.", synonyms: [s("bar code")] },
    related: ["gtin"],
  },

  {
    key: "demand",
    category: "Forecasting",
    sv: { term: "Efterfrågan", definition: "Den kvantitet kunder efterfrågar under en period.", forms: ["efterfrågan"] },
    en: { term: "Demand", definition: "The quantity customers require during a period." },
  },
  {
    key: "demand-forecast",
    category: "Forecasting",
    sv: { term: "Efterfrågeprognos", definition: "Uppskattning av framtida efterfrågan baserad på historik och antaganden.", synonyms: [] },
    en: { term: "Demand forecast", definition: "An estimate of future demand based on history and assumptions.", synonyms: [s("demand projection")] },
    related: ["forecast-accuracy"],
  },
  {
    key: "forecast-accuracy",
    category: "Forecasting",
    sv: { term: "Prognosprecision", definition: "Hur väl prognosen stämmer med det faktiska utfallet." },
    en: { term: "Forecast accuracy", definition: "How closely a forecast matches the actual outcome." },
  },
  {
    key: "forecast-horizon",
    category: "Forecasting",
    sv: { term: "Prognoshorisont", definition: "Hur långt fram i tiden en prognos sträcker sig." },
    en: { term: "Forecast horizon", definition: "How far into the future a forecast extends." },
  },
  {
    key: "seasonal-variation",
    category: "Forecasting",
    sv: { term: "Säsongsvariation", definition: "Återkommande variation i efterfrågan under årets månader eller veckor.", synonyms: [s("säsongseffekt")] },
    en: { term: "Seasonal variation", definition: "Recurring demand variation across months or weeks of the year.", synonyms: [s("seasonality")] },
  },
  {
    key: "moving-average",
    category: "Forecasting",
    sv: { term: "Glidande medelvärde", definition: "Medelvärde som beräknas över ett fönster som flyttas framåt i tiden." },
    en: { term: "Moving average", definition: "An average calculated over a window that moves forward in time." },
  },
  {
    key: "exponential-smoothing",
    category: "Forecasting",
    sv: { term: "Exponentiell utjämning", definition: "Prognosmetod där nyare observationer ges större vikt." },
    en: { term: "Exponential smoothing", definition: "A forecasting method giving more weight to recent observations." },
  },
  {
    key: "intermittent-demand",
    category: "Forecasting",
    sv: { term: "Intermittent efterfrågan", definition: "Efterfrågan som inträffar oregelbundet med perioder utan försäljning." },
    en: { term: "Intermittent demand", definition: "Demand occurring irregularly with periods of no sales." },
  },
  {
    key: "sales-velocity",
    category: "Forecasting",
    sv: { term: "Försäljningshastighet", definition: "Antal sålda enheter per tidsenhet." },
    en: { term: "Sales velocity", definition: "Units sold per unit of time." },
  },
  {
    key: "forecast-based-replenishment",
    category: "Forecasting",
    sv: { term: "Prognosbaserad påfyllnad", definition: "Påfyllnad som styrs av prognostiserad efterfrågan i stället för enbart historiskt saldo." },
    en: { term: "Forecast-based replenishment", definition: "Replenishment driven by forecast demand rather than historical balance alone." },
  },

  {
    key: "abc-analysis",
    category: "Inventory classification",
    sv: { term: "ABC-analys", definition: "Klassificering av artiklar efter andel av försäljnings- eller förbrukningsvärde." },
    en: { term: "ABC analysis", definition: "Classification of items by share of sales or consumption value." },
    related: ["xyz-analysis"],
  },
  {
    key: "xyz-analysis",
    category: "Inventory classification",
    sv: { term: "XYZ-analys", definition: "Klassificering av artiklar efter hur förutsägbar efterfrågan är." },
    en: { term: "XYZ analysis", definition: "Classification of items by how predictable demand is." },
  },
  {
    key: "inventory-optimization",
    category: "Inventory classification",
    sv: { term: "Lageroptimering", definition: "Anpassning av lagernivåer och beställningsregler för att minska kapital och risk." },
    en: { term: "Inventory optimization", definition: "Adjusting inventory levels and ordering rules to reduce capital and risk.", synonyms: [s("stock optimisation")] },
  },
  {
    key: "service-level",
    category: "Inventory classification",
    sv: { term: "Servicenivå", definition: "Målsatt sannolikhet att kunna leverera från lager.", synonyms: [s("servicegrad")] },
    en: { term: "Service level", definition: "The target probability of fulfilling demand from stock.", synonyms: [s("fill rate", "context-dependent")] },
    related: ["safety-stock"],
  },

  {
    key: "finance",
    category: "Finance",
    sv: { term: "Ekonomi", definition: "Området som omfattar intäkter, kostnader, kapital och lönsamhet." },
    en: { term: "Finance", definition: "The domain covering revenue, cost, capital and profitability." },
  },
  {
    key: "revenue",
    category: "Finance",
    sv: { term: "Intäkt", definition: "Värde som ett företag får från försäljning eller andra affärshändelser." },
    en: { term: "Revenue", definition: "Value received from sales or other business transactions.", synonyms: [s("income", "context-dependent")] },
  },
  {
    key: "sales",
    category: "Finance",
    sv: { term: "Försäljning", definition: "Överlåtelse av varor eller tjänster mot betalning.", synonyms: [s("avyttring", "context-dependent", "Avser främst avyttring av tillgångar.")] },
    en: { term: "Sales", definition: "The exchange of goods or services for payment." },
  },
  {
    key: "gross-margin",
    category: "Finance",
    sv: { term: "Bruttomarginal", definition: "Försäljningsintäkt minus varukostnad, uttryckt i procent av intäkten." },
    en: { term: "Gross margin", definition: "Sales revenue less cost of goods sold, as a percentage of revenue." },
  },
  {
    key: "cogs",
    category: "Finance",
    sv: { term: "Varukostnad", definition: "Kostnaden för de varor som sålts under en period." },
    en: { term: "Cost of goods sold", definition: "The cost of goods sold during a period.", synonyms: [s("COGS", "context-dependent")] },
    abbreviation: "COGS",
  },
  {
    key: "working-capital",
    category: "Finance",
    sv: { term: "Rörelsekapital", definition: "Omsättningstillgångar minus kortfristiga skulder." },
    en: { term: "Working capital", definition: "Current assets minus current liabilities." },
    related: ["tied-up-capital"],
  },
  {
    key: "write-down",
    category: "Finance",
    sv: { term: "Nedskrivning", definition: "Reduktion av ett tillgångsvärde i redovisningen." },
    en: { term: "Write-down", definition: "A reduction in the recorded value of an asset.", synonyms: [s("write down")] },
  },
  {
    key: "inventory-valuation",
    category: "Finance",
    sv: { term: "Lagervärdering", definition: "Metod för att fastställa värdet av lagret." },
    en: { term: "Inventory valuation", definition: "The method used to determine the value of inventory.", synonyms: [s("stock valuation")] },
    related: ["inventory-value"],
  },
  {
    key: "stockout-risk",
    category: "Risk",
    sv: { term: "Lagerbristrisk", definition: "Sannolikheten att lagret inte räcker till förväntad efterfrågan under ledtiden." },
    en: { term: "Stockout risk", definition: "The probability that inventory cannot meet expected demand during lead time.", synonyms: [s("out-of-stock risk")] },
    broader: ["supply-chain-risk"],
  },

  {
    key: "analytics",
    category: "Analytics",
    sv: { term: "Affärsanalys", definition: "Systematisk analys av affärsdata som underlag för beslut.", synonyms: [s("verksamhetsanalys")] },
    en: { term: "Business analytics", definition: "Systematic analysis of business data to support decisions.", synonyms: [s("business analysis")] },
  },
  {
    key: "kpi",
    category: "Analytics",
    sv: { term: "Nyckeltal", definition: "Mått som sammanfattar en viktig del av verksamhetens resultat." },
    en: { term: "Key performance indicator", definition: "A measure summarising an important part of business performance.", synonyms: [s("KPI", "context-dependent")] },
    abbreviation: "KPI",
  },
  {
    key: "report",
    category: "Analytics",
    sv: { term: "Rapport", definition: "Sammanställning av data och analys avsedd för läsning eller beslut." },
    en: { term: "Report", definition: "A structured presentation of data and analysis for reading or decisions." },
  },
  {
    key: "executive-summary",
    category: "Analytics",
    sv: { term: "Ledningssammanfattning", definition: "Kort sammanfattning av de viktigaste resultaten för beslutsfattare." },
    en: { term: "Executive summary", definition: "A short summary of the key results for decision-makers." },
  },
  {
    key: "data-quality",
    category: "Analytics",
    sv: { term: "Datakvalitet", definition: "I vilken grad data är korrekta, fullständiga och användbara." },
    en: { term: "Data quality", definition: "The degree to which data is accurate, complete and usable." },
  },
  {
    key: "dashboard",
    category: "Analytics",
    sv: { term: "Instrumentpanel", definition: "Samlad visuell översikt av aktuella nyckeltal och analyser." },
    en: { term: "Dashboard", definition: "A consolidated visual overview of current metrics and analyses." },
  },
  {
    key: "baseline",
    category: "Analytics",
    sv: { term: "Baslinje", definition: "Referensvärde som förändringar och scenarier jämförs mot." },
    en: { term: "Baseline", definition: "A reference value against which changes and scenarios are compared." },
  },

  {
    key: "retail",
    category: "Retail",
    sv: { term: "Detaljhandel", definition: "Försäljning av varor direkt till slutkund." },
    en: { term: "Retail", definition: "The sale of goods directly to the end customer." },
  },
  {
    key: "wholesale",
    category: "Retail",
    sv: { term: "Partihandel", definition: "Försäljning av varor i större volymer till återförsäljare eller företag." },
    en: { term: "Wholesale", definition: "The sale of goods in larger volumes to retailers or businesses." },
  },
  {
    key: "store-inventory",
    category: "Retail",
    sv: { term: "Butikslager", definition: "Lager som finns i en butik och är tillgängligt för försäljning." },
    en: { term: "Store inventory", definition: "Inventory held in a store and available for sale.", synonyms: [s("store stock")] },
  },
  {
    key: "selling-price",
    category: "Retail",
    sv: { term: "Försäljningspris", definition: "Priset som kunden betalar för en vara." },
    en: { term: "Selling price", definition: "The price a customer pays for a product.", synonyms: [s("sale price", "context-dependent")] },
  },
  {
    key: "promotion",
    category: "Retail",
    sv: { term: "Kampanj", definition: "Tillfällig marknadsföringsaktivitet med exempelvis rabatt." },
    en: { term: "Promotion", definition: "A temporary marketing activity such as a discount." },
  },
  {
    key: "waste",
    category: "Retail",
    sv: { term: "Svinn", definition: "Varor som förloras genom spill, stöld eller obsolet lager." },
    en: { term: "Waste", definition: "Goods lost through spoilage, theft or obsolescence.", synonyms: [s("shrinkage", "context-dependent")] },
  },
  {
    key: "on-shelf-availability",
    category: "Retail",
    sv: { term: "Hylltillgänglighet", definition: "Andelen tid en produkt finns tillgänglig på hyllan." },
    en: { term: "On-shelf availability", definition: "The share of time a product is available on the shelf." },
    abbreviation: "OSA",
  },
  {
    key: "out-of-stock",
    category: "Retail",
    sv: { term: "Slut i lager", definition: "Situation där en artikel inte finns tillgänglig för försäljning." },
    en: { term: "Out of stock", definition: "A situation where an item is unavailable for sale." },
    abbreviation: "OOS",
  },
];

/* ---------------------------------------------------------- abbreviations */

export interface AbbreviationRecord {
  short: string;
  fullEn: string;
  fullSv: string;
  meaningSv: string;
  meaningEn: string;
  source: string;
}

const abbr = (short: string, fullEn: string, fullSv: string, meaningSv: string, meaningEn: string): AbbreviationRecord => ({
  short,
  fullEn,
  fullSv,
  meaningSv,
  meaningEn,
  source: "GS1 General Specifications; APICS Dictionary; ISO 8000",
});

export const ABBREVIATIONS: AbbreviationRecord[] = [
  abbr("SKU", "Stock Keeping Unit", "Lagerförd artikel", "Lagerförd artikelidentitet", "Stock keeping unit identifier"),
  abbr("GTIN", "Global Trade Item Number", "Globalt artikelnummer", "Globalt artikelnummer", "Global trade item number"),
  abbr("EAN", "European Article Number", "Europeiskt artikelnummer", "Europeiskt artikelnummer", "European article number"),
  abbr("UPC", "Universal Product Code", "Universell produktkod", "Produktkod", "Universal product code"),
  abbr("PLU", "Price Look-Up Code", "Prisuppslagskod", "Prisuppslagskod", "Price look-up code"),
  abbr("MOQ", "Minimum Order Quantity", "Minsta orderkvantitet", "Minsta orderkvantitet", "Minimum order quantity"),
  abbr("EOQ", "Economic Order Quantity", "Ekonomisk orderkvantitet", "Ekonomisk orderkvantitet", "Economic order quantity"),
  abbr("ROP", "Reorder Point", "Beställningspunkt", "Beställningspunkt", "Reorder point"),
  abbr("SS", "Safety Stock", "Säkerhetslager", "Säkerhetslager", "Safety stock"),
  abbr("MRP", "Material Requirements Planning", "Materialbehovsplanering", "Materialbehovsplanering", "Material requirements planning"),
  abbr("ERP", "Enterprise Resource Planning", "Affärssystem", "Affärssystem", "Enterprise resource planning"),
  abbr("WMS", "Warehouse Management System", "Lagerhanteringssystem", "Lagerhanteringssystem", "Warehouse management system"),
  abbr("TMS", "Transportation Management System", "Transporthanteringssystem", "Transporthanteringssystem", "Transportation management system"),
  abbr("OMS", "Order Management System", "Orderhanteringssystem", "Orderhanteringssystem", "Order management system"),
  abbr("POS", "Point of Sale", "Kassasystem", "Kassasystem", "Point of sale"),
  abbr("SCM", "Supply Chain Management", "Försörjningskedjehantering", "Försörjningskedjehantering", "Supply chain management"),
  abbr("3PL", "Third-Party Logistics", "Tredjepartslogistik", "Tredjepartslogistik", "Third-party logistics"),
  abbr("4PL", "Fourth-Party Logistics", "Fjärdepartslogistik", "Fjärdepartslogistik", "Fourth-party logistics"),
  abbr("KPI", "Key Performance Indicator", "Nyckeltal", "Nyckeltal", "Key performance indicator"),
  abbr("COGS", "Cost of Goods Sold", "Kostnad för sålda varor", "Varukostnad", "Cost of goods sold"),
  abbr("GMROI", "Gross Margin Return on Inventory Investment", "Bruttomarginalavkastning på lagerinvestering", "Bruttomarginalavkastning på lagerinvestering", "Gross margin return on inventory investment"),
  abbr("ROII", "Return on Inventory Investment", "Avkastning på lagerinvestering", "Avkastning på lagerinvestering", "Return on inventory investment"),
  abbr("OTIF", "On Time In Full", "Leverans i tid och komplett", "Leverans i tid och komplett", "On time in full"),
  abbr("OOS", "Out of Stock", "Slut i lager", "Slut i lager", "Out of stock"),
  abbr("DOH", "Days on Hand", "Lagerdagar", "Lagerdagar", "Days on hand"),
  abbr("DIO", "Days Inventory Outstanding", "Genomsnittliga lagerdagar", "Genomsnittliga lagerdagar", "Days inventory outstanding"),
  abbr("FIFO", "First In, First Out", "Först in, först ut", "Först in, först ut", "First in, first out"),
  abbr("LIFO", "Last In, First Out", "Sist in, först ut", "Sist in, först ut", "Last in, first out"),
  abbr("FEFO", "First Expired, First Out", "Först utgående datum, först ut", "Först utgående datum, först ut", "First expired, first out"),
  abbr("JIT", "Just-in-Time", "Just-in-time", "Just-in-time", "Just-in-time"),
  abbr("VMI", "Vendor Managed Inventory", "Leverantörsstyrt lager", "Leverantörsstyrt lager", "Vendor managed inventory"),
  abbr("EDI", "Electronic Data Interchange", "Elektroniskt datautbyte", "Elektroniskt datautbyte", "Electronic data interchange"),
  abbr("ASN", "Advanced Shipping Notice", "Förhandsavisering av leverans", "Förhandsavisering av leverans", "Advanced shipping notice"),
  abbr("SLA", "Service Level Agreement", "Servicenivåavtal", "Servicenivåavtal", "Service level agreement"),
  abbr("B2B", "Business-to-Business", "Företag till företag", "Företag till företag", "Business-to-business"),
  abbr("B2C", "Business-to-Consumer", "Företag till konsument", "Företag till konsument", "Business-to-consumer"),
  abbr("D2C", "Direct-to-Consumer", "Direkt till konsument", "Direkt till konsument", "Direct-to-consumer"),
];

/* -------------------------------------------------------- category labels */

/**
 * Product categories used by imports and the demo data. Values may originate in
 * Swedish; the label shown to the user always follows the interface language.
 */
const CATEGORY_LABELS: Array<{ sv: string; en: string; aliases?: string[] }> = [
  { sv: "Elektronik", en: "Electronics" },
  { sv: "Kontorsmaterial", en: "Office Supplies" },
  { sv: "Livsmedel", en: "Food & Beverages" },
  { sv: "Förpackningsmaterial", en: "Packaging Materials" },
  { sv: "Rengöringsprodukter", en: "Cleaning Products" },
  { sv: "Kläder", en: "Clothing", aliases: ["Klädsel"] },
  { sv: "Reservdelar", en: "Spare Parts" },
  { sv: "Verktyg", en: "Tools" },
  { sv: "Byggmaterial", en: "Building Materials" },
  { sv: "Hygienprodukter", en: "Personal Care Products" },
  { sv: "Fästmaterial", en: "Fasteners" },
  { sv: "El", en: "Electrical" },
  { sv: "VVS", en: "Plumbing" },
  { sv: "Färg", en: "Paint" },
  { sv: "Trädgård", en: "Garden" },
  { sv: "Fritid", en: "Leisure" },
  { sv: "Kök", en: "Kitchen" },
  { sv: "Förvaring", en: "Storage" },
  { sv: "Möbler", en: "Furniture" },
  { sv: "Textil", en: "Textiles" },
  { sv: "Leksaker", en: "Toys" },
  { sv: "Sport", en: "Sports" },
  { sv: "Elverktyg", en: "Power tools" },
  { sv: "Handverktyg", en: "Hand tools" },
  { sv: "Elkomponenter", en: "Electrical components" },
  { sv: "Rör och kopplingar", en: "Pipes and fittings" },
  { sv: "Verkstad", en: "Workshop" },
  { sv: "Järnhandel", en: "Hardware" },
  { sv: "Belysning", en: "Lighting" },
  { sv: "Accessoarer", en: "Accessories" },
  { sv: "Hem", en: "Home" },
  { sv: "Utemöbler", en: "Outdoor furniture" },
  { sv: "Säsong", en: "Seasonal" },
  { sv: "Skyddsutrustning", en: "Safety equipment" },
  { sv: "Städning", en: "Cleaning" },
  { sv: "Rengöring", en: "Cleaning supplies" },
  { sv: "Personvård", en: "Personal care" },
  { sv: "Engångsmaterial", en: "Disposables" },
  { sv: "Restaurangutrustning", en: "Restaurant equipment" },
  { sv: "Förpackning", en: "Packaging" },
  { sv: "Lim och fog", en: "Adhesives and sealants" },
  { sv: "Utgående", en: "Discontinued" },
  { sv: "Mejeri", en: "Dairy" },
  { sv: "Torrvaror", en: "Dry goods" },
  { sv: "Fryst", en: "Frozen" },
  { sv: "Dryck", en: "Beverages" },
  { sv: "Utan kategori", en: "Uncategorised" },
];

const CATEGORY_LOOKUP = new Map<string, { sv: string; en: string }>();
for (const entry of CATEGORY_LABELS) {
  CATEGORY_LOOKUP.set(normalize(entry.sv), entry);
  CATEGORY_LOOKUP.set(normalize(entry.en), entry);
  for (const alias of entry.aliases ?? []) CATEGORY_LOOKUP.set(normalize(alias), entry);
}

/** Localize a stored (possibly source-language) category label. */
export function localizeCategory(value: string | null | undefined, lang: string): string {
  const active: PopulatedLanguage = lang === "sv" ? "sv" : "en";
  if (!value) return active === "sv" ? "Utan kategori" : "Uncategorised";
  const hit = CATEGORY_LOOKUP.get(normalize(value));
  return hit ? hit[active] : value;
}

/** All localized category labels for filters and suggestions. */
export function categoryLabels(lang: string): string[] {
  const active: PopulatedLanguage = lang === "sv" ? "sv" : "en";
  return CATEGORY_LABELS.map((c) => c[active]).filter((v, i, arr) => arr.indexOf(v) === i);
}

/** Language-correct search examples for the command palette. */
export function searchExamples(lang: string): string[] {
  const active: PopulatedLanguage = lang === "sv" ? "sv" : "en";
  const keys = ["Verktyg", "Fästmaterial", "Färg", "Förvaring"];
  return keys
    .map((sv) => CATEGORY_LABELS.find((c) => c.sv === sv)?.[active])
    .filter((value): value is string => Boolean(value));
}

/** Both language forms of a known category, for matching imported source data. */
export function categoryCandidates(value: string): string[] {
  const hit = CATEGORY_LOOKUP.get(normalize(value));
  if (!hit) return [value];
  return [...new Set([value, hit.sv, hit.en])];
}

/* ------------------------------------------------------------- term records */

const ISO_LANG: Record<PopulatedLanguage, string> = { sv: "sv", en: "en" };

function buildRecords(): TermRecord[] {
  const out: TermRecord[] = [];
  for (const concept of CONCEPTS) {
    for (const lang of ["sv", "en"] as const) {
      const local = concept[lang];
      const other = lang === "sv" ? concept.en : concept.sv;
      out.push({
        id: `${concept.key}.${lang}`,
        term: local.term,
        language: lang,
        definition: local.definition,
        synonyms: local.synonyms ?? [],
        translations: { [lang === "sv" ? "en" : "sv"]: other.term },
        category: concept.category,
        broader: concept.broader ?? [],
        narrower: concept.narrower ?? [],
        related: concept.related ?? [],
        abbreviation: concept.abbreviation
          ? {
              short: concept.abbreviation,
              full: ABBREVIATIONS.find((a) => a.short === concept.abbreviation)?.[lang === "sv" ? "fullSv" : "fullEn"] ?? concept.abbreviation,
            }
          : undefined,
        forms: local.forms ?? [],
        context: `${concept.category} · ${lang === "sv" ? "svensk fackterm" : "English industry term"}`,
        source: concept.source ?? (lang === "sv" ? SV_SOURCE : EN_SOURCE),
        status: "verified",
        lastVerified: VERIFIED,
      });
    }
  }
  return out;
}

export const TERM_RECORDS: TermRecord[] = buildRecords();
export const TERM_INDEX = new Map(TERM_RECORDS.map((record) => [record.id, record]));
export const POPULATED_LANGUAGES: PopulatedLanguage[] = ["sv", "en"];

export function recordsFor(lang: PopulatedLanguage): TermRecord[] {
  return TERM_RECORDS.filter((record) => record.language === lang);
}

export function termFor(key: string, lang: PopulatedLanguage): TermRecord | null {
  return TERM_INDEX.get(`${key}.${lang}`) ?? null;
}

export function verifiedSynonyms(key: string, lang: PopulatedLanguage): string[] {
  return termFor(key, lang)?.synonyms.filter((syn) => syn.status === "verified").map((syn) => syn.term) ?? [];
}

export function translationsFor(key: string, lang: PopulatedLanguage): string[] {
  const record = termFor(key, lang);
  if (!record) return [];
  return Object.entries(record.translations)
    .filter(([code]) => code !== lang)
    .map(([, value]) => value)
    .filter((value): value is string => Boolean(value));
}

/* ------------------------------------------------------------ normalization */

export function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("sv-SE")
    .replace(/[\u2018\u2019\u201c\u201d]/g, "")
    .replace(/[.,;:!?()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fold diacritics only for comparison; the original string is never stored folded. */
export function fold(value: string): string {
  return normalize(value)
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[éè]/g, "e")
    .replace(/[ü]/g, "u")
    .replace(/[áà]/g, "a")
    .replace(/[íì]/g, "i")
    .replace(/[óò]/g, "o")
    .replace(/[ñ]/g, "n")
    .replace(/[ç]/g, "c");
}

function singularCandidates(token: string, lang: PopulatedLanguage): string[] {
  const out = new Set<string>([token]);
  if (lang === "en") {
    if (token.endsWith("ies") && token.length > 4) out.add(token.slice(0, -3) + "y");
    if (token.endsWith("es") && token.length > 3) out.add(token.slice(0, -2));
    if (token.endsWith("s") && token.length > 3) out.add(token.slice(0, -1));
  } else {
    // Common Swedish plural and definite endings. These are candidates only:
    // expansion still requires an exact hit in a verified term or form.
    for (const suffix of ["erna", "arna", "orna", "erna", "en", "et", "ar", "er", "or", "n", "s"]) {
      if (token.endsWith(suffix) && token.length - suffix.length >= 4) out.add(token.slice(0, -suffix.length));
    }
  }
  return [...out];
}

function matchesTerm(input: string, term: string, lang: PopulatedLanguage): boolean {
  const needle = fold(input);
  const hay = fold(term);
  if (!needle || !hay) return false;
  if (needle === hay) return true;
  for (const candidate of singularCandidates(needle, lang)) {
    if (candidate === hay) return true;
  }
  // Compound recognition: a query token beginning or ending with an established
  // term of at least five characters (lagerhylla → lager + hylla).
  if (hay.length >= 5 && needle.length >= hay.length + 3 && (needle.startsWith(hay) || needle.endsWith(hay))) return true;
  return false;
}

/* ------------------------------------------------------------ search plan */

export interface SearchPlan {
  language: PopulatedLanguage;
  normalized: string;
  synonyms: string[];
  translations: string[];
  variants: string[];
  categories: string[];
  related: string[];
  abbreviations: string[];
  concepts: string[];
  explanation: string;
}

/**
 * Build a conservative language-aware expansion. Only verified same-language
 * synonyms are included; translations are kept separate and used for matching
 * imported English/Swedish source data, never presented as synonyms.
 */
export function planSearch(query: string, requestedLanguage: string, limit = 12): SearchPlan {
  const lang: PopulatedLanguage = requestedLanguage === "sv" ? "sv" : "en";
  const normalized = normalize(query);
  const variants = new Set<string>();
  const tokens = normalized.split(" ").filter((token) => token.length >= 2);
  const concepts: ConceptSeed[] = [];
  const synonyms = new Set<string>();
  const translations = new Set<string>();
  const related = new Set<string>();
  const abbreviations = new Set<string>();
  const exactTerms = new Set<string>();
  const categories = categoryCandidates(normalized);

  for (const concept of CONCEPTS) {
    const local = concept[lang];
    const haystack = [local.term, ...(local.forms ?? []), ...(local.synonyms ?? []).map((syn) => syn.term)];
    const matched = tokens.some((token) => haystack.some((term) => matchesTerm(token, term, lang))) ||
      matchesTerm(normalized, local.term, lang);
    if (!matched) continue;
    concepts.push(concept);
    exactTerms.add(local.term);
    for (const syn of local.synonyms ?? []) {
      if (syn.status === "verified") synonyms.add(syn.term);
    }
    for (const form of local.forms ?? []) synonyms.add(form);
    const other = lang === "sv" ? concept.en : concept.sv;
    translations.add(other.term);
    for (const rel of concept.related ?? []) {
      const record = termFor(rel, lang);
      if (record) related.add(record.term);
    }
    if (concept.abbreviation) {
      abbreviations.add(concept.abbreviation);
      const full = ABBREVIATIONS.find((a) => a.short === concept.abbreviation);
      if (full) abbreviations.add(lang === "sv" ? full.fullSv : full.fullEn);
    }
  }

  // Standalone abbreviation lookup (SKU, MOQ, OTIF...).
  for (const token of tokens) {
    for (const a of ABBREVIATIONS) {
      if (fold(token) === fold(a.short)) {
        abbreviations.add(a.short);
        abbreviations.add(lang === "sv" ? a.fullSv : a.fullEn);
      }
    }
  }

  synonyms.delete(normalized);
  for (const term of exactTerms) synonyms.delete(term);
  if (categories.length === 1 && synonyms.size === 0 && translations.size === 0) {
    for (const token of tokens) {
      for (const variant of accentVariants(token, lang)) {
        if (variant !== token) variants.add(variant);
      }
    }
  }
  const variantList = [...variants].filter((term) => term !== normalized).slice(0, limit);
  const synList = [...synonyms].filter((term) => term && fold(term) !== fold(normalized)).slice(0, limit);
  const transList = [...translations].filter((term) => term && fold(term) !== fold(normalized)).slice(0, limit);
  const relList = [...related].filter((term) => term && !synList.some((s) => fold(s) === fold(term))).slice(0, limit);
  const abbrList = [...abbreviations].slice(0, limit);

  const synonymNote =
    lang === "sv"
      ? synList.length
        ? `Matchar även verifierade synonymer: ${synList.join(", ")}.`
        : ""
      : synList.length
        ? `Also matching verified synonyms: ${synList.join(", ")}.`
        : "";
  const knownVariant = variantList.find(
    (variant) =>
      CATEGORY_LOOKUP.has(normalize(variant)) ||
      TERM_RECORDS.some((record) => record.language === lang && fold(record.term) === fold(variant)),
  );
  const interpreted = knownVariant ?? variantList[0];
  const variantNote = variantList.length
    ? lang === "sv"
      ? `Tolkar "${normalized}" som "${interpreted}".`
      : `Interpreting "${normalized}" as "${interpreted}".`
    : "";
  const categoryNote =
    categories.length > 1
      ? lang === "sv"
        ? `Matchar kategori ${localizeCategory(normalized, "sv")}.`
        : `Matching category ${localizeCategory(normalized, "en")}.`
      : "";
  const explanation = [categoryNote, synonymNote, variantNote].filter(Boolean).join(" ");

  return {
    language: lang,
    normalized,
    synonyms: synList,
    translations: transList,
    variants: variantList,
    categories,
    related: relList,
    abbreviations: abbrList,
    concepts: concepts.map((c) => c.key),
    explanation,
  };
}

/** Generate plausible accent variants for a Swedish query token (farg → färg). */
export function accentVariants(token: string, lang: PopulatedLanguage): string[] {
  if (lang !== "sv") return [token];
  const map: Record<string, string[]> = {
    a: ["a", "å", "ä"],
    o: ["o", "ö"],
    e: ["e", "é"],
    u: ["u", "ü"],
  };
  let out = [""];
  for (const char of token) {
    const options = map[char] ?? [char];
    out = out.flatMap((prefix) => options.map((option) => prefix + option));
    if (out.length > 24) break;
  }
  return out.slice(0, 24);
}

/** Lightweight language identification for free-text search and imports. */
export function detectLanguage(text: string): PopulatedLanguage {
  const value = normalize(text);
  if (/[åäö]/.test(value)) return "sv";
  const sv = ["och", "att", "för", "med", "lager", "artikel", "leverantör", "beställning", "prognos", "inköp"];
  const en = ["the", "and", "for", "with", "stock", "item", "supplier", "order", "forecast", "purchase"];
  const tokens = value.split(" ");
  let svScore = 0;
  let enScore = 0;
  for (const token of tokens) {
    if (sv.includes(token)) svScore++;
    if (en.includes(token)) enScore++;
  }
  return svScore > enScore ? "sv" : "en";
}

/* --------------------------------------------------------------- validation */

export interface TerminologyIssue {
  severity: "error" | "warning";
  id: string;
  message: string;
}

/** Structural and linguistic checks used by the automated terminology suite. */
export function validateTerminology(): TerminologyIssue[] {
  const issues: TerminologyIssue[] = [];
  const ids = new Set<string>();
  const termsByLang = new Map<string, Set<string>>();

  for (const record of TERM_RECORDS) {
    if (ids.has(record.id)) issues.push({ severity: "error", id: record.id, message: "Duplicate terminology ID." });
    ids.add(record.id);
    if (!record.definition.trim()) issues.push({ severity: "error", id: record.id, message: "Definition is empty." });
    if (!record.source.trim()) issues.push({ severity: "error", id: record.id, message: "Source is missing." });
    if (record.status !== "verified") issues.push({ severity: "warning", id: record.id, message: "Record is not verified." });

    const languageTerms = termsByLang.get(record.language) ?? new Set<string>();
    const folded = fold(record.term);
    if (languageTerms.has(folded)) issues.push({ severity: "error", id: record.id, message: "Duplicate term in language." });
    languageTerms.add(folded);
    termsByLang.set(record.language, languageTerms);

    for (const synonym of record.synonyms) {
      if (!synonym.term.trim()) issues.push({ severity: "error", id: record.id, message: "Empty synonym." });
      if (fold(synonym.term) === folded) issues.push({ severity: "error", id: record.id, message: "Synonym repeats the term." });
      if (synonym.status === "verified" && record.translations[record.language === "sv" ? "en" : "sv"] &&
          fold(synonym.term) === fold(record.translations[record.language === "sv" ? "en" : "sv"]!)) {
        issues.push({ severity: "error", id: record.id, message: "A translation is recorded as a synonym." });
      }
    }
  }

  for (const a of ABBREVIATIONS) {
    if (!/^[A-Z0-9]{2,6}$/.test(a.short)) issues.push({ severity: "error", id: a.short, message: "Abbreviation has an invalid form." });
    if (!a.fullEn || !a.fullSv) issues.push({ severity: "error", id: a.short, message: "Abbreviation lacks a full expression." });
  }

  for (const lang of POPULATED_LANGUAGES) {
    const labels = categoryLabels(lang);
    if (new Set(labels.map((l) => fold(l))).size !== labels.length) {
      issues.push({ severity: "error", id: "categories", message: `Duplicate category labels in ${lang}.` });
    }
  }

  return issues;
}

/** Language metadata for the UI and future locale switch. */
export function languageInfo(code: SupportedLanguage) {
  return SUPPORTED_LANGUAGES.find((lang) => lang.code === code) ?? null;
}

/** ISO code, kept explicit so records can never be language-ambiguous. */
export function languageOf(record: TermRecord): string {
  return ISO_LANG[record.language];
}
