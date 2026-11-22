/**
 * Linguistic quality gate.
 *
 * These tests protect the terminology service against the failure modes that a
 * translation layer usually introduces: fabricated synonyms, translations
 * presented as synonyms, cross-language leakage, wrong category labels and
 * over-eager search expansion.
 */
import { describe, expect, test } from "bun:test";
import {
  ABBREVIATIONS,
  CONCEPTS,
  SUPPORTED_LANGUAGES,
  TERM_RECORDS,
  categoryCandidates,
  categoryLabels,
  detectLanguage,
  fold,
  localizeCategory,
  normalize,
  planSearch,
  searchExamples,
  termFor,
  validateTerminology,
  verifiedSynonyms,
} from "../src/terminology.ts";

const SWEDISH_MARKERS = ["och", "att", "för", "med", "lager", "artikel", "leverantör", "beställning", "prognos", "inköp"];
const ENGLISH_MARKERS = ["the", "and", "with", "stock", "supplier", "order", "inventory", "forecast", "purchase", "warehouse"];

describe("terminology database integrity", () => {
  test("every record has an ID, language, definition, source and verification date", () => {
    expect(TERM_RECORDS.length).toBeGreaterThan(150);
    for (const record of TERM_RECORDS) {
      expect(record.id).toMatch(/^[a-z0-9-]+\.(sv|en)$/);
      expect(record.term.trim().length).toBeGreaterThan(1);
      expect(record.definition.trim().length).toBeGreaterThan(10);
      expect(record.source.length).toBeGreaterThan(5);
      expect(record.lastVerified).toBe("2026-11-21");
      expect(["sv", "en"]).toContain(record.language);
    }
  });

  test("no duplicate IDs or duplicate primary terms inside a language", () => {
    const issues = validateTerminology().filter((issue) => issue.severity === "error");
    expect(issues).toEqual([]);
  });

  test("every synonym belongs to the language of its record", () => {
    for (const record of TERM_RECORDS) {
      for (const synonym of record.synonyms) {
        expect(synonym.term.trim().length).toBeGreaterThan(1);
        if (record.language === "sv") {
          for (const marker of ENGLISH_MARKERS) {
            expect(fold(synonym.term).split(" ")).not.toContain(marker);
          }
        } else {
          expect(synonym.term).not.toMatch(/[åäö]/);
          for (const marker of SWEDISH_MARKERS) {
            expect(fold(synonym.term).split(" ")).not.toContain(marker);
          }
        }
      }
    }
  });

  test("a translation is never stored as a synonym", () => {
    for (const record of TERM_RECORDS) {
      const translation = record.translations[record.language === "sv" ? "en" : "sv"];
      if (!translation) continue;
      for (const synonym of record.synonyms) {
        expect(fold(synonym.term)).not.toBe(fold(translation));
      }
    }
  });

  test("context-dependent synonyms are not promoted to universal synonyms", () => {
    expect(verifiedSynonyms("procurement", "sv")).toEqual([]);
    expect(verifiedSynonyms("procurement", "en")).toContain("purchasing");
    const plan = planSearch("inköp", "sv");
    expect(plan.synonyms).not.toContain("anskaffning");
    expect(plan.synonyms).not.toContain("upphandling");
  });

  test("established Swedish and English synonyms are present", () => {
    expect(verifiedSynonyms("inventory", "sv")).toEqual(expect.arrayContaining(["varulager", "lagerbestånd"]));
    expect(verifiedSynonyms("inventory", "en")).toEqual(expect.arrayContaining(["stock", "inventory holdings"]));
    expect(verifiedSynonyms("supplier", "en")).toContain("vendor");
    expect(verifiedSynonyms("overstock", "en")).toContain("excess inventory");
  });

  test("records expose broader, narrower and related relationships separately", () => {
    const inventory = termFor("inventory", "en")!;
    expect(inventory.narrower).toContain("safety-stock");
    expect(inventory.related).toContain("inventory-turnover");
    expect(inventory.synonyms.map((s) => s.term)).not.toContain("inventory turnover");
  });
});

describe("category localization", () => {
  const pairs: Array<[string, string]> = [
    ["Elektronik", "Electronics"],
    ["Kontorsmaterial", "Office Supplies"],
    ["Livsmedel", "Food & Beverages"],
    ["Förpackningsmaterial", "Packaging Materials"],
    ["Rengöringsprodukter", "Cleaning Products"],
    ["Kläder", "Clothing"],
    ["Reservdelar", "Spare Parts"],
    ["Verktyg", "Tools"],
    ["Byggmaterial", "Building Materials"],
    ["Hygienprodukter", "Personal Care Products"],
  ];

  test("known categories follow the active interface language", () => {
    for (const [sv, en] of pairs) {
      expect(localizeCategory(sv, "sv")).toBe(sv);
      expect(localizeCategory(sv, "en")).toBe(en);
      expect(localizeCategory(en, "sv")).toBe(sv);
      expect(localizeCategory(en, "en")).toBe(en);
    }
  });

  test("English category labels never contain Swedish source labels", () => {
    const en = categoryLabels("en");
    expect(en).toContain("Tools");
    expect(en).not.toContain("Verktyg");
    expect(en).not.toContain("Färg");
  });

  test("category filters match both language forms of imported data", () => {
    expect(categoryCandidates("Tools")).toEqual(expect.arrayContaining(["Tools", "Verktyg"]));
    expect(categoryCandidates("Verktyg")).toEqual(expect.arrayContaining(["Tools", "Verktyg"]));
  });

  test("the command palette offers language-correct examples", () => {
    expect(searchExamples("sv")).toEqual(["Verktyg", "Fästmaterial", "Färg", "Förvaring"]);
    expect(searchExamples("en")).toEqual(["Tools", "Fasteners", "Paint", "Storage"]);
  });
});

describe("language-aware search", () => {
  test("Swedish expansion stays Swedish and English expansion stays English", () => {
    const sv = planSearch("lager", "sv");
    expect(sv.language).toBe("sv");
    expect(sv.synonyms).toEqual(expect.arrayContaining(["varulager", "lagerbestånd"]));
    expect(sv.synonyms).not.toContain("stock");

    const en = planSearch("inventory", "en");
    expect(en.language).toBe("en");
    expect(en.synonyms).toContain("stock");
    expect(en.synonyms).not.toContain("lager");
  });

  test("translations are kept separate from synonyms", () => {
    const plan = planSearch("inactive stock", "en");
    expect(plan.translations).toContain("Inaktivt lager");
    expect(plan.synonyms).not.toContain("Inaktivt lager");
  });

  test("Swedish characters and accent-folded variants are recognized", () => {
    expect(normalize("  Färg  ")).toBe("färg");
    expect(planSearch("farg", "sv").variants).toContain("färg");
    expect(planSearch("tools", "en").categories).toEqual(expect.arrayContaining(["Tools", "Verktyg"]));
    expect(planSearch("tools", "sv").variants).toEqual([]);
    expect(planSearch("lager", "sv").variants).toEqual([]);
    expect(planSearch("inaktivt lager", "sv").concepts).toContain("dead-stock");
  });

  test("compound words and plural forms resolve to the right concept", () => {
    expect(planSearch("lagerhylla", "sv").concepts).toContain("inventory");
    expect(planSearch("artiklar", "sv").concepts).toContain("item");
    expect(planSearch("suppliers", "en").concepts).toContain("supplier");
  });

  test("related concepts never enter synonym expansion", () => {
    const plan = planSearch("inventory", "en");
    expect(plan.related).toContain("Inventory turnover");
    expect(plan.synonyms).not.toContain("Inventory turnover");
  });

  test("language detection separates Swedish and English", () => {
    expect(detectLanguage("inaktivt lager och prognos")).toBe("sv");
    expect(detectLanguage("inactive stock and forecast")).toBe("en");
  });
});

describe("abbreviations and supported languages", () => {
  test("international abbreviations keep their established form", () => {
    const moq = ABBREVIATIONS.find((a) => a.short === "MOQ")!;
    expect(moq.short).toBe("MOQ");
    expect(moq.fullEn).toBe("Minimum Order Quantity");
    expect(moq.fullSv).toBe("Minsta orderkvantitet");
    expect(planSearch("MOQ", "en").abbreviations).toContain("MOQ");
  });

  test("registered languages include RTL Arabic and are not populated without verification", () => {
    expect(SUPPORTED_LANGUAGES.find((l) => l.code === "ar")?.rtl).toBe(true);
    expect(SUPPORTED_LANGUAGES.filter((l) => l.populated).map((l) => l.code)).toEqual(["sv", "en"]);
  });

  test("every concept has a verified source and exactly one Swedish and English record", () => {
    for (const concept of CONCEPTS) {
      expect(termFor(concept.key, "sv")).not.toBeNull();
      expect(termFor(concept.key, "en")).not.toBeNull();
    }
  });
});
