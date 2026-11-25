import { expect, test } from "playwright/test";
import { readAppWorld } from "./helpers";

/** Fixturen har 36 artiklar; Lagervärld ska visa ett ställ per artikel. */

test.describe("lagervärld", () => {
  test("laddar med fixturen och visar 36 ställ", async ({ page }) => {
    await page.goto("/app/lagervarld");
    await expect(page.getByRole("heading", { name: "Live Warehouse" })).toBeVisible();

    const payload = await readAppWorld(page);
    expect(payload.mode).toBe("racks");
    expect(payload.slots).toHaveLength(36);
    expect(payload.frames.length).toBeGreaterThan(0);
    expect(payload.summary.pallets).toBeGreaterThan(0);

    await expect(page.locator("[data-aw-rows] tr")).toHaveCount(36);

    await page.waitForFunction(() => Boolean((document.querySelector("[data-app-world]") as any)?.__world), undefined, {
      timeout: 45_000,
    });
    const world = await page.evaluate(() => (document.querySelector("[data-app-world]") as any).__world.stats());
    expect(world.racks).toBe(36);
    expect(world.mode).toBe("physical");
    expect(world.drawCalls).toBeGreaterThan(0);
  });

  test("klick på rad visar artikel, status, rekommendation och Varför", async ({ page }) => {
    await page.goto("/app/lagervarld");
    const row = page.locator("[data-aw-rows] tr").first();
    const sku = await row.getAttribute("data-sku");
    await row.getByRole("button", { name: "Visa i 3D" }).click();

    const panel = page.locator("[data-aw-panel]");
    await expect(panel.locator("[data-aw-panel-body]")).toBeVisible();
    await expect(panel.locator("[data-aw-panel-sku]")).toHaveText(sku!);
    await expect(panel.locator("[data-aw-panel-action]")).not.toBeEmpty();
    await expect(panel.locator("[data-aw-panel-why]")).not.toBeEmpty();
    await expect(panel.locator("[data-aw-panel-class]")).not.toHaveText("–");
    await expect(panel.locator("[data-aw-panel-stock]")).not.toHaveText("–");
    await expect(panel.getByRole("link", { name: "Öppna artikeln" })).toHaveAttribute("href", new RegExp(`/app/artiklar/${sku}`));
  });

  test("filter och sök dämpar ställ och rader", async ({ page }) => {
    await page.goto("/app/lagervarld");
    await page.waitForFunction(() => Boolean((document.querySelector("[data-app-world]") as any)?.__world), undefined, {
      timeout: 45_000,
    });

    const total = await page.locator("[data-aw-rows] tr:visible").count();
    await page.locator('[data-aw-filter="abc"]').selectOption("A");
    await expect
      .poll(async () => Number(await page.locator("[data-app-world]").getAttribute("data-visible-rows")))
      .toBeLessThan(total);

    await page.locator("[data-aw-filters] [data-aw-reset]").click();
    await expect
      .poll(async () => Number(await page.locator("[data-app-world]").getAttribute("data-visible-rows")))
      .toBe(total);

    await page.locator('[data-aw-quick="overstock"]').click();
    await expect(page.locator('[data-aw-quick="overstock"]')).toHaveClass(/is-on/);
    await expect
      .poll(async () => Number(await page.locator("[data-app-world]").getAttribute("data-visible-world")))
      .toBeLessThan(total);
  });

  test("tänk om räknar om men sparar inget", async ({ page }) => {
    await page.goto("/app/lagervarld");
    const before = await page.locator('[data-aw-out="overstockValue"]').textContent();
    const response = await page.request.get("/app/lagervarld/simulera?lead=20&service=0.95&demand=-10");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.counts.racks).toBe(36);
    expect(Object.keys(body.statusBySku)).toHaveLength(36);

    await page.locator("[data-aw-lead]").fill("20");
    await page.locator("[data-aw-lead]").dispatchEvent("input");
    await expect
      .poll(async () => page.locator('[data-aw-out="overstockValue"]').textContent(), { timeout: 15_000 })
      .not.toBe(before);
    await expect(page.locator("[data-aw-delta]")).toContainText("Tillfälligt");
    await expect(page.locator(".aw-whatif .aw-temp")).toContainText("inget sparas");
  });
});

test.describe("ABC/XYZ-matrisen", () => {
  test("klick öppnar panel med artiklar, åtgärd och gränser", async ({ page }) => {
    await page.goto("/app");
    const cell = page.locator('[data-matrix-cell="AX"]');
    await expect(cell).toBeVisible();
    await cell.click();

    const panel = page.locator("[data-matrix-panel]");
    await expect(panel).toBeVisible();
    const detail = panel.locator('[data-matrix-detail="AX"]');
    await expect(detail).toBeVisible();
    await expect(detail.locator("li").first()).toBeVisible();
    await expect(panel.locator(".matrix-thresholds")).toContainText("A ≥ 80 %");
    await expect(panel.locator(".matrix-thresholds")).toContainText("XYZ");
  });

  test("tangentbord: Enter på en ruta öppnar panelen, Esc stänger", async ({ page }) => {
    await page.goto("/app");
    const cell = page.locator('[data-matrix-cell="BX"]');
    await cell.focus();
    await page.keyboard.press("Enter");
    const panel = page.locator("[data-matrix-panel]");
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-matrix-detail="BX"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });
});
