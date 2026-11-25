/**
 * Server-rendered administration UI.
 *
 * Deliberately separate from the marketing shell and the customer app: no
 * customer navigation, no marketing footer, its own sidebar. All markup is
 * escaped, all forms are same-origin POSTs, and nothing here decides access -
 * the route layer does that on the server before a page is built.
 */
import { esc } from "../ui/base.ts";
import { LEGAL_GROUPS, SITE_GROUPS, type FieldDef, type FieldGroup } from "./fields.ts";
import type { AdminAuditRow, ContentDiff, VersionRow } from "./store.ts";
import type { AdminRow } from "./auth.ts";

export interface AdminPageInput {
  admin: AdminRow;
  title: string;
  active: string;
  content: string;
  subtitle?: string;
  flash?: string;
  error?: string;
}

const NAV: Array<{ href: string; label: string; icon: string; id: string }> = [
  { href: "/admin", label: "Översikt", icon: "▦", id: "dashboard" },
  { href: "/admin/plattform", label: "Plattform", icon: "◎", id: "platform" },
  { href: "/admin/anvandare", label: "Användare", icon: "◉", id: "users" },
  { href: "/admin/organisationer", label: "Organisationer", icon: "▤", id: "orgs" },
  { href: "/admin/offerter", label: "Offerter", icon: "⌁", id: "quotes" },
  { href: "/admin/testkonton", label: "Testkonton", icon: "◇", id: "test" },
  { href: "/admin/system", label: "System", icon: "⚙", id: "system" },
  { href: "/admin/sakerhet", label: "Säkerhet", icon: "◈", id: "security" },
  { href: "/admin/innehall", label: "Webbplats", icon: "✎", id: "content" },
  { href: "/admin/juridik", label: "Juridik", icon: "§", id: "legal" },
  { href: "/admin/versioner", label: "Versioner", icon: "↻", id: "versions" },
  { href: "/admin/logg", label: "Aktivitetslogg", icon: "≡", id: "audit" },
  { href: "/admin/konto", label: "Konto och 2FA", icon: "⚿", id: "account" },
];

export function adminShell(input: AdminPageInput): string {
  return `<!doctype html>
<html lang="sv" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(input.title)} · STOQWISE Admin</title>
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<link rel="stylesheet" href="/v3.css?v=143">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body class="admin-body">
<a class="skip" href="#admin-main">Till innehållet</a>
<div class="admin-shell">
  <aside class="admin-side">
    <a class="admin-brand" href="/admin"><span class="admin-brand-mark">SQ</span><span>STOQWISE<em>Admin</em></span></a>
    <nav class="admin-nav" aria-label="Administration">
      ${NAV.map(
        (item) => `<a href="${item.href}" class="${input.active === item.id ? "is-active" : ""}"${input.active === item.id ? ' aria-current="page"' : ""}><span aria-hidden="true">${item.icon}</span>${item.label}</a>`,
      ).join("")}
    </nav>
    <div class="admin-side-foot">
      <a class="admin-side-link" href="/" target="_blank" rel="noopener">Visa webbplatsen ↗</a>
      <p class="admin-who">${esc(input.admin.name)}<br><span>${esc(input.admin.email)}</span></p>
      <form method="post" action="/admin/logg-ut"><button class="admin-logout" type="submit">Logga ut</button></form>
    </div>
  </aside>
  <main class="admin-main" id="admin-main">
    <header class="admin-head">
      <div>
        <p class="admin-folio">Administration</p>
        <h1>${esc(input.title)}</h1>
        ${input.subtitle ? `<p class="admin-sub">${esc(input.subtitle)}</p>` : ""}
      </div>
    </header>
    ${input.flash ? `<p class="admin-flash" role="status">${esc(input.flash)}</p>` : ""}
    ${input.error ? `<p class="admin-error" role="alert">${esc(input.error)}</p>` : ""}
    ${input.content}
  </main>
</div>
</body>
</html>`;
}

/* ------------------------------------------------------------- auth screens */

export function adminLoginPage(input: { next?: string; error?: string; email?: string }): string {
  return `<!doctype html>
<html lang="sv" data-theme="light">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admininloggning · STOQWISE</title><meta name="robots" content="noindex, nofollow">
<link rel="stylesheet" href="/v3.css?v=143"><link rel="icon" href="/favicon.svg" type="image/svg+xml"></head>
<body class="admin-body admin-body--centered">
<main class="admin-auth">
  <p class="admin-folio">STOQWISE · Administration</p>
  <h1>Logga in</h1>
  <p class="admin-auth-lead">Separat inloggning för plattformsadministration, kunder, organisationer, kvoter och webbplatsinnehåll. Kundkonton har ingen åtkomst hit.</p>
  ${input.error ? `<p class="admin-error" role="alert">${esc(input.error)}</p>` : ""}
  <form method="post" action="/admin/logg-in" class="admin-form" autocomplete="on">
    <input type="hidden" name="nasta" value="${esc(input.next ?? "/admin")}">
    <label class="admin-field"><span>E-post</span>
      <input type="email" name="epost" value="${esc(input.email ?? "")}" required autocomplete="username" autofocus></label>
    <label class="admin-field"><span>Lösenord</span>
      <input type="password" name="losenord" required autocomplete="current-password"></label>
    <label class="admin-field"><span>Engångskod (om 2FA är aktiverat)</span>
      <input type="text" name="kod" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7"></label>
    <button class="admin-btn admin-btn--primary" type="submit">Logga in</button>
  </form>
  <p class="admin-auth-foot">Glömt lösenordet? Be systemägaren köra den lokala återställningen på servermaskinen. Den skapar nya engångsuppgifter i en skyddad fil och loggar åtgärden.</p>
</main>
</body></html>`;
}

export function adminSetupPage(input: { error?: string; configured: boolean; email?: string; name?: string }): string {
  return `<!doctype html>
<html lang="sv" data-theme="light">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Initiera administration · STOQWISE</title><meta name="robots" content="noindex, nofollow">
<link rel="stylesheet" href="/v3.css?v=143"><link rel="icon" href="/favicon.svg" type="image/svg+xml"></head>
<body class="admin-body admin-body--centered">
<main class="admin-auth">
  <p class="admin-folio">STOQWISE · Administration</p>
  <h1>Skapa första administratören</h1>
  ${
    input.configured
      ? `<p class="admin-auth-lead">Ange engångstoken från serverns miljövariabel <code>ADMIN_SETUP_TOKEN</code>. Flödet stängs automatiskt när ett administratörskonto finns.</p>`
      : `<p class="admin-error" role="alert">Initialisering är avstängd. Sätt <code>ADMIN_SETUP_TOKEN</code> (minst 16 tecken) i serverns miljö och starta om, eller be en befintlig administratör skapa kontot.</p>`
  }
  ${input.error ? `<p class="admin-error" role="alert">${esc(input.error)}</p>` : ""}
  <form method="post" action="/admin/init" class="admin-form">
    <label class="admin-field"><span>Engångstoken</span>
      <input type="password" name="token" required autocomplete="off"></label>
    <label class="admin-field"><span>Namn</span>
      <input type="text" name="namn" value="${esc(input.name ?? "")}" required maxlength="80" autocomplete="name"></label>
    <label class="admin-field"><span>E-post</span>
      <input type="email" name="epost" value="${esc(input.email ?? "")}" required maxlength="160" autocomplete="email"></label>
    <label class="admin-field"><span>Lösenord (minst 14 tecken)</span>
      <input type="password" name="losenord" required minlength="14" autocomplete="new-password"></label>
    <label class="admin-field"><span>Upprepa lösenord</span>
      <input type="password" name="losenord2" required minlength="14" autocomplete="new-password"></label>
    <button class="admin-btn admin-btn--primary" type="submit">Skapa administratör</button>
  </form>
</main>
</body></html>`;
}

/* ---------------------------------------------------------------- dashboard */

export interface DashboardData {
  siteCoverage: { filled: number; total: number };
  legalCoverage: { filled: number; total: number };
  siteMissing: FieldDef[];
  legalMissing: FieldDef[];
  siteDrafts: ContentDiff[];
  legalDrafts: ContentDiff[];
  siteVersion: VersionRow | null;
  legalVersion: VersionRow | null;
  siteVersions: number;
  legalVersions: number;
  edits: Array<{ key: string; label: string; updated_at: string; updated_by: string | null }>;
  audit: AdminAuditRow[];
}

export function adminDashboard(data: DashboardData): string {
  const statusCard = (title: string, coverage: { filled: number; total: number }, missing: FieldDef[], drafts: ContentDiff[], version: VersionRow | null, href: string, versions: number) => {
    const pct = coverage.total === 0 ? 0 : Math.round((coverage.filled / coverage.total) * 100);
    return `<section class="admin-card">
      <div class="admin-card-head"><h2>${title}</h2><a class="admin-link" href="${href}">Öppna</a></div>
      <dl class="admin-stats">
        <div><dt>Ifyllt</dt><dd>${coverage.filled}<span>/${coverage.total}</span></dd></div>
        <div><dt>Obligatoriska saknas</dt><dd class="${missing.length ? "is-warn" : ""}">${missing.length}</dd></div>
        <div><dt>Opublicerade ändringar</dt><dd class="${drafts.length ? "is-warn" : ""}">${drafts.length}</dd></div>
        <div><dt>Versioner</dt><dd>${versions}</dd></div>
      </dl>
      <div class="admin-progress" role="img" aria-label="${pct} procent ifyllt"><span style="width:${pct}%"></span></div>
      <p class="admin-meta">${
        version
          ? `Publicerad version ${version.version} · ${esc(version.created_at.slice(0, 16).replace("T", " "))} · ${esc(version.author ?? "okänd")}`
          : "Inget publicerat ännu. Webbplatsen visar den inbyggda texten."
      }</p>
    </section>`;
  };

  const missingList = (label: string, fields: FieldDef[], href: string) =>
    fields.length
      ? `<section class="admin-card"><div class="admin-card-head"><h2>${label}</h2><a class="admin-link" href="${href}">Fyll i</a></div>
         <ul class="admin-list">${fields.slice(0, 8).map((f) => `<li><span class="admin-dot" aria-hidden="true"></span>${esc(f.label)}</li>`).join("")}</ul>
         ${fields.length > 8 ? `<p class="admin-meta">och ${fields.length - 8} till</p>` : ""}</section>`
      : `<section class="admin-card"><div class="admin-card-head"><h2>${label}</h2></div><p class="admin-ok">Alla obligatoriska uppgifter är ifyllda.</p></section>`;

  return `
    <div class="admin-grid">
      ${statusCard("Webbplatsens innehåll", data.siteCoverage, data.siteMissing, data.siteDrafts, data.siteVersion, "/admin/innehall", data.siteVersions)}
      ${statusCard("Juridiska dokument", data.legalCoverage, data.legalMissing, data.legalDrafts, data.legalVersion, "/admin/juridik", data.legalVersions)}
    </div>
    <div class="admin-grid">
      ${missingList("Saknade uppgifter: juridik", data.legalMissing, "/admin/juridik")}
      ${missingList("Saknade uppgifter: webbplats", data.siteMissing, "/admin/innehall")}
    </div>
    <div class="admin-grid">
      <section class="admin-card">
        <div class="admin-card-head"><h2>Snabb åtkomst</h2></div>
        <div class="admin-shortcuts">
          <a href="/" target="_blank" rel="noopener">Startsidan ↗</a>
          <a href="/produkt" target="_blank" rel="noopener">Produkt ↗</a>
          <a href="/priser" target="_blank" rel="noopener">Prissättning ↗</a>
          <a href="/om-oss" target="_blank" rel="noopener">Om oss ↗</a>
          <a href="/kontakt" target="_blank" rel="noopener">Kontakt ↗</a>
          <a href="/integritet" target="_blank" rel="noopener">Integritetspolicy ↗</a>
          <a href="/villkor" target="_blank" rel="noopener">Användarvillkor ↗</a>
          <a href="/admin/forhandsgranska/juridik" target="_blank" rel="noopener">Förhandsgranska juridiska utkast ↗</a>
          <a href="/admin/forhandsgranska/webbplats" target="_blank" rel="noopener">Förhandsgranska webbplatsutkast ↗</a>
        </div>
      </section>
      <section class="admin-card">
        <div class="admin-card-head"><h2>Senaste ändringar</h2><a class="admin-link" href="/admin/logg">All aktivitet</a></div>
        ${
          data.edits.length
            ? `<ul class="admin-list">${data.edits
                .slice(0, 8)
                .map((e) => `<li><span class="admin-mono">${esc(e.updated_at.slice(0, 16).replace("T", " "))}</span> ${esc(e.label)}</li>`)
                .join("")}</ul>`
            : `<p class="admin-meta">Inga sparade utkast ännu.</p>`
        }
      </section>
    </div>
    <section class="admin-card">
      <div class="admin-card-head"><h2>Administratörsaktivitet</h2></div>
      ${
        data.audit.length
          ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Tid</th><th>Åtgärd</th><th>Objekt</th><th>IP</th></tr></thead><tbody>${data.audit
              .slice(0, 10)
              .map(
                (row) =>
                  `<tr><td class="admin-mono">${esc(row.created_at.slice(0, 16).replace("T", " "))}</td><td>${esc(actionLabel(row.action))}</td><td>${esc(row.target ?? "–")}</td><td class="admin-mono">${esc(row.ip ?? "–")}</td></tr>`,
              )
              .join("")}</tbody></table></div>`
          : `<p class="admin-meta">Ingen aktivitet loggad ännu.</p>`
      }
    </section>`;
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    "admin.setup": "Administratör initierad",
    "admin.login": "Inloggning",
    "admin.login_failed": "Misslyckad inloggning",
    "admin.logout": "Utloggning",
    "admin.password": "Lösenord ändrat",
    "admin.totp_enabled": "2FA aktiverat",
    "admin.totp_disabled": "2FA avstängt",
    "content.draft": "Utkast sparat",
    "content.publish": "Publicerat",
    "content.restore": "Version återställd",
    "section.draft": "Avsnitt sparat",
  };
  return map[action] ?? action;
}

/* ------------------------------------------------------------- content form */

function fieldControl(def: FieldDef, value: string, preview: boolean): string {
  const id = `f-${def.key.replace(/[^a-z0-9]+/gi, "-")}`;
  const missing = def.required && !value;
  const common = `id="${id}" name="${esc(def.key)}" maxlength="${def.maxLength ?? 2000}"${preview ? " disabled" : ""}${def.required ? " required" : ""}`;
  const control = def.multiline
    ? `<textarea ${common} rows="${value.length > 220 ? 5 : 3}">${esc(value)}</textarea>`
    : `<input type="text" ${common} value="${esc(value)}">`;
  return `<div class="admin-field${missing ? " is-missing" : ""}">
    <label for="${id}"><span>${esc(def.label)}</span>${def.required ? '<em aria-hidden="true">obligatorisk</em>' : ""}</label>
    ${control}
    ${def.help ? `<p class="admin-hint">${esc(def.help)}</p>` : ""}
  </div>`;
}

export function adminContentForm(input: {
  groups: FieldGroup[];
  values: Record<string, string>;
  action: string;
  heading: string;
  description: string;
  drafts: ContentDiff[];
  missing: FieldDef[];
  hasDrafts: boolean;
  previewHref: string;
  publishScope: "site" | "legal";
  savedAt?: string;
  publishedVersion?: number | null;
  locale: "sv" | "en";
}): string {
  const tabs = `<div class="admin-tabs" role="tablist" aria-label="Språk">
    <a role="tab" aria-selected="${input.locale === "sv"}" href="${input.action}?sprak=sv">Svenska</a>
    <a role="tab" aria-selected="${input.locale === "en"}" href="${input.action}?sprak=en">English</a>
  </div>`;
  const draftBanner = input.drafts.length
    ? `<p class="admin-flash">${input.drafts.length} opublicerade ändringar. Förhandsgranska innan du publicerar.</p>`
    : `<p class="admin-meta">Inga opublicerade ändringar.</p>`;

  const missingBanner = input.missing.length
    ? `<div class="admin-blocker"><h3>Obligatoriska uppgifter saknas (${input.missing.length})</h3>
       <p>Dokumentet kan sparas men publiceringen blir ofullständig tills dessa är ifyllda:</p>
       <ul>${input.missing.slice(0, 12).map((f) => `<li>${esc(f.label)}</li>`).join("")}</ul></div>`
    : `<p class="admin-ok">Alla obligatoriska uppgifter är ifyllda.</p>`;

  return `
    ${tabs}
    <div class="admin-toolbar">
      <div>${draftBanner}</div>
      <div class="admin-toolbar-actions">
        <a class="admin-btn" href="${input.previewHref}" target="_blank" rel="noopener">Förhandsgranska utkast ↗</a>
      </div>
    </div>
    ${missingBanner}
    <form method="post" action="${input.action}" class="admin-form admin-form--wide">
      <input type="hidden" name="sprak" value="${input.locale}">
      ${input.groups
        .map(
          (group) => `<fieldset class="admin-fieldset">
            <legend>${esc(group.title)}</legend>
            <p class="admin-hint">${esc(group.description)}</p>
            <div class="admin-fields">
              ${group.fields.map((def) => fieldControl(def, input.values[def.key] ?? "", false)).join("")}
            </div>
          </fieldset>`,
        )
        .join("")}
      <div class="admin-form-actions">
        <button class="admin-btn admin-btn--primary" type="submit" name="atgard" value="spara">Spara utkast</button>
        <span class="admin-meta">${input.savedAt ? `Senast sparat ${esc(input.savedAt)}` : ""}</span>
      </div>
    </form>
    <section class="admin-card admin-publish">
      <div class="admin-card-head"><h2>Publicera</h2></div>
      ${draftChangesTable(input.drafts)}
      <form method="post" action="/admin/publicera" class="admin-form admin-form--inline">
        <input type="hidden" name="omrade" value="${input.publishScope}">
        <input type="hidden" name="sprak" value="${input.locale}">
        <label class="admin-field"><span>Ändringsbeskrivning</span>
          <input type="text" name="notering" maxlength="200" placeholder="Till exempel: företagsuppgifter ifyllda" required></label>
        <label class="admin-check"><input type="checkbox" name="bekrafta" value="1" required> Jag har granskat förhandsgranskningen och publicerar ändringarna.</label>
        <button class="admin-btn admin-btn--primary" type="submit"${input.drafts.length ? "" : " disabled"}>Publicera ny version</button>
      </form>
      <p class="admin-meta">Varje publicering skapar en ny version. Historiken skrivs aldrig över.</p>
    </section>`;
}

function draftChangesTable(drafts: ContentDiff[]): string {
  if (!drafts.length) return `<p class="admin-meta">Inget att publicera.</p>`;
  return `<div class="admin-table-wrap"><table class="admin-table">
    <thead><tr><th>Fält</th><th>Publicerat</th><th>Utkast</th></tr></thead>
    <tbody>${drafts
      .map(
        (d) =>
          `<tr><td>${esc(d.label)}</td><td class="admin-dim">${d.published ? esc(clip(d.published)) : "<em>tomt</em>"}</td><td>${d.draft ? esc(clip(d.draft)) : "<em>tomt</em>"}</td></tr>`,
      )
      .join("")}</tbody></table></div>`;
}

const clip = (value: string): string => (value.length > 120 ? `${value.slice(0, 117)}…` : value);

/* --------------------------------------------------------------- legal page */

export interface LegalSectionRow {
  doc: "integritet" | "villkor";
  id: string;
  title: string;
  hasOverride: boolean;
}

export function adminLegalPage(input: {
  groups: FieldGroup[];
  values: Record<string, string>;
  drafts: ContentDiff[];
  missing: FieldDef[];
  sections: LegalSectionRow[];
  savedAt?: string;
  locale: "sv" | "en";
}): string {
  const sections = (doc: "integritet" | "villkor", label: string) => {
    const rows = input.sections.filter((s) => s.doc === doc);
    return `<section class="admin-card">
      <div class="admin-card-head"><h2>${label}</h2><span class="admin-meta">${rows.length} avsnitt</span></div>
      <ul class="admin-sections">
        ${rows
          .map(
            (s) =>
              `<li><a href="/admin/juridik/avsnitt/${doc}/${s.id}">${esc(s.title)}</a>${s.hasOverride ? '<span class="admin-badge">redigerad</span>' : ""}</li>`,
          )
          .join("")}
      </ul>
    </section>`;
  };

  return `
    ${adminContentForm({
      groups: input.groups,
      values: input.values,
      action: "/admin/juridik",
      heading: "Juridiska dokument",
      description: "Strukturerade fält som fyller i platshållarna i integritetspolicyn och användarvillkoren.",
      drafts: input.drafts,
      missing: input.missing,
      hasDrafts: input.drafts.length > 0,
      previewHref: "/admin/forhandsgranska/juridik",
      publishScope: "legal",
      savedAt: input.savedAt,
      locale: input.locale,
    })}
    <div class="admin-grid">
      ${sections("integritet", "Integritetspolicy: avsnitt")}
      ${sections("villkor", "Användarvillkor: avsnitt")}
    </div>`;
}

export function adminSectionPage(input: {
  doc: "integritet" | "villkor";
  sectionId: string;
  title: string;
  body: string;
  builtInTitle: string;
  saved: boolean;
}): string {
  return `
    <p class="admin-meta"><a class="admin-link" href="/admin/juridik">← Tillbaka till juridiken</a></p>
    <form method="post" action="/admin/juridik/avsnitt/${input.doc}/${input.sectionId}" class="admin-form admin-form--wide">
      <label class="admin-field"><span>Rubrik</span>
        <input type="text" name="rubrik" value="${esc(input.title)}" maxlength="180"></label>
      <label class="admin-field"><span>Brödtext</span>
        <textarea name="brodtext" rows="18" maxlength="12000" spellcheck="true">${esc(input.body)}</textarea>
        <p class="admin-hint">Tom rad mellan stycken blir nytt stycke. En rad som börjar med "- " blir en punkt i en lista. Länkar skrivs som [text](/sokvag). HTML tillåts inte.</p></label>
      <div class="admin-form-actions">
        <button class="admin-btn admin-btn--primary" type="submit">Spara utkast till avsnittet</button>
        <span class="admin-meta">Inbyggd text: ${esc(input.builtInTitle)}</span>
      </div>
    </form>
    <section class="admin-card">
      <div class="admin-card-head"><h2>Återställ avsnittet</h2></div>
      <p class="admin-meta">Sparar den inbyggda texten igen. Ändringen publiceras först när du publicerar juridiken.</p>
      <form method="post" action="/admin/juridik/avsnitt/${input.doc}/${input.sectionId}">
        <input type="hidden" name="atgard" value="aterstall">
        <button class="admin-btn" type="submit">Använd inbyggd text</button>
      </form>
    </section>`;
}

/* ---------------------------------------------------------------- versions */

export function adminVersionsPage(input: { scope: "site" | "legal"; versions: VersionRow[]; current: VersionRow | null }): string {
  const label = input.scope === "site" ? "Webbplatsens innehåll" : "Juridiska dokument";
  const rows = input.versions
    .map(
      (v) => `<tr>
        <td class="admin-mono">v${v.version}</td>
        <td class="admin-mono">${esc(v.created_at.slice(0, 16).replace("T", " "))}</td>
        <td>${esc(v.author ?? "okänd")}</td>
        <td>${esc(v.note ?? "")}</td>
        <td><a class="admin-link" href="/admin/versioner/${v.id}">Granska</a></td>
      </tr>`,
    )
    .join("");
  return `
    <div class="admin-tabs" role="tablist">
      <a role="tab" aria-selected="${input.scope === "site"}" href="/admin/versioner?omrade=webbplats">Webbplats</a>
      <a role="tab" aria-selected="${input.scope === "legal"}" href="/admin/versioner?omrade=juridik">Juridik</a>
    </div>
    <section class="admin-card">
      <div class="admin-card-head"><h2>Publiceringshistorik: ${label}</h2>
        <span class="admin-meta">${input.current ? `Senaste: v${input.current.version}` : "Ingen publicering ännu"}</span></div>
      ${
        input.versions.length
          ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Version</th><th>Tidpunkt</th><th>Administratör</th><th>Beskrivning</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
          : `<p class="admin-meta">Inga versioner ännu. Publicera för att skapa den första.</p>`
      }
    </section>`;
}

export function adminVersionPage(input: {
  version: VersionRow;
  scope: "site" | "legal";
  changes: Array<{ key: string; label: string; then: string; now: string }>;
}): string {
  return `
    <p class="admin-meta"><a class="admin-link" href="/admin/versioner?omrade=${input.scope === "site" ? "webbplats" : "juridik"}">← Alla versioner</a></p>
    <section class="admin-card">
      <div class="admin-card-head"><h2>Version ${input.version.version}</h2>
        <span class="admin-meta">${esc(input.version.created_at.slice(0, 16).replace("T", " "))} · ${esc(input.version.author ?? "okänd")} · ${esc(input.version.note ?? "")}</span></div>
      ${
        input.changes.length
          ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Fält</th><th>I versionen</th><th>Publicerat nu</th></tr></thead><tbody>${input.changes
              .map((c) => `<tr><td>${esc(c.label)}</td><td>${c.then ? esc(clip(c.then)) : "<em>tomt</em>"}</td><td class="admin-dim">${c.now ? esc(clip(c.now)) : "<em>tomt</em>"}</td></tr>`)
              .join("")}</tbody></table></div>`
          : `<p class="admin-meta">Versionen skiljer sig inte från det som är publicerat nu.</p>`
      }
      <form method="post" action="/admin/versioner/${input.version.id}/aterstall" class="admin-form admin-form--inline">
        <label class="admin-check"><input type="checkbox" name="bekrafta" value="1" required> Jag vill återställa versionen som utkast och granska den innan publicering.</label>
        <button class="admin-btn" type="submit">Återställ som utkast</button>
      </form>
    </section>`;
}

/* ------------------------------------------------------------------- audit */

export function adminAuditPage(input: { rows: AdminAuditRow[]; adminNames: Record<string, string> }): string {
  return `<section class="admin-card">
    <div class="admin-card-head"><h2>Aktivitetslogg</h2><span class="admin-meta">Senaste ${input.rows.length} händelserna</span></div>
    ${
      input.rows.length
        ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Tid</th><th>Administratör</th><th>Åtgärd</th><th>Objekt</th><th>IP</th></tr></thead><tbody>${input.rows
            .map(
              (row) =>
                `<tr><td class="admin-mono">${esc(row.created_at.slice(0, 16).replace("T", " "))}</td><td>${esc(input.adminNames[row.admin_id ?? ""] ?? row.admin_id?.slice(0, 8) ?? "system")}</td><td>${esc(actionLabel(row.action))}</td><td>${esc(row.target ?? "–")}</td><td class="admin-mono">${esc(row.ip ?? "–")}</td></tr>`,
            )
            .join("")}</tbody></table></div>`
        : `<p class="admin-meta">Ingen aktivitet ännu.</p>`
    }
  </section>`;
}

/* ----------------------------------------------------------------- account */

export function adminAccountPage(input: {
  admin: AdminRow;
  totpUri: string | null;
  totpSecret: string | null;
  error?: string;
  flash?: string;
}): string {
  const totp = input.admin.totp_enabled
    ? `<section class="admin-card">
        <div class="admin-card-head"><h2>Tvåfaktorsautentisering</h2><span class="admin-badge admin-badge--ok">Aktiverad</span></div>
        <p class="admin-meta">Inloggning kräver engångskod från din autentiseringsapp.</p>
        <form method="post" action="/admin/konto/totp/stang">
          <label class="admin-check"><input type="checkbox" name="bekrafta" value="1" required> Stäng av tvåfaktorsautentisering.</label>
          <label class="admin-field"><span>Nuvarande lösenord</span><input type="password" name="losenord" required autocomplete="current-password"></label>
          <label class="admin-field"><span>Engångskod från appen</span><input type="text" name="kod" inputmode="numeric" pattern="[0-9 ]{6,7}" maxlength="7" required></label>
          <button class="admin-btn" type="submit">Stäng av 2FA</button>
        </form>
      </section>`
    : input.totpSecret && input.totpUri
      ? `<section class="admin-card">
          <div class="admin-card-head"><h2>Aktivera tvåfaktorsautentisering</h2></div>
          <p class="admin-meta">Lägg in kontot manuellt i din autentiseringsapp (Google Authenticator, 1Password, Authy) med hemligheten nedan, eller öppna länken.</p>
          <p class="admin-secret"><code>${esc(input.totpSecret)}</code></p>
          <p><a class="admin-link" href="${esc(input.totpUri)}">Öppna otpauth-länk</a></p>
          <form method="post" action="/admin/konto/totp/aktivera" class="admin-form admin-form--inline">
            <label class="admin-field"><span>Engångskod från appen</span>
              <input type="text" name="kod" inputmode="numeric" pattern="[0-9 ]{6,7}" maxlength="7" required></label>
            <button class="admin-btn admin-btn--primary" type="submit">Aktivera</button>
          </form>
        </section>`
      : `<section class="admin-card">
          <div class="admin-card-head"><h2>Tvåfaktorsautentisering</h2><span class="admin-badge">Av</span></div>
          <p class="admin-meta">Rekommenderas för alla administratörskonton. Fungerar med valfri TOTP-app.</p>
          <form method="post" action="/admin/konto/totp/start"><button class="admin-btn" type="submit">Aktivera 2FA</button></form>
        </section>`;

  return `
    <div class="admin-grid">
      <section class="admin-card">
        <div class="admin-card-head"><h2>Konto</h2></div>
        <dl class="admin-stats">
          <div><dt>Namn</dt><dd class="admin-dd-text">${esc(input.admin.name)}</dd></div>
          <div><dt>E-post</dt><dd class="admin-dd-text">${esc(input.admin.email)}</dd></div>
          <div><dt>Roll</dt><dd class="admin-dd-text">${esc(input.admin.role)}</dd></div>
          <div><dt>Senaste inloggning</dt><dd class="admin-dd-text">${esc((input.admin.last_login_at ?? "–").slice(0, 16).replace("T", " "))}</dd></div>
        </dl>
      </section>
      <section class="admin-card">
        <div class="admin-card-head"><h2>Byt lösenord</h2></div>
        <form method="post" action="/admin/konto/losenord" class="admin-form">
          <label class="admin-field"><span>Nuvarande lösenord</span><input type="password" name="nuvarande" required autocomplete="current-password"></label>
          <label class="admin-field"><span>Nytt lösenord (minst 14 tecken)</span><input type="password" name="nytt" required minlength="14" autocomplete="new-password"></label>
          <label class="admin-field"><span>Upprepa nytt lösenord</span><input type="password" name="nytt2" required minlength="14" autocomplete="new-password"></label>
          <button class="admin-btn admin-btn--primary" type="submit">Spara lösenord</button>
        </form>
      </section>
    </div>
    ${totp}`;
}

export { SITE_GROUPS, LEGAL_GROUPS };
