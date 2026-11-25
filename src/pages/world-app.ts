/**
 * 「Live Warehouse」 - the signed-in digital twin.
 *
 * The page is server-rendered and fully usable without WebGL: the table is the
 * accessible source of truth and the default on small screens or with reduced
 * motion. The 3D scene is a second rendering of the same rows, produced by the
 * layout engine (`ui/live-warehouse.ts`) so placements and statuses can never
 * disagree with the analysis.
 */
import type { AnalyzedItem } from "../analysis.ts";
import type { Role } from "../data/repo.ts";
import { appAction, appNum, appSek, appText } from "../i18n-app.ts";
import type { Locale } from "../i18n.ts";
import { icon, shell } from "../ui/base.ts";
import { buildSimulationInput, type SimulationRun } from "../ui/live-simulation.ts";
import { liveStatus } from "../ui/live-warehouse.ts";
import type { AppWorldModel } from "../world.ts";

const esc = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export interface AppWorldInput {
  locale: Locale;
  path: string;
  user: { id: string; name: string; email: string };
  org: { name: string; plan: string };
  role: Role;
  analysisId: string;
  monthLabel: string;
  months: number;
  items: AnalyzedItem[];
  kpis: {
    inventoryValue: number;
    skuCount: number;
    stockUnits: number;
    turns: number;
    daysOfInventory: number | null;
    overstockValue: number;
    overstockCount: number;
    stockoutRiskCount: number;
    stockoutRiskValue: number;
    deadStockCount: number;
    deadStockValue: number;
    potentialReleaseLow: number;
    potentialReleaseHigh: number;
  };
  model: AppWorldModel;
  categories: string[];
  serviceLevel: number;
  /** Precomputed aggregate playback for portfolios above the detail budget. */
  portfolioRun?: SimulationRun | null;
}

const statusLabel = (locale: Locale, status: string): string => {
  switch (status) {
    case "overstock":
      return appText(locale, "Överlager");
    case "stockout":
      return appText(locale, "Bristrisk");
    case "inactive":
      return appText(locale, "Inaktivt lager");
    case "all":
      return appText(locale, "Alla zoner");
    default:
      return appText(locale, "Balanserat");
  }
};

export interface AppWorldTableQuery {
  page?: number;
  sort?: string;
  dir?: string;
  category?: string;
  abc?: string;
  xyz?: string;
  status?: string;
  query?: string;
}

export interface AppWorldTableResult {
  html: string;
  pager: string;
  note: string;
  total: number;
  page: number;
  pages: number;
  sort: string;
  dir: "asc" | "desc";
}

/** Server-side table for the complete portfolio. The 300-row preview is gone:
 * filters, sorting and paging operate on every article the plan allows. */
export function appWorldTable(input: {
  items: AnalyzedItem[];
  locale: Locale;
  analysisId: string;
} & AppWorldTableQuery): AppWorldTableResult {
  const { items, locale, analysisId } = input;
  const t = (source: string, vars?: Record<string, string | number>): string => {
    let text = appText(locale, source);
    for (const [key, value] of Object.entries(vars ?? {})) text = text.replace(`{${key}}`, String(value));
    return text;
  };
  const num = (value: number, decimals = 0): string => appNum(locale, value, decimals);
  const money = (value: number): string => appSek(locale, value, true);
  const pageSize = 50;
  const sortable: Record<string, (item: AnalyzedItem) => string | number | null> = {
    sku: (item) => item.sku,
    name: (item) => item.name,
    category: (item) => item.category ?? appText(locale, "Utan kategori"),
    abc: (item) => `${item.abc}${item.xyz ?? ""}`,
    stock: (item) => item.stock,
    value: (item) => item.value,
    cover: (item) => item.coverDays,
    status: (item) => liveStatus(item),
    action: (item) => item.action,
  };
  const sort = input.sort && sortable[input.sort] ? input.sort : "value";
  const dir: "asc" | "desc" = input.dir === "asc" ? "asc" : input.dir === "desc" ? "desc" : "desc";
  const query = (input.query ?? "").trim().slice(0, 200).toLocaleLowerCase(locale === "sv" ? "sv-SE" : "en-US");
  const category = (input.category ?? "").slice(0, 120);
  const abc = (input.abc ?? "").slice(0, 3);
  const xyz = (input.xyz ?? "").slice(0, 3);
  const status = (input.status ?? "").slice(0, 24);
  const filtered = items.filter((item) => {
    const itemCategory = item.category ?? appText(locale, "Utan kategori");
    if (category && itemCategory !== category) return false;
    if (abc && item.abc !== abc) return false;
    if (xyz && (item.xyz ?? "") !== xyz) return false;
    if (status && liveStatus(item) !== status) return false;
    if (query && !`${item.sku} ${item.name} ${item.category ?? ""} ${item.supplier ?? ""}`.toLocaleLowerCase(locale === "sv" ? "sv-SE" : "en-US").includes(query)) return false;
    return true;
  });
  const accessor = sortable[sort]!;
  filtered.sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (av === null && bv === null) return a.sku.localeCompare(b.sku);
    if (av === null) return 1;
    if (bv === null) return -1;
    let result: number;
    if (typeof av === "number" && typeof bv === "number") result = av - bv;
    else result = String(av).localeCompare(String(bv), locale === "sv" ? "sv" : "en", { numeric: true });
    if (result === 0) result = a.sku.localeCompare(b.sku);
    return dir === "asc" ? result : -result;
  });
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pages, Math.max(1, Math.round(input.page ?? 1)));
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const html = rows.length
    ? rows
        .map((item) => {
          const sceneStatus = liveStatus(item);
          const itemCategory = item.category ?? appText(locale, "Utan kategori");
          return `<tr data-sku="${esc(item.sku)}" data-abc="${item.abc}" data-xyz="${item.xyz ?? ""}" data-status="${sceneStatus}" data-category="${esc(itemCategory)}">
        <td><a href="/app/artiklar/${encodeURIComponent(item.sku)}?analys=${encodeURIComponent(analysisId)}">${esc(item.name)}</a><br><span class="mono muted">${esc(item.sku)}</span></td>
        <td>${esc(itemCategory)}</td>
        <td class="mono">${item.abc}${item.xyz ?? "–"}</td>
        <td class="num" data-aw-stock="${esc(item.sku)}">${num(item.stock)}</td>
        <td class="num">${money(item.value)}</td>
        <td class="num">${item.coverDays === null ? "–" : num(item.coverDays)}</td>
        <td data-aw-status-cell><span class="status-dot" data-status="${sceneStatus}"></span>${esc(statusLabel(locale, sceneStatus))}</td>
        <td>${esc(appAction(locale, item.action))}</td>
        <td><button class="link-btn" type="button" data-world-focus="${esc(item.sku)}">${esc(t("Visa i 3D"))}</button></td>
      </tr>`;
        })
        .join("")
    : `<tr><td colspan="9">${esc(t("Inga artiklar matchar filtret."))}</td></tr>`;
  const from = filtered.length ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(filtered.length, page * pageSize);
  const note = filtered.length
    ? t("Visar {from}–{to} av {total} artiklar.", { from: num(from), to: num(to), total: num(filtered.length) })
    : t("Inga artiklar matchar filtret.");
  const pager = `<nav class="pagination aw-table-pager" aria-label="${esc(t("Sidnavigering"))}" data-aw-pager>
    <button class="page-link" type="button" data-aw-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>${esc(t("← Föregående"))}</button>
    <span class="page-status">${esc(t("Sida {page} av {pages}", { page, pages }))}</span>
    <button class="page-link" type="button" data-aw-page="${page + 1}" ${page >= pages ? "disabled" : ""}>${esc(t("Nästa →"))}</button>
  </nav>`;
  return { html, pager, note, total: filtered.length, page, pages, sort, dir };
}

const MODES: Array<{ id: string; sv: string; en: string }> = [
  { id: "physical", sv: "Fysiskt lager", en: "Physical" },
  { id: "heatmap", sv: "Kapital", en: "Capital heat" },
  { id: "abc", sv: "ABC / XYZ", en: "ABC / XYZ" },
  { id: "overstock", sv: "Överlager", en: "Overstock" },
  { id: "stockout", sv: "Bristrisk", en: "Stockout" },
  { id: "demand", sv: "Efterfrågan", en: "Demand" },
  { id: "replenish", sv: "Påfyllning", en: "Replenishment" },
];

const zoneLabel = (locale: Locale, zone: string): string => {
  switch (zone) {
    case "all":
      return appText(locale, "Alla zoner");
    case "inactive":
      return appText(locale, "Inaktivt lager");
    case "inbound":
      return appText(locale, "Inleverans");
    case "storage":
      return appText(locale, "Lagring");
    case "picking":
      return appText(locale, "Plockzon");
    case "packing":
      return appText(locale, "Packning");
    case "outbound":
      return appText(locale, "Utlastning");
    default:
      return appText(locale, "Alla zoner");
  }
};

export function appWorldPage(input: AppWorldInput): string {
  const { locale, items, kpis, model } = input;
  const t = (source: string, vars?: Record<string, string | number>): string => {
    let text = appText(locale, source);
    for (const [key, value] of Object.entries(vars ?? {})) text = text.replace(`{${key}}`, String(value));
    return text;
  };
  const sv = locale === "sv";
  const money = (value: number): string => appSek(locale, value, true);
  const num = (value: number, decimals = 0): string => appNum(locale, value, decimals);

  const table = appWorldTable({ items, locale, analysisId: input.analysisId });
  const sortTh = (key: string, label: string, numeric = false): string => {
    const active = table.sort === key;
    const icon = active ? (table.dir === "asc" ? "↑" : "↓") : "↕";
    return `<th ${numeric ? 'class="num"' : ""} data-aw-sort-th="${key}" aria-sort="${active ? (table.dir === "asc" ? "ascending" : "descending") : "none"}"><button class="aw-sort" type="button" data-aw-sort="${key}" title="${esc(t("Sortera"))}">${esc(label)} <span data-aw-sort-icon aria-hidden="true">${icon}</span></button></th>`;
  };

  const categoryOptions = [...new Set(items.map((item) => item.category ?? appText(locale, "Utan kategori")))]
    .sort((a, b) => a.localeCompare(b))
    .map((category) => `<option value="${esc(category)}">${esc(category)}</option>`)
    .join("");

  const kpiTiles = [
    { key: "inventoryValue", label: t("Lagervärde"), hint: t("Saldo × inköpspris"), value: money(kpis.inventoryValue), tone: "neutral" },
    { key: "turns", label: t("Lageromsättning"), hint: t("Årlig varukostnad / lagervärde"), value: `${num(kpis.turns, 2)} ${t("ggr/år")}`, tone: "neutral" },
    { key: "overstockValue", label: t("Överlager"), hint: t("Värde över ledtid + 30 dagars behov"), value: money(kpis.overstockValue), tone: "warning" },
    { key: "stockoutRiskCount", label: t("Bristrisk"), hint: t("Artiklar med kortare täckning än ledtid"), value: `${num(kpis.stockoutRiskCount)} ${t("artiklar")}`, tone: "critical" },
    { key: "potentialReleaseLow", label: t("Frigjort kapital"), hint: t("Möjligt vid realisering, intervall"), value: `${money(kpis.potentialReleaseLow)}–${money(kpis.potentialReleaseHigh)}`, tone: "good" },
  ]
    .map(
      (tile) => `<div class="aw-kpi" data-tone="${tile.tone}"><span title="${esc(tile.hint)}">${esc(tile.label)}</span><b data-app-kpi="${tile.key}">${esc(tile.value)}</b></div>`,
    )
    .join("");

  const modeButtons = MODES.map(
    (mode, index) =>
      `<button class="aw-mode" type="button" role="tab" aria-selected="${index === 0 ? "true" : "false"}" data-aw-mode="${mode.id}">${esc(sv ? mode.sv : mode.en)}</button>`,
  ).join("");

  const modeNotes: Record<string, string> = {
    physical: sv
      ? "Fysisk struktur: ställ, pallar och zoner. Färg = lagerstatus, mönster = XYZ, fyllnad = saldo."
      : "Physical structure: racks, pallets and zones. Colour = status, pattern = XYZ, fill = stock.",
    heatmap: sv
      ? "Kapitalbindning per pallplats. Staplarnas höjd och färg visar lagervärde; lagerhastigheten syns i gångarna."
      : "Capital tied up per slot. Column height and colour show inventory value; turns are visible per aisle.",
    abc: sv
      ? "ABC styr placering: A närmast utlastning, C längst bort. XYZ syns som ytmönster på pallen."
      : "ABC drives placement: A nearest dispatch, C farthest away. XYZ is the surface pattern on each pallet.",
    overstock: sv
      ? "Endast överlager visas. Övriga artiklar tonas bort så att kapitalet i överlager blir synligt."
      : "Only overstock is shown. Everything else is removed so the tied-up capital is visible.",
    stockout: sv
      ? "Endast bristrisk visas. Pulserande ringar markerar artiklar som täcker kortare tid än ledtiden."
      : "Only stockout risk is shown. Pulsing rings mark articles covering less than their lead time.",
    demand: sv
      ? "Utflödet styrs av faktisk månadsförsäljning. Varje låda är en plockad enhet, inte en animation utan data."
      : "Outbound flow follows actual monthly sales. Every carton is a picked unit, not decoration.",
    replenish: sv
      ? "Påfyllningsbehov: artiklar under beställningspunkt eller med kortare täckning än ledtid. Fyren visar var."
      : "Replenishment needs: articles below reorder point or with less cover than lead time. Beacons show where.",
  };

  const replenishment = model.replenishment
    .map((entry) => {
      const reason =
        entry.reason === "empty"
          ? t("Slut i lager")
          : entry.reason === "below_reorder"
            ? t("Under beställningspunkt")
            : t("Kortare täckning än ledtid");
      return `<li><button type="button" class="aw-replenish" data-world-focus="${esc(entry.sku)}">
        <span class="aw-replenish-name">${esc(entry.name)}<em>${esc(entry.sku)}</em></span>
        <span class="aw-replenish-qty">+${num(entry.qty)}</span>
        <span class="aw-replenish-why">${esc(reason)}</span>
      </button></li>`;
    })
    .join("");

  const simArticleOptions = [...items]
    .sort((a, b) => b.value - a.value)
    .slice(0, 80)
    .map((item) => `<option value="${esc(item.sku)}">${esc(item.name)} · ${esc(item.sku)}</option>`)
    .join("");

  // One compact status line. A segment with a zero count (pick faces in the
  // cluster view) is omitted instead of printed as "0 platser".
  const liveLine = [
    `${num(model.summary.articles)} ${sv ? "artiklar" : "items"}`,
    `${num(model.summary.pallets)} ${sv ? "pallar" : "pallets"}`,
    model.mode === "hierarchical"
      ? `${num(model.summary.clusters)} ${sv ? "zoner" : "zones"}`
      : `${num(model.summary.aisles)} ${sv ? "gångar" : "aisles"}`,
    ...(model.summary.pickFaces > 0
      ? [`${num(model.summary.pickFaces)} ${sv ? "platser" : "pick faces"}`]
      : []),
  ].join(" · ");

  const aggregated = model.mode === "hierarchical";

  const payload = {
    mode: model.mode,
    portfolio: input.portfolioRun ?? null,
    limit: model.limit,
    technicalCapacity: model.technicalCapacity,
    locale,
    floor: model.floor,
    zones: model.zones,
    frames: model.frames,
    picks: model.picks,
    slots: model.slots,
    blocks: model.blocks,
    replenishment: model.replenishment,
    summary: model.summary,
    analysisId: input.analysisId,
    // The layout is derived from stock/turnover, not from verified physical
    // coordinates. The UI states this instead of implying real bin locations.
    locationBasis: "simulated",
    modeNotes,
    // Below the detail budget the browser runs the exact engine on this
    // snapshot. Above it the server precomputed the portfolio run in
    // `portfolio`, so 500k rows never have to be shipped or stepped in the DOM.
    simulation: aggregated ? null : buildSimulationInput(model, items, input.analysisId),
  };

  const content = `<div class="aw" data-app-world data-mode="physical" data-view="3d" data-analysis="${esc(input.analysisId)}" data-visible-rows="${table.total}" ${aggregated ? 'data-portfolio="1"' : ""}>
    <div class="aw-head">
      <div>
        <p class="aw-live"><span class="aw-live-dot" aria-hidden="true"></span>${esc(liveLine)}
          <span class="aw-basis" title="${esc(sv ? "Placeringarna är beräknade ur artikeldata. Verifierade fysiska lagerkoordinater saknas." : "Placements are derived from the item data. No verified physical coordinates are stored.")}">${esc(sv ? "Simulerad placering" : "Simulated layout")}</span>
        </p>
      </div>
      <div class="aw-view-toggle" role="group" aria-label="${esc(t("Vy"))}">
        <button class="btn btn-sm" type="button" data-aw-view="3d" aria-pressed="true">3D</button>
        <button class="btn btn-ghost btn-sm" type="button" data-aw-view="table" aria-pressed="false">${esc(t("Tabell"))}</button>
      </div>
    </div>

    <div class="aw-modes" role="tablist" aria-label="${esc(t("Visualiseringsläge"))}">
      ${modeButtons}
      <button class="aw-info" type="button" data-aw-help aria-expanded="false" aria-controls="aw-mode-note" title="${esc(t("Vad visar läget?"))}" aria-label="${esc(t("Vad visar läget?"))}">i</button>
    </div>
    <p class="aw-mode-note" id="aw-mode-note" data-aw-mode-note hidden>${esc(modeNotes.physical ?? "")}</p>

    <div class="aw-kpis">${kpiTiles}</div>

    <div class="aw-chips" role="group" aria-label="${esc(t("Snabbfilter"))}">
      <button class="aw-chip is-on" type="button" data-aw-quick="">${esc(t("Alla"))}</button>
      <button class="aw-chip" type="button" data-aw-quick="overstock">${esc(t("Överlager"))}</button>
      <button class="aw-chip" type="button" data-aw-quick="stockout">${esc(t("Bristrisk"))}</button>
      <button class="aw-chip" type="button" data-aw-quick="inactive">${esc(t("Inaktiva"))}</button>
      <span class="aw-chip-note" data-aw-visible-note></span>
    </div>

    <form class="filterbar aw-filters" data-aw-filters>
      <div class="form-row"><label for="aw-cat">${esc(t("Kategori"))}</label>
        <select id="aw-cat" data-aw-filter="category"><option value="">${esc(t("Alla"))}</option>${categoryOptions}</select></div>
      <div class="form-row"><label for="aw-abc">ABC</label>
        <select id="aw-abc" data-aw-filter="abc"><option value="">${esc(t("Alla"))}</option><option>A</option><option>B</option><option>C</option></select></div>
      <div class="form-row"><label for="aw-xyz">XYZ</label>
        <select id="aw-xyz" data-aw-filter="xyz"><option value="">${esc(t("Alla"))}</option><option>X</option><option>Y</option><option>Z</option></select></div>
      <div class="form-row"><label for="aw-status">${esc(t("Status"))}</label>
        <select id="aw-status" data-aw-filter="status"><option value="">${esc(t("Alla"))}</option>
          <option value="overstock">${esc(statusLabel(locale, "overstock"))}</option>
          <option value="stockout">${esc(statusLabel(locale, "stockout"))}</option>
          <option value="inactive">${esc(statusLabel(locale, "inactive"))}</option>
          <option value="balanced">${esc(statusLabel(locale, "balanced"))}</option></select></div>
      <div class="form-row grow"><label for="aw-search">${esc(t("Sök artikel"))}</label>
        <input id="aw-search" type="search" autocomplete="off" placeholder="${esc(t("Namn eller SKU"))}" data-aw-search></div>
      <button class="btn btn-ghost btn-sm" type="reset" data-aw-reset>${esc(t("Rensa"))}</button>
    </form>
    <div class="aw-search-results" data-aw-search-results hidden aria-live="polite"></div>

    <div class="aw-stage">
      <div class="aw-canvas-wrap" data-aw-viewport>
        <div class="aw-skeleton skeleton" data-aw-skeleton aria-hidden="true"></div>
        <canvas class="aw-canvas" data-aw-canvas tabindex="0" aria-label="${esc(sv ? "3D-vy av lagret. Piltangenter roterar, plus och minus zoomar, 0 återställer kameran." : "3D warehouse view. Arrow keys rotate, plus and minus zoom, 0 resets the camera.")}"></canvas>

        <div class="aw-overlay aw-overlay-top">
          <div class="aw-sim" role="group" aria-label="${esc(t("Simulering"))}" ${model.mode === "hierarchical" ? "hidden" : ""}>
            <button class="aw-sim-btn" type="button" data-aw-play aria-pressed="false" title="${esc(t("Spela upp flödet"))}">${icon("play", 14)}<span>${esc(t("Spela"))}</span></button>
            <button class="aw-sim-btn" type="button" data-aw-sim-reset title="${esc(t("Återställ saldo och tid"))}">${icon("reset", 14)}<span>${esc(t("Återställ"))}</span></button>
          </div>
          <div class="aw-zones" role="group" aria-label="${esc(t("Zoner"))}">
            ${["all", "inbound", "storage", "picking", "packing", "outbound", "inactive"]
              .map((zone) => `<button type="button" class="aw-zone" data-aw-zone="${zone}">${esc(zoneLabel(locale, zone))}</button>`)
              .join("")}
          </div>
        </div>

        <div class="aw-overlay aw-overlay-bottom">
          <div class="aw-legend" data-aw-legend>
            <span class="aw-legend-group">
              <span><i class="aw-dot" data-tone="balanced"></i>${esc(t("Balanserat"))}</span>
              <span><i class="aw-dot" data-tone="overstock"></i>${esc(t("Överlager"))}</span>
              <span><i class="aw-dot" data-tone="stockout"></i>${esc(t("Bristrisk"))}</span>
              <span><i class="aw-dot" data-tone="inactive"></i>${esc(t("Inaktivt"))}</span>
            </span>
            <span class="aw-legend-group" title="${esc(t("Ytmönster visar XYZ: slät, streckad eller prickad"))}">
              <span class="aw-legend-title">XYZ</span>
              <span><i class="aw-pattern" data-pattern="smooth"></i>X</span>
              <span><i class="aw-pattern" data-pattern="striped"></i>Y</span>
              <span><i class="aw-pattern" data-pattern="dotted"></i>Z</span>
            </span>
            <span class="aw-legend-group" title="${esc(t("Pallens fyllnadsgrad visar saldo"))}">
              <span class="aw-legend-title">${esc(t("Fyllnad"))}</span>
              <span class="aw-fill"><i style="--fill:18%"></i><i style="--fill:62%"></i><i style="--fill:100%"></i></span>
            </span>
          </div>
          <div class="aw-controls">
            <p class="aw-hint" data-aw-hint>${esc(
              sv ? "Dra för att rotera · scroll för att zooma · shift-dra för att panorera" : "Drag to orbit · scroll to zoom · shift-drag to pan",
            )}</p>
            <p class="aw-axis-hint">A → ${esc(t("nära utlastning"))} · C → ${esc(t("längst bort"))}</p>
            <div class="aw-cam" role="group" aria-label="${esc(t("Kamera"))}">
              <span class="aw-aisle" data-aw-aisle aria-live="polite">${esc(sv ? "Översikt" : "Overview")}</span>
              <button class="aw-cam-btn" type="button" data-aw-aisle-prev title="${esc(sv ? "Föregående gång" : "Previous aisle")}" aria-label="${esc(sv ? "Föregående gång" : "Previous aisle")}">‹</button>
              <button class="aw-cam-btn" type="button" data-aw-aisle-next title="${esc(sv ? "Nästa gång" : "Next aisle")}" aria-label="${esc(sv ? "Nästa gång" : "Next aisle")}">›</button>
              <button class="aw-cam-btn" type="button" data-aw-zoom-out title="${esc(sv ? "Zooma ut" : "Zoom out")}" aria-label="${esc(sv ? "Zooma ut" : "Zoom out")}">−</button>
              <button class="aw-cam-btn" type="button" data-aw-zoom-in title="${esc(sv ? "Zooma in" : "Zoom in")}" aria-label="${esc(sv ? "Zooma in" : "Zoom in")}">+</button>
              <button class="aw-cam-btn aw-cam-reset" type="button" data-aw-cam-reset title="${esc(sv ? "Återställ kameran" : "Reset camera")}">${icon("reset", 13)}<span>${esc(sv ? "Kamera" : "Camera")}</span></button>
            </div>
          </div>
        </div>
      </div>

      <aside class="aw-panel" data-aw-panel aria-live="polite">
        <div class="aw-panel-head">
          <p class="eyebrow" data-aw-panel-status>${esc(sv ? "Artikel" : "Item")}</p>
          <h2 data-aw-panel-name>${esc(t("Välj en artikel"))}</h2>
          <p class="mono muted" data-aw-panel-sku>${esc(t("Klicka på en pall eller en rad i tabellen."))}</p>
        </div>

        <div data-aw-panel-body hidden>
          <dl class="aw-panel-facts">
            <div><dt>${esc(t("Kategori"))}</dt><dd data-aw-panel-category>–</dd></div>
            <div><dt>${esc(t("Leverantör"))}</dt><dd data-aw-panel-supplier>–</dd></div>
            <div><dt>ABC / XYZ</dt><dd data-aw-panel-class>–</dd></div>
            <div><dt>${esc(t("Placering"))}</dt><dd data-aw-panel-location>–</dd></div>
            <div><dt>${esc(t("Pallplatser"))}</dt><dd data-aw-panel-pallets>–</dd></div>
            <div><dt>${esc(t("Pallfyllnad"))}</dt><dd data-aw-panel-fill>–</dd></div>
            <div><dt>${esc(t("Saldo"))}</dt><dd data-aw-panel-stock>–</dd></div>
            <div><dt>${esc(t("Tillgängligt"))}</dt><dd data-aw-panel-available>–</dd></div>
            <div><dt>${esc(t("Lagervärde"))}</dt><dd data-aw-panel-value>–</dd></div>
            <div><dt>${esc(t("Inköpspris"))}</dt><dd data-aw-panel-cost>–</dd></div>
            <div><dt>${esc(t("Försäljningspris"))}</dt><dd data-aw-panel-price>–</dd></div>
            <div><dt>${esc(t("Marginal"))}</dt><dd data-aw-panel-margin>–</dd></div>
            <div><dt>${esc(t("Täckning"))}</dt><dd data-aw-panel-cover>–</dd></div>
            <div><dt>${esc(t("Beställningspunkt"))}</dt><dd data-aw-panel-reorder>–</dd></div>
            <div><dt>${esc(t("Överlager"))}</dt><dd data-aw-panel-overstock>–</dd></div>
            <div><dt>${esc(t("Snitt/månad"))}</dt><dd data-aw-panel-demand>–</dd></div>
          </dl>
          <p class="aw-panel-basis">${esc(
            sv
              ? "Placeringen är simulerad ur artikeldata. Verifierade fysiska lagerkoordinater finns inte."
              : "The placement is simulated from item data. No verified physical warehouse coordinates exist.",
          )}</p>

          <div class="aw-spark">
            <div class="aw-spark-head"><span>${esc(t("Efterfrågan, 12 mån"))}</span><b data-aw-panel-trend>–</b></div>
            <svg viewBox="0 0 220 46" preserveAspectRatio="none" role="img" aria-label="${esc(t("Månadsförsäljning"))}" data-aw-panel-spark></svg>
          </div>

          <div class="aw-panel-reco">
            <span>${esc(t("Rekommenderad åtgärd"))}</span>
            <strong data-aw-panel-action>–</strong>
          </div>
          <p class="aw-panel-why" data-aw-panel-why>–</p>

          <div class="aw-panel-actions">
            <a class="btn btn-sm" data-aw-panel-open href="#">${esc(t("Öppna artikeln"))}</a>
            <button class="btn btn-ghost btn-sm" type="button" data-aw-panel-focus>${esc(t("Zooma hit"))}</button>
          </div>
        </div>

                  <div class="aw-replenish-block">
          <h3>${esc(t("Påfyllningsbehov"))}</h3>
          ${replenishment ? `<ul class="aw-replenish-list">${replenishment}</ul>` : `<p class="aw-empty-note">${esc(t("Inget påfyllningsbehov i den här analysen."))}</p>`}
        </div>
      </aside>
    </div>

    <section class="aw-sim-engine" data-aw-sim-engine aria-labelledby="aw-sim-title">
      <div class="aw-sim-top">
        <div>
          <h2 id="aw-sim-title">${esc(t("Simulerad dag"))} <b data-aw-day>0</b> <span class="muted">/ <span data-aw-days-out>90</span></span>
            <span class="aw-sim-safe" title="${esc(sv ? "Simuleringen ändrar aldrig importerade saldon." : "The simulation never changes imported balances.")}">${esc(sv ? "påverkar inte lagret" : "does not affect stock")}</span>
            ${aggregated ? `<span class="aw-sim-mode" title="${esc(sv ? "Alla artiklar ingår i summorna. 3D visar zoner och flöden." : "Every item is included in the totals. The 3D view shows zones and flows.")}">${esc(sv ? "Aggregerad" : "Aggregated")}</span>` : ""}</h2>
          <p class="aw-sim-date"><span data-aw-date>${esc("2026-11-01")}</span></p>
        </div>
        <div class="aw-sim-controls">
          <button class="aw-sim-btn" type="button" data-aw-play aria-pressed="false">${icon("play", 14)}<span>${esc(t("Spela"))}</span></button>
          <button class="aw-sim-btn" type="button" data-aw-sim-reset>${icon("reset", 14)}<span>${esc(t("Återställ"))}</span></button>
          <label><span>${esc(t("Hastighet"))}</span>
            <select data-aw-speed><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option></select>
          </label>
          <label><span>${esc(t("Period"))}</span>
            <select data-aw-days><option value="30">30 ${esc(t("dagar"))}</option><option value="90" selected>90 ${esc(t("dagar"))}</option><option value="180">180 ${esc(t("dagar"))}</option></select>
          </label>
          <label><span>${esc(t("Typ"))}</span>
            <select data-aw-preset>
              <option value="normal">${esc(t("Normal drift"))}</option>
              <option value="peak">${esc(t("Efterfrågetopp"))}</option>
              <option value="supply">${esc(t("Leveransstörning"))}</option>
              <option value="stress">${esc(t("Stresscenario"))}</option>
              <option value="custom">${esc(t("Anpassat"))}</option>
            </select>
          </label>
        </div>
      </div>

      <div class="aw-sim-track">
        <div class="aw-sim-progress"><span data-aw-progress></span></div>
        <label class="sr-only" for="aw-scrub">${esc(t("Simulerad dag"))}</label>
        <input id="aw-scrub" type="range" min="0" max="90" step="1" value="0" data-aw-scrub>
      </div>

      <dl class="aw-sim-metrics">
        <div><dt>${esc(t("Lager i simuleringen"))}</dt><dd data-aw-metric="onHand">–</dd></div>
        <div><dt>${esc(t("In idag"))}</dt><dd data-aw-metric="inbound">–</dd></div>
        <div><dt>${esc(t("Ut idag"))}</dt><dd data-aw-metric="outbound">–</dd></div>
        <div><dt>${esc(t("Öppna ordrar"))}</dt><dd data-aw-metric="orders">–</dd></div>
        ${aggregated ? "" : `<div><dt>${esc(t("Förväntade leveranser"))}</dt><dd data-aw-metric="expected">–</dd></div>`}
        <div><dt>${esc(t("Bristrisk"))}</dt><dd data-aw-metric="risk">–</dd></div>
        <div><dt>${esc(t("Överlager"))}</dt><dd data-aw-metric="overstock">–</dd></div>
        <div><dt>${esc(t("Kapitalbindning"))}</dt><dd data-aw-metric="capital">–</dd></div>
        ${aggregated ? "" : `<div><dt>${esc(t("Beställningsbehov"))}</dt><dd data-aw-metric="purchase">–</dd></div>`}
      </dl>

      <div class="aw-sim-lower">
        <div class="aw-event-panel">
          <header>
            <h3>${esc(sv ? "Simulerade händelser" : "Simulated events")}</h3>
            <span class="aw-event-count" data-aw-event-count>0</span>
            <button type="button" class="aw-event-follow" data-aw-follow>${esc(sv ? "Följ senaste" : "Follow latest")}</button>
          </header>
          <ol class="aw-events" data-aw-events aria-live="polite">
            <li class="aw-events-empty">${esc(sv ? "Starta simuleringen för att följa in- och utflöden." : "Start the simulation to follow inbound and outbound flows.")}</li>
          </ol>
        </div>
        <div class="aw-sim-support">
          <h3>${esc(sv ? "Beslutsstöd · simulering" : "Decision support · simulation")}</h3>
          <div><h4>${esc(t("Bristrisk"))}</h4><ul data-aw-support="risk"><li class="muted">–</li></ul></div>
          <div><h4>${esc(t("Överlager"))}</h4><ul data-aw-support="overstock"><li class="muted">–</li></ul></div>
          <div><h4>${esc(sv ? "Beställningsbehov · största poster" : "Purchase need · largest items")}</h4><ul data-aw-support="purchase"><li class="muted">–</li></ul></div>
        </div>
      </div>
    </section>

    <details class="aw-tune" data-aw-tune>
      <summary>${esc(t("Anpassa scenario"))} <span class="aw-tune-note">${esc(sv ? "påverkar inte lagret" : "does not affect stock")}</span></summary>
      <form class="aw-scenario-form" data-aw-scenario-form>
        <label class="aw-slider"><span>${esc(t("Efterfrågan"))} <b data-aw-sc-demand-out>±0 %</b></span>
          <input type="range" min="-20" max="50" step="5" value="0" data-aw-sc-demand></label>
        <label class="aw-slider"><span>${esc(t("Leveranstid"))} <b data-aw-sc-lead-out>+0 ${esc(t("dagar"))}</b></span>
          <input type="range" min="-5" max="15" step="1" value="0" data-aw-sc-lead></label>
        <label class="aw-slider"><span>${esc(t("Säkerhetslager"))} <b data-aw-sc-safety-out>+0 %</b></span>
          <input type="range" min="0" max="100" step="10" value="0" data-aw-sc-safety></label>
        <label class="aw-slider"><span>MOQ <b data-aw-sc-moq-out>±0 %</b></span>
          <input type="range" min="-50" max="100" step="10" value="0" data-aw-sc-moq></label>
        <label class="aw-slider"><span>${esc(t("Extra försäljning"))} <b data-aw-sc-boost-out>0 %</b></span>
          <input type="range" min="0" max="100" step="10" value="0" data-aw-sc-boost></label>
        <label class="aw-select"><span>${esc(t("Artikel för extra försäljning"))}</span>
          <select data-aw-sc-sku><option value="">${esc(t("Ingen"))}</option>${simArticleOptions}</select></label>
        <label class="aw-check"><input type="checkbox" data-aw-sc-delay> <span>${esc(t("Försena leveranser"))}</span></label>
        <div class="aw-scenario-actions">
          <button class="btn btn-sm" type="submit" data-aw-sc-apply>${esc(t("Kör scenario"))}</button>
          <button class="btn btn-ghost btn-sm" type="button" data-aw-sc-reset>${esc(t("Nollställ"))}</button>
        </div>
      </form>
    </details>

    <section class="aw-whatif" data-aw-whatif>
      <div>
        <h2>${esc(t("Tänk om"))}</h2>
        <p class="aw-temp">${esc(sv ? "Tillfällig beräkning. Inget sparas." : "Temporary calculation. Nothing is saved.")}</p>
      </div>
      <form class="aw-whatif-form" data-aw-whatif-form>
        <label class="aw-slider"><span>${esc(t("Leveranstid"))} <b data-aw-lead-out>±0</b> ${esc(t("dagar"))}</span>
          <input type="range" min="-10" max="20" step="1" value="0" data-aw-lead></label>
        <label class="aw-slider"><span>${esc(t("Servicenivå"))} <b data-aw-service-out>${Math.round(input.serviceLevel * 100)} %</b></span>
          <input type="range" min="0" max="3" step="1" value="${Math.max(0, [0.9, 0.95, 0.98, 0.99].indexOf(input.serviceLevel))}" data-aw-service></label>
        <label class="aw-slider"><span>${esc(t("Efterfrågan"))} <b data-aw-demand-out>±0 %</b></span>
          <input type="range" min="-30" max="30" step="5" value="0" data-aw-demand></label>
        <div class="aw-whatif-out">
          <div><span>${esc(t("Överlagervärde"))}</span><b data-aw-out="overstockValue">${money(kpis.overstockValue)}</b></div>
          <div><span>${esc(t("Riskerad försäljning"))}</span><b data-aw-out="stockoutRiskValue">${money(kpis.stockoutRiskValue)}</b></div>
          <div><span>${esc(t("Frigjort kapital"))}</span><b data-aw-out="potentialReleaseLow">${money(kpis.potentialReleaseLow)}–${money(kpis.potentialReleaseHigh)}</b></div>
        </div>
        <p class="aw-delta" data-aw-delta>${esc(sv ? "Oförändrat mot den importerade analysen." : "Unchanged from the imported analysis.")}</p>
        <button class="btn btn-ghost btn-sm" type="reset" data-aw-whatif-reset>${esc(t("Återställ"))}</button>
      </form>
    </section>

    <section class="aw-table-wrap" id="aw-tabell">
      <div class="aw-table-head">
        <h2>${esc(t("Tabellvy"))}</h2>
      </div>
      <div class="table-wrap">
        <table class="data-table aw-table">
          <thead><tr>
            ${sortTh("name", t("Artikel"))}${sortTh("category", t("Kategori"))}${sortTh("abc", "ABC / XYZ")}
            ${sortTh("stock", t("Saldo"), true)}${sortTh("value", t("Lagervärde"), true)}
            ${sortTh("cover", t("Täckning (d)"), true)}
            ${sortTh("status", t("Status"))}${sortTh("action", t("Åtgärd"))}<th></th>
          </tr></thead>
          <tbody data-aw-rows>${table.html}</tbody>
        </table>
      </div>
      <div class="aw-table-footer">
        <p class="muted aw-table-note" data-aw-table-note role="status" aria-live="polite">${esc(table.note)} <a href="/app/artiklar?analys=${encodeURIComponent(input.analysisId)}&sort=value">${esc(t("Öppna Lager"))}</a></p>
        ${table.pager}
      </div>
    </section>

    <script type="application/json" data-aw-data>${JSON.stringify(payload).replace(/</g, "\\u003c")}</script>
  </div>`;

  return shell({
    locale,
    user: input.user,
    org: input.org,
    role: input.role,
    active: "world",
    title: t("Live Warehouse"),
    subtitle: esc(sv ? "Digital tvilling · lager, flöden och simulering i samma vy" : "Digital twin · stock, flows and simulation in one view"),
    path: input.path,
    actions: `<a class="btn btn-ghost btn-sm" href="/app/artiklar?analys=${encodeURIComponent(input.analysisId)}">${esc(t("Öppna Lager"))} ${icon("arrow", 14)}</a>`,
    content,
  });
}

/** The recommendation as a verb phrase, in the reader's language. */
export function itemActionLabel(item: AnalyzedItem, locale: Locale): string {
  return appAction(locale, item.action);
}

/** Small helper for the article endpoint: the "why" behind the recommendation. */
export function itemWhy(item: AnalyzedItem, locale: Locale): string {
  const sv = locale === "sv";
  const parts: string[] = [];
  if (item.stockoutRisk) {
    parts.push(
      sv
        ? `Täcker ${Math.max(0, Math.round(item.coverDays ?? 0))} dagar mot ${item.leadTimeDays} dagars ledtid`
        : `Covers ${Math.max(0, Math.round(item.coverDays ?? 0))} days against a ${item.leadTimeDays}-day lead time`,
    );
  }
  if (item.overstockQty > 0) {
    parts.push(
      sv
        ? `Överlager ${Math.round(item.overstockQty)} enheter (${appSek(locale, item.overstockValue, true)})`
        : `Overstock of ${Math.round(item.overstockQty)} units (${appSek(locale, item.overstockValue, true)})`,
    );
  }
  if (item.monthsSinceLastSale !== null && item.monthsSinceLastSale >= 6) {
    parts.push(
      sv
        ? `Ingen försäljning på ${Math.round(item.monthsSinceLastSale)} månader`
        : `No sales for ${Math.round(item.monthsSinceLastSale)} months`,
    );
  }
  if (!parts.length) {
    parts.push(
      sv
        ? `Balanserat lager: ${appNum(locale, item.stock, 0)} enheter, ${appNum(locale, item.avgMonthlyDemand, 0)} i snitt per månad`
        : `Balanced stock: ${appNum(locale, item.stock, 0)} units, ${appNum(locale, item.avgMonthlyDemand, 0)} average per month`,
    );
  }
  return parts.join(" · ");
}
