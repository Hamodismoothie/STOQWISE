/**
 * Integration architecture.
 *
 * A connector is a description plus a `pull` function. The description states
 * exactly which credentials and endpoints are required, so the UI can tell a
 * customer what is missing instead of failing silently. Connectors whose
 * credentials are absent report `blocked` - they never pretend to work, and they
 * never scrape a system the customer has not authorised.
 *
 * The CSV and Excel connectors are fully functional today: they take bytes and
 * return the same `ParsedCsv` structure the importer already understands, which
 * is what makes ERP support a matter of writing one adapter rather than touching
 * the pipeline.
 */
import { parseCsv, type ParsedCsv } from "../csv.ts";
import { readXlsx } from "../xlsx.ts";
import { config } from "../config.ts";

export type IntegrationCategory = "file" | "erp" | "accounting" | "wms" | "ecommerce";
export type IntegrationStatus = "available" | "requires_credentials";

export interface IntegrationCredentials {
  [key: string]: string | undefined;
}

export interface PullResult {
  parsed: ParsedCsv;
  source: string;
  meta: Record<string, string | number>;
}

export interface IntegrationDefinition {
  id: string;
  name: string;
  category: IntegrationCategory;
  status: IntegrationStatus;
  summary: string;
  docsUrl: string;
  authType: "none" | "api_key" | "oauth2" | "basic" | "client_credentials";
  /** Environment variables the connector reads. Empty for file connectors. */
  requiredEnv: string[];
  capabilities: string[];
  /** What a customer must do to activate it. */
  activation: string[];
  pull?: (input: { bytes: Uint8Array; filename: string; credentials: IntegrationCredentials }) => Promise<PullResult>;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

const csvConnector: IntegrationDefinition = {
  id: "csv",
  name: "CSV-fil",
  category: "file",
  status: "available",
  summary: "Laddar upp en export från valfritt system. Automatisk kolumnigenkänning.",
  docsUrl: "/kom-igang",
  authType: "none",
  requiredEnv: [],
  capabilities: ["import", "export", "auto_mapping", "custom_delimiter"],
  activation: ["Exportera artikelregister med saldo, inköpspris och försäljning per månad."],
  pull: async ({ bytes, filename }) => ({
    parsed: parseCsv(decode(bytes)),
    source: "csv",
    meta: { filename, bytes: bytes.length },
  }),
};

const excelConnector: IntegrationDefinition = {
  id: "excel",
  name: "Excel (.xlsx)",
  category: "file",
  status: "available",
  summary: "Läser första kalkylbladet i en xlsx-fil och konverterar det till importformatet.",
  docsUrl: "/kom-igang",
  authType: "none",
  requiredEnv: [],
  capabilities: ["import", "export"],
  activation: ["Spara exporten som .xlsx med rubriker i första raden."],
  pull: async ({ bytes, filename }) => {
    const matrix = readXlsx(bytes);
    if (matrix.length < 2) throw new Error("Kalkylbladet innehåller inga datarader.");
    const headers = matrix[0]!;
    const rows = matrix.slice(1).map((row) => headers.map((_, i) => row[i] ?? ""));
    return {
      parsed: { headers, rows, delimiter: ";", warnings: [] },
      source: "excel",
      meta: { filename, rows: rows.length },
    };
  },
};

/**
 * ERP connectors share a shape: an endpoint, a token, a paging loop and a field
 * mapping. The pull functions below are deliberately not faked - without the
 * credentials they throw a typed error that the UI renders as "external
 * activation required", with the exact steps from `activation`.
 */
function erpConnector(def: Omit<IntegrationDefinition, "status" | "pull">): IntegrationDefinition {
  return {
    ...def,
    status: "requires_credentials",
    pull: async () => {
      throw new Error(
        `Integrationen ${def.name} kräver ${def.requiredEnv.join(", ")}. Lägg in uppgifterna i serverns miljö och aktivera sedan anslutningen under Integrationer.`,
      );
    },
  };
}

export const integrations: IntegrationDefinition[] = [
  csvConnector,
  excelConnector,
  erpConnector({
    id: "fortnox",
    name: "Fortnox",
    category: "accounting",
    summary: "Artiklar, lagersaldon och fakturarader via Fortnox officiella REST-API.",
    docsUrl: "https://apps.fortnox.se/apidocs",
    authType: "oauth2",
    requiredEnv: ["FORTNOX_CLIENT_ID", "FORTNOX_CLIENT_SECRET", "FORTNOX_REFRESH_TOKEN"],
    capabilities: ["articles", "stock_balance", "invoices", "suppliers"],
    activation: [
      "Skapa en integration i Fortnox Developer Portal och få client id och secret.",
      "Auktorisera kontot och spara refresh-token i serverns miljö.",
      "Lägg uppgifterna i serverns miljö. Anslutningen visas som redo när de finns.",
    ],
  }),
  erpConnector({
    id: "visma",
    name: "Visma (eEkonomi / Business)",
    category: "accounting",
    summary: "Artikelregister och lagersaldon via Visma Connect.",
    docsUrl: "https://developer.visma.com/",
    authType: "oauth2",
    requiredEnv: ["VISMA_CLIENT_ID", "VISMA_CLIENT_SECRET", "VISMA_TENANT_ID"],
    capabilities: ["articles", "stock_balance"],
    activation: [
      "Registrera appen i Visma Developer Portal.",
      "Begär behörighet till artikel- och lagerendpoints för kundens tenant.",
      "Spara client id, secret och tenant id i serverns miljö.",
    ],
  }),
  erpConnector({
    id: "dynamics365",
    name: "Microsoft Dynamics 365 Business Central",
    category: "erp",
    summary: "Item ledger entries och inventory via OData v4 (API-publisher).",
    docsUrl: "https://learn.microsoft.com/dynamics365/business-central/dev-itpro/api-reference/v2.0/",
    authType: "client_credentials",
    requiredEnv: ["D365_TENANT_ID", "D365_CLIENT_ID", "D365_CLIENT_SECRET", "D365_COMPANY_ID", "D365_ENVIRONMENT"],
    capabilities: ["items", "item_ledger", "inventory", "warehouses"],
    activation: [
      "Registrera en app i Entra ID och ge den BC-behörighet (API.ReadWrite.All).",
      "Slå på API-publisher i företagets Business Central-miljö.",
      "Ange tenant, client id/secret, miljö och företags-id.",
    ],
  }),
  erpConnector({
    id: "sap",
    name: "SAP S/4HANA",
    category: "erp",
    summary: "Material master och lagersaldon via OData-tjänster (API_MATERIAL_STOCK_SRV).",
    docsUrl: "https://api.sap.com/",
    authType: "basic",
    requiredEnv: ["SAP_BASE_URL", "SAP_USERNAME", "SAP_PASSWORD"],
    capabilities: ["material", "stock", "plants", "valuation"],
    activation: [
      "Kräver att kundens SAP-team exponerar OData-tjänsten och skapar en teknisk användare.",
      "Ange bas-URL och uppgifter i serverns miljö.",
      "Mappa växt (plant) till lagerplats i STOQWISE.",
    ],
  }),
  erpConnector({
    id: "odoo",
    name: "Odoo",
    category: "erp",
    summary: "product.product, stock.quant och sale.order.line via JSON-RPC.",
    docsUrl: "https://www.odoo.com/documentation/master/developer/reference/external_api.html",
    authType: "api_key",
    requiredEnv: ["ODOO_URL", "ODOO_DB", "ODOO_USER", "ODOO_API_KEY"],
    capabilities: ["products", "stock", "sales", "warehouses"],
    activation: [
      "Skapa en API-nyckel under Inställningar → Användare i Odoo.",
      "Ange URL, databas, användare och nyckel i serverns miljö.",
    ],
  }),
  erpConnector({
    id: "wms",
    name: "WMS (generisk)",
    category: "wms",
    summary: "Generisk WMS-adapter för saldo per lagerplats via REST eller fil.",
    docsUrl: "/kontakt",
    authType: "api_key",
    requiredEnv: ["WMS_BASE_URL", "WMS_API_KEY"],
    capabilities: ["stock_by_location", "movements", "receipts"],
    activation: [
      "Bekräfta att WMS-leverantören kan exportera saldo per artikel och lagerplats.",
      "Ange bas-URL och API-nyckel i serverns miljö.",
    ],
  }),
  erpConnector({
    id: "shopify",
    name: "Shopify",
    category: "ecommerce",
    summary: "Inventory levels och ordrar via Admin GraphQL API.",
    docsUrl: "https://shopify.dev/docs/api/admin-graphql",
    authType: "oauth2",
    requiredEnv: ["SHOPIFY_SHOP", "SHOPIFY_ACCESS_TOKEN"],
    capabilities: ["inventory", "orders", "variants", "locations"],
    activation: [
      "Skapa en custom app i Shopify-admin med read_inventory och read_orders.",
      "Ange butiksdomän och access token i serverns miljö.",
    ],
  }),
];

export function listIntegrations(credentials: IntegrationCredentials = process.env as IntegrationCredentials): Array<
  IntegrationDefinition & { connected: boolean; missing: string[] }
> {
  return integrations.map((integration) => {
    const missing = integration.requiredEnv.filter((key) => !credentials[key]);
    return {
      ...integration,
      missing,
      connected: integration.status === "available" || missing.length === 0,
    };
  });
}

export function getIntegration(id: string): IntegrationDefinition | null {
  return integrations.find((i) => i.id === id) ?? null;
}

const ALLOWED_UPLOAD_EXTENSIONS = new Set([".csv", ".txt", ".tsv", ".xlsx"]);

/** Keeps only the last path component and removes characters that confuse logs or headers. */
export function safeUploadFilename(name: string): string {
  const base = String(name || "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
  return base || "uppladdning.csv";
}

/** Central upload policy for both the web form and the JSON API. */
export function assertUploadAllowed(filename: string, byteLength: number): void {
  const name = safeUploadFilename(filename).toLowerCase();
  const ext = name.match(/\.[a-z0-9]+$/)?.[0] ?? "";
  if (ext === ".xls") {
    throw new Error("Formatet .xls (Excel 97) stöds inte. Spara om filen som .xlsx eller CSV.");
  }
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    throw new Error("Filen måste vara CSV, TSV, TXT eller XLSX.");
  }
  if (byteLength <= 0) throw new Error("Filen är tom.");
  if (byteLength > config.maxUploadBytes) {
    throw new Error(`Filen är större än ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`);
  }
}

/** Converts an uploaded file to the importer's format using the best adapter. */
export async function parseUpload(input: {
  bytes: Uint8Array;
  filename: string;
  integrationId?: string;
}): Promise<PullResult> {
  assertUploadAllowed(input.filename, input.bytes.byteLength);
  const filename = safeUploadFilename(input.filename);
  const name = filename.toLowerCase();
  const id = input.integrationId ?? (name.endsWith(".xlsx") || name.endsWith(".xls") ? "excel" : "csv");
  const integration = getIntegration(id);
  if (!integration?.pull) throw new Error(`Okänd importkälla: ${id}`);
  if (id === "excel" && name.endsWith(".xls")) {
    throw new Error("Formatet .xls (Excel 97) stöds inte. Spara om filen som .xlsx eller CSV.");
  }
  return integration.pull({ bytes: input.bytes, filename, credentials: process.env as IntegrationCredentials });
}
