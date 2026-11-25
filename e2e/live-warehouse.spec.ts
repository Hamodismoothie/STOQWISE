import { expect, test, type Page } from "playwright/test";

/**
 * Live Warehouse 2.0: the seven modes, camera zones, the click panel and the
 * deterministic simulation engine (start/pause/reset, speed, period, scenario,
 * event effects and the guarantee that real stock is never written).
 */

async function boot(page: Page) {
  await page.goto("/app/lagervarld");
  await page.waitForFunction(() => Boolean((document.querySelector("[data-app-world]") as any)?.__world), undefined, {
    timeout: 45_000,
  });
  await page.waitForFunction(
    () => document.querySelector("[data-app-world]")?.getAttribute("data-simulation") === "ready",
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () => ((document.querySelector("[data-app-world]") as any)?.__world.stats().drawCalls || 0) > 0,
    undefined,
    { timeout: 30_000 },
  );
}

async function day(page: Page): Promise<number> {
  return Number(await page.locator("[data-aw-day]").textContent());
}

async function setRange(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((element, next) => {
    const input = element as HTMLInputElement;
    input.value = next;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function playUntil(page: Page, target: number): Promise<void> {
  if ((await page.locator("[data-aw-play]").first().getAttribute("aria-pressed")) !== "true") {
    await page.locator("[data-aw-play]").first().click();
  }
  await expect.poll(() => day(page), { timeout: 25_000 }).toBeGreaterThanOrEqual(target);
  await page.locator("[data-aw-play]").first().click();
  await expect(page.locator("[data-aw-play]").first()).toHaveAttribute("aria-pressed", "false");
}

test.describe("live warehouse 2.0", () => {
  test("sju visualiseringslägen byter scenen, inte bara färgen", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await boot(page);

    const modes = ["physical", "heatmap", "abc", "overstock", "stockout", "demand", "replenish"];
    for (const mode of modes) {
      await page.locator(`[data-aw-mode="${mode}"]`).click();
      await expect(page.locator(`[data-aw-mode="${mode}"]`)).toHaveAttribute("aria-selected", "true");
      const stats = await page.evaluate(() => (document.querySelector("[data-app-world]") as any).__world.stats());
      expect(stats.mode).toBe(mode);
      expect(stats.visible).toBeGreaterThan(0);
    }

    await page.locator('[data-aw-mode="overstock"]').click();
    await expect
      .poll(async () => Number(await page.locator("[data-app-world]").getAttribute("data-visible-world")))
      .toBeLessThan(36);

    await page.locator('[data-aw-mode="physical"]').click();
    await expect
      .poll(async () => Number(await page.locator("[data-app-world]").getAttribute("data-visible-world")))
      .toBe(36);

    expect(errors).toEqual([]);
  });

  test("zonknappar flyttar kameran och markeras", async ({ page }) => {
    await boot(page);
    const zone = page.locator('[data-aw-zone="inbound"]');
    await zone.click();
    await expect(zone).toHaveAttribute("aria-pressed", "true");
    await page.locator('[data-aw-zone="picking"]').click();
    await expect(page.locator('[data-aw-zone="picking"]')).toHaveAttribute("aria-pressed", "true");
    await expect(zone).toHaveAttribute("aria-pressed", "false");
    await page.locator('[data-aw-zone="all"]').click();
    await expect(page.locator('[data-aw-zone="all"]')).toHaveAttribute("aria-pressed", "true");
  });

  test("klick i 3D-scenen väljer en pall och öppnar panelen", async ({ page }) => {
    await boot(page);
    await page.locator("canvas.aw-canvas").scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    const box = await page.locator("canvas.aw-canvas").boundingBox();
    expect(box).not.toBeNull();
    let opened = false;
    for (let row = 2; row <= 6 && !opened; row++) {
      for (let col = 2; col <= 9 && !opened; col++) {
        await page.mouse.click(box!.x + (box!.width * col) / 11, box!.y + (box!.height * row) / 8);
        await page.waitForTimeout(160);
        opened = await page.locator("[data-aw-panel-body]").isVisible();
      }
    }
    expect(opened).toBe(true);
    expect(await page.locator("[data-aw-panel-sku]").textContent()).toMatch(/[A-Z0-9]{2,}-/);
  });

  test("panelen visar pris, klass, placering och efterfrågan", async ({ page }) => {
    await boot(page);
    const row = page.locator("[data-aw-rows] tr").first();
    const sku = await row.getAttribute("data-sku");
    await row.getByRole("button", { name: "Visa i 3D" }).click();

    const panel = page.locator("[data-aw-panel]");
    await expect(panel.locator("[data-aw-panel-body]")).toBeVisible();
    await expect(panel.locator("[data-aw-panel-sku]")).toHaveText(sku!);
    await expect(panel.locator("[data-aw-panel-location]")).not.toHaveText("–");
    await expect(panel.locator("[data-aw-panel-cost]")).toContainText("kr");
    await expect(panel.locator("[data-aw-panel-class]")).not.toHaveText("–");
    await expect(panel.locator("[data-aw-panel-action]")).not.toHaveText("–");
    await expect(panel.locator("[data-aw-panel-spark] polyline")).toHaveCount(1);
    await expect(panel.locator("[data-aw-panel-open]")).toHaveAttribute("href", new RegExp(`/app/artiklar/${sku}`));
  });

  test("start, paus, hastighet och återställning ändrar simuleringens tillstånd", async ({ page }) => {
    await boot(page);
    await expect(page.locator("[data-aw-day]")).toHaveText("0");
    await page.locator("[data-aw-speed]").selectOption("8");
    await expect(page.locator("[data-app-world]")).toHaveAttribute("data-sim-speed", "8");

    await page.locator("[data-aw-play]").first().click();
    await expect(page.locator("[data-aw-play]").first()).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => day(page), { timeout: 20_000 }).toBeGreaterThan(1);
    await page.locator("[data-aw-play]").first().click();
    const paused = await day(page);
    await page.waitForTimeout(900);
    expect(await day(page)).toBe(paused);
    expect(await page.locator("[data-aw-play]").first().getAttribute("aria-pressed")).toBe("false");
    expect(await page.locator("[data-aw-events] .aw-event").count()).toBeGreaterThan(0);

    await page.locator("[data-aw-sim-reset]").first().click();
    await expect(page.locator("[data-aw-day]")).toHaveText("0");
    await expect(page.locator("[data-aw-metric=inbound]")).toContainText("0");
  });

  test("flödet ändrar saldo och återställning tar tillbaka det", async ({ page }) => {
    await boot(page);
    const sum = async () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-aw-stock]"))
          .map((node) => Number((node.textContent || "").replace(/[^\d-]/g, "")))
          .reduce((a, b) => a + b, 0),
      );
    const before = await sum();
    expect(before).toBeGreaterThan(0);

    await playUntil(page, 1);
    await expect.poll(sum, { timeout: 20_000 }).not.toBe(before);

    await page.locator("[data-aw-sim-reset]").first().click();
    await expect.poll(sum, { timeout: 20_000 }).toBe(before);
    await expect(page.locator("[data-aw-play]").first()).toHaveAttribute("aria-pressed", "false");
  });

  test("period och dag-scrub styr den simulerade tiden", async ({ page }) => {
    await boot(page);
    await page.locator("[data-aw-days]").selectOption("30");
    await expect(page.locator("[data-aw-days-out]")).toHaveText("30");
    await expect(page.locator("[data-aw-scrub]")).toHaveAttribute("max", "30");

    await setRange(page, "[data-aw-scrub]", "10");
    await expect(page.locator("[data-aw-day]")).toHaveText("10");
    await expect(page.locator("[data-aw-date]")).toHaveText("2026-11-11");
    await expect(page.locator("[data-aw-events] .aw-event").first()).toBeVisible();
  });

  test("what-if ger reproducerbara resultat och påverkar inte det riktiga lagret", async ({ page }) => {
    await boot(page);
    const firstSku = await page.locator("[data-aw-rows] tr").first().getAttribute("data-sku");
    const articleBefore = await (await page.request.get(`/app/lagervarld/artikel/${firstSku}`)).json();

    const metrics = async () => ({
      onHand: await page.locator('[data-aw-metric="onHand"]').textContent(),
      outbound: await page.locator('[data-aw-metric="outbound"]').textContent(),
    });

    await playUntil(page, 3);
    const baseline = await metrics();
    await page.locator("[data-aw-sim-reset]").first().click();
    await playUntil(page, 3);
    expect(await metrics()).toEqual(baseline);

    await page.locator("[data-aw-sim-reset]").first().click();
    await setRange(page, "[data-aw-sc-demand]", "50");
    await page.locator("[data-aw-sc-apply]").click();
    await expect(page.locator("[data-aw-day]")).toHaveText("0");
    await expect(page.locator("[data-aw-preset]")).toHaveValue("custom");
    await playUntil(page, 3);
    const stressed = await metrics();
    expect(Number(stressed.outbound!.replace(/[^\d]/g, ""))).toBeGreaterThan(
      Number(baseline.outbound!.replace(/[^\d]/g, "")),
    );

    const articleAfter = await (await page.request.get(`/app/lagervarld/artikel/${firstSku}`)).json();
    expect(articleAfter.stock).toBe(articleBefore.stock);
    expect(articleAfter.reserved).toBe(articleBefore.reserved);
  });

  test("kontrollerna fungerar efter flera körningar", async ({ page }) => {
    await boot(page);
    for (let run = 0; run < 3; run++) {
      await page.locator("[data-aw-preset]").selectOption(run === 1 ? "peak" : "normal");
      await page.locator("[data-aw-days]").selectOption(run === 2 ? "30" : "90");
      await page.locator("[data-aw-sim-reset]").first().click();
      await expect(page.locator("[data-aw-day]")).toHaveText("0");
    }
    await page.locator("[data-aw-days]").selectOption("30");
    await page.locator("[data-aw-play]").first().click();
    await expect.poll(() => day(page), { timeout: 20_000 }).toBeGreaterThan(0);
    await page.locator("[data-aw-play]").first().click();
    await page.locator("[data-aw-sim-reset]").first().click();
    await expect(page.locator("[data-aw-day]")).toHaveText("0");
    await expect(page.locator("[data-aw-days-out]")).toHaveText("30");
  });
});

test("sökningen hittar en artikel i hela beståndet och fokuserar dess placering", async ({ page }) => {
  await boot(page);
  const firstRow = page.locator("[data-aw-rows] tr").first();
  const sku = await firstRow.getAttribute("data-sku");
  expect(sku).toBeTruthy();
  await page.locator("[data-aw-search]").fill(sku!);
  const hit = page.locator(".aw-search-hit", { hasText: sku! }).first();
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page.locator("[data-aw-panel-sku]")).toHaveText(sku!);
  await expect(page.locator(".aw-search-results")).toBeHidden();
});
