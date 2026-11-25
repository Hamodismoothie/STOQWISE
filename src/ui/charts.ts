import { appText } from "../i18n-app.ts";
import type { Locale } from "../i18n.ts";
/**
 * Charts.
 *
 * Hand-built SVG, no chart library. Reasons: the visuals need to match the
 * product's own visual language, everything must render server-side (no hydration
 * step), and every chart has to work without JavaScript. Interaction is layered
 * on top with a small progressive-enhancement script.
 *
 * Conventions shared by all charts:
 *   - numbers are passed in already computed, never derived here
 *   - every chart has a <title> and aria-label so it is readable by a screen reader
 *   - geometry uses viewBox + preserveAspectRatio so it scales with the container
 *   - colour comes from CSS variables, so light/dark both work
 */
import { formatNumber } from "../analysis.ts";
import { DISPLAY, foldTail } from "../tuning.ts";

const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export interface Point {
  label: string;
  value: number;
}

const fmt = (n: number): string => formatNumber(n, 0);

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const scaled = value / base;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * base;
}

/* --------------------------------------------------------------- sparkline */

export function sparkline(values: number[], options: { width?: number; height?: number; tone?: string } = {}): string {
  const w = options.width ?? 120;
  const h = options.height ?? 28;
  if (values.length < 2) return `<span class="spark-empty" aria-hidden="true"></span>`;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = w / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(2)},${(h - ((v - min) / range) * (h - 4) - 2).toFixed(2)}`).join(" ");
  return `<svg class="spark ${options.tone ?? ""}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

/* ------------------------------------------------------- line with band */

export interface LineSeries {
  label: string;
  value: number;
  lo?: number;
  hi?: number;
}

export function forecastChart(
  history: Point[],
  forecast: LineSeries[],
  options: { width?: number; height?: number; unit?: string; id?: string; locale?: Locale } = {},
): string {
  const w = options.width ?? 720;
  const locale = options.locale ?? "en";
  const h = options.height ?? 260;
  const padL = 52;
  const padR = 14;
  const padT = 18;
  const padB = 34;
  const all = [...history.map((p) => p.value), ...forecast.map((f) => f.hi ?? f.value)];
  const max = niceMax(Math.max(1, ...all));
  const count = Math.max(1, history.length + forecast.length - 1);
  const x = (i: number): number => padL + (i / Math.max(1, count)) * (w - padL - padR);
  const y = (v: number): number => h - padB - (v / max) * (h - padT - padB);

  const histLine = history.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const offset = Math.max(0, history.length - 1);
  const foreLine = forecast.map((f, i) => `${x(offset + i).toFixed(1)},${y(f.value).toFixed(1)}`).join(" ");

  const band = forecast
    .map((f, i) => `${x(offset + i).toFixed(1)},${y(f.hi ?? f.value).toFixed(1)}`)
    .concat(
      [...forecast]
        .reverse()
        .map((f, i) => `${x(offset + forecast.length - 1 - i).toFixed(1)},${y(f.lo ?? f.value).toFixed(1)}`),
    )
    .join(" ");

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((frac) => {
      const yy = padT + frac * (h - padT - padB);
      return `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${w - padR}" y2="${yy.toFixed(1)}" class="grid-line"/>
        <text x="${padL - 8}" y="${(yy + 3.5).toFixed(1)}" class="axis-label" text-anchor="end">${fmt(max * (1 - frac))}</text>`;
    })
    .join("");

  const xLabels = [...history, ...forecast]
    .map((p, i) => ({ label: "label" in p ? (p as Point).label : "", i }))
    .filter((p, index) => p.label && index % Math.ceil(count / 8) === 0)
    .map((p) => `<text x="${x(p.i).toFixed(1)}" y="${h - 12}" class="axis-label" text-anchor="middle">${esc(p.label)}</text>`)
    .join("");

  return `<svg class="chart chart-line" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(appText(locale, "Efterfrågeprognos"))}">
    <title>${esc(appText(locale, "Historisk efterfrågan och prognos med osäkerhetsintervall"))}</title>
    ${gridLines}
    <polygon points="${band}" class="band"/>
    <polyline points="${histLine}" class="line-history" pathLength="1"/>
    <polyline points="${foreLine}" class="line-forecast" pathLength="1"/>
    ${forecast.length ? `<line x1="${x(offset).toFixed(1)}" y1="${padT}" x2="${x(offset).toFixed(1)}" y2="${h - padB}" class="divider"/>
    <text x="${x(offset) + 6}" y="${padT + 10}" class="axis-label">${esc(appText(locale, "prognos →"))}</text>` : ""}
    ${xLabels}
  </svg>`;
}

/* ----------------------------------------------------------------- bars */

export function barChart(
  items: Point[],
  options: { unit?: string; tone?: "brass" | "mint" | "danger" } = {},
): string {
  const max = niceMax(Math.max(1, ...items.map((i) => i.value)));
  const tone = options.tone ? ` ${options.tone}` : "";

  const rows = items
    .map((item) => {
      const width = Math.max(2, (item.value / max) * 100);
      return `<div class="bar-row" role="listitem">
        <span class="bar-label">${esc(item.label)}</span>
        <span class="bar-value">${fmt(item.value)}</span>
        <span class="bar-track" aria-hidden="true"><span class="bar-fill${tone}" style="width:${width.toFixed(1)}%"></span></span>
      </div>`;
    })
    .join("");

  return `<div class="bar-list" role="list" aria-label="${esc(options.unit ?? "Ranking")}">${rows}</div>`;
}

/* ----------------------------------------------------------------- donut */

export function donut(
  segments: Array<{ label: string; value: number; tone?: string }>,
  options: { size?: number; centerLabel?: string; centerValue?: string; locale?: Locale } = {},
): string {
  const locale = options.locale ?? "en";
  const size = options.size ?? 180;
  const r = size / 2 - 12;
  const cx = size / 2;
  const cy = size / 2;
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  let angle = -Math.PI / 2;

  const arcs = segments
    .map((seg, i) => {
      const sweep = (seg.value / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      angle += sweep;
      const x2 = cx + r * Math.cos(angle);
      const y2 = cy + r * Math.sin(angle);
      const large = sweep > Math.PI ? 1 : 0;
      if (seg.value <= 0) return "";
      return `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="var(--series-${(i % 6) + 1})" stroke-width="14" stroke-linecap="butt" class="arc" style="--i:${i}"><title>${esc(seg.label)}: ${fmt(seg.value)}</title></path>`;
    })
    .join("");

  return `<svg class="chart chart-donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(appText(locale, "Fördelning"))}">
    <title>${esc(appText(locale, "Fördelning"))}</title>
    ${arcs}
    ${options.centerValue ? `<text x="${cx}" y="${cy + 2}" text-anchor="middle" class="donut-value">${esc(options.centerValue)}</text>` : ""}
    ${options.centerLabel ? `<text x="${cx}" y="${cy + 20}" text-anchor="middle" class="donut-label">${esc(options.centerLabel)}</text>` : ""}
  </svg>`;
}

/* ------------------------------------------------------------ scatter map */

export interface ScatterPoint {
  x: number;
  y: number;
  size: number;
  label: string;
  group?: string;
}

export function velocityMap(points: ScatterPoint[], options: { width?: number; height?: number; locale?: Locale } = {}): string {
  const locale = options.locale ?? "en";
  const w = options.width ?? 720;
  const h = options.height ?? 320;
  const pad = 42;
  const maxX = Math.max(1, ...points.map((p) => p.x)) * 1.05;
  const maxY = Math.max(1, Math.min(120, ...points.map((p) => p.y))) * 1.05;
  const maxSize = Math.max(1, ...points.map((p) => p.size));

  const px = (v: number): number => pad + (Math.min(v, maxX) / maxX) * (w - pad - 12);
  const py = (v: number): number => h - pad - (Math.min(v, maxY) / maxY) * (h - pad - 16);

  const dots = points
    .map((p, i) => {
      const r = 3 + Math.sqrt(p.size / maxSize) * 12;
      const tone = p.group === "neg" ? "neg" : (p.y ?? 0) < 10 ? "warn" : "ok";
      return `<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="${r.toFixed(1)}" class="dot ${tone}" style="--i:${i % 40}"><title>${esc(p.label)}</title></circle>`;
    })
    .join("");

  return `<svg class="chart chart-scatter" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(appText(locale, "Omsättning mot marginal"))}">
    <title>${esc(appText(locale, "Varje punkt är en artikel: omsättningshastighet mot marginal, storlek efter lagervärde"))}</title>
    <line x1="${pad}" y1="${h - pad}" x2="${w - 12}" y2="${h - pad}" class="axis"/>
    <line x1="${pad}" y1="${16}" x2="${pad}" y2="${h - pad}" class="axis"/>
    <text x="${w / 2}" y="${h - 8}" class="axis-label" text-anchor="middle">${esc(appText(locale, "Omsättning (ggr/år) →"))}</text>
    <text x="12" y="${h / 2}" class="axis-label" transform="rotate(-90 12 ${h / 2})" text-anchor="middle">${esc(appText(locale, "Marginal % →"))}</text>
    ${dots}
  </svg>`;
}

/* ---------------------------------------------------------- ABC/XYZ matrix */

export interface MatrixArticle {
  sku: string;
  name: string;
  abc: string;
  xyz: string | null;
  action: string;
  value: number;
}

/**
 * The matrix doubles as a filter. Each cell is a link to the article list with
 * `abc`/`xyz` set, and the panel underneath explains, per cell, which articles
 * are in it, what to do with them and the exact cuts that produced the class.
 * The list is server-rendered so it works without script; the script only opens
 * the panel in place instead of navigating.
 */
export function abcXyzMatrix(
  rows: Array<{ abc: string; x: number; y: number; z: number; unclassified?: number; value: number }>,
  options: {
    locale?: Locale;
    analysisId?: string;
    articles?: MatrixArticle[];
    cutoffs?: { abcA: number; abcB: number; xyzX: number; xyzY: number };
  } = {},
): string {
  const locale = options.locale ?? "en";
  const sv = locale === "sv";
  const cell = 128;
  const gap = 6;
  const w = cell * 3 + gap * 4;
  const h = cell * 3 + gap * 4;
  const max = Math.max(1, ...rows.flatMap((r) => [r.x, r.y, r.z]));
  const cutoffs = options.cutoffs ?? { abcA: 0.8, abcB: 0.95, xyzX: 0.5, xyzY: 1 };
  const articles = options.articles ?? [];
  const base = options.analysisId ? `/app/artiklar?analys=${encodeURIComponent(options.analysisId)}` : "/app/artiklar";

  const byCell = new Map<string, MatrixArticle[]>();
  for (const article of articles) {
    if (!article.xyz) continue;
    const key = `${article.abc}${article.xyz}`;
    const list = byCell.get(key) ?? [];
    list.push(article);
    byCell.set(key, list);
  }
  for (const list of byCell.values()) list.sort((a, b) => b.value - a.value);

  const grid = ["A", "B", "C"]
    .map((abc, row) =>
      ["X", "Y", "Z"]
        .map((xyz, col) => {
          const entry = rows.find((r) => r.abc === abc);
          const count = entry ? (entry[xyz.toLowerCase() as "x" | "y" | "z"] as number) : 0;
          const intensity = count / max;
          const x = gap + col * (cell + gap);
          const y = gap + row * (cell + gap);
          const key = `${abc}${xyz}`;
          const href = `${base}&abc=${abc}&xyz=${xyz}&sort=value`;
          return `<a class="matrix-cell${intensity >= 0.7 ? " matrix-deep" : ""}" href="${href}" data-matrix-cell="${key}" style="--i:${row * 3 + col}">
            <rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="var(--matrix-${Math.min(5, Math.ceil(intensity * 5))})"/>
            <text x="${x + 12}" y="${y + 22}" class="matrix-key">${key}</text>
            <text x="${x + 12}" y="${y + cell - 16}" class="matrix-count">${count}</text>
            <title>${key}: ${count}</title>
          </a>`;
        })
        .join(""),
    )
    .join("");

  const details = ["A", "B", "C"]
    .flatMap((abc) => ["X", "Y", "Z"].map((xyz) => `${abc}${xyz}`))
    .map((key) => {
      const list = byCell.get(key) ?? [];
      const actions = new Map<string, number>();
      for (const article of list) actions.set(article.action, (actions.get(article.action) ?? 0) + 1);
      const actionText = [...actions.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([action, n]) => `${appText(locale, actionName(action))} ${n}`)
        .join(" · ");
      const links = list
        .slice(0, 6)
        .map(
          (article) =>
            `<li><a href="/app/artiklar/${encodeURIComponent(article.sku)}${options.analysisId ? `?analys=${encodeURIComponent(options.analysisId)}` : ""}" data-sku="${esc(article.sku)}">${esc(article.name)}</a> <span class="mono muted">${esc(article.sku)}</span></li>`,
        )
        .join("");
      const more = list.length > 6 ? `<p class="hint">${sv ? `+${list.length - 6} fler i listan` : `+${list.length - 6} more in the list`}</p>` : "";
      return `<div class="matrix-detail" data-matrix-detail="${key}" hidden>
        <p class="matrix-detail-head"><b>${key}</b> · ${list.length} ${sv ? "artiklar" : "items"}${actionText ? ` · ${esc(actionText)}` : ""}</p>
        ${list.length ? `<ul class="matrix-list">${links}</ul>${more}` : `<p class="hint">${sv ? "Inga artiklar i den här rutan." : "No items in this cell."}</p>`}
        <a class="btn btn-sm" href="${base}&abc=${key[0]}&xyz=${key[1]}&sort=value">${sv ? `Visa alla ${list.length} i Lager` : `Show all ${list.length} in Inventory`}</a>
      </div>`;
    })
    .join("");

  const cutText = sv
    ? `Gränser: ABC efter kumulativ andel av försäljningsvärdet. A: andelen före artikeln < ${Math.round(cutoffs.abcA * 100)} %, B: ${Math.round(cutoffs.abcA * 100)}–${Math.round(cutoffs.abcB * 100)} %, C: resten. XYZ efter variationskoefficient, X < ${String(cutoffs.xyzX).replace(".", ",")}, Y ${String(cutoffs.xyzX).replace(".", ",")}–${String(cutoffs.xyzY).replace(".", ",")}, Z > ${String(cutoffs.xyzY).replace(".", ",")}.`
    : `Cuts: ABC by cumulative share of sales revenue. A: share before the item < ${Math.round(cutoffs.abcA * 100)}%, B: ${Math.round(cutoffs.abcA * 100)}–${Math.round(cutoffs.abcB * 100)}%, C: the rest. XYZ by coefficient of variation, X < ${cutoffs.xyzX}, Y ${cutoffs.xyzX}–${cutoffs.xyzY}, Z > ${cutoffs.xyzY}.`;

  const withoutXyz = rows
    .filter((row) => (row.unclassified ?? 0) > 0)
    .map((row) => `${row.abc} ${row.unclassified}`)
    .join(", ");
  const coverageText = withoutXyz
    ? sv
      ? `Artiklar utan XYZ-klass visas inte i rutorna: ${withoutXyz}.`
      : `Items without an XYZ class are not shown in the cells: ${withoutXyz}.`
    : "";

  return `<svg class="chart chart-matrix" viewBox="0 0 ${w} ${h}" role="group" aria-label="${esc(appText(locale, "ABC och XYZ-matris"))}">
    <title>${esc(appText(locale, "Antal artiklar per ABC- och XYZ-klass"))}</title>${grid}</svg>
    <div class="matrix-panel" data-matrix-panel hidden>${details}
      <p class="matrix-thresholds">${esc(cutText)}${coverageText ? ` ${esc(coverageText)}` : ""}</p>
    </div>`;
}

function actionName(action: string): string {
  return (
    {
      write_off: "Nedskrivning",
      liquidate: "Realisera",
      reduce: "Minska",
      reorder: "Beställ",
      review: "Granska",
      ok: "OK",
    }[action] ?? action
  );
}

/* ---------------------------------------------------------- health map */

export function healthMap(
  items: Array<{
    sku: string;
    name: string;
    score: number;
    value: number;
    action: string;
    stock?: number;
    coverDays?: number | null;
  }>,
  options: { width?: number; height?: number; locale?: Locale; analysisId?: string } = {},
): string {
  const locale = options.locale ?? "en";
  const sv = locale === "sv";
  const w = options.width ?? 720;
  const cols = 40;
  const size = Math.floor((w - (cols - 1) * 2) / cols);
  const rows = Math.ceil(items.length / cols);
  const h = rows * (size + 2);
  const maxValue = Math.max(1, ...items.map((i) => i.value));

  const squares = items
    .map((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * (size + 2);
      const y = row * (size + 2);
      // The square's colour is the recommended action, exactly as the legend
      // says. A low priority score must never paint an OK item as a risk.
      const tone =
        item.action === "write_off" || item.action === "liquidate"
          ? "dead"
          : item.action === "reorder"
            ? "risk"
            : item.action === "reduce" || item.action === "review"
              ? "watch"
              : "ok";
      // Value sets intensity, but only within a narrow band: the hue carries the
      // action, so a large healthy square must never read as a warning.
      const strength = 0.92 + (item.value / maxValue) * 0.08;
      const status = appText(locale, actionName(item.action));
      const cover = item.coverDays === null || item.coverDays === undefined ? "–" : `${fmt(item.coverDays)} ${sv ? "dagar" : "days"}`;
      const label = `${item.name} · ${item.sku} · ${status} · ${Math.round(item.score)}/100 · ${fmt(item.value)} kr`;
      const href = options.analysisId
        ? `/app/artiklar/${encodeURIComponent(item.sku)}?analys=${encodeURIComponent(options.analysisId)}`
        : `/app/artiklar/${encodeURIComponent(item.sku)}`;
      return `<g class="hm ${tone}" role="button" tabindex="0" data-sku="${esc(item.sku)}" data-hm-sku="${esc(item.sku)}" data-hm-name="${esc(item.name)}" data-hm-status="${esc(status)}" data-hm-score="${esc(Math.round(item.score))}" data-hm-value="${esc(fmt(item.value))} kr" data-hm-stock="${esc(item.stock === undefined ? "–" : fmt(item.stock))}" data-hm-cover="${esc(cover)}" data-hm-href="${esc(href)}" aria-label="${esc(label)}" style="--i:${i % 60}">
        <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="1.5" class="hm-cell" style="--hm-v:${strength.toFixed(2)}"/>
        <title>${esc(label)}</title>
      </g>`;
    })
    .join("");

  return `<div class="hm-wrap">
    <svg class="chart chart-healthmap" viewBox="0 0 ${cols * (size + 2)} ${h}" role="group" aria-label="${esc(appText(locale, "Lagerhälsokarta"))}">
      <title>${esc(appText(locale, "En ruta per artikel, färg efter åtgärdsbehov och intensitet efter lagervärde"))}</title>${squares}</svg>
    <div class="hm-panel" data-hm-panel hidden>
      <p class="hm-panel-head"><b data-hm-name>–</b><span class="mono" data-hm-sku></span></p>
      <dl class="hm-facts">
        <div><dt>${sv ? "Åtgärd" : "Action"}</dt><dd data-hm-status>–</dd></div>
        <div><dt>${sv ? "Prioritet" : "Priority"}</dt><dd data-hm-score>–</dd></div>
        <div><dt>${sv ? "Lagervärde" : "Inventory value"}</dt><dd data-hm-value>–</dd></div>
        <div><dt>${sv ? "Saldo" : "Stock"}</dt><dd data-hm-stock>–</dd></div>
        <div><dt>${sv ? "Täckning" : "Coverage"}</dt><dd data-hm-cover>–</dd></div>
      </dl>
      <a class="btn btn-sm" data-hm-open href="#">${sv ? "Öppna artikeln" : "Open item"}</a>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------- treemap */

/**
 * Squarified treemap (Bruls, Huizing, van Wijk). Slice-and-dice produces long
 * thin strips that read as empty bands; squarification keeps each category close
 * to a square so the area is actually comparable at a glance.
 */
function squarify(areas: number[], w: number, h: number): Array<{ x: number; y: number; w: number; h: number }> {
  const rects: Array<{ x: number; y: number; w: number; h: number }> = [];
  let x = 0;
  let y = 0;
  let cw = w;
  let ch = h;
  let index = 0;

  const worst = (row: number[], side: number): number => {
    const sum = row.reduce((a, b) => a + b, 0);
    if (sum <= 0) return Number.POSITIVE_INFINITY;
    const max = Math.max(...row);
    const min = Math.min(...row);
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  while (index < areas.length && cw > 0.5 && ch > 0.5) {
    const side = Math.min(cw, ch);
    let row = [areas[index]!];
    let end = index + 1;
    let score = worst(row, side);

    while (end < areas.length) {
      const candidate = [...row, areas[end]!];
      const candidateScore = worst(candidate, side);
      if (candidateScore > score) break;
      row = candidate;
      score = candidateScore;
      end++;
    }

    const rowSum = row.reduce((a, b) => a + b, 0);
    if (cw >= ch) {
      const columnWidth = rowSum / ch;
      let cursor = y;
      for (const area of row) {
        const tileHeight = area / columnWidth;
        rects.push({ x, y: cursor, w: columnWidth, h: tileHeight });
        cursor += tileHeight;
      }
      x += columnWidth;
      cw -= columnWidth;
    } else {
      const rowHeight = rowSum / cw;
      let cursor = x;
      for (const area of row) {
        const tileWidth = area / rowHeight;
        rects.push({ x: cursor, y, w: tileWidth, h: rowHeight });
        cursor += tileWidth;
      }
      y += rowHeight;
      ch -= rowHeight;
    }
    index = end;
  }

  return rects;
}

/** Shorten a tile label at a word boundary so it never ends mid-word. */
function ellipsize(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = Math.max(1, max - 1);
  const cut = text.slice(0, room);
  const space = cut.lastIndexOf(" ");
  const base = space > room * 0.55 ? cut.slice(0, space) : cut;
  return `${base.replace(/[\s,–-]+$/, "")}…`;
}

/**
 * Break a tile label into lines that fit the tile instead of cutting the name
 * off. Names longer than the allowed lines are shortened on the last line, so a
 * narrow tile reads "Pipes and / fittings" rather than "Pipes and fi".
 */
function wrapLabel(text: string, maxChars: number, maxLines: number): string[] {
  if (text.length <= maxChars) return [text];
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word.length > maxChars ? ellipsize(word, maxChars) : word;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  // No room for the rest: merge the overflow into the last visible line.
  return [...lines.slice(0, maxLines - 1), ellipsize(lines.slice(maxLines - 1).join(" "), maxChars)];
}

export function treemap(
  groups: Array<{ label: string; value: number; dead?: number }>,
  options: {
    width?: number;
    height?: number;
    format?: (n: number) => string;
    unit?: string;
    ariaLabel?: string;
    locale?: Locale;
    /** Label for the folded remainder when there are more groups than tiles. */
    restLabel?: string;
    maxGroups?: number;
  } = {},
): string {
  const formatValue = options.format ?? fmt;
  const unit = options.unit ?? "kr";
  const w = options.width ?? 720;
  const locale = options.locale ?? "en";
  const h = options.height ?? 240;
  const maxGroups = Math.max(1, options.maxGroups ?? DISPLAY.treemapGroups);
  const positive = groups.filter((g) => g.value > 0).sort((a, b) => b.value - a.value);
  // Dropping groups would make the tiles add up to less than the inventory value.
  // Fold the tail into an explicit "other" group instead, so the chart reconciles
  // with the KPI above it.
  const restLabel = options.restLabel ?? appText(locale, "Övriga");
  const visible = foldTail(positive, maxGroups, (tail) => ({
    label: restLabel,
    value: tail.reduce((a, g) => a + g.value, 0),
    dead: tail.reduce((a, g) => a + (g.dead ?? 0), 0),
  }));
  const total = visible.reduce((a, g) => a + g.value, 0) || 1;
  // Colour is relative to the most dead category on screen, so the ramp always
  // uses its full range instead of washing out when every category is healthy.
  const worstDead = Math.max(...visible.map((g) => (g.value > 0 ? (g.dead ?? 0) / g.value : 0)), 0.01);
  const layout = squarify(visible.map((g) => (g.value / total) * w * h), w, h);

  const rects = visible.map((group, i) => {
    const box = layout[i];
    if (!box) return "";
    const deadShare = group.value > 0 ? (group.dead ?? 0) / group.value : 0;
    // Area is capital. Colour is how much of that capital is dead: paper for a
    // healthy category, copper for one that is not moving. Dark tiles get a
    // paper label so the number stays legible.
    const tone = Math.min(5, Math.max(1, 1 + Math.round((deadShare / worstDead) * 4)));
    const onDeep = tone >= 4;
    // Small tiles cannot hold text without colliding with their neighbours, so
    // they stay unlabelled (the tooltip always carries name and amount). Tall
    // enough tiles may use a second line for long category names.
    const roomForLabel = box.w >= 52 && box.h >= 24;
    const roomForValue = box.w >= 64 && box.h >= 46;
    const maxChars = Math.max(4, Math.floor((box.w - 16) / 5.8));
    const lines = wrapLabel(group.label, maxChars, roomForValue && box.h >= 58 ? 2 : 1);
    const valueY = box.y + 19 + (lines.length - 1) * 13 + 16;
    return `<g class="tm${onDeep ? " tm-deep" : ""}" style="--i:${i}">
      <rect x="${(box.x + 1).toFixed(1)}" y="${(box.y + 1).toFixed(1)}" width="${Math.max(0, box.w - 2).toFixed(1)}" height="${Math.max(0, box.h - 2).toFixed(1)}" rx="1" fill="var(--matrix-${tone})"/>
      ${roomForLabel
        ? lines
            .map((text, index) => `<text x="${(box.x + 8).toFixed(1)}" y="${(box.y + 19 + index * 13).toFixed(1)}" class="tm-label">${esc(text)}</text>`)
            .join("")
        : ""}
      ${roomForValue ? `<text x="${(box.x + 8).toFixed(1)}" y="${valueY.toFixed(1)}" class="tm-value">${formatValue(group.value)}</text>` : ""}
      <title>${esc(group.label)}: ${formatValue(group.value)}${unit ? " " + unit : ""}</title>
    </g>`;
  });

  return `<svg class="chart chart-treemap" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(options.ariaLabel ?? appText(locale, "Kapitalfördelning per kategori"))}">
    <title>${esc(options.ariaLabel ?? appText(locale, "Lagervärde per kategori"))}</title>${rects.join("")}</svg>`;
}

/* ------------------------------------------------------------------ radar */

export function riskRadar(axes: Array<{ label: string; value: number }>, options: { size?: number } = {}): string {
  const size = options.size ?? 260;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 38;
  const count = Math.max(3, axes.length);

  const point = (i: number, value: number): [number, number] => {
    const angle = -Math.PI / 2 + (i / count) * Math.PI * 2;
    return [cx + Math.cos(angle) * r * Math.max(0.04, Math.min(1, value)), cy + Math.sin(angle) * r * Math.max(0.04, Math.min(1, value))];
  };

  const rings = [0.25, 0.5, 0.75, 1]
    .map((level) => {
      const points = axes.map((_, i) => point(i, level).map((n) => n.toFixed(1)).join(",")).join(" ");
      return `<polygon points="${points}" class="radar-ring"/>`;
    })
    .join("");

  const shape = axes.map((a, i) => point(i, a.value).map((n) => n.toFixed(1)).join(",")).join(" ");
  const labels = axes
    .map((a, i) => {
      const [x, y] = point(i, 1.16);
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="radar-label" text-anchor="middle">${esc(a.label)}</text>`;
    })
    .join("");

  return `<svg class="chart chart-radar" viewBox="0 0 ${size} ${size}" role="img" aria-label="Riskprofil">
    <title>Riskprofil per område, 0 till 100</title>${rings}
    <polygon points="${shape}" class="radar-shape"/>${labels}</svg>`;
}

/* --------------------------------------------------------------- timeline */

export function valueTimeline(points: Array<{ date: string; value: number }>, options: { width?: number; height?: number; locale?: Locale } = {}): string {
  const locale = options.locale ?? "en";
  if (points.length < 2) {
    return `<div class="chart-placeholder"><p>${esc(appText(locale, "Lagervärdets utveckling visas när organisationen har minst två importer."))}</p><p class="muted">${esc(appText(locale, "Importera igen om en månad. Då ritas trenden automatiskt."))}</p></div>`;
  }
  const w = options.width ?? 720;
  const h = options.height ?? 200;
  const pad = 40;
  const max = niceMax(Math.max(...points.map((p) => p.value)));
  const min = Math.min(...points.map((p) => p.value)) * 0.9;
  const x = (i: number): number => pad + (i / Math.max(1, points.length - 1)) * (w - pad - 12);
  const y = (v: number): number => h - 28 - ((v - min) / Math.max(1, max - min)) * (h - 46);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${pad},${h - 28} ${line} ${x(points.length - 1).toFixed(1)},${h - 28}`;
  const dots = points
    .map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.5" class="tl-dot"><title>${esc(p.date.slice(0, 16).replace("T", " "))}: ${fmt(p.value)} ${appText(locale, "kr")}</title></circle>`)
    .join("");

  return `<svg class="chart chart-timeline" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(appText(locale, "Lagervärdets utveckling"))}">
    <title>${esc(appText(locale, "Lagervärde per importeringstillfälle"))}</title>
    <polygon points="${area}" class="tl-area"/>
    <polyline points="${line}" class="tl-line"/>${dots}
    <text x="${pad}" y="${h - 8}" class="axis-label">${esc(points[0]!.date.slice(0, 10))}</text>
    <text x="${w - 12}" y="${h - 8}" class="axis-label" text-anchor="end">${esc(points[points.length - 1]!.date.slice(0, 10))}</text>
  </svg>`;
}
