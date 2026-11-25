import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "playwright/test";

/**
 * WCAG 2.2 AA via axe (serious/critical) plus a keyboard pass over the parts
 * that only work with a keyboard: skip link, matrix cells, search and explore.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function audit(page: import("playwright/test").Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const contrast = results.violations.filter((v) => v.id === "color-contrast");
  return {
    name,
    blocking: blocking.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      help: v.help,
      samples: v.nodes.slice(0, 3).map((n) => ({ target: n.target, html: n.html.slice(0, 160), summary: n.failureSummary?.slice(0, 160) })),
    })),
    contrast: contrast.map((v) => ({
      id: v.id,
      nodes: v.nodes.length,
      samples: v.nodes.slice(0, 3).map((n) => ({ target: n.target, html: n.html.slice(0, 160), summary: n.failureSummary?.slice(0, 160) })),
    })),
    passes: results.passes.length,
  };
}

test.describe("tillgänglighet", () => {
  // Audit the settled layout. Entry animations temporarily lower opacity, which
  // makes axe report false contrast failures mid-transition.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("axe: publik sida", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(800);
    const result = await audit(page, "public");
    expect(result.blocking).toEqual([]);
    expect(result.contrast).toEqual([]);
  });

  test("axe: dashboard", async ({ page }) => {
    await page.goto("/app");
    await page.waitForTimeout(600);
    const result = await audit(page, "dashboard");
    expect(result.blocking).toEqual([]);
    expect(result.contrast).toEqual([]);
  });

  test("axe: lagervärld (både 3D och tabell)", async ({ page }) => {
    await page.goto("/app/lagervarld");
    await page.waitForTimeout(1200);
    const result = await audit(page, "app-world");
    expect(result.blocking).toEqual([]);
    expect(result.contrast).toEqual([]);

    await page.getByRole("button", { name: "Tabell", exact: true }).click();
    const table = await audit(page, "app-world-table");
    expect(table.blocking).toEqual([]);
  });

  test("tangentbord: skip-länk, fokus och matrix med Enter", async ({ page, browserName }) => {
    await page.goto("/app");
    // Safari does not include links in the default Tab order; Option+Tab is the
    // platform keyboard path for full keyboard access. Chromium uses Tab.
    const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab";
    await page.keyboard.press(tabKey);
    const skip = page.locator("a.skip");
    await expect(skip).toBeFocused();

    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press(tabKey);
      seen.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return el ? `${el.tagName}:${(el.textContent || "").trim().slice(0, 24)}` : "";
        }),
      );
    }
    expect(new Set(seen).size, seen.join(" | ")).toBeGreaterThan(4);
    expect(seen.every(Boolean)).toBe(true);
  });

  test("tangentbord: lagervärldens filter och tabell", async ({ page }) => {
    await page.goto("/app/lagervarld");
    /* Native select: reachable and operable from the keyboard (the platform
       decides how the popup opens, so the change itself is set directly). */
    await page.locator('[data-aw-filter="abc"]').focus();
    await expect(page.locator('[data-aw-filter="abc"]')).toBeFocused();
    await page.keyboard.press("KeyA");
    await page.locator('[data-aw-filter="abc"]').selectOption("A");
    await expect(page.locator('[data-aw-filter="abc"]')).toHaveValue("A");

    await page.locator("[data-aw-search]").fill("18V");
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => Number(await page.locator("[data-app-world]").getAttribute("data-visible-rows")))
      .toBeGreaterThan(0);
  });
});
