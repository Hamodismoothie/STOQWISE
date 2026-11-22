/**
 * Personalised commercial pricing.
 *
 * This module is deliberately independent of HTTP, the database and AI. The
 * same rules produce the estimate in the app, the quote record and the tests.
 * Nothing here invents a price: every amount comes from a configurable rule
 * and every line is returned with the input that produced it.
 */

export type BillingCycle = "monthly" | "annual";
export type SupportLevel = "standard" | "priority" | "dedicated";

export const MODULE_IDS = [
  "inventory",
  "forecast",
  "optimization",
  "procurement",
  "product",
  "ai",
  "reporting",
  "multi_location",
  "integrations",
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

export interface ModuleDefinition {
  id: ModuleId;
  sv: string;
  en: string;
  descriptionSv: string;
  descriptionEn: string;
}

export const MODULES: ModuleDefinition[] = [
  {
    id: "inventory",
    sv: "Lagerintelligens",
    en: "Inventory Intelligence",
    descriptionSv: "Lagervärde, omsättning, åldring, överlager och bristrisk.",
    descriptionEn: "Inventory value, turnover, ageing, overstock and stockout risk.",
  },
  {
    id: "forecast",
    sv: "Efterfrågeprognos",
    en: "Demand Forecasting",
    descriptionSv: "Säsong, trend, prognosfel och artikelprognoser med osäkerhet.",
    descriptionEn: "Seasonality, trend, forecast error and item forecasts with uncertainty.",
  },
  {
    id: "optimization",
    sv: "Lageroptimering",
    en: "Inventory Optimization",
    descriptionSv: "Säkerhetslager, beställningspunkt, ABC/XYZ och kapitaloptimering.",
    descriptionEn: "Safety stock, reorder points, ABC/XYZ and capital optimization.",
  },
  {
    id: "procurement",
    sv: "Inköpsintelligens",
    en: "Procurement Intelligence",
    descriptionSv: "Inköpsförslag, EOQ, ledtider och leverantörsrisk.",
    descriptionEn: "Purchase recommendations, EOQ, lead times and supplier risk.",
  },
  {
    id: "product",
    sv: "Produktintelligens",
    en: "Product Intelligence",
    descriptionSv: "Produktlönsamhet, segment, bidrag och avvikande beteende.",
    descriptionEn: "Product profitability, segments, contribution and unusual behaviour.",
  },
  {
    id: "ai",
    sv: "AI-affärsinsikter",
    en: "AI Business Insights",
    descriptionSv: "Förklaringar, prioriteringar och åtgärder med spårbara beräkningar.",
    descriptionEn: "Explanations, priorities and actions with traceable calculations.",
  },
  {
    id: "reporting",
    sv: "Avancerad rapportering",
    en: "Advanced Reporting",
    descriptionSv: "PDF-rapporter, Excel-exporter och ledningssammanfattningar.",
    descriptionEn: "PDF reports, Excel exports and executive summaries.",
  },
  {
    id: "multi_location",
    sv: "Flerlageranalys",
    en: "Multi-location Analysis",
    descriptionSv: "Jämför lager, butiker och kanaler i samma beslutsunderlag.",
    descriptionEn: "Compare warehouses, stores and channels in one decision view.",
  },
  {
    id: "integrations",
    sv: "Integrationer och API",
    en: "Integrations and API",
    descriptionSv: "API, webhooks och förberedda kopplingar mot ERP, WMS och POS.",
    descriptionEn: "API, webhooks and prepared connections to ERP, WMS and POS.",
  },
];

export interface PricingProfile {
  industry: string;
  country: string;
  businessType: string;
  employees: number;
  locations: number;
  warehouses: number;
  stores: number;
  skus: number;
  inventoryValue: number;
  monthlyTransactions: number;
  suppliers: number;
  users: number;
  modules: ModuleId[];
  support: SupportLevel;
  billingCycle: BillingCycle;
  integrations: number;
  erp: string;
  wms: string;
  pos: string;
  ecommerce: string;
  dataFormats: string[];
  notes: string;
}

export interface PackageRule {
  id: "starter" | "growth" | "business" | "enterprise";
  sv: string;
  en: string;
  maxSkus: number;
  maxUsers: number;
  maxLocations: number;
}

export interface PricingRules {
  currency: "SEK";
  roundingSek: number;
  baseMonthly: number;
  minimumMonthly: number;
  annualDiscountPct: number;
  includedSkus: number;
  skuBlock: number;
  skuBlockPrice: number;
  includedUsers: number;
  extraUserPrice: number;
  includedLocations: number;
  extraLocationPrice: number;
  includedTransactions: number;
  transactionBlock: number;
  transactionBlockPrice: number;
  includedSuppliers: number;
  supplierBlock: number;
  supplierBlockPrice: number;
  includedEmployees: number;
  employeeBlock: number;
  employeeBlockPrice: number;
  includedInventoryValue: number;
  inventoryValueBlock: number;
  inventoryValueBlockPrice: number;
  modulePrices: Record<ModuleId, number>;
  supportPrices: Record<SupportLevel, number>;
  integrationMonthly: number;
  implementationBase: number;
  implementationPerIntegration: number;
  implementationPerWarehouse: number;
  packages: PackageRule[];
}

/**
 * Default commercial rules. These are configuration, not published prices.
 * An administrator can replace them in the database without a code change.
 */
export const defaultPricingRules: PricingRules = {
  currency: "SEK",
  roundingSek: 10,
  baseMonthly: 1_490,
  minimumMonthly: 1_490,
  annualDiscountPct: 12,
  includedSkus: 2_000,
  skuBlock: 1_000,
  skuBlockPrice: 180,
  includedUsers: 3,
  extraUserPrice: 290,
  includedLocations: 1,
  extraLocationPrice: 490,
  includedTransactions: 5_000,
  transactionBlock: 5_000,
  transactionBlockPrice: 150,
  includedSuppliers: 10,
  supplierBlock: 10,
  supplierBlockPrice: 120,
  includedEmployees: 10,
  employeeBlock: 10,
  employeeBlockPrice: 90,
  includedInventoryValue: 5_000_000,
  inventoryValueBlock: 5_000_000,
  inventoryValueBlockPrice: 250,
  modulePrices: {
    inventory: 0,
    forecast: 490,
    optimization: 590,
    procurement: 690,
    product: 390,
    ai: 790,
    reporting: 290,
    multi_location: 390,
    integrations: 490,
  },
  supportPrices: { standard: 0, priority: 900, dedicated: 2_400 },
  integrationMonthly: 250,
  implementationBase: 4_500,
  implementationPerIntegration: 3_500,
  implementationPerWarehouse: 2_000,
  packages: [
    { id: "starter", sv: "Starter", en: "Starter", maxSkus: 2_500, maxUsers: 3, maxLocations: 1 },
    { id: "growth", sv: "Growth", en: "Growth", maxSkus: 15_000, maxUsers: 10, maxLocations: 5 },
    { id: "business", sv: "Business", en: "Business", maxSkus: 75_000, maxUsers: 30, maxLocations: 20 },
    { id: "enterprise", sv: "Enterprise", en: "Enterprise", maxSkus: Number.MAX_SAFE_INTEGER, maxUsers: Number.MAX_SAFE_INTEGER, maxLocations: Number.MAX_SAFE_INTEGER },
  ],
};

export interface EstimateLine {
  key: string;
  sv: string;
  en: string;
  amount: number;
  detailSv: string;
  detailEn: string;
}

export interface PriceEstimate {
  monthly: number;
  annualMonthly: number;
  annualTotal: number;
  annualSaving: number;
  implementation: number;
  recurringLines: EstimateLine[];
  implementationLines: EstimateLine[];
  includedModules: ModuleDefinition[];
  additionalModules: ModuleDefinition[];
  recommendedPackage: PackageRule;
  activeIntegrations: number;
  assumptionsSv: string[];
  assumptionsEn: string[];
  factors: Array<{ key: string; value: number; sv: string; en: string }>;
}

const finite = (value: unknown, fallback = 0): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const positive = (value: unknown, fallback = 1): number => Math.max(1, Math.round(finite(value, fallback)));

export function normalizeProfile(input: Partial<PricingProfile>): PricingProfile {
  const modules: ModuleId[] = Array.isArray(input.modules)
    ? [...new Set(input.modules.filter((m): m is ModuleId => MODULE_IDS.includes(m as ModuleId)))]
    : ["inventory"];
  if (!modules.includes("inventory")) modules.unshift("inventory");
  const support: SupportLevel = input.support === "priority" || input.support === "dedicated" ? input.support : "standard";
  const cycle: BillingCycle = input.billingCycle === "annual" ? "annual" : "monthly";
  return {
    industry: String(input.industry ?? "").slice(0, 80),
    country: String(input.country ?? "").slice(0, 60),
    businessType: String(input.businessType ?? "").slice(0, 60),
    employees: positive(input.employees, 1),
    locations: positive(input.locations, 1),
    warehouses: finite(input.warehouses, 0),
    stores: finite(input.stores, 0),
    skus: positive(input.skus, 1),
    inventoryValue: finite(input.inventoryValue, 0),
    monthlyTransactions: finite(input.monthlyTransactions, 0),
    suppliers: finite(input.suppliers, 0),
    users: positive(input.users, 1),
    modules,
    support,
    billingCycle: cycle,
    integrations: finite(input.integrations, 0),
    erp: String(input.erp ?? "").slice(0, 80),
    wms: String(input.wms ?? "").slice(0, 80),
    pos: String(input.pos ?? "").slice(0, 80),
    ecommerce: String(input.ecommerce ?? "").slice(0, 80),
    dataFormats: Array.isArray(input.dataFormats) ? input.dataFormats.map((f) => String(f).slice(0, 30)).slice(0, 10) : [],
    notes: String(input.notes ?? "").slice(0, 2_000),
  };
}

const blocks = (value: number, included: number, block: number): number => {
  if (block <= 0 || value <= included) return 0;
  return Math.ceil((value - included) / block);
};

const roundTo = (value: number, step: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value / Math.max(1, step)) * Math.max(1, step);
};

export function activeIntegrationCount(profile: PricingProfile): number {
  const systems = [profile.erp, profile.wms, profile.pos, profile.ecommerce].filter((s) => s.trim().length > 0).length;
  return systems + profile.integrations;
}

export function recommendedPackage(profile: PricingProfile, rules: PricingRules): PackageRule {
  return (
    rules.packages.find(
      (p) => profile.skus <= p.maxSkus && profile.users <= p.maxUsers && profile.locations <= p.maxLocations,
    ) ?? rules.packages[rules.packages.length - 1]!
  );
}

export function calculateEstimate(profileInput: Partial<PricingProfile>, rulesInput: PricingRules = defaultPricingRules): PriceEstimate {
  const profile = normalizeProfile(profileInput);
  const rules = sanitizeRules(rulesInput);
  const lines: EstimateLine[] = [];
  const add = (line: EstimateLine): void => {
    if (line.amount > 0) lines.push(line);
  };

  add({
    key: "base",
    sv: "Basplattform",
    en: "Core platform",
    amount: rules.baseMonthly,
    detailSv: "Lagerintelligens, konto och grundläggande rapportering.",
    detailEn: "Inventory intelligence, account and core reporting.",
  });

  const skuBlocks = blocks(profile.skus, rules.includedSkus, rules.skuBlock);
  add({
    key: "skus",
    sv: "Artikelvolym",
    en: "Item volume",
    amount: skuBlocks * rules.skuBlockPrice,
    detailSv: `${profile.skus.toLocaleString("sv-SE")} artiklar · ${rules.includedSkus.toLocaleString("sv-SE")} ingår · ${skuBlocks} block om ${rules.skuBlock.toLocaleString("sv-SE")}.`,
    detailEn: `${profile.skus.toLocaleString("en-GB")} items · ${rules.includedSkus.toLocaleString("en-GB")} included · ${skuBlocks} blocks of ${rules.skuBlock.toLocaleString("en-GB")}.`,
  });

  const extraUsers = Math.max(0, profile.users - rules.includedUsers);
  add({
    key: "users",
    sv: "Användare",
    en: "Users",
    amount: extraUsers * rules.extraUserPrice,
    detailSv: `${profile.users} användare · ${rules.includedUsers} ingår · ${extraUsers} extra.`,
    detailEn: `${profile.users} users · ${rules.includedUsers} included · ${extraUsers} extra.`,
  });

  const extraLocations = Math.max(0, profile.locations - rules.includedLocations);
  add({
    key: "locations",
    sv: "Lagerställen",
    en: "Locations",
    amount: extraLocations * rules.extraLocationPrice,
    detailSv: `${profile.locations} lagerställen · ${rules.includedLocations} ingår · ${extraLocations} extra.`,
    detailEn: `${profile.locations} locations · ${rules.includedLocations} included · ${extraLocations} extra.`,
  });

  const transactionBlocks = blocks(profile.monthlyTransactions, rules.includedTransactions, rules.transactionBlock);
  add({
    key: "transactions",
    sv: "Transaktionsvolym",
    en: "Transaction volume",
    amount: transactionBlocks * rules.transactionBlockPrice,
    detailSv: `${profile.monthlyTransactions.toLocaleString("sv-SE")} transaktioner/mån · ${transactionBlocks} extra block.`,
    detailEn: `${profile.monthlyTransactions.toLocaleString("en-GB")} transactions/month · ${transactionBlocks} extra ${transactionBlocks === 1 ? "block" : "blocks"}.`,
  });

  const supplierBlocks = blocks(profile.suppliers, rules.includedSuppliers, rules.supplierBlock);
  add({
    key: "suppliers",
    sv: "Leverantörsbas",
    en: "Supplier base",
    amount: supplierBlocks * rules.supplierBlockPrice,
    detailSv: `${profile.suppliers} leverantörer · ${supplierBlocks} extra block.`,
    detailEn: `${profile.suppliers} suppliers · ${supplierBlocks} extra ${supplierBlocks === 1 ? "block" : "blocks"}.`,
  });

  const employeeBlocks = blocks(profile.employees, rules.includedEmployees, rules.employeeBlock);
  add({
    key: "employees",
    sv: "Företagsstorlek",
    en: "Company size",
    amount: employeeBlocks * rules.employeeBlockPrice,
    detailSv: `${profile.employees} anställda · ${employeeBlocks} extra block.`,
    detailEn: `${profile.employees} employees · ${employeeBlocks} extra ${employeeBlocks === 1 ? "block" : "blocks"}.`,
  });

  const valueBlocks = blocks(profile.inventoryValue, rules.includedInventoryValue, rules.inventoryValueBlock);
  add({
    key: "inventory-value",
    sv: "Datavolym och lagervärde",
    en: "Data volume and inventory value",
    amount: valueBlocks * rules.inventoryValueBlockPrice,
    detailSv: `Lagervärde ${profile.inventoryValue.toLocaleString("sv-SE")} kr · ${valueBlocks} extra block.`,
    detailEn: `Inventory value SEK ${profile.inventoryValue.toLocaleString("en-GB")} · ${valueBlocks} extra ${valueBlocks === 1 ? "block" : "blocks"}.`,
  });

  const includedModules = profile.modules
    .map((id) => MODULES.find((m) => m.id === id)!)
    .filter((m) => m.id === "inventory");
  const additionalModules = profile.modules
    .map((id) => MODULES.find((m) => m.id === id)!)
    .filter((m) => m.id !== "inventory");

  for (const module of additionalModules) {
    add({
      key: `module-${module.id}`,
      sv: module.sv,
      en: module.en,
      amount: rules.modulePrices[module.id] ?? 0,
      detailSv: "Vald analysmodul.",
      detailEn: "Selected analysis module.",
    });
  }

  const supportPrice = rules.supportPrices[profile.support] ?? 0;
  add({
    key: "support",
    sv: "Supportnivå",
    en: "Support level",
    amount: supportPrice,
    detailSv:
      profile.support === "dedicated"
        ? "Dedikerad support och namngiven kontakt."
        : profile.support === "priority"
          ? "Prioriterad support med kortare svarstid."
          : "Standardssupport ingår.",
    detailEn:
      profile.support === "dedicated"
        ? "Dedicated support and a named contact."
        : profile.support === "priority"
          ? "Priority support with a shorter response time."
          : "Standard support included.",
  });

  const integrationCount = activeIntegrationCount(profile);
  add({
    key: "integrations",
    sv: "Systemintegrationer",
    en: "System integrations",
    amount: integrationCount * rules.integrationMonthly,
    detailSv: `${integrationCount} aktiva systemintegrationer.`,
    detailEn: `${integrationCount} active system integrations.`,
  });

  const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const monthly = roundTo(Math.max(rules.minimumMonthly, subtotal), rules.roundingSek);
  const annualMonthly = roundTo(monthly * (1 - rules.annualDiscountPct / 100), rules.roundingSek);
  const annualTotal = annualMonthly * 12;
  const annualSaving = monthly * 12 - annualTotal;

  const implementationLines: EstimateLine[] = [
    {
      key: "implementation-base",
      sv: "Onboarding och konfiguration",
      en: "Onboarding and configuration",
      amount: rules.implementationBase,
      detailSv: "Konto, datamodell, mappning och genomgång.",
      detailEn: "Account, data model, mapping and walkthrough.",
    },
  ];
  if (integrationCount > 0)
    implementationLines.push({
      key: "implementation-integrations",
      sv: "Integrationer",
      en: "Integrations",
      amount: integrationCount * rules.implementationPerIntegration,
      detailSv: `${integrationCount} integrationer × ${rules.implementationPerIntegration.toLocaleString("sv-SE")} kr.`,
      detailEn: `${integrationCount} integrations × SEK ${rules.implementationPerIntegration.toLocaleString("en-GB")}.`,
    });
  if (profile.warehouses > 1)
    implementationLines.push({
      key: "implementation-warehouses",
      sv: "Flerlageruppsättning",
      en: "Multi-warehouse setup",
      amount: (profile.warehouses - 1) * rules.implementationPerWarehouse,
      detailSv: `${profile.warehouses - 1} ytterligare lager × ${rules.implementationPerWarehouse.toLocaleString("sv-SE")} kr.`,
      detailEn: `${profile.warehouses - 1} additional warehouses × SEK ${rules.implementationPerWarehouse.toLocaleString("en-GB")}.`,
    });
  const implementation = implementationLines.reduce((sum, line) => sum + line.amount, 0);

  return {
    monthly,
    annualMonthly,
    annualTotal,
    annualSaving,
    implementation,
    recurringLines: lines,
    implementationLines,
    includedModules,
    additionalModules,
    recommendedPackage: recommendedPackage(profile, rules),
    activeIntegrations: integrationCount,
    assumptionsSv: [
      "Estimatet bygger på uppgifterna i affärsprofilen och STOQWISE konfigurerade prisregler.",
      "Priset är exklusive moms och är ett indicativt estimat, inte ett bindande erbjudande.",
      "Faktisk volym kan avvika när data har importerats och verifierats.",
      "Implementation debiteras separat och kan justeras efter teknisk genomgång.",
    ],
    assumptionsEn: [
      "The estimate is based on the business profile and STOQWISE's configured pricing rules.",
      "Prices exclude VAT and are an indicative estimate, not a binding offer.",
      "Actual volumes may differ once data has been imported and verified.",
      "Implementation is invoiced separately and may change after technical review.",
    ],
    factors: [
      { key: "employees", value: profile.employees, sv: "Anställda", en: "Employees" },
      { key: "skus", value: profile.skus, sv: "Aktiva artiklar", en: "Active items" },
      { key: "locations", value: profile.locations, sv: "Lagerställen", en: "Locations" },
      { key: "warehouses", value: profile.warehouses, sv: "Lager", en: "Warehouses" },
      { key: "stores", value: profile.stores, sv: "Butiker", en: "Stores" },
      { key: "transactions", value: profile.monthlyTransactions, sv: "Transaktioner/mån", en: "Transactions/month" },
      { key: "suppliers", value: profile.suppliers, sv: "Leverantörer", en: "Suppliers" },
      { key: "users", value: profile.users, sv: "Användare", en: "Users" },
      { key: "integrations", value: integrationCount, sv: "Integrationer", en: "Integrations" },
    ],
  };
}

function numberFrom(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Applies bounds and merges partial rule updates. This is the only path an
 * administrator update takes, so a malformed form cannot create a negative or
 * infinite price.
 */
export function sanitizeRules(input: Partial<PricingRules> | null | undefined): PricingRules {
  const r = input ?? {};
  const modulePrices = { ...defaultPricingRules.modulePrices };
  for (const id of MODULE_IDS) {
    const value = (r.modulePrices as Record<string, unknown> | undefined)?.[id];
    if (value !== undefined) modulePrices[id] = numberFrom(value, modulePrices[id]);
  }
  const supportPrices = { ...defaultPricingRules.supportPrices };
  for (const key of ["standard", "priority", "dedicated"] as const) {
    const value = (r.supportPrices as Record<string, unknown> | undefined)?.[key];
    if (value !== undefined) supportPrices[key] = numberFrom(value, supportPrices[key]);
  }
  const packages = Array.isArray(r.packages) && r.packages.length === 4
    ? r.packages.map((p, i) => {
        const fallback = defaultPricingRules.packages[i]!;
        return {
          id: fallback.id,
          sv: fallback.sv,
          en: fallback.en,
          maxSkus: numberFrom(p.maxSkus, fallback.maxSkus),
          maxUsers: numberFrom(p.maxUsers, fallback.maxUsers),
          maxLocations: numberFrom(p.maxLocations, fallback.maxLocations),
        };
      })
    : defaultPricingRules.packages;

  return {
    currency: "SEK",
    roundingSek: Math.max(1, numberFrom(r.roundingSek, defaultPricingRules.roundingSek)),
    baseMonthly: numberFrom(r.baseMonthly, defaultPricingRules.baseMonthly),
    minimumMonthly: numberFrom(r.minimumMonthly, defaultPricingRules.minimumMonthly),
    annualDiscountPct: Math.min(50, numberFrom(r.annualDiscountPct, defaultPricingRules.annualDiscountPct)),
    includedSkus: numberFrom(r.includedSkus, defaultPricingRules.includedSkus),
    skuBlock: Math.max(1, numberFrom(r.skuBlock, defaultPricingRules.skuBlock)),
    skuBlockPrice: numberFrom(r.skuBlockPrice, defaultPricingRules.skuBlockPrice),
    includedUsers: numberFrom(r.includedUsers, defaultPricingRules.includedUsers),
    extraUserPrice: numberFrom(r.extraUserPrice, defaultPricingRules.extraUserPrice),
    includedLocations: numberFrom(r.includedLocations, defaultPricingRules.includedLocations),
    extraLocationPrice: numberFrom(r.extraLocationPrice, defaultPricingRules.extraLocationPrice),
    includedTransactions: numberFrom(r.includedTransactions, defaultPricingRules.includedTransactions),
    transactionBlock: Math.max(1, numberFrom(r.transactionBlock, defaultPricingRules.transactionBlock)),
    transactionBlockPrice: numberFrom(r.transactionBlockPrice, defaultPricingRules.transactionBlockPrice),
    includedSuppliers: numberFrom(r.includedSuppliers, defaultPricingRules.includedSuppliers),
    supplierBlock: Math.max(1, numberFrom(r.supplierBlock, defaultPricingRules.supplierBlock)),
    supplierBlockPrice: numberFrom(r.supplierBlockPrice, defaultPricingRules.supplierBlockPrice),
    includedEmployees: numberFrom(r.includedEmployees, defaultPricingRules.includedEmployees),
    employeeBlock: Math.max(1, numberFrom(r.employeeBlock, defaultPricingRules.employeeBlock)),
    employeeBlockPrice: numberFrom(r.employeeBlockPrice, defaultPricingRules.employeeBlockPrice),
    includedInventoryValue: numberFrom(r.includedInventoryValue, defaultPricingRules.includedInventoryValue),
    inventoryValueBlock: Math.max(1, numberFrom(r.inventoryValueBlock, defaultPricingRules.inventoryValueBlock)),
    inventoryValueBlockPrice: numberFrom(r.inventoryValueBlockPrice, defaultPricingRules.inventoryValueBlockPrice),
    modulePrices,
    supportPrices,
    integrationMonthly: numberFrom(r.integrationMonthly, defaultPricingRules.integrationMonthly),
    implementationBase: numberFrom(r.implementationBase, defaultPricingRules.implementationBase),
    implementationPerIntegration: numberFrom(r.implementationPerIntegration, defaultPricingRules.implementationPerIntegration),
    implementationPerWarehouse: numberFrom(r.implementationPerWarehouse, defaultPricingRules.implementationPerWarehouse),
    packages,
  };
}
