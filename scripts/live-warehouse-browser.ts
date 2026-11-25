/**
 * Browser FPS / navigation harness for the Live Warehouse model.
 *
 * Serves the temporary synthetic fixtures from public/world/.scale-bench with a
 * local static server and drives headless Chromium through Playwright. Run
 * scripts/live-warehouse-browser-models.ts first.
 *
 * Run: bun scripts/live-warehouse-browser.ts
 */
import { copyFileSync, rmSync } from "node:fs";
import { chromium } from "playwright";

copyFileSync("scripts/live-warehouse-bench.html", "public/world/.scale-bench.html");
const counts = process.argv.slice(2).map(Number).filter(Boolean);
const targets = counts.length ? counts : [500, 5_000, 10_000, 50_000, 100_000, 250_000, 500_000];
const hardware = process.env.GPU === "hardware";
const reportPath = hardware ? "reports/live-warehouse-browser-hardware.json" : "reports/live-warehouse-browser.json";
const port = 8788;
const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname);
    if (path.startsWith("/vendor/three/")) {
      const name = path.slice("/vendor/three/".length);
      if (!/^[a-z0-9.]+$/i.test(name)) return new Response("not found", { status: 404 });
      const file = Bun.file(`node_modules/three/build/${name}`);
      return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
    }
    const file = Bun.file(`public${path}`);
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

const results: Array<Record<string, unknown>> = [];
try {
  const browser = await chromium.launch({
    headless: true,
    args: [
      ...(hardware
        ? ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"]
        : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]),
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  for (const count of targets) {
    const page = await context.newPage();
    await page.bringToFront();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${port}/world/.scale-bench.html?count=${count}&soak=${process.env.SOAK_MS || 5000}`, { waitUntil: "load" });
    await page.waitForFunction(() => (globalThis as unknown as { __benchReady?: boolean }).__benchReady === true, undefined, { timeout: 180_000 });
    const bench = await page.evaluate(() => (globalThis as unknown as { __bench?: unknown }).__bench) as Record<string, unknown>;
    const gpu = await page.evaluate(() => {
      const doc = (globalThis as unknown as { document?: { querySelector(selector: string): { getContext(kind: string): any } | null } }).document;
      const canvas = doc?.querySelector("canvas");
      const gl = canvas && (canvas.getContext("webgl2") || canvas.getContext("webgl"));
      const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      return {
        vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
      };
    });
    const result = { ...bench, gpu, errors };
    results.push(result);
    console.log(JSON.stringify(result));
    await page.close();
    if (typeof Bun !== "undefined" && typeof Bun.gc === "function") Bun.gc(true);
  }
  await context.close();
  await browser.close();
  await Bun.write(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), hardware, results }, null, 2));
  console.log(`\nWrote ${reportPath}`);
} finally {
  server.stop(true);
  rmSync("public/world/.scale-bench.html", { force: true });
}
