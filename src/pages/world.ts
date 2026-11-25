/**
 * The public, scroll-driven warehouse section.
 *
 * The four steps are one process: import → analysis → forecast → optimisation.
 * Every figure in them comes from `story.ts`, which runs the same `analyze`,
 * `forecastSeries` and `supplyPlan` as the app on the same demo dataset as the
 * 3D scene. The browser only formats and toggles what the server computed.
 *
 *   · every sentence, number and link is real DOM text - the canvas is
 *     decoration (`aria-hidden`) and nothing is only available in 3D;
 *   · the poster is an inline SVG built from the same scene model;
 *   · one panel per demo environment is rendered up front, so switching the
 *     environment keeps every step and KPI consistent without a reload.
 */
import type { DemoEnvironmentMeta } from "../demo.ts";
import { formatNumber, formatSek, type Locale } from "../i18n.ts";
import type { SceneModel } from "../ui/scene.ts";
import type { WorldEnvironment, WorldKpis } from "../world.ts";
import type { Story } from "../story.ts";
import { esc, icon } from "../ui/base.ts";

const num = (locale: Locale, value: number, decimals = 0): string => formatNumber(locale, value, decimals);
/** Same SEK amount in every locale: only the separators change. */
const sek = (locale: Locale, value: number): string => formatSek(locale, Math.round(value));
const share = (locale: Locale, value: number): string => `${formatNumber(locale, Math.round(value * 100), 0)} %`;

/** Top-down poster: the same racks, statuses and patterns as the 3D scene. */
export function worldPoster(scene: SceneModel, locale: Locale): string {
  const aisleCount = Math.max(1, scene.aisles.length);
  const width = 960;
  const height = 460;
  const padding = 34;
  const columnWidth = (width - padding * 2) / aisleCount;
  const rowHeight = (height - padding * 2) / 12;

  const racks = scene.racks
    .map((rack) => {
      const x = padding + rack.aisle * columnWidth + columnWidth * 0.34;
      const y = padding + rack.depth * (height - padding * 2 - rowHeight);
      const h = 10 + rack.stackHeight * 22;
      const rect = `<rect x="${x.toFixed(1)}" y="${(y + (24 - h) / 2).toFixed(1)}" width="${(columnWidth * 0.32).toFixed(1)}" height="${h.toFixed(1)}" rx="2"/>`;
      const pattern = rack.pattern === "smooth" ? "" : `<rect class="wp-pat" data-pattern="${rack.pattern}" x="${x.toFixed(1)}" y="${(y + (24 - h) / 2).toFixed(1)}" width="${(columnWidth * 0.32).toFixed(1)}" height="${h.toFixed(1)}" rx="2"/>`;
      return `<g class="wp-rack wp-${rack.status}">
        ${rect}${pattern}
        <title>${esc(`${rack.name} · ${rack.label.status}`)}</title>
      </g>`;
    })
    .join("");

  // The poster prints one label per aisle column, so the truncation has to follow
  // the column width instead of a fixed character count.
  const labelFontSize = 11;
  const labelChars = Math.max(4, Math.floor((columnWidth - 6) / (labelFontSize * 0.62)));
  const aisleLabels = scene.aisles
    .map(
      (aisle) =>
        `<text x="${(padding + aisle.index * columnWidth + columnWidth / 2).toFixed(1)}" y="${height - 12}" text-anchor="middle">${esc(
          aisle.category.length > labelChars ? `${aisle.category.slice(0, labelChars - 1)}…` : aisle.category,
        )}</text>`,
    )
    .join("");

  return `<svg class="world-poster" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(
    locale === "sv"
      ? `Stiliserad lagerlayout med ${scene.counts.racks} ställ: A närmast docken, C längst bort.`
      : `Stylised warehouse layout with ${scene.counts.racks} racks: A closest to the dock, C farthest away.`,
  )}" preserveAspectRatio="xMidYMid slice">
    <defs>
      <pattern id="wp-striped" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="none"/><line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" stroke-opacity=".5" stroke-width="1.6"/>
      </pattern>
      <pattern id="wp-dotted" width="6" height="6" patternUnits="userSpaceOnUse">
        <circle cx="3" cy="3" r="1.1" fill="currentColor" fill-opacity=".55"/>
      </pattern>
    </defs>
    <rect class="wp-floor" x="0" y="0" width="${width}" height="${height}"/>
    <g class="wp-aisles">${aisleLabels}</g>
    <g class="wp-racks">${racks}</g>
    <line class="wp-dock" x1="${padding}" y1="${padding - 10}" x2="${width - padding}" y2="${padding - 10}"/>
  </svg>`;
}

function payload(environments: WorldEnvironment[]) {
  return environments.map((environment) => ({
    id: environment.id,
    company: environment.company,
    industry: environment.industry,
    industryId: environment.industryId,
    zones: environment.zones,
    attributes: environment.attributes,
    kpis: environment.kpis,
    counts: environment.scene.counts,
    aisles: environment.scene.aisles.map((aisle) => ({ index: aisle.index, category: aisle.category, value: aisle.value, zone: aisle.zone })),
    racks: environment.scene.racks.map((rack) => ({
      sku: rack.sku,
      name: rack.name,
      aisle: rack.aisle,
      depth: rack.depth,
      boxes: rack.boxes,
      abc: rack.abc,
      status: rack.status,
      pattern: rack.pattern,
    })),
  }));
}

interface WorldSectionInput {
  locale: Locale;
  environments: WorldEnvironment[];
  metas: DemoEnvironmentMeta[];
}

const kpiRows = (kpis: WorldKpis, locale: Locale): Array<{ key: string; label: string; value: string; tone: string }> => [
  {
    key: "inventoryValue",
    label: locale === "sv" ? "Lagervärde" : "Inventory value",
    value: sek(locale, kpis.inventoryValue),
    tone: "neutral",
  },
  {
    key: "overstockValue",
    label: locale === "sv" ? "Överlager" : "Overstock",
    value: sek(locale, kpis.overstockValue),
    tone: "warning",
  },
  {
    key: "stockoutRiskCount",
    label: locale === "sv" ? "Bristrisk" : "Stockout risk",
    value: `${num(locale, kpis.stockoutRiskCount)} ${locale === "sv" ? "artiklar" : "items"}`,
    tone: "critical",
  },
];

/* ------------------------------------------------------------ step details */

function importStep(story: Story, locale: Locale): string {
  const sv = locale === "sv";
  const t = (svText: string, enText: string) => (sv ? svText : enText);
  const data = story.import;
  const rows = data.samples
    .slice(0, 3)
    .map(
      (sample) => `<li class="world-data-row">
        <span class="world-data-name">${esc(sample.name)}</span>
        <b class="mono">${num(locale, sample.stock)}</b>
      </li>`,
    )
    .join("");

  return `<div class="world-story-block world-import">
    <div class="world-import-flow">
      <div class="world-file" aria-hidden="true">
        <span class="world-file-kind">CSV</span>
        <span class="world-file-line"></span>
        <span class="world-file-line"></span>
        <span class="world-file-line world-file-line--short"></span>
        <span class="world-file-alt">XLSX</span>
      </div>
      <span class="world-flow-arrow" aria-hidden="true">${icon("arrow", 16)}</span>
      <div class="world-data-card">
        <div class="world-data-head"><span>${esc(t("Artikel", "Item"))}</span><span>${esc(t("Saldo", "On hand"))}</span></div>
        <ul class="world-data-rows">${rows}</ul>
      </div>
    </div>
    <ul class="world-import-stats">
      <li><b class="mono">${num(locale, data.items)}</b><span>${esc(t("artiklar", "items"))}</span></li>
      <li><b class="mono">${num(locale, data.months)}</b><span>${esc(t("månader", "months"))}</span></li>
      <li><b class="mono">${num(locale, data.suppliers)}</b><span>${esc(t("leverantörer", "suppliers"))}</span></li>
    </ul>
  </div>`;
}

function analysisStep(story: Story, locale: Locale): string {
  const sv = locale === "sv";
  const t = (svText: string, enText: string) => (sv ? svText : enText);
  const data = story.analysis;
  const cellFor = (abc: string, xyz: string) => data.matrix.find((cell) => cell.abc === abc && cell.xyz === xyz);
  const abcKeys = ["A", "B", "C"];
  const xyzKeys = ["X", "Y", "Z"];
  const head = xyzKeys.map((xyz) => `<th scope="col">${xyz}</th>`).join("");
  const body = abcKeys
    .map(
      (abc) => `<tr><th scope="row">${abc}</th>${xyzKeys
        .map((xyz) => {
          const cell = cellFor(abc, xyz);
          const count = cell?.count ?? 0;
          const cellShare = cell?.share ?? 0;
          const alpha = (0.04 + Math.min(0.36, cellShare * 0.5)).toFixed(2);
          return `<td style="--cell-alpha:${alpha}" title="${esc(
            `${abc}/${xyz}: ${num(locale, count)} ${t("artiklar", "items")} · ${share(locale, cellShare)} ${t("av lagervärdet", "of inventory value")}`,
          )}">
            <b class="mono">${num(locale, count)}</b><span>${share(locale, cellShare)}</span>
          </td>`;
        })
        .join("")}</tr>`,
    )
    .join("");

  return `<div class="world-story-block">
    <div class="world-matrix-wrap">
      <table class="world-matrix">
        <caption class="sr-only">${esc(
          t("ABC/XYZ-matris med antal artiklar och andel av lagervärdet.", "ABC/XYZ matrix with item counts and share of inventory value."),
        )}</caption>
        <thead><tr><th scope="col"><span class="sr-only">ABC</span></th>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="world-matrix-caption">${esc(
      t("Artiklar per ABC/XYZ-klass · färg visar andel av lagervärdet", "Items per ABC/XYZ class · colour shows share of inventory value"),
    )}</p>
  </div>`;
}

function chart(story: Story, locale: Locale): string {
  const sv = locale === "sv";
  const history = story.forecast.history;
  const points = story.forecast.points;
  const total = history.length + points.length;
  const W = 520;
  const H = 190;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 22;
  const max = Math.max(1, ...history, ...points.map((point) => point.value)) * 1.08;
  const x = (index: number) => padL + (index / Math.max(1, total - 1)) * (W - padL - padR);
  const y = (value: number) => padT + (1 - value / max) * (H - padT - padB);
  const line = (values: number[], offset = 0) =>
    values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index + offset).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  const historyPath = line(history);
  const forecastValues = [history[history.length - 1] ?? 0, ...points.map((point) => point.value)];
  const forecastPath = line(forecastValues, history.length - 1);
  const labels = story.forecast.labels;
  const boundary = history.length - 1;
  const area = `${historyPath} L${x(boundary).toFixed(1)} ${H - padB} L${x(0)} ${H - padB} Z`;

  return `<svg class="world-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(
    sv
      ? "Historisk efterfrågan och prognos sex månader framåt."
      : "Historical demand and a six-month forecast.",
  )}">
    <g class="world-chart-grid" aria-hidden="true">
      ${[0.25, 0.5, 0.75].map((p) => `<line x1="${padL}" y1="${(padT + p * (H - padT - padB)).toFixed(1)}" x2="${W - padR}" y2="${(padT + p * (H - padT - padB)).toFixed(1)}"/>`).join("")}
      <line class="world-chart-base" x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}"/>
      <line class="world-chart-now" x1="${x(boundary).toFixed(1)}" y1="${padT}" x2="${x(boundary).toFixed(1)}" y2="${H - padB}"/>
    </g>
    <path class="world-chart-area" d="${area}"/>
    <path class="world-chart-history" d="${historyPath}"/>
    <path class="world-chart-forecast" d="${forecastPath}"/>
    <circle class="world-chart-point" cx="${x(boundary).toFixed(1)}" cy="${y(history[boundary] ?? 0).toFixed(1)}" r="2.4"/>
    <g class="world-chart-labels" aria-hidden="true">
      <text x="${padL}" y="${H - 6}">${esc(labels[0] ?? "")}</text>
      <text x="${x(boundary).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(labels[boundary] ?? "")}</text>
      <text x="${W - padR}" y="${H - 6}" text-anchor="end">${esc(labels[labels.length - 1] ?? "")}</text>
    </g>
  </svg>`;
}

function forecastStep(story: Story, locale: Locale): string {
  const sv = locale === "sv";
  return `<div class="world-story-block world-forecast">
    <div class="world-chart-card">
      ${chart(story, locale)}
      <div class="world-chart-legend">
        <span data-kind="history">${esc(sv ? "Historik" : "History")}</span>
        <span data-kind="forecast">${esc(sv ? "Prognos 6 månader" : "Forecast 6 months")}</span>
      </div>
    </div>
  </div>`;
}

function decisionStep(story: Story, locale: Locale): string {
  const sv = locale === "sv";
  const t = (svText: string, enText: string) => (sv ? svText : enText);
  const order = story.decision.orders[0];
  if (!order) {
    return `<div class="world-story-block world-optimise"><p class="world-optimise-empty">${icon("check", 15)} ${esc(
      t("Inga akuta inköpsbehov just nu.", "No urgent purchase needs right now."),
    )}</p></div>`;
  }
  const before = order.coverBefore ?? 0;
  const after = order.coverAfter ?? 0;
  const scale = Math.max(1, before, after);
  const width = (value: number) => `${Math.max(3, Math.min(100, (value / scale) * 100)).toFixed(0)}%`;

  return `<div class="world-story-block world-optimise">
    <article class="world-order-card">
      <div class="world-order-top">
        <span class="world-order-kicker">${esc(t("Inköpsförslag", "Purchase proposal"))}</span>
        <span class="world-order-chip">${esc(t("Prioriterad", "Priority"))}</span>
      </div>
      <div class="world-order-product"><b>${esc(order.name)}</b><span class="mono">${esc(order.sku)}</span></div>
      <div class="world-order-impact">
        <div class="world-order-qty"><b class="mono">${num(locale, order.quantity)}</b><span>${esc(
          t("st att beställa", "units to order"),
        )}</span></div>
        <div class="world-cover">
          <div class="world-cover-row">
            <span>${esc(t("I dag", "Today"))}</span>
            <i aria-hidden="true"><b style="width:${width(before)}"></b></i>
            <em class="mono">${order.coverBefore === null ? "–" : `${num(locale, order.coverBefore)} ${t("d", "d")}`}</em>
          </div>
          <div class="world-cover-row" data-after="true">
            <span>${esc(t("Efter", "After"))}</span>
            <i aria-hidden="true"><b style="width:${width(after)}"></b></i>
            <em class="mono">${order.coverAfter === null ? "–" : `${num(locale, order.coverAfter)} ${t("d", "d")}`}</em>
          </div>
        </div>
      </div>
    </article>
    <p class="world-order-caption">${esc(
      t(
        "Ett representativt förslag. Hela inköpslistan finns i plattformen.",
        "One representative proposal. The full purchase list is in the platform.",
      ),
    )}</p>
  </div>`;
}

/** One section, four acts, one payload. */
export function worldSection({ locale, environments, metas }: WorldSectionInput): string {
  const sv = locale === "sv";
  const t = (svText: string, enText: string) => (sv ? svText : enText);
  const primary = environments[0]!;
  const poster = worldPoster(primary.scene, locale);
  const kpis = primary.kpis;

  const envButtons = environments
    .map((environment, index) => {
      const meta = metas.find((m) => m.id === environment.id);
      const label = meta ? (sv ? meta.industry : meta.industryEn) : environment.id;
      const full = meta ? (sv ? meta.title : meta.titleEn) : environment.id;
      return `<button class="world-env" type="button" data-world-env="${environment.id}" title="${esc(full)}" aria-pressed="${index === 0 ? "true" : "false"}"><span class="world-env-dot" aria-hidden="true"></span>${esc(label)}</button>`;
    })
    .join("");

  const kpiTiles = kpiRows(kpis, locale)
    .map(
      (row) =>
        `<div class="world-kpi" data-tone="${row.tone}"><span class="world-kpi-label">${esc(row.label)}</span><span class="world-kpi-value" data-world-kpi="${row.key}">${esc(row.value)}</span></div>`,
    )
    .join("");

  /** One story panel per environment, so a switch never mixes figures. */
  const storyPanels = (render: (story: Story) => string) =>
    environments
      .map(
        (environment, index) =>
          `<div class="world-story${index === 0 ? " is-active" : ""}" data-world-story="${environment.id}"${index === 0 ? "" : ' aria-hidden="true"'}>${render(environment.story)}</div>`,
      )
      .join("");

  const acts = [
    {
      no: "01",
      id: "import",
      title: t("Importera lagerdata.", "Import inventory data."),
      lead: t("CSV och XLSX omvandlas till analysunderlag.", "CSV and XLSX become analysis-ready data."),
      content: storyPanels((story) => importStep(story, locale)),
    },
    {
      no: "02",
      id: "analys",
      title: t("Förstå ditt lager.", "Understand your inventory."),
      lead: t(
        "Identifiera kapitalbindning, överlager och bristrisker.",
        "Identify tied-up capital, overstock and stockout risk.",
      ),
      content: `<div class="world-kpis" data-world-kpis>${kpiTiles}</div>${storyPanels((story) => analysisStep(story, locale))}`,
    },
    {
      no: "03",
      id: "prognos",
      title: t("Förutse efterfrågan.", "Forecast demand."),
      lead: t(
        "Analysera historik och uppskatta framtida lagerbehov.",
        "Analyse history and estimate future inventory needs.",
      ),
      content: storyPanels((story) => forecastStep(story, locale)),
    },
    {
      no: "04",
      id: "optimera",
      title: t("Optimera dina beslut.", "Optimise your decisions."),
      lead: t(
        "Få datadrivna rekommendationer för inköp och lager.",
        "Get data-driven recommendations for purchasing and stock.",
      ),
      content: storyPanels((story) => decisionStep(story, locale)),
    },
  ]
    .map(
      (act, index) => `<article class="world-act" id="varld-${act.id}" data-world-act="${index}">
      <p class="world-act-no">${act.no}</p>
      <h3 class="world-act-title">${esc(act.title)}</h3>
      <p class="world-act-lead">${esc(act.lead)}</p>
      ${act.content}
    </article>`,
    )
    .join("");

  return `<section class="world" id="varld" data-world aria-labelledby="world-title">
    <div class="world-head site-wrap">
      <p class="eyebrow eyebrow-light"><span class="eyebrow-mark" aria-hidden="true"></span>${esc(
        t("Demolagret", "The demo warehouse"),
      )}</p>
      <h2 id="world-title">${esc(t("Samma lagerdata hela vägen.", "One dataset, all the way through."))}</h2>
      <p class="world-lead">${esc(
        t(
          "Fyra steg, från exportfil till nästa inköpsbeslut.",
          "Four steps, from export file to the next purchasing decision.",
        ),
      )}</p>
      <div class="world-controls">
        <div class="world-envs" role="group" aria-label="${esc(t("Demomiljö", "Demo environment"))}">${envButtons}</div>
        <div class="world-modes">
          <button class="btn btn-sm" type="button" data-world-explore aria-pressed="false">${esc(
            t("Utforska", "Explore"),
          )}</button>
          <button class="btn btn-ghost btn-sm" type="button" data-world-exit hidden>${esc(t("Vanlig vy", "Exit explore"))}</button>
        </div>
      </div>
      <p class="world-status" data-world-status role="status" aria-live="polite">${esc(
        t(
          "Syntetisk demodata, inte verkliga kunddata",
          "Synthetic demo data, not real customer data",
        ),
      )}</p>
    </div>

    <div class="world-stage site-wrap" data-world-stage>
      <div class="world-view">
        <div class="world-canvas-wrap" data-world-viewport>
          ${poster}
          <canvas class="world-canvas" data-world-canvas aria-hidden="true" tabindex="-1"></canvas>
          <div class="world-overlay" aria-hidden="true">
            <div class="world-legend">
              <span data-status="overstock">${esc(t("Överlager", "Overstock"))}</span>
              <span data-status="stockout">${esc(t("Bristrisk", "Stockout risk"))}</span>
              <span data-status="inactive">${esc(t("Inaktivt", "Inactive"))}</span>
            </div>
            <div class="world-progress" aria-hidden="true"><span data-world-progress></span></div>
          </div>
          <div class="world-cam" role="group" aria-label="${esc(t("Kameravy", "Camera view"))}">
            <span class="world-cam-label" data-world-aisle>${esc(t("Översikt", "Overview"))}</span>
            <button class="world-cam-btn" type="button" data-world-row-prev aria-label="${esc(t("Föregående gång", "Previous aisle"))}">‹</button>
            <button class="world-cam-btn" type="button" data-world-row-next aria-label="${esc(t("Nästa gång", "Next aisle"))}">›</button>
            <button class="world-cam-btn" type="button" data-world-zoom-out aria-label="${esc(t("Zooma ut", "Zoom out"))}">−</button>
            <button class="world-cam-btn" type="button" data-world-zoom-in aria-label="${esc(t("Zooma in", "Zoom in"))}">+</button>
            <button class="world-cam-btn world-cam-reset" type="button" data-world-cam-reset>${esc(t("Kamera", "Camera"))}</button>
          </div>
          <p class="world-cam-hint">${esc(
            t(
              "Dra för att rotera · ⌘/Ctrl + scroll för zoom · skift-dra för att panorera",
              "Drag to orbit · ⌘/Ctrl + scroll to zoom · shift-drag to pan",
            ),
          )}</p>
          <p class="world-fallback" data-world-fallback hidden></p>
          <p class="world-toast" data-world-toast role="status" hidden></p>
          <div class="world-floor-nav"><button class="btn btn-ghost btn-sm" type="button" data-world-exit-2>${esc(
            t("Vanlig vy", "Exit explore"),
          )}</button></div>
        </div>
      </div>
      <div class="world-acts">${acts}</div>
    </div>

    <div class="world-final site-wrap">
      <h3>${esc(t("Vill du se vad som döljer sig bakom siffrorna?", "Want to see what is hiding behind the numbers?"))}</h3>
      <p>${esc(t("Utforska STOQWISE eller skapa ett konto.", "Explore STOQWISE or create an account."))}</p>
      <div class="world-final-actions">
        <a class="btn btn-mint" href="/produkt">${esc(t("Utforska STOQWISE", "Explore STOQWISE"))} ${icon("arrow", 14)}</a>
        <a class="btn btn-ghost" href="/skapa-konto">${esc(t("Skapa konto", "Create account"))}</a>
      </div>
    </div>

    <script type="application/json" data-world-data>${JSON.stringify(payload(environments)).replace(/</g, "\\u003c")}</script>
  </section>`;
}
