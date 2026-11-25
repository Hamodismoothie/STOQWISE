import { describe, expect, test } from "bun:test";
import { TECHNICAL_ITEM_CAPACITY } from "../src/capacity.ts";
import { config } from "../src/config.ts";
import { planLimits } from "../src/data/repo.ts";

/**
 * Subscription allowances and technical capacity are deliberately separate.
 * These assertions keep every plan on the central limit source and stop a
 * future plan edit from exceeding what the platform is prepared to represent.
 */
describe("kapacitetskontraktet", () => {
  test("plattformens tekniska kapacitet är 500 000 artiklar", () => {
    expect(TECHNICAL_ITEM_CAPACITY).toBe(500_000);
    expect(config.maxRows).toBe(TECHNICAL_ITEM_CAPACITY);
  });

  test("varje abonnemangsgräns kommer från planLimits och ryms i kapaciteten", () => {
    for (const [plan, limits] of Object.entries(planLimits)) {
      expect(limits.maxSkus).toBeGreaterThan(0);
      expect(limits.maxSkus).toBeLessThanOrEqual(TECHNICAL_ITEM_CAPACITY);
    }
  });

  test("Enterprise använder hela den tekniska kapaciteten", () => {
    expect(planLimits.enterprise.maxSkus).toBe(TECHNICAL_ITEM_CAPACITY);
  });

  test("uppladdningsgränsen rymmer en kontrollerad 500 000-raders export", () => {
    // The synthetic 500k CSV measured 53.1 MB; the 256 MB request bound leaves
    // room for wider customer exports without making the body unbounded.
    expect(config.maxUploadBytes).toBeGreaterThanOrEqual(128 * 1024 * 1024);
  });
});
