import { expect, test, type ConsoleMessage } from "playwright/test";

/**
 * The public 3D section is the riskiest surface: three.js, WebGL, scroll-driven
 * camera, an explore mode and a static fallback. These tests exercise all of
 * it against a real browser, with no mocks except the WebGL switch.
 */

const errors = (messages: ConsoleMessage[]): string[] =>
  messages.filter((m) => m.type() === "error").map((m) => m.text());

test.describe("publik sida", () => {
  test("laddar utan konsolfel och har canvas", async ({ page }) => {
    const messages: ConsoleMessage[] = [];
    const pageErrors: string[] = [];
    page.on("console", (m) => messages.push(m));
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto("/");
    await expect(page).toHaveTitle(/STOQWISE/);
    await page.locator("#varld").scrollIntoViewIfNeeded();

    await page.waitForFunction(
      () => document.querySelector("[data-world]")?.getAttribute("data-world-ready") === "3d",
      undefined,
      { timeout: 45_000 },
    );

    expect(errors(messages)).toEqual([]);
    expect(pageErrors).toEqual([]);
    await expect(page.locator("[data-world-canvas]")).toBeVisible();
    const stats = await page.evaluate(() => (window as any).__worldStats);
    expect(stats.webgl).toBe(true);
    expect(stats.drawCalls).toBeGreaterThan(0);
  });

  test("scrollstyrning ändrar scenens tillstånd", async ({ page }) => {
    await page.goto("/");
    await page.locator("#varld").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => Boolean((window as any).__world), undefined, { timeout: 45_000 });

    const read = () => page.evaluate(() => (window as any).__world.stats());

    await page.evaluate(() => (window as any).__world.setProgress(0.12));
    const first = await read();
    await page.evaluate(() => (window as any).__world.setProgress(0.92));
    await page.waitForTimeout(300);
    const last = await read();

    expect(first.progress).toBeLessThan(last.progress);
    expect(first.act).toBe(0);
    expect(last.act).toBe(3);

    /* Riktig scroll ska också flytta akten i DOM:en. */
    await page.mouse.wheel(0, 2200);
    await expect
      .poll(async () => page.locator("[data-world]").getAttribute("data-world-act"))
      .not.toBe("0");
  });

  test("Utforska startar och Esc lämnar läget", async ({ page }) => {
    await page.goto("/");
    await page.locator("#varld").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => Boolean((window as any).__world), undefined, { timeout: 45_000 });

    const explore = page.locator("[data-world-explore]");
    await explore.scrollIntoViewIfNeeded();
    await explore.click();
    await expect(explore).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => (window as any).__world.isExplore())).toBe(true);

    await page.keyboard.press("Escape");
    await expect(explore).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => (window as any).__world.isExplore())).toBe(false);
  });

  test("WebGL avstängt ger statisk fallback", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (String(type).startsWith("webgl")) return null;
        return (original as any).call(this, type, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });

    await page.goto("/");
    await page.locator("#varld").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector("[data-world]")?.getAttribute("data-world-static") === "true");

    await expect(page.locator("[data-world-fallback]")).toBeVisible();
    await expect(page.locator("[data-world-canvas]")).toBeHidden();
    expect(await page.evaluate(() => Boolean((window as any).__world))).toBe(false);
    await context.close();
  });

  test("prefers-reduced-motion ger statisk scen", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto("/");
    await page.locator("#varld").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector("[data-world]")?.getAttribute("data-world-static") === "true");

    expect(await page.evaluate(() => Boolean((window as any).__world))).toBe(false);
    await expect(page.locator("[data-world-fallback]")).toBeVisible();
    await expect(page.locator("[data-world-explore]")).toBeDisabled();
    await context.close();
  });
});
