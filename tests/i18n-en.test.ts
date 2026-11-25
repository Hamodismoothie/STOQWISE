import { describe, expect, test } from "bun:test";
import { DEMO_ENVIRONMENTS, buildDemoDataset } from "../src/demo.ts";
import { appDynamic, appPct, appSek, appText } from "../src/i18n-app.ts";

describe("English customer copy", () => {
  test("Swedish priority reasons become English business copy", () => {
    expect(appDynamic("en", "13.45 % av lagervärdet i en artikel")).toBe("13.45% of inventory value in one item");
    expect(appDynamic("en", "9.51 % av lagervärdet i en artikel")).toBe("9.51% of inventory value in one item");
  });

  test("key dashboard labels are translated", () => {
    expect(appText("en", "Lageröversikt")).toBe("Inventory overview");
    expect(appText("en", "Prioriterade åtgärder")).toBe("Recommended actions");
    expect(appText("en", "Visa alla åtgärder")).toBe("View all recommended actions");
    expect(appText("en", "Beräknad")).toBe("Calculated");
  });

  test("numbers and currency use English formatting", () => {
    expect(appSek("en", 1_109_026)).toBe("SEK 1,109,026");
    expect(appSek("en", 71_160)).toBe("SEK 71,160");
    expect(appPct("en", 13.45, 2)).toBe("13.45%");
    expect(appPct("sv", 13.45, 2)).toBe("13,45 %");
  });

  test("the English demo assortment is translated but Swedish is unchanged", () => {
    for (const environment of DEMO_ENVIRONMENTS) {
      const english = buildDemoDataset(environment.id, "en");
      for (const item of english.items) {
        expect(item.name).not.toMatch(/[åäöÅÄÖ]/);
        expect(item.unit).not.toMatch(/[åäöÅÄÖ]/);
      }
    }
    const swedish = buildDemoDataset("industri", "sv");
    expect(swedish.items.some((item) => item.name === "18V borstlös slagskruvdragare")).toBe(true);
    const english = buildDemoDataset("industri", "en");
    expect(english.items.some((item) => item.name === "18V brushless impact driver")).toBe(true);
  });
});
