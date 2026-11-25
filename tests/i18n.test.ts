import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LOCALE,
  LOCALES,
  cookieFor,
  dirFor,
  formatDate,
  formatSek,
  localeFromCookie,
  resolveLocale,
  safeNext,
  strings,
} from "../src/i18n.ts";
import { appDynamic, appMethod, appSek, appText } from "../src/i18n-app.ts";

function aboutEachString(value: unknown, visit: (value: string, key: string) => void, prefix = ""): void {
  if (typeof value === "string") visit(value, prefix);
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) aboutEachString(child, visit, prefix ? `${prefix}.${key}` : key);
  }
}

function flatten(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return [prefix];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key));
}

describe("språkval", () => {
  test("cookien läses och okända språk faller tillbaka till engelska", () => {
    expect(localeFromCookie("lr_lang=sv")).toBe("sv");
    expect(localeFromCookie("a=b; lr_lang=sv; c=d")).toBe("sv");
    expect(localeFromCookie("lr_lang=de")).toBe(DEFAULT_LOCALE);
    expect(localeFromCookie("lr_lang=en-XA")).toBe(DEFAULT_LOCALE);
    expect(localeFromCookie("lr_lang=sv%20")).toBe("sv");
    expect(localeFromCookie(null)).toBe(DEFAULT_LOCALE);
  });

  test("cookien är långlivad och same-site", () => {
    const cookie = cookieFor("sv");
    expect(cookie).toContain("lr_lang=sv");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=31536000");
    expect(cookie).toContain("SameSite=Lax");
  });

  test("resolvern prioriterar cookie, användare, organisation och fallback", () => {
    expect(resolveLocale({ cookie: "lr_lang=en", userLocale: "sv", orgLocale: "sv", fallback: "sv" })).toBe("en");
    expect(resolveLocale({ userLocale: "en", orgLocale: "sv", fallback: "sv" })).toBe("en");
    expect(resolveLocale({ userLocale: null, orgLocale: "en", fallback: "sv" })).toBe("en");
    expect(resolveLocale({ userLocale: "de", orgLocale: "en", fallback: "sv" })).toBe("en");
    expect(resolveLocale({ fallback: "sv" })).toBe("sv");
    expect(resolveLocale({ cookie: "lr_lang=de" })).toBe(DEFAULT_LOCALE);
  });

  test("returadressen får inte lämna sajten", () => {
    expect(safeNext("/priser")).toBe("/priser");
    expect(safeNext("/app/artiklar?q=1")).toBe("/app/artiklar?q=1");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("/\\evil")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

describe("katalog", () => {
  test("engelska och svenska har exakt samma nycklar", () => {
    const enKeys = flatten(strings("en")).sort();
    const svKeys = flatten(strings("sv")).sort();
    expect(svKeys).toEqual(enKeys);
    expect(enKeys.length).toBeGreaterThan(80);
  });

  test("inga HTML-taggar i meddelandena", () => {
    for (const locale of ["en", "sv"] as const) {
      const catalog = strings(locale);
      aboutEachString(catalog, (value, key) => {
        expect({ key, value }).toEqual({ key, value: expect.not.stringContaining("<") });
        expect({ key, value }).toEqual({ key, value: expect.not.stringContaining(">") });
      });
    }
  });

  test("inga tomma strängar", () => {
    for (const locale of ["en", "sv"] as const) {
      for (const [key, value] of Object.entries(strings(locale))) {
        expect(key.length).toBeGreaterThan(0);
        expect(JSON.stringify(value).includes('""')).toBe(false);
      }
    }
  });

  test("endast kompletta språk är valbara", () => {
    const available = LOCALES.filter((l) => l.available).map((l) => l.code);
    expect(available).toEqual(["en", "sv"]);
    expect(LOCALES.length).toBe(14);
    expect(LOCALES.find((l) => l.code === "en-XA")?.available).toBe(false);
  });
});

describe("riktning och formatering", () => {
  test("arabiska är RTL, engelska och svenska är LTR", () => {
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("en")).toBe("ltr");
    expect(dirFor("sv")).toBe("ltr");
  });

  test("valutan är alltid SEK och beloppet identiskt", () => {
    const en = formatSek("en", 6618210);
    const sv = formatSek("sv", 6618210);
    expect(en.startsWith("SEK ")).toBe(true);
    expect(sv.startsWith("SEK ")).toBe(true);
    expect(en.replace(/[^0-9]/g, "")).toBe("6618210");
    expect(sv.replace(/[^0-9]/g, "")).toBe("6618210");
    expect(en).not.toBe(sv);
  });

  test("datum följer språket men inte tidszonen", () => {
    expect(formatDate("en", "2026-11-21T12:00:00Z")).toContain("2026");
    expect(formatDate("sv", "2026-11-21T12:00:00Z")).toContain("2026");
  });
});

describe("appkatalogen", () => {
  test("engelska översätter appens källsträngar och svenska är identitet", () => {
    expect(appText("en", "Översikt")).toBe("Overview");
    expect(appText("en", "Lagervärde per kategori")).toBe("Capital by category");
    expect(appText("sv", "Översikt")).toBe("Översikt");
    expect(appText("en", "saknas helt")).toBe("saknas helt");
  });

  test("belopp och modellnamn följer språket men valutan är alltid SEK", () => {
    expect(appSek("sv", 1234)).toContain("kr");
    expect(appSek("en", 1234)).toBe("SEK 1,234");
    expect(appMethod("en", "ses")).toBe("simple exponential smoothing");
    expect(appMethod("sv", "ses")).toBe("enkel utjämning");
  });

  test("motorns genererade orsaker och formler översätts", () => {
    expect(appDynamic("en", "Överlager 324 enheter")).toBe("Overstock 324 units");
    expect(appDynamic("en", "2.68 % av lagervärdet i en artikel")).toBe("2.68% of inventory value in one item");
    expect(appDynamic("sv", "Överlager 324 enheter")).toBe("Överlager 324 enheter");
  });
});
