import { expect, test as setup } from "playwright/test";
import { importFixture, signUp } from "./helpers";

/** One account per run: unique e-mail, then the 36-row fixture imported. */
setup("skapa konto och importera fixturen", async ({ page }) => {
  const email = `e2e-${Date.now()}@lagerradar.test`;
  await signUp(page, email);
  await expect(page).toHaveURL(/\/start/);

  await importFixture(page);
  await expect(page).toHaveURL(/\/app(\?|$)/);
  await expect(page.locator("[data-count]").first()).toBeVisible();

  await page.context().storageState({ path: "reports/e2e/state.json" });
});
