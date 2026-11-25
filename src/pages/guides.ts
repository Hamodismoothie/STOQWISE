/**
 * Export guides: one page that answers "where is the file in my system?".
 *
 * The page is deliberately plain: a numbered path, the columns that must be in
 * the file, and one honest note per system about what its export cannot do.
 * Everything comes from `export-guides.ts`, so the text here and the tests
 * cannot disagree.
 */
import { EXPORT_GUIDES, requiredColumnList } from "../export-guides.ts";
import { appText, appTranslator } from "../i18n-app.ts";
import { card, esc, icon, shell } from "../ui/base.ts";
import type { PageContext } from "./core.ts";

export function exportGuidesPage(input: PageContext): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const lang = locale === "en" ? "en" : "sv";

  const jump = `<p class="hint" style="margin:0 0 4px">${t("Gå direkt till")}: ${EXPORT_GUIDES.map(
    (guide, index) =>
      `<a class="link-btn" href="#${esc(guide.id)}" style="white-space:normal;overflow-wrap:anywhere">${index + 1}. ${esc(guide.name)}</a>`,
  ).join(" ")}</p>`;

  const requirements = card({
    span: 12,
    title: t("Vad som krävs"),
    subtitle: t("Samma krav oavsett system. Saknas en kolumn kan du mappa den manuellt i nästa steg."),
    body: `<ul class="prose" style="margin:0;padding-left:18px;font-size:13.5px">${requiredColumnList(locale)
      .map((line) => `<li>${esc(line)}</li>`)
      .join("")}</ul>
      <p class="hint" style="margin:10px 0 0">${t("Två kolumner räcker för att komma igång: saldo och inköpspris.")}</p>`,
  });

  const guides = EXPORT_GUIDES.map((guide) =>
    card({
      span: 6,
      id: guide.id,
      title: guide.name,
      subtitle: `${guide.version ? `${esc(guide.version[lang])} · ` : ""}${esc(t("Ungefär {n} minuter", { n: guide.minutes }))}`,
      body: `<p class="hint" style="margin:0 0 6px">${t("Menyväg")}</p>
        <ol class="prose" style="margin:0 0 12px;padding-left:18px;font-size:13.5px">${guide.steps
          .map((step) => `<li style="margin:0 0 6px">${esc(step[lang])}</li>`)
          .join("")}</ol>
        <p class="hint" style="margin:0 0 6px">${t("Kolumner som krävs")}</p>
        <ul class="prose" style="margin:0 0 12px;padding-left:18px;font-size:13.5px">${guide.columns
          .map((column) => `<li><span class="mono">${esc(column[lang])}</span></li>`)
          .join("")}</ul>
        <p class="hint" style="margin:0 0 10px">${esc(guide.note[lang])}</p>
        <a class="link-btn" href="${esc(guide.docs)}" target="_blank" rel="noopener noreferrer">${t("Officiell dokumentation")} ${icon("arrow", 13)}</a>`,
    }),
  ).join("");

  return shell({
    locale,
    path: input.url.pathname + input.url.search,
    title: t("Exportguider"),
    active: "imports",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: t("Menyväg och kolumner för de vanligaste affärs- och butikssystemen."),
    content: `
    <div class="grid">
      <section class="card span-12"><div class="card-body" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between">
        <a class="btn btn-ghost" href="/app/importera">${icon("arrow", 14)} ${t("Tillbaka till importen")}</a>
        ${jump}
      </section>
      ${requirements}
      ${guides}
    </div>`,
  });
}
