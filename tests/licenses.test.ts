/**
 * License and asset traceability regression tests.
 *
 * These do not replace legal review. They stop the most common accidental
 * regressions: a new runtime dependency with an unapproved license, a font that
 * ships without its OFL text, or a legacy font being served from /fonts again.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};
const register = readFileSync(join(ROOT, "THIRD_PARTY_LICENSES.md"), "utf8");

const ALLOWED_RUNTIME_LICENSES = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD"]);

describe("tredjepartslicenser", () => {
  test("alla runtime-beroenden har en granskad licens och finns i registret", () => {
    for (const [name, range] of Object.entries(packageJson.dependencies ?? {})) {
      const pkgPath = join(ROOT, "node_modules", name, "package.json");
      expect(existsSync(pkgPath)).toBe(true);
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string; license?: string };
      expect(ALLOWED_RUNTIME_LICENSES.has(pkg.license ?? "")).toBe(true);
      expect(register).toContain(range.replace(/^[^0-9]*/, ""));
      expect(register).toContain(pkg.version);
    }
  });

  test("registret namnger de direkta runtime-beroendena", () => {
    expect(register).toContain("three.js");
    expect(register).toContain("pdfkit");
    expect(register).toContain("SIL OFL 1.1");
    expect(register).toContain("Geist");
    expect(register).toContain("Newsreader");
  });

  test("varje publikt teckensnitt har en licensfil", () => {
    const files = readdirSync(join(ROOT, "public", "fonts"));
    const families: Array<[RegExp, string]> = [
      [/^geist-sans-/, "OFL-geist-sans.txt"],
      [/^geist-mono-/, "OFL-geist-mono.txt"],
      [/^newsreader-400-italic\.ttf$/, "OFL-newsreader.txt"],
    ];
    const fontFiles = files.filter((file) => /\.(woff2|ttf)$/i.test(file));
    expect(fontFiles.length).toBeGreaterThan(0);
    for (const file of fontFiles) {
      const family = families.find(([pattern]) => pattern.test(file));
      expect(family).toBeDefined();
      expect(files).toContain(family![1]);
    }
  });

  test("oanvända legacy-teckensnitt ligger utanför den publika fontvägen", () => {
    expect(existsSync(join(ROOT, "assets", "legacy-fonts"))).toBe(true);
    const css = readFileSync(join(ROOT, "public", "v3.css"), "utf8");
    for (const legacy of ["inter-latin", "manrope-latin", "jetbrains-mono", "schibsted", "instrument-sans"]) {
      expect(css).not.toContain(legacy);
    }
  });

  test("forskningsgrunden för prognosmetoderna är dokumenterad", () => {
    for (const reference of ["Croston", "Syntetos", "Teunter", "Nikolopoulos", "ADIDA"]) {
      expect(register).toContain(reference);
    }
  });
});
