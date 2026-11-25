/**
 * Export guides: where the file lives in the customer's system, and which
 * columns have to be in it.
 *
 * This is product documentation kept as data, not prose in a template: the
 * import page, the guide page and the tests all read the same entries, and each
 * guide names the vendor page it was verified against so it can be re-checked
 * when a system changes its menus.
 *
 * Rules: menu paths only where they can be verified, no invented steps. When a
 * system cannot export what the engine needs in one step, the guide says so.
 */
import type { Locale } from "./i18n.ts";

export type ExportGuideId =
  | "visma"
  | "fortnox"
  | "business-central"
  | "pyramid"
  | "shopify"
  | "woocommerce";

export interface ExportGuideStep {
  sv: string;
  en: string;
}

export interface ExportGuide {
  id: ExportGuideId;
  name: string;
  /** Product variants the path applies to. Empty when the system has one edition. */
  version: { sv: string; en: string } | null;
  /** Minutes a first-time user should expect to spend. */
  minutes: number;
  steps: ExportGuideStep[];
  /** Column names as they appear in that system's export. */
  columns: ExportGuideStep[];
  note: ExportGuideStep;
  /** Vendor documentation the path was verified against. */
  docs: string;
}

export const EXPORT_GUIDES: ExportGuide[] = [
  {
    id: "visma",
    name: "Visma Administration",
    version: { sv: "1000, 2000 och Administration Cloud", en: "1000, 2000 and Administration Cloud" },
    minutes: 4,
    steps: [
      {
        sv: "Öppna Artiklar/Lager → Artiklar och tjänster och växla till listläge.",
        en: "Open Items/Inventory → Items and services and switch to list view.",
      },
      {
        sv: "Högerklicka i tabellen och välj Kopiera/exportera tabellinnehåll. Spara filen som CSV.",
        en: "Right-click the table and choose Copy/export table contents. Save the file as CSV.",
      },
      {
        sv: "Vill du ha lagervärde per artikel: Utskrifter → Lager → Lagervärdeslista. Välj datum och skriv ut till fil.",
        en: "For inventory value per item: Printouts → Inventory → Inventory value list. Choose a date and print to file.",
      },
      {
        sv: "För efterfrågan: Utskrifter → Statistik → Lagerstatistik med kolumnerna Antal i lager och Omsatt antal.",
        en: "For demand: Printouts → Statistics → Inventory statistics with the columns Quantity in stock and Quantity sold.",
      },
    ],
    columns: [
      { sv: "Artikelnummer", en: "Item number" },
      { sv: "Benämning", en: "Description" },
      { sv: "I lager (saldo)", en: "In stock (quantity)" },
      { sv: "Inpris eller Senaste inköpspris", en: "Cost price or Latest purchase price" },
      { sv: "Omsatt antal, frivilligt men ger prognos", en: "Quantity sold, optional but enables forecasting" },
    ],
    note: {
      sv: "Visma räknar lagervärde som antal × (inpris + frakt per styck). Ligger frakten i en egen kolumn blir vårt lagervärde något lägre än Vismas.",
      en: "Visma calculates inventory value as quantity × (cost price + freight per unit). When freight sits in its own column our value is slightly lower than Visma's.",
    },
    docs: "https://support.spiris.se/visma-administration-1000/content/online-help/utskrifter-lagervardeslista.htm",
  },
  {
    id: "fortnox",
    name: "Fortnox",
    version: null,
    minutes: 2,
    steps: [
      { sv: "Gå till Register → Artiklar.", en: "Go to Register → Items." },
      {
        sv: "Klicka Exportera CSV uppe till höger. Välj Alla, Aktiva eller Inaktiva.",
        en: "Click Export CSV in the top right corner. Choose All, Active or Inactive.",
      },
      {
        sv: "Har du Fortnox Lager: ta i stället ut rapporten Lagervärdesrapport under Rapporter, eftersom Artikelregister inte finns i den versionen.",
        en: "If you use Fortnox Inventory: use the Inventory value report under Reports instead, because the item register report is not available in that edition.",
      },
    ],
    columns: [
      { sv: "Artikelnummer", en: "Item number" },
      { sv: "Benämning", en: "Description" },
      { sv: "Saldo eller Disponibelt antal", en: "Stock or Available quantity" },
      { sv: "Kalkylkostnad eller Inpris", en: "Calculated cost or Cost price" },
      { sv: "Utpris", en: "Sales price" },
    ],
    note: {
      sv: "CSV-exporten innehåller inget sålt antal. Utan försäljningskolumn räknar vi lager, kapital och åtgärder, men inte omsättning eller bristrisk.",
      en: "The CSV export contains no quantity sold. Without a sales column we calculate stock, capital and actions, but not turnover or stockout risk.",
    },
    docs: "https://support.fortnox.se/produkthjalp/fakturering/export-av-artikelregister",
  },
  {
    id: "business-central",
    name: "Microsoft Dynamics 365 Business Central",
    version: null,
    minutes: 4,
    steps: [
      { sv: "Tryck Alt+Q och sök efter Artiklar. Öppna listan.", en: "Press Alt+Q and search for Items. Open the list." },
      {
        sv: "Lägg till kolumnerna Inventory, Unit Cost och Unit Price via Personalize om de inte syns. Bara synliga kolumner följer med i filen.",
        en: "Add the columns Inventory, Unit Cost and Unit Price through Personalize if they are hidden. Only visible columns are included in the file.",
      },
      {
        sv: "Välj Share → Open in Excel. Filen laddas ner som .xlsx och kan laddas upp direkt här.",
        en: "Choose Share → Open in Excel. The file downloads as .xlsx and can be uploaded here directly.",
      },
      {
        sv: "Vill du ha sålt antal: lägg till fältet Sales (Qty.) i vyn, eller ta ut rapporten Inventory Valuation.",
        en: "For quantity sold: add the field Sales (Qty.) to the view, or run the Inventory Valuation report.",
      },
    ],
    columns: [
      { sv: "No.", en: "No." },
      { sv: "Description", en: "Description" },
      { sv: "Inventory (saldo)", en: "Inventory (quantity)" },
      { sv: "Unit Cost (kostnad per styck)", en: "Unit Cost" },
      { sv: "Unit Price (försäljningspris)", en: "Unit Price" },
    ],
    note: {
      sv: "Business Central exporterar vyn, inte tabellen. Saknas en kolumn i filen är den nästan alltid dold i vyn.",
      en: "Business Central exports the view, not the table. A column missing from the file is almost always hidden in the view.",
    },
    docs: "https://learn.microsoft.com/en-us/dynamics365/business-central/across-work-with-excel",
  },
  {
    id: "pyramid",
    name: "Pyramid Business Studio",
    version: { sv: "Pyramid 4", en: "Pyramid 4" },
    minutes: 5,
    steps: [
      {
        sv: "Sök fram artiklarna i artikelregistret och markera raderna i listan.",
        en: "Find the items in the item register and select the rows in the list.",
      },
      {
        sv: "För över listan till kalkylblad via verktygspaletten i listkontrollen.",
        en: "Send the list to a spreadsheet through the tool palette in the list control.",
      },
      {
        sv: "För lagervärde: kör rutin 481 Lagervärdering och skriv ut till fil.",
        en: "For inventory value: run routine 481 Inventory valuation and print to file.",
      },
      {
        sv: "Vill du hellre köra en rapport: använd rutin 8020 Utskriftscentral med en semikolonseparerad rapport.",
        en: "If you prefer a report: use routine 8020 Print centre with a semicolon-separated report.",
      },
    ],
    columns: [
      { sv: "Artikelnummer", en: "Item number" },
      { sv: "Benämning", en: "Description" },
      { sv: "Saldo", en: "Quantity" },
      { sv: "Inköpspris eller lagerpris", en: "Purchase price or inventory price" },
      { sv: "Omsatt antal", en: "Quantity sold" },
    ],
    note: {
      sv: "Pyramid lägger rapportfält i separata kolumner först när rapporten är semikolonseparerad. Blir allt en enda kolumn, be din Pyramid-konsult att sätta semikolon som fältavgränsare.",
      en: "Pyramid puts report fields in separate columns only when the report is semicolon-separated. If everything lands in one column, ask your Pyramid consultant to set semicolon as the field separator.",
    },
    docs: "https://kundservice.unikum.se/media/2737/exporterarapporter_pyramid4.pdf",
  },
  {
    id: "shopify",
    name: "Shopify",
    version: null,
    minutes: 3,
    steps: [
      { sv: "Admin → Produkter.", en: "Admin → Products." },
      {
        sv: "Klicka Exportera och välj Alla produkter, eller det urval du vill analysera.",
        en: "Click Export and choose All products, or the selection you want to analyse.",
      },
      {
        sv: "Välj CSV för Excel och klicka Exportera produkter. Stora kataloger mejlas till butikens adress i stället för att laddas ner direkt.",
        en: "Choose CSV for Excel and click Export products. Large catalogues are emailed to the store address instead of downloading directly.",
      },
    ],
    columns: [
      { sv: "Handle", en: "Handle" },
      { sv: "Title", en: "Title" },
      { sv: "Variant SKU", en: "Variant SKU" },
      { sv: "Variant Inventory Qty", en: "Variant Inventory Qty" },
      { sv: "Variant Price", en: "Variant Price" },
      { sv: "Variant Cost", en: "Variant Cost" },
    ],
    note: {
      sv: "Filen har en rad per variant, inte per produkt. Variant Cost fylls bara i om kostpris finns på varianten, annars blir lagervärdet noll.",
      en: "The file has one row per variant, not per product. Variant Cost is only filled in when the variant has a cost, otherwise inventory value becomes zero.",
    },
    docs: "https://help.shopify.com/en/manual/products/import-export/export-products",
  },
  {
    id: "woocommerce",
    name: "WooCommerce",
    version: null,
    minutes: 3,
    steps: [
      { sv: "Produkter → Alla produkter.", en: "Products → All products." },
      { sv: "Klicka Exportera överst i listan.", en: "Click Export at the top of the list." },
      {
        sv: "Behåll Export all columns, eller välj SKU, Name, Stock, Regular price och Categories. Klicka sedan Generate CSV.",
        en: "Keep Export all columns, or select SKU, Name, Stock, Regular price and Categories. Then click Generate CSV.",
      },
    ],
    columns: [
      { sv: "SKU", en: "SKU" },
      { sv: "Name", en: "Name" },
      { sv: "Stock", en: "Stock" },
      { sv: "Regular price", en: "Regular price" },
      { sv: "Categories", en: "Categories" },
    ],
    note: {
      sv: "Kostpris ingår inte i standardexporten. Utan kostpris kan vi inte räkna kapitalbindning, så ta med kolumnen om du har ett tillägg för inköpspris.",
      en: "Cost of goods is not part of the standard export. Without it we cannot calculate tied-up capital, so include the column if you have a purchase price extension.",
    },
    docs: "https://woocommerce.com/document/product-csv-importer-exporter/",
  },
];

export function exportGuide(id: string): ExportGuide | null {
  return EXPORT_GUIDES.find((guide) => guide.id === id) ?? null;
}

/** The columns every import needs, regardless of system. */
export function requiredColumnList(locale: Locale): string[] {
  return locale === "en"
    ? ["Stock per item (required)", "Unit cost per item (required)", "Item number or description", "Monthly quantity sold (enables forecast)"]
    : ["Lagersaldo per artikel (obligatoriskt)", "Inköpspris per artikel (obligatoriskt)", "Artikelnummer eller benämning", "Såld kvantitet per månad (ger prognos)"];
}
