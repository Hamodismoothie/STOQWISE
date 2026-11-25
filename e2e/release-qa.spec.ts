import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "playwright/test";
import { readAppWorld, signUp } from "./helpers";

/**
 * Release QA. This spec is deliberately separate from the feature specs: it
 * exercises the full customer journey, the import variants and the negative
 * cases that a release candidate must survive. It runs against the dedicated
 * Playwright server/database in playwright.config.ts, never customer data.
 */

const BASE = "http://127.0.0.1:3199";
const STORAGE = "reports/e2e/state.json";
const CSV_FIXTURE = "tests/fixtures/e2e-36-artiklar.csv";

let analysisId = "";
let xlsxAnalysisId = "";

async function uploadBuffer(
  page: Page,
  name: string,
  mimeType: string,
  buffer: Buffer,
  fields: Record<string, string> = {},
) {
  return page.request.post(`${BASE}/app/importera`, {
    headers: { origin: BASE },
    multipart: {
      file: { name, mimeType, buffer },
      ...fields,
    },
    maxRedirects: 0,
  });
}

async function openImport(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.goto("/app/importera");
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer });
  if (name.endsWith(".xlsx")) await page.locator("#kalla").selectOption("excel");
  await page.locator('form[action="/app/importera"] button[type="submit"]').click();
  await expect(page.locator('form[action="/app/importera/kor"]')).toBeVisible({ timeout: 30_000 });
}

async function runImport(page: Page): Promise<string> {
  const submit = page.locator('form[action="/app/importera/kor"] button[type="submit"]').first();
  await Promise.all([page.waitForURL(/\/app\?analys=/, { timeout: 60_000 }), submit.click()]);
  await expect(page.locator('h1')).toBeVisible();
  return new URL(page.url()).searchParams.get("analys") ?? "";
}

function csvBuffer(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

test.describe("release QA", () => {
  test.describe.configure({ mode: "serial" });

  test("publik navigation, registrering, inloggning och utloggning", async ({ browser }) => {
    // This flow must start signed out; the shared storage state belongs to the
    // setup account used by the import and app tests below.
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.clearCookies();
    const email = `qa-flow-${Date.now()}@stoqwise.test`;
    const password = "e2e-losenord-2026";
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      // Chromium occasionally reports this browser-internal cross-document
      // ViewTransition abort during the logout/login redirect. It is not an
      // application exception; all other page errors still fail the test.
      if (!error.message.includes("ViewTransition opt-in disabled")) errors.push(error.message);
    });

    await page.goto("/");
    await expect(page).toHaveTitle(/STOQWISE/);
    await expect(page.locator("header.site-header")).toBeVisible();
    await page.locator('footer a[href="/produkt"]').first().click();
    await expect(page).toHaveURL(/\/produkt/);
    await expect(page.locator("h1").first()).not.toBeEmpty();

    await page.getByRole("link", { name: /Skapa konto|Create an account/i }).first().click();
    await expect(page).toHaveURL(/\/skapa-konto/);
    await signUp(page, email);
    await expect(page).toHaveURL(/\/start/);

    await page.goto("/app");
    await expect(page.getByText("Ingen analys ännu")).toBeVisible();

    await page.locator('form[action="/logga-ut"] button[type="submit"]').click();
    await expect(page).toHaveURL(`${BASE}/`);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/logga-in/);

    await page.locator("#e").fill(email);
    await page.locator("#p").fill(password);
    await page.getByRole("button", { name: /Logga in|Sign in/i }).click();
    await expect(page).toHaveURL(/\/app/);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("dashboard och CSV-analys finns efter setup", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator("#a")).toBeVisible();
    analysisId = await page.locator("#a").inputValue();
    expect(analysisId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(page.locator("body")).toContainText("36 artiklar");
    await expect(page.locator(".kpi-value").first()).not.toBeEmpty();
    await expect(page.getByText("Lagerhälsa").first()).toBeVisible();
  });

  test("XLSX-import av exporterad analys skapar en ny analys", async ({ page }) => {
    if (!analysisId) {
      await page.goto("/app");
      analysisId = await page.locator("#a").inputValue();
    }
    const exported = await page.request.get(`${BASE}/app/analys/${analysisId}/export.xlsx`);
    expect(exported.ok()).toBeTruthy();
    expect(exported.headers()["content-type"]).toContain("spreadsheetml");
    const xlsx = Buffer.from(await exported.body());
    expect(xlsx.length).toBeGreaterThan(1000);
    expect(xlsx.subarray(0, 2).toString()).toBe("PK");
    await mkdir("reports/e2e", { recursive: true });
    await writeFile("reports/e2e/qa-export.xlsx", xlsx);

    // Use a real file path for the binary upload; this is the same path a
    // customer's file picker gives the browser and avoids test-only buffer
    // encoding differences in Playwright's multipart transport.
    await page.goto("/app/importera");
    await page.locator('input[type="file"]').setInputFiles("reports/e2e/qa-export.xlsx");
    await page.locator("#kalla").selectOption("excel");
    await page.locator('form[action="/app/importera"] button[type="submit"]').click();
    await expect(page.locator('form[action="/app/importera/kor"]')).toBeVisible({ timeout: 30_000 });
    xlsxAnalysisId = await runImport(page);
    expect(xlsxAnalysisId).toMatch(/^[0-9a-f-]{36}$/);
    expect(xlsxAnalysisId).not.toBe(analysisId);
    await expect(page.locator("body")).toContainText("36 artiklar");

    await page.goto("/app/importera");
    await expect(page.locator("body")).toContainText("qa-export.xlsx");
  });

  test("artikelregister, sökning och artikelberäkningar", async ({ page }) => {
    await page.goto(`/app/artiklar?analys=${analysisId}`);
    await expect(page.locator(".data-table tbody tr")).toHaveCount(36);
    const first = page.locator(".data-table tbody tr").first();
    const sku = await first.getAttribute("data-sku");
    expect(sku).toBeTruthy();

    await page.goto(`/app/artiklar?analys=${analysisId}&q=18V`);
    await expect(page.locator(".data-table tbody tr")).not.toHaveCount(0);
    await page.goto(`/app/artiklar/${encodeURIComponent(sku!)}?analys=${analysisId}`);
    await expect(page.getByText("Lagerstatus").first()).toBeVisible();
    await expect(page.getByText("Efterfrågan och prognos").first()).toBeVisible();
    await expect(page.getByText("Lagerstyrning").first()).toBeVisible();
    await expect(page.getByText("Modelljämförelse").first()).toBeVisible();
    await expect(page.locator(".fact")).not.toHaveCount(0);
  });

  test("efterfrågan, optimering och inköpsintelligens", async ({ page }) => {
    await page.goto(`/app/prognos?analys=${analysisId}`);
    await expect(page.locator("h1")).toContainText("Prognos");
    await expect(page.locator("body")).toContainText("Prognos och lagerstyrning per artikel");
    await expect(page.locator(".data-table tbody tr")).not.toHaveCount(0);

    await page.goto(`/app/simulering?analys=${analysisId}`);
    await expect(page.locator("h1")).toContainText("Simulering");
    await expect(page.locator('form[action="/app/simulering"]')).toBeVisible();
    await page.locator('form[action="/app/simulering"] button[type="submit"]').first().click();
    await expect(page.locator("h1")).toContainText("Simulering");
    await expect(page.locator("body")).toContainText("Basfall");

    await page.goto(`/app/inkop?analys=${analysisId}`);
    await expect(page.locator("h1")).toContainText("Inköp");
    await expect(page.locator("body")).toContainText("Leverantör");
    await expect(page.locator("body")).toContainText("Inköpsvärde");
  });

  test("AI-beslutsstöd svarar med spårbara fakta", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (!url.startsWith(BASE) && !url.startsWith("data:")) external.push(url);
    });
    await page.goto(`/app/copilot?analys=${analysisId}`);
    const question = page.locator('form[data-composer] input[name="q"]');
    await question.fill("Vilka 10 artiklar binder mest kapital?");
    await page.locator('form[data-composer] button[type="submit"]').click();
    await expect(page).toHaveURL(/samtal=/);
    await expect(page.locator(".turn-bot .bubble")).not.toHaveCount(0);
    await expect(page.locator("body")).toContainText("konfidens");
    expect(external).toEqual([]);
  });

  test("rapport- och dataexporter", async ({ page }) => {
    const pdf = await page.request.get(`${BASE}/app/analys/${analysisId}/rapport.pdf`);
    expect(pdf.ok()).toBeTruthy();
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    expect(Buffer.from(await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

    const xlsx = await page.request.get(`${BASE}/app/analys/${analysisId}/export.xlsx`);
    expect(xlsx.ok()).toBeTruthy();
    expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");

    const csv = await page.request.get(`${BASE}/app/analys/${analysisId}/export.csv`);
    expect(csv.ok()).toBeTruthy();
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(await csv.text()).toContain("Artikel;Benämning");

    const json = await page.request.get(`${BASE}/app/export`);
    expect(json.ok()).toBeTruthy();
    expect(json.headers()["cache-control"]).toContain("no-store");
    expect(await json.text()).toContain("exportedAt");
  });

  test("kontoinställningar och datahantering", async ({ page }) => {
    await page.goto("/app/installningar");
    await expect(page.locator("h1")).toContainText("Inställningar");
    await expect(page.locator("#namn")).toBeVisible();
    await expect(page.locator("#service")).toBeVisible();
    await expect(page.locator("#dead")).toBeVisible();
    await expect(page.locator("#rate")).toBeVisible();
    await expect(page.getByText("Data i organisationen").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Exportera all data/i })).toBeVisible();

    await page.locator("#service").selectOption("0.98");
    await page.locator("#dead").selectOption("90");
    await page.locator("#rate").fill("12");
    await Promise.all([
      page.waitForURL(/meddelande=/),
      page.locator('form[action="/app/installningar"] button[type="submit"]').click(),
    ]);
    await page.reload();
    await expect(page.locator("#service")).toHaveValue("0.98");
    await expect(page.locator("#dead")).toHaveValue("90");
    await expect(page.locator("#rate")).toHaveValue("12");

    // A new import must start from the saved organisation defaults, not from
    // the old hard-coded 95 % / 180 days.
    await page.goto("/app/importera");
    await page.locator('input[type="file"]').setInputFiles(CSV_FIXTURE);
    await page.locator('form[action="/app/importera"] button[type="submit"]').click();
    await expect(page.locator("#serviceniva")).toHaveValue("0.98");
    await expect(page.locator("#dodlager")).toHaveValue("90");
  });

  test("negativa filfall avvisas utan 500", async ({ page }) => {
    const empty = await uploadBuffer(page, "tom.csv", "text/csv", csvBuffer(""));
    expect(empty.status()).toBe(303);
    expect(empty.headers()["location"]).toContain("fel=");

    const executable = await uploadBuffer(page, "payload.exe", "application/octet-stream", csvBuffer("MZ"));
    expect(executable.status()).toBe(303);
    expect(executable.headers()["location"]).toContain("fel=");

    const brokenXlsx = await uploadBuffer(
      page,
      "broken.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      csvBuffer("not a zip"),
    );
    expect(brokenXlsx.status()).toBe(303);
    expect(brokenXlsx.headers()["location"]).toContain("fel=");
  });

  test("dubbletter, negativt saldo, saknade värden och felaktiga priser hanteras", async ({ page }) => {
    const malformed = [
      "Artikelnummer;Benämning;Lagersaldo;Inköpspris;Försäljningspris;2025-01;2025-02",
      "DUP-1;Dubblett;10;100;150;5;7",
      "DUP-1;Dubblett igen;5;100;150;2;3",
      "NEG-1;Negativt saldo;-7;100;150;4;5",
      "MISSING-1;Saknar saldo;;100;150;1;2",
      "BAD-COST;Fel inköpspris;10;abc;150;1;2",
      "BAD-PRICE;Fel försäljningspris;10;100;xyz;1;2",
    ].join("\r\n");
    const result = await uploadBuffer(page, "qa-negativ.csv", "text/csv", csvBuffer(malformed));
    expect(result.status()).toBe(200);
    const html = await result.text();
    expect(html).toContain("Kolumnmappning");
    const draft = html.match(/name="draft" value="([^"]+)"/)?.[1];
    expect(draft).toBeTruthy();

    const run = await page.request.post(`${BASE}/app/importera/kor`, {
      headers: { origin: BASE },
      form: { draft: draft!, lager: "QA-lager" },
      maxRedirects: 0,
    });
    expect(run.status()).toBe(303);
    expect(run.headers()["location"]).toContain("/app?analys=");
    await page.goto(new URL(run.headers()["location"]!, BASE).toString());
    await expect(page.locator("body")).toContainText("Analys klar: 3 artiklar");
    const warningCard = page.locator("section.card", { hasText: "Importvarningar" });
    await expect(warningCard).toBeVisible();
    await expect(warningCard.locator(".alert")).not.toHaveCount(0);

    // The import history must show that the two unusable rows were skipped and
    // that the duplicate and negative stock did not increase the item count.
    await page.goto("/app/importera");
    const row = page.locator("section.card", { hasText: "Importhistorik" }).locator("tr", { hasText: "qa-negativ.csv" });
    await expect(row).toBeVisible();
    const cells = await row.locator("td").allInnerTexts();
    expect(cells[2]).toBe("6");
    expect(cells[3]).toBe("3");
    expect(cells[4]).toBe("2");
  });

  test("kategorifilter styr klustervyn över detaljbudgeten", async ({ browser }) => {
    test.setTimeout(180_000);
    // Aggregate filtering must affect the 3D scene, not only the 300 preview
    // rows. A fresh organisation keeps the trial's single analysis available.
    const filterContext = await browser.newContext();
    const filterPage = await filterContext.newPage();
    await filterContext.clearCookies();
    await signUp(filterPage, `qa-filter-${Date.now()}@test.se`);
    const categories = ["Alfa", "Beta", "Gamma", "Delta"];
    const filterRows = Array.from({ length: 2_500 }, (_, i) =>
      `FILTER-${i};Filterartikel ${i};${categories[i % categories.length]};${10 + (i % 40)};100;150;${Array.from(
        { length: 6 },
        (_, m) => 1 + ((i * (m + 2)) % 9),
      ).join(";")}`,
    ).join("\r\n");
    const filterCsv = csvBuffer(
      `Artikelnummer;Benämning;Kategori;Lagersaldo;Inköpspris;Försäljningspris;2025-01;2025-02;2025-03;2025-04;2025-05;2025-06\r\n${filterRows}`,
    );
    const opened = await uploadBuffer(filterPage, "qa-filter.csv", "text/csv", filterCsv);
    expect(opened.status()).toBe(200);
    const filterDraft = (await opened.text()).match(/name="draft" value="([^"]+)"/)?.[1];
    expect(filterDraft).toBeTruthy();
    const filtered = await filterPage.request.post(`${BASE}/app/importera/kor`, {
      headers: { origin: BASE },
      form: { draft: filterDraft!, lager: "QA-filterlager" },
      maxRedirects: 0,
    });
    expect(filtered.status()).toBe(303);
    await filterPage.goto("/app/lagervarld");
    const payload = await readAppWorld(filterPage);
    expect(payload.mode).toBe("hierarchical");
    const blocks = payload.blocks as Array<{ categoryName?: string; xyz?: string | null }>;
    expect(blocks.every((block) => Boolean(block.categoryName))).toBe(true);
    const chosen = categories[0]!;
    const expected = blocks.filter((block) => block.categoryName === chosen).length;
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(blocks.length);
    await expect(filterPage.locator("[data-draw-calls]")).toBeVisible({ timeout: 30_000 });
    const worldRoot = filterPage.locator("[data-app-world]");
    await expect(worldRoot).toHaveAttribute("data-visible-rows", "2500", { timeout: 15_000 });
    await expect(filterPage.locator("[data-aw-rows] tr")).toHaveCount(50);
    await filterPage.locator('[data-aw-page="2"]').click();
    await expect(filterPage.locator("[data-aw-pager]")).toContainText("Sida 2 av 50");
    await expect(filterPage.locator("[data-aw-rows] tr")).toHaveCount(50);
    await filterPage.locator('[data-aw-page="1"]').click();
    await filterPage.locator("#aw-cat").selectOption(chosen);
    await expect(worldRoot).toHaveAttribute("data-visible-world", String(expected), {
      timeout: 15_000,
    });
    await expect(worldRoot).toHaveAttribute("data-visible-rows", "625", { timeout: 15_000 });
    await filterPage.locator("#aw-cat").selectOption("");
    const xyzClass = blocks.find((block) => block.xyz)?.xyz;
    expect(xyzClass).toBeTruthy();
    expect(new Set(blocks.map((block) => block.xyz ?? "none")).size).toBeGreaterThan(1);
    const expectedXyz = blocks.filter((block) => block.xyz === xyzClass).length;
    expect(expectedXyz).toBeGreaterThan(0);
    expect(expectedXyz).toBeLessThan(blocks.length);
    await filterPage.locator("#aw-xyz").selectOption(xyzClass!);
    await expect(worldRoot).toHaveAttribute("data-visible-world", String(expectedXyz), {
      timeout: 15_000,
    });
    await filterContext.close();
  });

  test("orimligt stor CSV stoppas av radgränsen", async ({ browser }) => {
    test.setTimeout(120_000);
    // The shared account has already used its trial analyses, so use a fresh
    // organisation to prove that the row limit itself rejects the file.
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.clearCookies();
    await signUp(page, `qa-stor-${Date.now()}@test.se`);
    const header = "Artikelnummer;Benämning;Lagersaldo;Inköpspris\r\n";
    const rows = Array.from({ length: 500_001 }, (_, i) => `BIG-${i};Artikel ${i};1;10`).join("\r\n");
    const result = await uploadBuffer(page, "stor.csv", "text/csv", csvBuffer(header + rows));
    expect(result.status()).toBe(303);
    expect(result.headers()["location"]).toContain("fel=");
    expect(decodeURIComponent(result.headers()["location"]!)).toMatch(/500[\s\u00a0]000/);
    await context.close();
  });

  test("upprepad import och otillåtna API-anrop", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.clearCookies();
    await signUp(page, `qa-repeat-${Date.now()}@test.se`);
    const csv = Buffer.from(await readFile(CSV_FIXTURE));
    const first = await uploadBuffer(page, "e2e-36-artiklar.csv", "text/csv", csv);
    expect(first.status()).toBe(200);
    const firstHtml = await first.text();
    const draft = firstHtml.match(/name="draft" value="([^"]+)"/)?.[1];
    expect(draft).toBeTruthy();
    const run = await page.request.post(`${BASE}/app/importera/kor`, {
      headers: { origin: BASE },
      form: { draft: draft!, lager: "QA-lager" },
      maxRedirects: 0,
    });
    expect(run.status()).toBe(303);
    expect(run.headers()["location"]).toContain("/app?analys=");

    const repeated = await uploadBuffer(page, "e2e-36-artiklar.csv", "text/csv", csv);
    expect(repeated.status()).toBe(200);
    expect(await repeated.text()).toContain("Kolumnmappning");

    const none = await page.request.get(`${BASE}/api/v1/analyses`);
    expect(none.status()).toBe(401);
    const invalid = await page.request.get(`${BASE}/api/v1/analyses`, {
      headers: { authorization: "Bearer lr_read_invalid-key" },
    });
    expect(invalid.status()).toBe(401);
    await context.close();
  });

  test("responsivitet: desktop, laptop, surfplatta och mobil", async ({ browser }) => {
    const sizes = [
      { name: "desktop", width: 1440, height: 900 },
      { name: "laptop", width: 1280, height: 800 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "mobile", width: 390, height: 844 },
    ];
    for (const size of sizes) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        storageState: STORAGE,
      });
      const page = await context.newPage();
      await page.goto("/app");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${size.name}: horisontell overflow`).toBeLessThanOrEqual(1);

      if (size.width <= 760) {
        await page.locator("[data-rail-toggle]").click();
        await expect(page.locator("html")).toHaveAttribute("data-rail", "open");
        await page.keyboard.press("Escape");
        await expect(page.locator("html")).not.toHaveAttribute("data-rail", "open");
      }

      await page.goto("/app/lagervarld");
      await page.waitForTimeout(1200);
      const worldOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(worldOverflow, `${size.name}: lagervärld overflow`).toBeLessThanOrEqual(1);
      if (size.width <= 900) {
        await expect(page.locator('[data-app-world]')).toHaveAttribute("data-view", "table");
        await expect(page.locator(".aw-table")).toBeVisible();
      } else {
        await expect(page.locator('[data-app-world]')).toHaveAttribute("data-view", "3d");
      }
      await context.close();
    }
  });

  test("prestandamätning för sidor och API", async ({ page }) => {
    const metrics: Record<string, unknown> = {};
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    for (const path of ["/", "/app", "/app/lagervarld", "/app/artiklar", "/app/prognos", "/app/inkop"]) {
      const started = Date.now();
      const response = await page.goto(path, { waitUntil: "load" });
      const elapsed = Date.now() - started;
      expect(response?.status(), path).toBeLessThan(500);
      const nav = await page.evaluate(() => {
        const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        return entry
          ? {
              domContentLoaded: Math.round(entry.domContentLoadedEventEnd),
              load: Math.round(entry.loadEventEnd),
              transferSize: entry.transferSize,
              decodedBodySize: entry.decodedBodySize,
            }
          : null;
      });
      metrics[path] = { elapsed, ...nav };
    }

    for (const path of ["/halsa", "/api/v1/health", `/app/analys/${analysisId}/export.csv`]) {
      const started = Date.now();
      const response = await page.request.get(`${BASE}${path}`);
      metrics[`http:${path}`] = { ms: Date.now() - started, status: response.status(), bytes: (await response.body()).length };
    }
    const heap = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null);
    metrics.jsHeapBytes = heap;
    metrics.pageErrors = errors;
    expect(errors).toEqual([]);

    await mkdir("reports/e2e", { recursive: true });
    await writeFile("reports/e2e/release-qa-metrics.json", JSON.stringify(metrics, null, 2));
  });
});
