/**
 * The public about page.
 *
 * The narrative is deliberately built around the same demo environment as the
 * product demo: the hero figures, the warehouse scene and the zone values all
 * come from `worldEnvironment`, so the page cannot show a polished illustration
 * that disagrees with the platform. The scene is a server-rendered isometric
 * map of that model; the interactive 3D world remains one click away.
 */
import { formatNumber, formatSek, strings, type Locale, DEFAULT_LOCALE } from "../i18n.ts";
import { cmsText as site, esc, icon, marketingShell } from "../ui/base.ts";
import type { SceneModel } from "../ui/scene.ts";
import { worldEnvironment, type WorldEnvironment } from "../world.ts";

const LINKEDIN_URL = "https://www.linkedin.com/in/mohammad-al-kakouni";
const COMPANY_LINKEDIN_URL = "https://www.linkedin.com/company/stoqwise";

const linkedinMark = `<svg class="icon icon-linkedin" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45z"/></svg>`;

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, Math.max(1, max - 1)).trimEnd()}…` : value;

/** Deliberate short names for the narrow warehouse columns, never mid-word cuts. */
const CATEGORY_SHORT: Record<string, string> = {
  Elkomponenter: "Elkomp.",
  "Rör och kopplingar": "Rör",
  Fästmaterial: "Fästen",
  Skyddsutrustning: "Skydd",
  Byggmaterial: "Bygg",
  "Electrical components": "Electrical",
  "Pipes and fittings": "Pipes",
  "Adhesives and sealants": "Adhesives",
  "Safety equipment": "Safety",
  "Building Materials": "Building",
};

const shortCategory = (value: string): string => CATEGORY_SHORT[value] ?? truncate(value, 11);

const percent = (value: number, max: number): string => `${Math.max(5, Math.min(100, (value / max) * 100))}%`;

/** Isometric warehouse map built from the same analysed scene as the product. */
function twinScene(scene: SceneModel, alt: string): string {
  const width = 1000;
  const height = 540;
  const left = 64;
  const right = 64;
  const top = 108;
  const bottom = 430;
  const columns = Math.max(1, scene.aisles.length);
  const columnWidth = (width - left - right) / columns;
  const rows = new Map<number, number>();

  const racks = [...scene.racks]
    .sort((a, b) => b.depth - a.depth || a.aisle - b.aisle)
    .map((rack) => {
      const indexInAisle = rows.get(rack.aisle) ?? 0;
      rows.set(rack.aisle, indexInAisle + 1);
      const x = left + rack.aisle * columnWidth + columnWidth / 2 - 17 + (indexInAisle % 2 === 0 ? -7 : 7);
      const y = top + rack.depth * (bottom - top);
      const w = 34;
      const h = 18 + rack.stackHeight * 48;
      const lid = 7;
      const title = `${rack.name} · ${rack.label.value} · ${rack.label.status}`;
      return `<g class="about-rack is-${rack.status}">
        <title>${esc(title)}</title>
        <ellipse class="about-rack-shadow" cx="${(x + w / 2).toFixed(1)}" cy="${(y + 4).toFixed(1)}" rx="${(w * 0.72).toFixed(1)}" ry="5"/>
        <rect class="about-rack-side" x="${(x + w).toFixed(1)}" y="${(y - h).toFixed(1)}" width="${lid}" height="${h.toFixed(1)}" rx="1.5"/>
        <rect class="about-rack-front" x="${x.toFixed(1)}" y="${(y - h).toFixed(1)}" width="${w}" height="${h.toFixed(1)}" rx="1.5"/>
        <path class="about-rack-top" d="M${x.toFixed(1)} ${(y - h).toFixed(1)} l${lid} -${lid} h${w} l-${lid} ${lid} Z"/>
      </g>`;
    })
    .join("");

  const aisleBands = scene.aisles
    .map(
      (aisle, index) =>
        `<rect class="about-aisle-band" x="${(left + index * columnWidth + 5).toFixed(1)}" y="${top - 8}" width="${(columnWidth - 10).toFixed(1)}" height="${bottom - top + 18}" rx="10"/>`,
    )
    .join("");

  const aisleLabels = scene.aisles
    .map((aisle, index) => {
      const x = left + index * columnWidth + columnWidth / 2;
      return `<g class="about-aisle-label">
        <text x="${x.toFixed(1)}" y="${height - 24}" text-anchor="middle">${esc(shortCategory(aisle.category))}</text>
      </g>`;
    })
    .join("");

  return `<svg class="about-twin-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(alt)}" preserveAspectRatio="xMidYMid meet">
    <defs>
      <pattern id="about-floor-grid" width="46" height="46" patternUnits="userSpaceOnUse">
        <path d="M46 0H0V46" fill="none" stroke="rgba(223,231,223,.07)" stroke-width="1"/>
      </pattern>
      <radialGradient id="about-floor-glow" cx="50%" cy="38%" r="70%">
        <stop offset="0" stop-color="rgba(111,148,127,.15)"/>
        <stop offset="1" stop-color="rgba(11,21,18,0)"/>
      </radialGradient>
    </defs>
    <rect class="about-twin-floor" x="0" y="0" width="${width}" height="${height}"/>
    <rect x="26" y="70" width="${width - 52}" height="${height - 92}" rx="20" fill="url(#about-floor-grid)"/>
    <rect x="26" y="70" width="${width - 52}" height="${height - 92}" rx="20" fill="url(#about-floor-glow)"/>
    <g class="about-aisles">${aisleBands}</g>
    <g class="about-dock">
      <path d="M${left} 92H${width - right}"/>
    </g>
    <g class="about-racks">${racks}</g>
    <g class="about-aisle-labels">${aisleLabels}</g>
  </svg>`;
}

function heroPanel(environment: WorldEnvironment, locale: Locale): string {
  const c = strings(locale).about;
  const scene = environment.scene;
  const kpis = environment.kpis;
  const topAisles = [...scene.aisles].sort((a, b) => b.value - a.value).slice(0, 4);
  const max = Math.max(1, ...topAisles.map((aisle) => aisle.value));
  const number = (value: number, digits = 0): string => formatNumber(locale, value, digits);

  return `<aside class="about-signal" aria-label="${esc(c.heroPanelLabel)}">
    <div class="about-signal-head">
      <span class="about-signal-live"><i aria-hidden="true"></i>${esc(c.heroPanelLabel)}</span>
      <span class="about-signal-demo">${esc(c.heroPanelDemo)}</span>
    </div>
    <div class="about-signal-value">
      <span>${esc(c.heroInventory)}</span>
      <strong>${esc(formatSek(locale, Math.round(kpis.inventoryValue)))}</strong>
    </div>
    <div class="about-signal-stats">
      <div><span>${esc(c.heroTurns)}</span><strong>${esc(number(kpis.turns, 1))} <small>${esc(c.heroTurnsUnit)}</small></strong></div>
      <div><span>${esc(c.heroRisk)}</span><strong>${esc(number(kpis.stockoutRiskCount))} <small>${esc(locale === "sv" ? "artiklar" : "items")}</small></strong></div>
    </div>
    <div class="about-signal-bars" aria-hidden="true">
      ${topAisles
        .map(
          (aisle) => `<div class="about-signal-bar">
            <span>${esc(shortCategory(aisle.category))}</span>
            <i><b style="--about-bar:${percent(aisle.value, max)}"></b></i>
            <em>${esc(formatSek(locale, aisle.value))}</em>
          </div>`,
        )
        .join("")}
    </div>
    <p class="about-signal-foot">${esc(c.heroPanelFoot)}</p>
  </aside>`;
}

export function aboutPage(input: { user: { name: string } | null; locale?: Locale }): string {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const c = strings(locale).about;
  const environment = worldEnvironment("industri", locale);
  const scene = environment.scene;
  const number = (value: number, digits = 0): string => formatNumber(locale, value, digits);
  const statusLegend = scene.hud.legend.filter((item) =>
    ["balanced", "overstock", "stockout", "inactive"].includes(item.key),
  );
  const sceneAlt = c.twinSceneAlt
    .replace("{racks}", number(scene.counts.racks))
    .replace("{aisles}", number(scene.aisles.length));

  const capabilities = [
    { icon: "layers", title: c.capabilities[0]!.title, text: c.capabilities[0]!.text },
    { icon: "trend", title: c.capabilities[1]!.title, text: c.capabilities[1]!.text },
    { icon: "sliders", title: c.capabilities[2]!.title, text: c.capabilities[2]!.text },
    { icon: "users", title: c.capabilities[3]!.title, text: c.capabilities[3]!.text },
    { icon: "grid", title: c.capabilities[4]!.title, text: c.capabilities[4]!.text },
    { icon: "spark", title: c.capabilities[5]!.title, text: c.capabilities[5]!.text },
  ];

  return marketingShell({
    title: c.pageTitle,
    description: c.description,
    active: "about",
    user: input.user,
    locale,
    path: "/om-oss",
    content: `<div class="about-page">
      <section class="about-hero" aria-labelledby="about-title">
        <div class="about-hero-orbit" aria-hidden="true"></div>
        <div class="site-wrap about-hero-inner">
          <div class="about-hero-copy">
            <p class="about-eyebrow"><span aria-hidden="true"></span>${esc(c.eyebrow)}</p>
            <h1 class="about-hero-title" id="about-title">${esc(c.h1)}</h1>
            <p class="about-hero-lead">${site(locale, "site.about.lead", c.lead)}</p>
            <div class="about-actions">
              <a class="btn btn-lg" href="/produkt">${esc(c.heroPrimary)} ${icon("arrow", 16)}</a>
              <a class="btn btn-ghost btn-lg" href="/kontakt?amne=demo">${esc(c.heroSecondary)}</a>
            </div>
            <ul class="about-proof">
              ${c.heroProof.map((item) => `<li><span aria-hidden="true">${icon("check", 13)}</span>${esc(item)}</li>`).join("")}
            </ul>
          </div>
          <div class="about-hero-visual">
            ${heroPanel(environment, locale)}
          </div>
        </div>
      </section>

      <section class="about-section about-intro about-reveal" aria-labelledby="about-intro-title">
        <div class="site-wrap">
          <div class="about-intro-grid">
            <div>
              <p class="about-eyebrow">${esc(c.introEyebrow)}</p>
              <h2 class="about-heading" id="about-intro-title">${esc(c.introTitle)}</h2>
            </div>
            <div class="about-prose">
              ${c.introBody.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}
            </div>
          </div>
          <div class="about-signal-row">
            <span class="about-signal-row-label">${esc(c.introSignalsLabel)}</span>
            <ul>
              ${c.introSignals.map((signal, index) => `<li><span>0${index + 1}</span>${esc(signal)}</li>`).join("")}
            </ul>
          </div>
        </div>
      </section>

      <section class="about-section about-origin about-reveal" id="varfor" aria-labelledby="about-origin-title">
        <div class="site-wrap">
          <div class="about-section-head">
            <p class="about-eyebrow">${esc(c.originEyebrow)}</p>
            <h2 class="about-heading" id="about-origin-title">${esc(c.originTitle)}</h2>
            <p class="about-lead">${esc(c.originLead)}</p>
          </div>
          <div class="about-origin-grid">
            <div class="about-prose about-origin-copy">
              ${c.originBody.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}
            </div>
            <div class="about-questions">
              <p class="about-label">${esc(c.originQuestionsLabel)}</p>
              <ol>
                ${c.originQuestions
                  .map(
                    (question, index) =>
                      `<li><span aria-hidden="true">0${index + 1}</span><p>${esc(question)}</p></li>`,
                  )
                  .join("")}
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section class="about-section about-system about-reveal" aria-labelledby="about-system-title">
        <div class="site-wrap">
          <div class="about-section-head">
            <p class="about-eyebrow">${esc(c.systemEyebrow)}</p>
            <h2 class="about-heading" id="about-system-title">${esc(c.systemTitle)}</h2>
            <p class="about-lead">${esc(c.systemLead)}</p>
          </div>
          <div class="about-system-grid">
            <div class="about-prose">
              ${c.systemBody.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}
            </div>
            <aside class="about-chain" aria-label="${esc(c.systemFlowTitle)}">
              <p class="about-label">${esc(c.systemFlowTitle)}</p>
              <ol>
                ${c.systemSteps
                  .map(
                    (step, index) =>
                      `<li><span class="about-chain-index" aria-hidden="true">0${index + 1}</span><div><strong>${esc(step.title)}</strong><p>${esc(step.text)}</p></div></li>`,
                  )
                  .join("")}
              </ol>
            </aside>
          </div>
        </div>
      </section>

      <section class="about-section about-capabilities about-reveal" id="plattform" aria-labelledby="about-capabilities-title">
        <div class="site-wrap">
          <div class="about-section-head about-section-head--split">
            <div>
              <p class="about-eyebrow">${esc(c.capabilitiesEyebrow)}</p>
              <h2 class="about-heading" id="about-capabilities-title">${esc(c.capabilitiesTitle)}</h2>
            </div>
            <p class="about-lead">${esc(c.capabilitiesLead)}</p>
          </div>
          <div class="about-capability-grid">
            ${capabilities
              .map(
                (capability, index) => `<article class="about-capability${index === 4 ? " is-twin" : ""}">
                  <div class="about-capability-top"><span class="about-capability-icon">${icon(capability.icon, 18)}</span><span class="about-capability-index">0${index + 1}</span></div>
                  <h3>${esc(capability.title)}</h3>
                  <p>${esc(capability.text)}</p>
                  ${index === 4 ? `<a class="about-capability-link" href="#digital-tvilling">${esc(c.twinLink)} ${icon("arrow", 13)}</a>` : ""}
                </article>`,
              )
              .join("")}
          </div>
            
        </div>
      </section>

      <section class="about-twin about-reveal" id="digital-tvilling" aria-labelledby="about-twin-title">
        <div class="site-wrap">
          <div class="about-twin-head">
            <div>
              <p class="about-eyebrow about-eyebrow--light">${esc(c.twinEyebrow)}</p>
              <h2 class="about-heading about-heading--light" id="about-twin-title">${esc(c.twinTitle)}</h2>
            </div>
            <div>
              <p class="about-lead about-lead--light">${esc(c.twinLead)}</p>
              <div class="about-actions">
                <a class="btn btn-lg" href="/#varld">${esc(c.twinCta)} ${icon("arrow", 16)}</a>
                <a class="btn btn-ghost btn-ghost--light btn-lg" href="/produkt">${esc(c.twinSecondary)}</a>
              </div>
            </div>
          </div>
          <figure class="about-twin-figure">
            <div class="about-twin-chrome">
              <span class="about-twin-chrome-label"><i aria-hidden="true"></i>${esc(c.twinSceneLabel)}</span>
              <span class="about-twin-chrome-demo">${esc(c.twinSceneDemo)}</span>
            </div>
            <div class="about-twin-view">
              ${twinScene(scene, sceneAlt)}
              <div class="about-twin-scan" aria-hidden="true"></div>
            </div>
            <div class="about-twin-legend">
              ${statusLegend
                .map(
                  (item) =>
                    `<span data-status="${item.key}"><i aria-hidden="true"></i>${esc(item.label)}</span>`,
                )
                .join("")}
            </div>
            <p class="about-twin-cats" aria-hidden="true">${scene.aisles.map((aisle) => esc(shortCategory(aisle.category))).join(" · ")}</p>
            <figcaption><span>${esc(c.twinSceneFoot)}</span></figcaption>
          </figure>
          <div class="about-twin-detail">
            <div class="about-prose about-prose--light">
              ${c.twinBody.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}
            </div>
            <ul class="about-twin-points">
              ${c.twinPoints
                .map(
                  (point) => `<li><span class="about-twin-point-mark" aria-hidden="true">${icon("check", 13)}</span><div><strong>${esc(point.title)}</strong><p>${esc(point.text)}</p></div></li>`,
                )
                .join("")}
            </ul>
          </div>
        </div>
      </section>

      <section class="about-section about-experience about-reveal" id="erfarenhet" aria-labelledby="about-experience-title">
        <div class="site-wrap">
          <div class="about-experience-grid">
            <div>
              <p class="about-eyebrow">${esc(c.experienceEyebrow)}</p>
              <h2 class="about-heading" id="about-experience-title">${esc(c.experienceTitle)}</h2>
            </div>
            <div class="about-experience-copy">
              <p class="about-lead">${esc(c.experienceLead)}</p>
              <div class="about-prose">
                ${c.experienceBody.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="about-founder-section about-reveal" aria-labelledby="about-founder-title">
        <div class="site-wrap">
          <div class="about-founder">
            <div class="about-founder-mark" aria-hidden="true">MA</div>
            <div class="about-founder-main">
              <p class="about-eyebrow">${esc(c.founderEyebrow)}</p>
              <h2 class="about-founder-title" id="about-founder-title">${esc(c.founderTitle)}</h2>
              <div class="about-founder-name">
                <strong>${esc(c.founderName)}</strong>
                <a class="about-linkedin" href="${LINKEDIN_URL}" target="_blank" rel="noopener noreferrer" aria-label="${esc(c.linkedinLabel)}">${linkedinMark}</a>
              </div>
              <a class="about-linkedin-company" href="${COMPANY_LINKEDIN_URL}" target="_blank" rel="noopener noreferrer" aria-label="${esc(c.companyLinkedinLabel)}">${linkedinMark}<span>${esc(c.companyLinkedin)}</span></a>
            </div>
            <dl class="about-founder-facts">
              <div><dt>${esc(c.founderEducationLabel)}</dt><dd>${esc(c.founderEducation)}</dd></div>
              <div><dt>${esc(c.founderExperienceLabel)}</dt><dd>${esc(c.founderExperience)}</dd></div>
              <div><dt>${esc(c.founderBasedLabel)}</dt><dd>${esc(c.founderBased)}</dd></div>
            </dl>
          </div>
        </div>
      </section>

      <section class="about-vision about-reveal" aria-labelledby="about-vision-title">
        <div class="about-vision-orbit" aria-hidden="true"></div>
        <div class="site-wrap">
          <p class="about-eyebrow about-eyebrow--light">${esc(c.visionEyebrow)}</p>
          <div class="about-vision-grid">
            <h2 class="about-vision-title" id="about-vision-title">${esc(c.visionTitle)}</h2>
            <div class="about-vision-copy">
              <div class="about-prose about-prose--light">
                ${c.visionBody.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}
              </div>
              <p class="about-vision-statement">${esc(c.visionStatement)}</p>
              <div class="about-actions">
                <a class="btn btn-lg" href="/produkt">${esc(c.visionPrimary)} ${icon("arrow", 16)}</a>
                <a class="btn btn-ghost btn-ghost--light btn-lg" href="/kontakt">${esc(c.visionSecondary)}</a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>`,
  });
}
