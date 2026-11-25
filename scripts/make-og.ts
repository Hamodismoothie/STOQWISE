/**
 * Renders the social sharing card (`public/brand/stoqwise-og.png`).
 *
 * The card is a real 1200×630 PNG built from the shipped brand artwork and the
 * interface fonts, so a link preview shows the same identity as the site. It is
 * generated rather than hand-drawn so it can be regenerated when the copy in
 * `public/brand/` changes.
 *
 * Usage:
 *   bun scripts/make-og.ts
 */
import { chromium } from "playwright";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "public", "brand", "stoqwise-og.png");

const html = `<!doctype html>
<html lang="sv"><head><meta charset="utf-8">
<style>
  @font-face { font-family: Geist; src: url("file://${ROOT}/public/fonts/geist-sans-400.woff2") format("woff2"); font-weight: 400; }
  @font-face { font-family: Geist; src: url("file://${ROOT}/public/fonts/geist-sans-600.woff2") format("woff2"); font-weight: 600; }
  @font-face { font-family: GeistMono; src: url("file://${ROOT}/public/fonts/geist-mono-400.woff2") format("woff2"); font-weight: 400; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1200px; height: 630px; display: flex; flex-direction: column;
    justify-content: space-between; padding: 68px 76px 60px;
    background: #f6f4ef; color: #0e1a18; font-family: Geist, sans-serif;
    background-image:
      radial-gradient(1200px 420px at 88% -10%, rgba(14, 26, 24, .08), transparent 62%),
      linear-gradient(180deg, #f8f6f1 0%, #f2efe8 100%);
  }
  .top { display: flex; align-items: center; justify-content: space-between; }
  .top img { height: 46px; }
  .label { font-family: GeistMono, monospace; font-size: 14px; letter-spacing: .18em; text-transform: uppercase; color: #6b7671; }
  h1 { font-size: 62px; line-height: 1.06; letter-spacing: -.02em; font-weight: 600; max-width: 22ch; }
  h1 em { font-style: normal; color: #0f5b52; }
  p { margin-top: 26px; font-size: 22px; line-height: 1.5; color: #46514c; max-width: 34ch; }
  .rule { display: flex; align-items: center; gap: 18px; margin-top: 34px; }
  .rule i { display: block; width: 64px; height: 3px; background: #b4622f; }
  .rule span { font-family: GeistMono, monospace; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: #6b7671; }
</style></head>
<body>
  <div class="top">
    <img src="file://${ROOT}/public/brand/stoqwise-logo.svg" alt="STOQWISE">
    <span class="label">Inventory intelligence</span>
  </div>
  <div>
    <h1>Lagerintelligens som <em>frigör kapital</em></h1>
    <p>Efterfrågeprognos, lageroptimering och inköpsintelligens för svensk handel och industri.</p>
    <div class="rule"><i></i><span>stoqwise</span></div>
  </div>
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate("document.fonts.ready");
  await page.screenshot({ path: OUT });
  console.log(`Skrev ${OUT}`);
} finally {
  await browser.close();
}
