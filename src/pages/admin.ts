/**
 * Administrative surfaces: imports, integrations, team, billing, audit and
 * settings. These pages own no calculations - they configure and observe the
 * pipeline that `pipeline.ts` runs.
 */
import type { Role } from "../data/repo.ts";
import { EMAILS } from "../brand.ts";
import { can, limitsFor, planLimits } from "../data/repo.ts";
import type { IntegrationDefinition } from "../integrations/index.ts";
import { alert, badge, card, emptyState, esc, flash, icon, shell, table } from "../ui/base.ts";
import { appDate, appDateTime, appNum, appPct, appSek, appText, appTranslator } from "../i18n-app.ts";
import type { Locale } from "../i18n.ts";
import type { PageContext } from "./core.ts";

const num = (locale: Locale, n: number, d = 0): string => appNum(locale, n, d);
const sv = (locale: Locale, n: number): string => appNum(locale, n, 0);
const sek = (locale: Locale, n: number): string => appSek(locale, n);
const pct = (locale: Locale, n: number, d = 1): string => appPct(locale, n, d);
const date = (locale: Locale, iso: string): string => appDate(locale, iso);
const dateTime = (locale: Locale, iso: string): string => appDateTime(locale, iso);

/* ---------------------------------------------------------------- imports */

export function importsPage(input: PageContext & {
  analyses: Array<{ id: string; filename: string; rows: number; created_at: string; source: string | null }>;
  imports: Array<{ id: string; filename: string; source: string; rows: number; imported: number; skipped: number; status: string; error: string | null; started_at: string }>;
  limit: number;
  usedThisMonth: number;
}): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const history = input.imports.length
    ? table({
        columns: [
          { key: "filename", label: t("Fil") },
          { key: "source", label: t("Källa") },
          { key: "rows", label: t("Rader"), align: "right" },
          { key: "imported", label: t("Artiklar"), align: "right" },
          { key: "skipped", label: t("Överhoppade"), align: "right" },
          { key: "status", label: t("Status") },
          { key: "started", label: t("Tid") },
        ],
        rows: input.imports.map((i) => ({
          filename: esc(i.filename),
          source: esc(i.source),
          rows: sv(locale, i.rows),
          imported: sv(locale, i.imported),
          skipped: sv(locale, i.skipped),
          status: i.status === "ok" ? badge("Klar", "ok") : i.status === "failed" ? badge("Fel", "danger") : badge("Pågår", "warn"),
          started: `<span class="tag-inline">${dateTime(locale, i.started_at)}</span>`,
        })),
        empty: t("Inga importer ännu."),
      })
    : emptyState("Inga importer ännu", "Ladda upp en CSV eller Excel-fil för att komma igång.");

  const analyses = input.analyses.length
    ? table({
        columns: [
          { key: "filename", label: t("Analys") },
          { key: "rows", label: t("Artiklar"), align: "right" },
          { key: "source", label: t("Källa") },
          { key: "created", label: t("Skapad") },
          { key: "open", label: "" },
        ],
        rows: input.analyses.map((a) => ({
          filename: esc(a.filename),
          rows: sv(locale, a.rows),
          source: esc(a.source ?? "csv"),
          created: date(locale, a.created_at),
          open: `<a class="link-btn" href="/app?analys=${a.id}">${t("Öppna →")}</a>`,
        })),
      })
    : "";

  return shell({
    locale,
    path: input.url.pathname + input.url.search,
    title: t("Importer"),
    active: "imports",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: t("{used} av {limit} analyser använda den här månaden.", { used: input.usedThisMonth, limit: input.limit }),
    content: `
    ${flash(input.url, locale)}
    <div class="grid">
      <section class="card span-7"><div class="card-head"><div><h2>${t("Ny import")}</h2><p>${t("CSV eller Excel. Automatisk kolumnigenkänning, manuell justering i nästa steg.")}</p></div></div>
        <div class="card-body">
          <form method="post" action="/app/importera" enctype="multipart/form-data" data-busy="${t("Läser filen…")}">
            <div class="form-row">
              <label for="file">${t("Fil")}</label>
              <input id="file" name="file" type="file" accept=".csv,.txt,.tsv,.xlsx" required>
              <span class="hint">${t("Max 12 MB och 500 000 rader. Filen sparas aldrig på disk, endast tolkade rader.")}</span>
            </div>
            <div class="field-grid">
              <div class="form-row"><label for="lager">${t("Lager / enhet")}</label>
                <input id="lager" name="lager" type="text" placeholder="Huvudlager" maxlength="60"></div>
            <div class="form-row"><label for="kalla">${t("Källa")}</label>
                <select id="kalla" name="kalla">
                  <option value="csv">${t("CSV-export")}</option>
                  <option value="excel">Excel (.xlsx)</option>
                </select></div>
            </div>
            <button class="btn" type="submit">${icon("upload", 16)} ${t("Läs in och granska")}</button>
          </form>
        </div>
      </section>

      ${card({
        span: 5,
        title: t("Vad som krävs"),
        body: `<ul class="prose" style="margin:0;padding-left:18px;font-size:13.5px">
          <li><strong>${t("Lagersaldo")}</strong> ${t("per artikel (obligatoriskt)")}</li>
          <li><strong>${t("Inköpspris")}</strong> ${t("per artikel (obligatoriskt)")}</li>
          <li><strong>${t("Försäljning")}</strong> ${t("antingen som månadskolumner (2025-01 …) eller som total kvantitet")}</li>
          <li>${t("Artikelnummer, benämning, kategori, leverantör, ledtid och minsta orderkvantitet höjer kvaliteten")}</li>
        </ul>
        <p class="hint mt-4">${t("Kolumnnamn känns igen på svenska och engelska. Saknas något kan du mappa manuellt.")}</p>`,
      })}

      ${card({ span: 12, title: t("Importhistorik"), subtitle: t("Varje körning loggas med radantal, fel och varningar."), body: history })}
      ${analyses ? card({ span: 12, title: t("Analyser"), body: analyses }) : ""}
    </div>`,
  });
}

/* ------------------------------------------------------------ mapping step */

export function mappingPage(input: PageContext & {
  draftId: string;
  filename: string;
  headers: string[];
  sampleRows: string[][];
  columns: Record<string, number | null>;
  monthColumns: Array<{ index: number; label: string }>;
  warnings: string[];
  fields: Array<{ key: string; label: string }>;
  rowCount: number;
}): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const select = (key: string): string => {
    const options = input.headers
      .map((h, i) => `<option value="${i}" ${input.columns[key] === i ? "selected" : ""}>${esc(h)}</option>`)
      .join("");
    return `<select id="col-${key}" name="col_${key}"><option value="">${t("Ingen")}</option>${options}</select>`;
  };

  const preview = `<div class="table-wrap"><table class="data-table"><thead><tr>${input.headers
    .map((h) => `<th>${esc(h)}</th>`)
    .join("")}</tr></thead><tbody>${input.sampleRows
    .map((row) => `<tr>${input.headers.map((_, i) => `<td class="mono">${esc(row[i] ?? "")}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;

  const monthChoices = input.headers
    .map((h, i) => {
      const checked = input.monthColumns.some((m) => m.index === i) ? "checked" : "";
      return `<label class="flex center gap-2" style="text-transform:none;font-size:12.5px;letter-spacing:0;font-weight:400">
        <input type="checkbox" name="months" value="${i}" ${checked}> ${esc(h)}</label>`;
    })
    .join("");

  return shell({
    locale,
    path: input.url.pathname + input.url.search,
    title: t("Granska mappning"),
    active: "imports",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: `${esc(input.filename)} · ${sv(locale, input.rowCount)} rader · ${input.headers.length} kolumner`,
    content: `
    <form method="post" action="/app/importera/kor" data-busy="${t("Analyserar…")}">
      <input type="hidden" name="draft" value="${input.draftId}">
      <div class="grid">
        ${card({
          span: 8,
          title: t("Kolumnmappning"),
          subtitle: t("Förvalt utifrån rubriker och datans form. Ändra där det behövs."),
          body: `<div class="field-grid">${input.fields
            .map(
              (f) => `<div class="form-row"><label for="col-${f.key}">${esc(f.label)}${["stock", "cost"].includes(f.key) ? " *" : ""}</label>${select(f.key)}</div>`,
            )
            .join("")}</div>`,
        })}
        ${card({
          span: 4,
          title: t("Inställningar"),
          body: `<div class="form-row"><label for="serviceniva">${t("Servicenivå")}</label>
              <select id="serviceniva" name="serviceniva">
                ${[0.9, 0.95, 0.98, 0.99].map((s) => `<option value="${s}" ${s === 0.95 ? "selected" : ""}>${Math.round(s * 100)} %</option>`).join("")}
              </select></div>
            <div class="form-row"><label for="dodlager">${t("Fönster för inaktivt lager")}</label>
              <select id="dodlager" name="dodlager">
                ${[90, 180, 365].map((d) => `<option value="${d}" ${d === 180 ? "selected" : ""}>${d} dagar</option>`).join("")}
              </select></div>
            <div class="form-row"><label for="lager2">${t("Lager")}</label>
              <input id="lager2" name="lager" type="text" value="Huvudlager" maxlength="60"></div>
            <button class="btn" type="submit" style="width:100%">${icon("play", 15)} ${t("Kör analys")}</button>`,
        })}
        ${card({
          span: 12,
          title: t("Månadskolumner"),
          subtitle: t("Markera de kolumner som innehåller såld kvantitet per månad. Minst två ger säsong och XYZ."),
          body: `<div class="flex wrap gap-3">${monthChoices}</div>`,
        })}
        ${input.warnings.length ? card({ span: 12, title: t("Varningar från tolkningen"), body: input.warnings.map((w) => alert(esc(w), "warn")).join("") }) : ""}
        ${card({ span: 12, title: t("Förhandsgranskning"), body: preview })}
      </div>
    </form>`,
  });
}

/* ---------------------------------------------------------- integrations */

export function integrationsPage(input: PageContext & {
  integrations: Array<IntegrationDefinition & { connected: boolean; missing: string[] }>;
  apiKeys: Array<{ id: string; name: string; prefix: string; scopes: string; created_at: string; last_used_at: string | null }>;
  webhooks: Array<{ id: string; url: string; events: string; created_at: string }>;
  deliveries: Array<{ event: string; status: string; response_code: number | null; attempts: number; error: string | null; created_at: string; url: string }>;
  newKey?: string;
}): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const apiAccess = can(input.role, "api.manage");

  const cards = input.integrations
    .map(
      (i) => `<article class="integration">
      <div class="integration-head"><h3>${esc(i.name)}</h3>
        ${i.connected ? badge(t("Redo"), "ok") : badge(t("Kräver uppgifter"), "warn")}</div>
      <p>${esc(appText(locale, i.summary))}</p>
      <ul>${i.capabilities.slice(0, 4).map((c) => `<li>${esc(c.replace(/_/g, " "))}</li>`).join("")}</ul>
      ${
        i.missing.length
          ? `<p class="hint">${t("Saknas:")} <span class="mono">${i.missing.map(esc).join(", ")}</span></p>`
          : ""
      }
      <div class="integration-foot">
        ${i.status === "available" ? `<a class="link-btn" href="/app/importera">${t("Importera fil →")}</a>` : `<span class="tag-inline">${esc(i.authType)}</span>`}
        <a class="link-btn" href="${esc(i.docsUrl)}" rel="noopener noreferrer" target="_blank">${t("Dokumentation")}</a>
      </div>
    </article>`,
    )
    .join("");

  const keyTable = input.apiKeys.length
    ? table({
        columns: [
          { key: "name", label: t("Namn") },
          { key: "prefix", label: t("Prefix") },
          { key: "scopes", label: t("Scope") },
          { key: "last", label: t("Senast använd") },
          { key: "action", label: "" },
        ],
        rows: input.apiKeys.map((k) => ({
          name: esc(k.name),
          prefix: `<span class="mono">${esc(k.prefix)}…</span>`,
          scopes: badge(k.scopes === "write" ? "läs + skriv" : "läs", k.scopes === "write" ? "info" : "default"),
          last: k.last_used_at ? date(locale, k.last_used_at) : "aldrig",
          action: `<form method="post" action="/app/integrationer/nyckel/aterkalla"><input type="hidden" name="id" value="${k.id}"><button class="link-btn" type="submit">Återkalla</button></form>`,
        })),
      })
    : `<p class="muted">${t("Inga API-nycklar ännu.")}</p>`;

  const hookTable = input.webhooks.length
    ? table({
        columns: [
          { key: "url", label: t("Endpoint") },
          { key: "events", label: t("Händelser") },
          { key: "created", label: t("Skapad") },
          { key: "action", label: "" },
        ],
        rows: input.webhooks.map((w) => ({
          url: `<span class="mono">${esc(w.url)}</span>`,
          events: esc(w.events),
          created: date(locale, w.created_at),
          action: `<form method="post" action="/app/integrationer/webhook/radera" data-confirm="${esc(t("Ta bort webhooken?"))}"><input type="hidden" name="id" value="${w.id}"><button class="link-btn" type="submit">${t("Ta bort")}</button></form>`,
        })),
      })
    : `<p class="muted">Inga webhooks registrerade.</p>`;

  const deliveries = input.deliveries.length
    ? table({
        columns: [
          { key: "event", label: t("Händelse") },
          { key: "url", label: t("Endpoint") },
          { key: "status", label: t("Status") },
          { key: "code", label: t("Svar"), align: "right" },
          { key: "time", label: t("Tid") },
        ],
        rows: input.deliveries.map((d) => ({
          event: esc(d.event),
          url: `<span class="mono">${esc(d.url)}</span>`,
          status: d.status === "ok" ? badge("OK", "ok") : badge("Fel", "danger"),
          code: d.response_code ?? "–",
          time: `<span class="tag-inline">${dateTime(locale, d.created_at)}</span>`,
        })),
      })
    : `<p class="muted">${t("Inga leveranser ännu. De loggas när en händelse skickas.")}</p>`;

  return shell({
    locale,
    path: input.url.pathname + input.url.search,
    title: t("Integrationer"),
    active: "integrations",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: t("API, webhooks, importhistorik och förberedda kopplingar mot ERP och WMS."),
    content: `
    ${flash(input.url, locale)}
    ${input.newKey ? alert(`Ny API-nyckel skapad. Kopiera den nu. Den visas aldrig igen:<br><code style="font-size:13px">${esc(input.newKey)}</code>`, "ok") : ""}
    ${card({ title: t("Anslutningar"), subtitle: t("Gröna är redo att användas. Gula kräver uppgifter i serverns miljö."), body: `<div class="integration-grid">${cards}</div>` })}

    <div class="grid mt-4">
      ${card({
        span: 6,
        title: t("API-nycklar"),
        subtitle: t("Bearer-token för REST-API:t. Endast hash lagras."),
        body: apiAccess
          ? `<form class="filterbar" method="post" action="/app/integrationer/nyckel" style="margin-bottom:14px">
              <div class="form-row grow"><label for="keyname">${t("Namn")}</label><input id="keyname" name="namn" type="text" placeholder="Fortnox sync" required></div>
              <div class="form-row"><label for="scope">${t("Scope")}</label><select id="scope" name="scope"><option value="read">${t("Läs")}</option><option value="write">${t("Läs + skriv")}</option></select></div>
              <button class="btn btn-sm" type="submit">${icon("plus", 14)} ${t("Skapa")}</button>
            </form>` + keyTable
          : `<p class="muted">Din roll kan se men inte hantera API-nycklar.</p>`,
      })}
      ${card({
        span: 6,
        title: t("Webhooks"),
        subtitle: t("Signeras med HMAC-SHA256 i header X-Stoqwise-Signature."),
        body:
          (apiAccess
            ? `<form class="filterbar" method="post" action="/app/integrationer/webhook" style="margin-bottom:14px">
                <div class="form-row grow"><label for="hookurl">${t("Endpoint")}</label><input id="hookurl" name="url" type="url" placeholder="https://…" required></div>
                <div class="form-row grow"><label for="hookev">${t("Händelser")}</label><input id="hookev" name="events" type="text" value="analysis.completed" placeholder="analysis.completed,stockout.risk"></div>
                <button class="btn btn-sm" type="submit">${icon("plus", 14)} ${t("Lägg till")}</button>
              </form>`
            : "") + hookTable,
      })}
      ${card({ span: 12, title: t("Leveranslogg"), subtitle: t("Max tre försök per händelse, med backoff."), body: deliveries })}
      ${card({
        span: 12,
        title: t("Importhistorik"),
        subtitle: t("Varje manuell import loggas med radantal, fel och varningar."),
        body: `<p class="muted" style="font-size:13px">${t("Öppna Importer för att se de senaste körningarna och ladda upp en ny fil.")}</p><a class="link-btn" href="/app/importera">${t("Till importer →")}</a>`,
      })}
    </div>`,
  });
}

/* ------------------------------------------------------------------- team */

export function teamPage(input: PageContext & {
  members: Array<{ user_id: string; email: string; name: string; role: Role; created_at: string }>;
  invitations: Array<{ id: string; email: string; role: Role; expires_at: string; accepted_at: string | null }>;
  inviteLink?: string;
  limit: number;
}): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const manage = can(input.role, "members.manage");

  const rows = input.members.map((m) => ({
    name: `${esc(m.name)}${m.user_id === input.user.id ? ' <span class="tag-inline">(du)</span>' : ""}`,
    email: esc(m.email),
    role:
      manage && m.role !== "owner" && m.user_id !== input.user.id
        ? `<form method="post" action="/app/team/roll" class="flex gap-2 center">
            <input type="hidden" name="user" value="${m.user_id}">
            <select name="roll" data-autosubmit aria-label="Roll för ${esc(m.email)}" style="padding:4px 26px 4px 8px;font-size:12px">
              ${(["admin", "analyst", "viewer"] as Role[]).map((r) => `<option value="${r}" ${m.role === r ? "selected" : ""}>${roleLabel(r, locale)}</option>`).join("")}
            </select></form>`
        : badge(roleLabel(m.role, locale), m.role === "owner" ? "info" : "default"),
    joined: date(locale, m.created_at),
    action:
      manage && m.role !== "owner" && m.user_id !== input.user.id
        ? `<form method="post" action="/app/team/ta-bort" data-confirm="${esc(t("Ta bort användaren från organisationen?"))}"><input type="hidden" name="user" value="${m.user_id}"><button class="link-btn" type="submit">${t("Ta bort")}</button></form>`
        : "",
  }));

  return shell({
    locale,
    path: input.url.pathname + input.url.search,
    title: t("Team"),
    active: "team",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: t("{n} av {limit} platser använda. Roller styr både meny och behörigheter på servern.", { n: input.members.length, limit: input.limit }),
    content: `
    ${flash(input.url, locale)}
    <div class="grid">
      ${card({
        span: 8,
        title: t("Medlemmar"),
        body: table({
          columns: [
            { key: "name", label: t("Namn") },
            { key: "email", label: t("E-post") },
            { key: "role", label: t("Roll") },
            { key: "joined", label: t("Medlem sedan") },
            { key: "action", label: "" },
          ],
          rows,
        }),
      })}
      ${card({
        span: 4,
        title: t("Bjud in"),
        subtitle: t("Länken är engångs och giltig i sju dagar."),
        body: manage
          ? `<form method="post" action="/app/team/bjud-in">
              <div class="form-row"><label for="invemail">${t("E-post")}</label><input id="invemail" name="email" type="email" required></div>
              <div class="form-row"><label for="invrole">${t("Roll")}</label>
                <select id="invrole" name="roll"><option value="analyst">${t("Analytiker")}</option><option value="viewer">${t("Läsare")}</option><option value="admin">${t("Administratör")}</option></select></div>
              <button class="btn" type="submit" style="width:100%">${icon("plus", 15)} ${t("Skapa inbjudan")}</button>
            </form>
            ${input.inviteLink ? alert(`Inbjudningslänk:<br><code style="font-size:12.5px">${esc(input.inviteLink)}</code>`, "ok") : ""}
            <div class="rule"></div>
            <h3>${t("Roller")}</h3>
            <dl class="stat-line"><dt>${t("Ägare")}</dt><dd>${t("allt, inkl. fakturering")}</dd></dl>
            <dl class="stat-line"><dt>${t("Administratör")}</dt><dd>${t("team, API, data")}</dd></dl>
            <dl class="stat-line"><dt>${t("Analytiker")}</dt><dd>${t("import och analys")}</dd></dl>
            <dl class="stat-line"><dt>${t("Läsare")}</dt><dd>${t("endast läsning")}</dd></dl>`
          : `<p class="muted">${t("Din roll kan inte bjuda in användare.")}</p>`,
      })}
      ${card({
        span: 12,
        title: t("Inbjudningar"),
        body: input.invitations.length
          ? table({
              columns: [
                { key: "email", label: t("E-post") },
                { key: "role", label: t("Roll") },
                { key: "expires", label: t("Giltig till") },
                { key: "status", label: t("Status") },
              ],
              rows: input.invitations.map((i) => ({
                email: esc(i.email),
                role: esc(roleLabel(i.role, locale)),
                expires: date(locale, i.expires_at),
                status: i.accepted_at ? badge("Accepterad", "ok") : badge("Väntar", "warn"),
              })),
            })
          : `<p class="muted">Inga inbjudningar skickade.</p>`,
      })}
    </div>`,
  });
}

function roleLabel(role: Role, locale: Locale): string {
  return appText(locale, { owner: "Ägare", admin: "Administratör", analyst: "Analytiker", viewer: "Läsare" }[role]);
}

/* ---------------------------------------------------------------- billing */

export function billingPage(input: PageContext & {
  subscription: { plan: string; status: string; current_period_end: string | null } | null;
  usage: { analyses: number; copilot: number; members: number; skus: number };
  stripeReady: boolean;
}): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const current = limitsFor(input.org.plan);
  const packageCard = `<article class="commercial-callout">
    <p class="eyebrow">${t("Intern konfiguration")}</p>
    <h3>${esc(appText(locale, current.name))}</h3>
    <p class="muted">${t("Pris och omfattning styrs av er affärsprofil och en personlig offert. Här ser ni den interna konfigurationen och användningen.")}</p>
    <div class="kv compact">
      <div><dt>${t("Artiklar")}</dt><dd>${sv(locale, current.maxSkus)}</dd></div>
      <div><dt>${t("Användare")}</dt><dd>${current.maxUsers}</dd></div>
      <div><dt>${t("Analyser/mån")}</dt><dd>${current.maxAnalysesPerMonth}</dd></div>
      <div><dt>${t("API")}</dt><dd>${current.apiAccess ? t("Ingår") : t("Inte ingår")}</dd></div>
    </div>
    <a class="btn" href="/app/prisestimat">${t("Visa personligt prisestimat")} ${icon("arrow", 15)}</a>
    <p class="hint">${t("Ingen betalning aktiveras automatiskt. Offert och avtal krävs.")}</p>
  </article>`;

  return shell({
    locale,
    path: input.url.pathname + input.url.search,
    title: t("Abonnemang"),
    active: "billing",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: input.subscription ? (input.subscription.current_period_end ? t("{status} · förnyas {date}", { status: input.subscription.status, date: date(locale, input.subscription.current_period_end) }) : t("{status} · förnyas manuellt", { status: input.subscription.status })) : "",
    content: `
    ${flash(input.url, locale)}
    ${!input.stripeReady ? alert(t("Betalningar är inte aktiverade i den här installationen. Offert, avtal och fakturering hanteras manuellt."), "warn") : ""}
    <div class="grid">
      ${card({
        span: 12,
        title: t("Användning den här månaden"),
        body: `<div class="kv">
          <div><dt>${t("Analyser")}</dt><dd>${input.usage.analyses} / ${current.maxAnalysesPerMonth}</dd></div>
          <div><dt>${t("Copilot-frågor")}</dt><dd>${input.usage.copilot} / ${sv(locale, current.copilotPerMonth)}</dd></div>
          <div><dt>${t("Användare")}</dt><dd>${input.usage.members} / ${current.maxUsers}</dd></div>
          <div><dt>${t("Artiklar i senaste analys")}</dt><dd>${sv(locale, input.usage.skus)} / ${sv(locale, current.maxSkus)}</dd></div>
        </div>`,
      })}
      <div class="span-12">${packageCard}</div>
      ${card({
        span: 12,
        title: t("Fakturering"),
        body: `<p class="muted" style="font-size:13.5px">${EMAILS.billing ? t("Fakturaunderlag skickas från {email} vid månadsskifte. Betalning sker mot faktura med 30 dagars villkor, eller via kort när Stripe är aktiverat. Avtal och personuppgiftsbiträdesavtal tillhandahålls på begäran.", { email: `<span class="mono">${EMAILS.billing}</span>` }) : t("Fakturaunderlag skickas vid månadsskifte. Betalning sker mot faktura med 30 dagars villkor, eller via kort när Stripe är aktiverat. Avtal och personuppgiftsbiträdesavtal tillhandahålls på begäran.")}</p>
        <p class="hint">${t("Ingen betalning dras automatiskt i den här installationen.")}</p>`,
      })}
    </div>`,
  });
}

/* ------------------------------------------------------------------ audit */

export function auditPage(input: PageContext & {
  entries: Array<{ action: string; target: string | null; ip: string | null; created_at: string; email: string | null }>;
}): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  return shell({
    locale,
    path: input.url.pathname + input.url.search,
    title: t("Händelselogg"),
    active: "audit",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: t("Spårbarhet för importer, inloggningar, behörighetsändringar och datautlämning."),
    content: card({
      title: t("Senaste händelser"),
      body: table({
        columns: [
          { key: "action", label: t("Händelse") },
          { key: "email", label: t("Användare") },
          { key: "target", label: t("Objekt") },
          { key: "ip", label: t("IP") },
          { key: "time", label: t("Tid") },
        ],
        rows: input.entries.map((e) => ({
          action: `<span class="mono">${esc(e.action)}</span>`,
          email: esc(e.email ?? "–"),
          target: `<span class="tag-inline">${esc(e.target ?? "–")}</span>`,
          ip: `<span class="mono">${esc(e.ip ?? "–")}</span>`,
          time: dateTime(locale, e.created_at),
        })),
        empty: t("Inga händelser loggade ännu."),
      }),
    }),
  });
}

/* -------------------------------------------------------------- settings */

export function settingsPage(input: PageContext & {
  orgName: string;
  settings: { serviceLevel: number; deadStockDays: number; capitalCostRate: number };
  counts: { analyses: number; items: number; members: number };
}): string {
  const locale = input.locale;
  const t = appTranslator(locale);
  const manage = can(input.role, "org.manage");
  const destroy = can(input.role, "data.delete");

  return shell({
    locale,
    path: input.url.pathname + input.url.search,
    title: t("Inställningar"),
    active: "settings",
    user: input.user,
    org: input.org,
    role: input.role,
    subtitle: t("Organisation, standardvärden och datahantering."),
    content: `
    ${flash(input.url, locale)}
    <div class="grid">
      ${card({
        span: 7,
        title: t("Organisation"),
        body: `<form method="post" action="/app/installningar" data-busy="${t("Sparar…")}">
          <div class="form-row"><label for="namn">${t("Företagsnamn")}</label>
            <input id="namn" name="namn" type="text" value="${esc(input.orgName)}" ${manage ? "" : "disabled"}></div>
          <div class="field-grid">
            <div class="form-row"><label for="service">${t("Servicenivå")}</label>
              <select id="service" name="service" ${manage ? "" : "disabled"}>
                ${[0.9, 0.95, 0.98, 0.99].map((s) => `<option value="${s}" ${input.settings.serviceLevel === s ? "selected" : ""}>${Math.round(s * 100)} %</option>`).join("")}
              </select></div>
            <div class="form-row"><label for="dead">${t("Fönster för inaktivt lager")}</label>
              <select id="dead" name="dodlager" ${manage ? "" : "disabled"}>
                ${[90, 180, 365].map((d) => `<option value="${d}" ${input.settings.deadStockDays === d ? "selected" : ""}>${d} dagar</option>`).join("")}
              </select></div>
            <div class="form-row"><label for="rate">${t("Kalkylränta (%)")}</label>
              <input id="rate" name="ranta" type="number" min="0" max="30" step="0.5" value="${input.settings.capitalCostRate * 100}" ${manage ? "" : "disabled"}></div>
          </div>
          ${manage ? `<button class="btn" type="submit">${t("Spara")}</button>` : `<p class="hint">Din roll kan läsa men inte ändra inställningarna.</p>`}
        </form>`,
      })}
      ${card({
        span: 5,
        title: t("Data i organisationen"),
        body: `<dl class="stat-line"><dt>Analyser</dt><dd>${input.counts.analyses}</dd></dl>
          <dl class="stat-line"><dt>Artikelrader</dt><dd>${sv(locale, input.counts.items)}</dd></dl>
          <dl class="stat-line"><dt>${t("Användare")}</dt><dd>${input.counts.members}</dd></dl>
          <div class="mt-4 stack">
            <a class="btn btn-ghost" href="/app/export">${icon("download", 15)} ${t("Exportera all data (JSON)")}</a>
            ${destroy ? `<form method="post" action="/app/radera-analyser" data-confirm="${esc(t("Radera alla analyser i organisationen? Det går inte att ångra."))}">
              <button class="btn btn-danger" type="submit">${t("Radera alla analyser")}</button></form>` : ""}
          </div>
          <p class="hint mt-4">${t("Rådata sparas aldrig som fil. Radering tar bort tolkade rader, resultat och artikelrader.")}</p>`,
      })}
    </div>`,
  });
}
