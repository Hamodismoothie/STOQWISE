import { describe, expect, test } from "bun:test";
import {
  calculateEstimate,
  defaultPricingRules,
  normalizeProfile,
  recommendedPackage,
  sanitizeRules,
  type PricingProfile,
} from "../src/pricing.ts";

const baseProfile: Partial<PricingProfile> = {
  industry: "Retail",
  country: "SE",
  businessType: "Omnichannel",
  employees: 24,
  locations: 4,
  warehouses: 2,
  stores: 2,
  skus: 12_000,
  inventoryValue: 8_000_000,
  monthlyTransactions: 14_000,
  suppliers: 35,
  users: 6,
  modules: ["inventory", "forecast", "optimization", "procurement", "product", "ai"],
  support: "priority",
  billingCycle: "annual",
  integrations: 1,
  erp: "Fortnox",
  wms: "",
  pos: "",
  ecommerce: "Shopify",
  dataFormats: ["csv"],
  notes: "",
};

describe("personalised pricing engine", () => {
  test("normalises unknown modules and always includes the core inventory module", () => {
    const profile = normalizeProfile({ modules: ["forecast" as never, "nonsense" as never], users: 0, locations: 0 });
    expect(profile.modules).toEqual(["inventory", "forecast"]);
    expect(profile.users).toBe(1);
    expect(profile.locations).toBe(1);
  });

  test("returns traceable recurring lines and a deterministic total", () => {
    const estimate = calculateEstimate(baseProfile);
    expect(estimate.recurringLines.length).toBeGreaterThan(5);
    expect(estimate.recurringLines.find((line) => line.key === "skus")?.amount).toBe(10 * 180);
    expect(estimate.recurringLines.find((line) => line.key === "users")?.amount).toBe(3 * 290);
    expect(estimate.recurringLines.find((line) => line.key === "locations")?.amount).toBe(3 * 490);
    expect(estimate.monthly).toBeGreaterThan(defaultPricingRules.minimumMonthly);
    expect(estimate.monthly % defaultPricingRules.roundingSek).toBe(0);
    expect(estimate.recurringLines.reduce((sum, line) => sum + line.amount, 0)).toBeLessThanOrEqual(estimate.monthly);
  });

  test("annual billing uses the configured discount and shows the saving", () => {
    const monthly = calculateEstimate({ ...baseProfile, billingCycle: "monthly" });
    const annual = calculateEstimate({ ...baseProfile, billingCycle: "annual" });
    expect(annual.monthly).toBe(monthly.monthly);
    expect(annual.annualMonthly).toBeLessThan(annual.monthly);
    expect(annual.annualSaving).toBeGreaterThan(0);
    expect(annual.annualTotal).toBe(annual.annualMonthly * 12);
  });

  test("extra modules, users, locations, integrations and warehouses each change the estimate", () => {
    const lean = calculateEstimate({ ...baseProfile, modules: ["inventory"], users: 1, locations: 1, integrations: 0, erp: "", ecommerce: "", warehouses: 1 });
    const rich = calculateEstimate({ ...baseProfile, modules: ["inventory", "forecast", "ai", "reporting"], users: 8, locations: 6, integrations: 3, erp: "ERP", wms: "WMS", pos: "POS", ecommerce: "Shop", warehouses: 3 });
    expect(rich.monthly).toBeGreaterThan(lean.monthly);
    expect(rich.implementation).toBeGreaterThan(lean.implementation);
  });

  test("recommends a package from verified business dimensions", () => {
    const rules = sanitizeRules(defaultPricingRules);
    expect(recommendedPackage(normalizeProfile({ skus: 2_000, users: 2, locations: 1 }), rules).id).toBe("starter");
    expect(recommendedPackage(normalizeProfile({ skus: 12_000, users: 8, locations: 4 }), rules).id).toBe("growth");
    expect(recommendedPackage(normalizeProfile({ skus: 60_000, users: 20, locations: 10 }), rules).id).toBe("business");
    expect(recommendedPackage(normalizeProfile({ skus: 200_000, users: 60, locations: 30 }), rules).id).toBe("enterprise");
  });

  test("administrator rule overrides are bounded and affect the estimate", () => {
    const rules = sanitizeRules({
      ...defaultPricingRules,
      baseMonthly: 2_000,
      annualDiscountPct: 999,
      skuBlockPrice: -100,
      modulePrices: { ...defaultPricingRules.modulePrices, forecast: 750 },
    });
    expect(rules.annualDiscountPct).toBe(50);
    expect(rules.skuBlockPrice).toBe(defaultPricingRules.skuBlockPrice);
    const estimate = calculateEstimate({ ...baseProfile, modules: ["inventory", "forecast"] }, rules);
    expect(estimate.recurringLines.find((line) => line.key === "module-forecast")?.amount).toBe(750);
  });

  test("the five personas produce different, explainable estimates", () => {
    const personas: Partial<PricingProfile>[] = [
      { ...baseProfile, industry: "Retail", skus: 3_000, users: 3, locations: 1 },
      { ...baseProfile, industry: "Wholesale", skus: 20_000, users: 8, locations: 3 },
      { ...baseProfile, industry: "E-commerce", skus: 7_000, users: 5, locations: 2 },
      { ...baseProfile, industry: "Food", skus: 4_000, users: 4, locations: 2 },
      { ...baseProfile, industry: "3PL", skus: 45_000, users: 12, locations: 8 },
    ];
    const prices = personas.map((p) => calculateEstimate(p).monthly);
    expect(new Set(prices).size).toBe(prices.length);
    expect(prices.every((p) => p > 0)).toBe(true);
  });
});
