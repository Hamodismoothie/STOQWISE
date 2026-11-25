import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test } from "playwright/test";

/**
 * Frame time in act 2 and act 3, on desktop and with 4× CPU throttling.
 *
 * Measured as the mean and p95 of 120 consecutive rAF deltas after a warm-up,
 * with the world section actually in the viewport (the renderer pauses when the
 * section leaves the screen, which would otherwise report idle frames).
 */

const SAMPLE_FRAMES = 120;

async function frameStats(page: import("playwright/test").Page) {
  return page.evaluate(
    (frames) =>
      new Promise<{ mean: number; p95: number; max: number; samples: number }>((resolve) => {
        const deltas: number[] = [];
        let last = performance.now();
        function step(now: number) {
          deltas.push(now - last);
          last = now;
          if (deltas.length < frames) {
            requestAnimationFrame(step);
            return;
          }
          const usable = deltas.slice(10);
          const sorted = [...usable].sort((a, b) => a - b);
          resolve({
            mean: usable.reduce((a, b) => a + b, 0) / usable.length,
            p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
            max: sorted[sorted.length - 1] ?? 0,
            samples: usable.length,
          });
        }
        requestAnimationFrame(step);
      }),
    SAMPLE_FRAMES,
  );
}

test("frametid i scen 2 och 3, desktop och 4× CPU", async ({ page }) => {
  const results: Record<string, unknown> = {};
  await page.goto("/");
  await page.locator("#varld").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => Boolean((window as any).__world), undefined, { timeout: 45_000 });
  await page.locator("[data-world-stage]").scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);

  const client = await page.context().newCDPSession(page);
  for (const act of [2, 3] as const) {
    const progress = act === 2 ? 0.6 : 0.92;
    await page.evaluate((p) => (window as any).__world.setProgress(p), progress);
    await page.waitForTimeout(400);
    results[`scene${act}`] = await frameStats(page);
    results[`scene${act}_info`] = await page.evaluate(() => (window as any).__worldStats);
  }

  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.waitForTimeout(400);
  for (const act of [2, 3] as const) {
    const progress = act === 2 ? 0.6 : 0.92;
    await page.evaluate((p) => (window as any).__world.setProgress(p), progress);
    await page.waitForTimeout(400);
    results[`scene${act}_cpu4`] = await frameStats(page);
  }
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  await mkdir("reports/e2e", { recursive: true });
  await writeFile("reports/e2e/perf.json", JSON.stringify(results, null, 2));
  console.log("PERF", JSON.stringify(results));

  expect((results.scene3 as { mean: number }).mean).toBeGreaterThan(0);
});

/**
 * LCP och CLS på startsidan och produktsidan.
 *
 * Mätt i webbläsaren med PerformanceObserver: LCP är starttiden för den sista
 * största innehållsmålningen, CLS är summan av layoutskiften utan nylig
 * inmatning. Sidan får stå still i 1,5 s efter `load` så att sena skiften hinner
 * räknas. Siffrorna skrivs per sida till `reports/e2e/web-vitals.json` och är en
 * baslinje — testet mäter, det ställer inga prestandakrav.
 */
for (const path of ["/", "/produkt"] as const) {
  const name = path === "/" ? "hem" : "produkt";
  test(`LCP och CLS på ${path}`, async ({ page }) => {
    await page.addInitScript(() => {
      const store = { lcp: 0, cls: 0 };
      (window as any).__vitals = store;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) store.lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as Array<{ hadRecentInput: boolean; value: number }>) {
          if (!entry.hadRecentInput) store.cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });

    await page.goto(path, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    const vitals = await page.evaluate(() => (window as any).__vitals as { lcp: number; cls: number });
    const result = { path, lcpMs: Math.round(vitals.lcp), cls: Math.round(vitals.cls * 1000) / 1000, viewport: page.viewportSize() };

    await mkdir("reports/e2e", { recursive: true });
    const file = "reports/e2e/web-vitals.json";
    let all: Record<string, unknown> = {};
    try {
      all = JSON.parse(await readFile(file, "utf8"));
    } catch {
      /* first route writes the file */
    }
    all[name] = result;
    await writeFile(file, JSON.stringify(all, null, 2));
    console.log(`VITALS ${name} LCP=${result.lcpMs}ms CLS=${result.cls}`);

    expect(result.lcpMs).toBeGreaterThan(0);
    expect(result.cls).toBeGreaterThanOrEqual(0);
  });
}
