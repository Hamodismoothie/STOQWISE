import { expect, type Page } from "playwright/test";

export const fixture = "tests/fixtures/e2e-36-artiklar.csv";

export async function signUp(page: Page, email: string): Promise<void> {
  await page.goto("/skapa-konto");
  await page.locator("#n").fill("E2E Granskare");
  await page.locator("#c").fill("Stoqwise Testlager AB");
  await page.locator("#e").fill(email);
  await page.locator("#p").fill("e2e-losenord-2026");
  await Promise.all([page.waitForURL(/\/start/), page.getByRole("button", { name: /Skapa|create/i }).click()]);
}

/** Upload the 36-row fixture and accept the prefilled column mapping. */
export async function importFixture(page: Page): Promise<void> {
  await page.goto("/app/importera");
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.locator('form[action="/app/importera"] button[type="submit"]').click();
  await expect(page.locator('form[action="/app/importera/kor"]')).toBeVisible({ timeout: 30_000 });
  await Promise.all([
    page.waitForURL(/\/app(\?|$)/, { timeout: 60_000 }),
    page.locator('form[action="/app/importera/kor"] button[type="submit"]').first().click(),
  ]);
}

/** The 3D payload on /app/lagervarld, as the page itself reads it. */
export async function readAppWorld(page: Page): Promise<{ mode: string; slots: unknown[]; blocks: unknown[]; frames: unknown[]; picks: unknown[]; summary: { articles: number; pallets: number } }> {
  return page.evaluate(() => {
    const node = document.querySelector("[data-aw-data]");
    if (!node) throw new Error("no payload");
    return JSON.parse(node.textContent || "{}");
  });
}
