/** Server-rendered platform administration. Access is decided by the route layer. */
import { esc } from "../ui/base.ts";
import type { AdminRow } from "./auth.ts";
import { adminShell } from "./pages.ts";
import type { AdminOrgRow, AdminPricingQuoteRow, AdminTrialMailRow, AdminUserRow, PlatformSettingKey, PlatformStats } from "./platform-store.ts";
import { formatDuration, type TimeToPdfStats } from "../import-timing.ts";
import { trialState } from "../trial-state.ts";

const dt = (iso: string | null): string => (iso ? esc(iso.slice(0, 16).replace("T", " ")) : "–");
const num = (value: number): string => value.toLocaleString("sv-SE");

function badge(value: string, tone: "ok" | "warn" | "danger" | "info" = "info"): string {
  return `<span class="admin-badge admin-badge--${tone}">${esc(value)}</span>`;
}

function table(headers: string[], rows: string[][], empty = "Inga poster."): string {
  if (!rows.length) return `<p class="admin-meta">${esc(empty)}</p>`;
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}

function shell(admin: AdminRow, title: string, subtitle: string, active: string, content: string, flash?: string): string {
  return adminShell({ admin, title, subtitle, active, content, flash });
}

export function platformOverviewPage(input: {
  admin: AdminRow;
  stats: PlatformStats;
  imports: Array<{ organization: string; filename: string; status: string; rows: number; imported: number; error: string | null; started_at: string }>;
  analyses: Array<{ organization: string; filename: string; rows: number; status: string; created_at: string }>;
  trialMails: AdminTrialMailRow[];
  timeToPdf: TimeToPdfStats;
  flash?: string;
}): string {
  const { stats } = input;
  const cards = [
    ["Användare", num(stats.users), `${num(stats.activeUsers)} aktiva · ${num(stats.suspendedUsers)} pausade`],
    ["Organisationer", num(stats.organizations), `${num(stats.testOrganizations)} test · ${num(stats.suspendedOrganizations)} pausade`],
    ["Analyser", num(stats.analyses), `${num(stats.analysesThisMonth)} denna månad · ${num(stats.failedAnalyses)} misslyckade`],
    ["Importer", num(stats.imports), `${num(stats.failedImports)} misslyckade`],
    ["Artikelrader", num(stats.items), "normaliserade rader i plattformen"],
    ["Offerter", num(stats.openQuotes), "öppna förfrågningar och aktiveringar"],
    ["Provperioder", num(stats.activeTrials), `${num(stats.trialsEndingSoon)} slutar inom 3 dagar · ${num(stats.readOnlyTrials)} i läsbart läge`],
    ["Trialmejl", num(stats.trialMailFailures24h), "misslyckade utskick senaste dygnet"],
    ["Drift", `${stats.uptimeHours} h`, `${stats.databaseMB} MB databas · ${stats.heapMB} MB heap`],
    [
      "Tid till första PDF",
      formatDuration(input.timeToPdf.medianSeconds),
      input.timeToPdf.count
        ? `${input.timeToPdf.count} mätta · p90 ${formatDuration(input.timeToPdf.p90Seconds)} · median från inloggning`
        : "Ingen mätning ännu",
    ],
  ];
  const content = `
    <div class="admin-grid">${cards
      .map(
        ([label, value, note]) => `<section class="admin-card"><p class="admin-folio">${esc(label)}</p><p class="admin-stat">${esc(value)}</p><p class="admin-meta">${esc(note)}</p></section>`,
      )
      .join("")}</div>
    <section class="admin-card"><div class="admin-card-head"><h2>Senaste importer</h2><a class="admin-link" href="/admin/sakerhet">Säkerhetslogg</a></div>
      ${table(
        ["Tid", "Organisation", "Fil", "Status", "Rader", "Importerade"],
        input.imports.map((row) => [
          dt(row.started_at),
          esc(row.organization),
          `<span class="admin-mono">${esc(row.filename)}</span>`,
          row.status === "ok" ? badge("Klar", "ok") : badge(row.status === "failed" ? "Fel" : "Pågår", row.status === "failed" ? "danger" : "warn"),
          num(row.rows),
          num(row.imported),
        ]),
      )}
      ${input.imports.some((row) => row.error) ? `<p class="admin-error">${esc(input.imports.find((row) => row.error)?.error ?? "")}</p>` : ""}
    </section>
    <section class="admin-card"><div class="admin-card-head"><h2>Senaste analyser</h2></div>
      ${table(
        ["Tid", "Organisation", "Fil", "Status", "Rader"],
        input.analyses.map((row) => [dt(row.created_at), esc(row.organization), `<span class="admin-mono">${esc(row.filename)}</span>`, row.status === "ok" ? badge("Klar", "ok") : badge("Fel", "danger"), num(row.rows)]),
      )}
    </section>
    <section class="admin-card"><div class="admin-card-head"><h2>Trialmejl</h2>${input.admin.role === "owner" ? `<form method="post" action="/admin/plattform/trial-sweep"><button class="admin-btn admin-btn--small" type="submit">Kör trial-sweep</button></form>` : ""}</div>
      <p class="admin-meta">Sweepen är idempotent och skickar bara steg som är due och ännu inte markerade. Knappen kör samma sweep direkt i stället för att vänta på nästa timme.</p>
      ${table(
        ["Tid", "Steg", "Mottagare", "Status", "Fel"],
        input.trialMails.map((row) => [
          dt(row.created_at),
          `<span class="admin-mono">${esc(row.kind)}</span>`,
          esc(row.to_email),
          row.status === "failed" ? badge("Misslyckat", "danger") : row.status === "outbox" ? badge("Outbox", "warn") : badge("Skickat", "ok"),
          row.error ? `<span class="admin-error">${esc(row.error)}</span>` : `<span class="admin-meta">–</span>`,
        ]),
        "Inga trialmejl skickade ännu.",
      )}
    </section>`;
  return shell(input.admin, "Plattform", "Användare, organisationer, trialmejl, importer, analyser och drift.", "platform", content, input.flash);
}

/* ------------------------------------------------------------- quotes */

function quoteEstimate(json: string): { monthly: number } {
  try {
    const parsed = JSON.parse(json) as { monthly?: unknown };
    return { monthly: Number.isFinite(Number(parsed.monthly)) ? Number(parsed.monthly) : 0 };
  } catch {
    return { monthly: 0 };
  }
}

const isOpenQuote = (status: string): boolean => status === "requested" || status === "accepted_pending_payment";

function quoteStatusLabel(status: string): string {
  if (status === "accepted_pending_payment") return "Aktivering begärd";
  if (status === "handled") return "Hanterad";
  if (status === "declined") return "Avvisad";
  if (status === "activated") return "Aktiverad";
  return "Offert begärd";
}

function quoteStatusTone(status: string): "ok" | "warn" | "danger" | "info" {
  if (status === "accepted_pending_payment") return "warn";
  if (status === "handled") return "ok";
  if (status === "declined") return "danger";
  if (status === "activated") return "ok";
  return "info";
}

export function adminQuotesPage(input: { admin: AdminRow; quotes: AdminPricingQuoteRow[]; flash?: string }): string {
  const ordered = [...input.quotes].sort((a, b) => {
    const rank = (status: string): number => (isOpenQuote(status) ? 0 : 1);
    return rank(a.status) - rank(b.status) || b.created_at.localeCompare(a.created_at);
  });
  const open = ordered.filter((quote) => isOpenQuote(quote.status));
  const activations = open.filter((quote) => quote.status === "accepted_pending_payment");
  const rows = ordered.map((quote) => {
    const amount = quoteEstimate(quote.estimate_json);
    const isActivation = quote.status === "accepted_pending_payment";
    const action = isOpenQuote(quote.status)
      ? `<div class="admin-actions">
          ${isActivation ? `<a class="admin-btn admin-btn--small admin-btn--primary" href="/admin/organisationer/${esc(quote.org_id)}">Aktivera plan</a>` : `<a class="admin-btn admin-btn--small" href="/admin/organisationer/${esc(quote.org_id)}">Öppna organisation</a>`}
          <form method="post" action="/admin/offerter/${esc(quote.id)}/status"><input type="hidden" name="status" value="handled"><button class="admin-btn admin-btn--small" type="submit">Markera hanterad</button></form>
          ${isActivation ? "" : `<form method="post" action="/admin/offerter/${esc(quote.id)}/status"><input type="hidden" name="status" value="declined"><button class="admin-btn admin-btn--small admin-btn--danger" type="submit">Avvisa</button></form>`}
        </div>`
      : `<a class="admin-link" href="/admin/organisationer/${esc(quote.org_id)}">Öppna organisation</a>`;
    return [
      dt(quote.created_at),
      isActivation ? badge("Aktivering", "warn") : badge("Offert", "info"),
      `<a href="/admin/organisationer/${esc(quote.org_id)}"><strong>${esc(quote.org_name)}</strong><br><span class="admin-mono">${esc(quote.org_plan)}</span></a>`,
      quote.user_email
        ? `<a href="/admin/anvandare/${esc(quote.user_id ?? "")}">${esc(quote.user_name ?? "Okänd")}<br><span class="admin-mono">${esc(quote.user_email)}</span></a>`
        : `<span class="admin-meta">Ingen kontakt angiven</span>`,
      `${num(amount.monthly)} kr/mån`,
      quote.note ? `<span class="admin-meta">${esc(quote.note.slice(0, 180))}${quote.note.length > 180 ? "…" : ""}</span>` : `<span class="admin-meta">Ingen anteckning</span>`,
      badge(quoteStatusLabel(quote.status), quoteStatusTone(quote.status)),
      action,
    ];
  });
  const content = `
    <div class="admin-grid">
      <section class="admin-card"><p class="admin-folio">Öppna förfrågningar</p><p class="admin-stat">${num(open.length)}</p><p class="admin-meta">offerter och aktiveringar som väntar på åtgärd</p></section>
      <section class="admin-card"><p class="admin-folio">Aktiveringar</p><p class="admin-stat">${num(activations.length)}</p><p class="admin-meta">kunder som väntar på avtal och aktiverad plan</p></section>
      <section class="admin-card"><p class="admin-folio">Senaste 100</p><p class="admin-stat">${num(input.quotes.length)}</p><p class="admin-meta">hela kön inklusive hanterade ärenden</p></section>
    </div>
    <section class="admin-card"><div class="admin-card-head"><h2>Offertkö</h2><span class="admin-meta">Öppna ärenden visas först</span></div>
      <p class="admin-meta">En aktivering utförs på organisationens sida genom att välja betald plan och spara. Då skickas välkomstmejlet och öppna ärenden markeras som aktiverade.</p>
      ${table(["Tid", "Typ", "Organisation", "Kontakt", "Beräknat", "Anteckning", "Status", "Åtgärd"], rows, "Inga offertförfrågningar ännu.")}
    </section>`;
  return shell(input.admin, "Offerter", "Offertförfrågningar och aktiveringsbegäranden från prisestimatet.", "quotes", content, input.flash);
}

export function adminUsersPage(input: { admin: AdminRow; users: AdminUserRow[]; query: string; flash?: string }): string {
  const rows = input.users.map((user) => [
    `<a href="/admin/anvandare/${esc(user.id)}"><strong>${esc(user.name)}</strong><br><span class="admin-mono">${esc(user.email)}</span></a>`,
    esc(user.company ?? "–"),
    user.org_name ? `<a href="/admin/organisationer/${esc(user.org_id ?? "")}">${esc(user.org_name)}</a>` : "–",
    esc(user.plan ?? "–"),
    user.status === "active" ? badge("Aktiv", "ok") : badge("Pausad", "danger"),
    num(user.analyses),
    dt(user.created_at),
  ]);
  const content = `
    <form class="admin-filter" method="get" action="/admin/anvandare"><label class="admin-field"><span>Sök användare</span><input type="search" name="q" value="${esc(input.query)}" placeholder="namn, e-post eller företag"></label><button class="admin-btn">Sök</button></form>
    <section class="admin-card"><div class="admin-card-head"><h2>Registrerade användare</h2><span class="admin-meta">${input.users.length} visade</span></div>${table(["Användare", "Företag", "Organisation", "Plan", "Status", "Analyser", "Registrerad"], rows)}</section>`;
  return shell(input.admin, "Användare", "Konton, organisationstillhörighet och kontostatus.", "users", content, input.flash);
}

export function adminUserPage(input: {
  admin: AdminRow;
  user: AdminUserRow;
  organizations: Array<{ id: string; name: string; plan: string; kind: string; status: string; role: string }>;
  events: Array<{ action: string; target: string | null; ip: string | null; created_at: string }>;
  flash?: string;
}): string {
  const content = `
    <div class="admin-grid">
      <section class="admin-card"><div class="admin-card-head"><h2>Konto</h2></div>
        <dl class="admin-stats"><div><dt>Status</dt><dd>${input.user.status === "active" ? badge("Aktiv", "ok") : badge("Pausad", "danger")}</dd></div><div><dt>Analyser</dt><dd>${num(input.user.analyses)}</dd></div><div><dt>Organisationer</dt><dd>${num(input.user.org_count)}</dd></div></dl>
        <p class="admin-meta">${esc(input.user.email)} · ${esc(input.user.company ?? "inget företag")} · registrerad ${dt(input.user.created_at)}</p>
        <div class="admin-actions">
          <form method="post" action="/admin/anvandare/${esc(input.user.id)}/status"><input type="hidden" name="status" value="${input.user.status === "active" ? "suspended" : "active"}"><button class="admin-btn ${input.user.status === "active" ? "admin-btn--danger" : ""}" type="submit">${input.user.status === "active" ? "Pausa kontot" : "Aktivera kontot"}</button></form>
          <form method="post" action="/admin/anvandare/${esc(input.user.id)}/sessioner"><button class="admin-btn" type="submit">Logga ut alla sessioner</button></form>
        </div>
      </section>
      <section class="admin-card"><div class="admin-card-head"><h2>Organisationer</h2></div>
        ${input.organizations.length ? `<ul class="admin-list">${input.organizations.map((org) => `<li><a href="/admin/organisationer/${esc(org.id)}">${esc(org.name)}</a> <span class="admin-meta">${esc(org.role)} · ${esc(org.plan)} · ${esc(org.status)}</span></li>`).join("")}</ul>` : `<p class="admin-meta">Ingen organisation.</p>`}
      </section>
    </div>
    <section class="admin-card"><div class="admin-card-head"><h2>Senaste kundhändelser</h2></div>
      ${table(["Tid", "Händelse", "Objekt", "IP"], input.events.map((event) => [dt(event.created_at), `<span class="admin-mono">${esc(event.action)}</span>`, esc(event.target ?? "–"), `<span class="admin-mono">${esc(event.ip ?? "–")}</span>`]))}
    </section>`;
  return shell(input.admin, input.user.name, "Kontodetaljer och säkerhetsåtgärder.", "users", content, input.flash);
}

export function adminOrganizationsPage(input: { admin: AdminRow; organizations: AdminOrgRow[]; query: string; flash?: string }): string {
  const rows = input.organizations.map((org) => [
    `<a href="/admin/organisationer/${esc(org.id)}"><strong>${esc(org.name)}</strong><br><span class="admin-mono">${esc(org.slug)}</span></a>`,
    org.kind === "test" ? badge("Testkonto", "warn") : badge("Kund", "info"),
    esc(org.plan),
    org.status === "active" ? badge("Aktiv", "ok") : badge("Pausad", "danger"),
    num(org.members),
    num(org.analyses),
    num(org.items),
    dt(org.last_analysis_at),
  ]);
  const content = `
    <form class="admin-filter" method="get" action="/admin/organisationer"><label class="admin-field"><span>Sök organisation</span><input type="search" name="q" value="${esc(input.query)}" placeholder="namn, slug eller id"></label><button class="admin-btn">Sök</button></form>
    <section class="admin-card"><div class="admin-card-head"><h2>Organisationer</h2><span class="admin-meta">${input.organizations.length} visade</span></div>${table(["Organisation", "Typ", "Plan", "Status", "Medlemmar", "Analyser", "Artiklar", "Senaste analys"], rows)}</section>`;
  return shell(input.admin, "Organisationer", "Kunder, testmiljöer, abonnemang och användning.", "orgs", content, input.flash);
}

export function adminOrganizationPage(input: {
  admin: AdminRow;
  org: AdminOrgRow;
  limits: { maxSkus: number; maxUsers: number; maxAnalysesPerMonth: number; copilotPerMonth: number; apiAccess: boolean; simulation: boolean; isTest: boolean };
  members: Array<{ user_id: string; email: string; name: string; status: string; role: string; created_at: string }>;
  imports: Array<{ filename: string; status: string; rows: number; imported: number; error: string | null; started_at: string }>;
  flash?: string;
}): string {
  const trial = trialState(input.org);
  const trialCard = trial.isTrial
    ? `<section class="admin-card"><div class="admin-card-head"><h2>Provperiod</h2></div>
        <dl class="admin-stats">
          <div><dt>Status</dt><dd>${trial.ended ? badge("Läsbart läge", "warn") : badge("Aktiv", "ok")}</dd></div>
          <div><dt>Slutdatum</dt><dd>${dt(trial.endsAt)}</dd></div>
          <div><dt>Dagar kvar</dt><dd>${num(trial.daysLeft)}</dd></div>
        </dl>
        <table class="admin-table"><thead><tr><th>Steg</th><th>Skickat</th></tr></thead><tbody>
          ${([
            ["Välkomst", input.org.trial_welcome_sent_at],
            ["Halvtid", input.org.trial_midpoint_sent_at],
            ["Slutspurt", input.org.trial_ending_sent_at],
            ["Avslut", input.org.trial_ended_sent_at],
          ] as Array<[string, string | null]>)
            .map(([label, at]) => `<tr><td>${esc(label)}</td><td>${dt(at)}</td></tr>`)
            .join("")}
        </tbody></table>
        <p class="admin-meta">Markeringarna styr vilka livscykelmejl som redan har skickats. De nollställs när en ny provperiod startas.</p>
      </section>`
    : "";
  const membership = input.members.map((member) => [
    `<a href="/admin/anvandare/${esc(member.user_id)}">${esc(member.name)}<br><span class="admin-mono">${esc(member.email)}</span></a>`,
    member.role === "owner"
      ? badge("Ägare", "info")
      : `<form method="post" action="/admin/organisationer/${esc(input.org.id)}/medlem" class="admin-inline"><input type="hidden" name="user" value="${esc(member.user_id)}"><select name="roll">${["admin", "analyst", "viewer"].map((role) => `<option value="${role}" ${member.role === role ? "selected" : ""}>${esc(role)}</option>`).join("")}</select><button class="admin-btn admin-btn--small">Spara</button></form>`,
    member.status === "active" ? badge("Aktiv", "ok") : badge("Pausad", "danger"),
    dt(member.created_at),
  ]);
  const content = `
    <div class="admin-grid">
      <section class="admin-card"><div class="admin-card-head"><h2>Organisation</h2></div>
        <form class="admin-form" method="post" action="/admin/organisationer/${esc(input.org.id)}">
          <label class="admin-field"><span>Namn</span><input type="text" name="namn" value="${esc(input.org.name)}" maxlength="160" required></label>
          <label class="admin-field"><span>Plan</span><select name="plan">${(input.org.kind === "test" ? ["internal_test"] : ["trial", "basic", "multi", "business", "enterprise"]).map((plan) => `<option value="${plan}" ${input.org.plan === plan ? "selected" : ""}>${esc(plan)}</option>`).join("")}</select></label>
          <label class="admin-field"><span>Status</span><select name="status"><option value="active" ${input.org.status === "active" ? "selected" : ""}>Aktiv</option><option value="suspended" ${input.org.status === "suspended" ? "selected" : ""}>Pausad</option></select></label>
          <fieldset class="admin-fieldset"><legend>Anpassade gränser</legend>
            <label class="admin-field"><span>Max artiklar</span><input type="number" name="maxSkus" min="1" max="500000" value="${input.limits.maxSkus}"></label>
            <label class="admin-field"><span>Max användare</span><input type="number" name="maxUsers" min="1" max="10000" value="${input.limits.maxUsers}"></label>
            <label class="admin-field"><span>Analyser per månad</span><input type="number" name="maxAnalysesPerMonth" min="1" max="10000000" value="${input.limits.maxAnalysesPerMonth}"></label>
            <label class="admin-field"><span>Copilot per månad</span><input type="number" name="copilotPerMonth" min="0" max="100000000" value="${input.limits.copilotPerMonth}"></label>
            <label class="admin-check"><input type="checkbox" name="apiAccess" value="1" ${input.limits.apiAccess ? "checked" : ""}> API-åtkomst</label>
            <label class="admin-check"><input type="checkbox" name="simulation" value="1" ${input.limits.simulation ? "checked" : ""}> Simulering</label>
          </fieldset>
          <button class="admin-btn admin-btn--primary" type="submit">Spara organisation</button>
        </form>
      </section>
      <section class="admin-card"><div class="admin-card-head"><h2>Sammanställning</h2></div>
        <dl class="admin-stats"><div><dt>Medlemmar</dt><dd>${num(input.org.members)}</dd></div><div><dt>Analyser</dt><dd>${num(input.org.analyses)}</dd></div><div><dt>Artikelrader</dt><dd>${num(input.org.items)}</dd></div><div><dt>Prenumeration</dt><dd>${esc(input.org.subscription_status ?? "–")}</dd></div></dl>
        <p class="admin-meta">Skapad ${dt(input.org.created_at)} · provperiod ${dt(input.org.trial_ends_at)}</p>
        ${input.org.kind === "test" ? `<p class="admin-ok">Internt testkonto: server-side obegränsad åtkomst, ingen betalning och separerad från kunddata.</p>` : ""}
        ${input.org.status === "suspended" ? `<form method="post" action="/admin/organisationer/${esc(input.org.id)}"><input type="hidden" name="namn" value="${esc(input.org.name)}"><input type="hidden" name="plan" value="${esc(input.org.plan)}"><input type="hidden" name="status" value="active"><button class="admin-btn">Återaktivera</button></form>` : ""}
      </section>
    </div>
    ${trialCard}
    <section class="admin-card"><div class="admin-card-head"><h2>Medlemmar</h2></div>${table(["Användare", "Roll", "Kontostatus", "Medlem sedan"], membership)}</section>
    <section class="admin-card"><div class="admin-card-head"><h2>Importer</h2></div>${table(["Tid", "Fil", "Status", "Rader", "Importerade"], input.imports.map((row) => [dt(row.started_at), `<span class="admin-mono">${esc(row.filename)}</span>`, row.status === "ok" ? badge("Klar", "ok") : badge("Fel", "danger"), num(row.rows), num(row.imported)]))}</section>`;
  return shell(input.admin, input.org.name, "Plan, gränser, medlemmar och användning.", "orgs", content, input.flash);
}

export function adminTestAccountsPage(input: { admin: AdminRow; accounts: AdminOrgRow[]; candidates: AdminOrgRow[]; flash?: string }): string {
  const rows = input.accounts.map((org) => [
    `<a href="/admin/organisationer/${esc(org.id)}">${esc(org.name)}</a>`,
    esc(org.plan),
    org.status === "active" ? badge("Aktiv", "ok") : badge("Pausad", "danger"),
    `${num(org.members)} medlemmar · ${num(org.analyses)} analyser`,
    `<form method="post" action="/admin/testkonton/${esc(org.id)}"><input type="hidden" name="enabled" value="0"><input type="hidden" name="bekrafta" value="1"><button class="admin-btn admin-btn--danger admin-btn--small" type="submit">Ta bort teststatus</button></form>`,
  ]);
  const content = `
    <section class="admin-card"><div class="admin-card-head"><h2>Interna testkonton</h2></div>
      <p class="admin-meta">Teststatus sätts endast här, kräver bekräftelse och loggas. Den ger server-side åtkomst till hela plattformen utan betalning eller kvoter. Vanliga kundkonton påverkas inte.</p>
      ${table(["Organisation", "Plan", "Status", "Användning", ""], rows, "Inga testkonton finns ännu.")}
    </section>
    <section class="admin-card"><div class="admin-card-head"><h2>Gör en separat organisation till testkonto</h2></div>
      <form class="admin-form" method="post" action="/admin/testkonton/promote">
        <label class="admin-field"><span>Kundorganisation</span><select name="org">${input.candidates.map((org) => `<option value="${esc(org.id)}">${esc(org.name)} · ${esc(org.plan)}</option>`).join("")}</select></label>
        <label class="admin-check"><input type="checkbox" name="bekrafta" value="1" required> Jag bekräftar att organisationen blir ett internt testkonto och får obegränsad åtkomst.</label>
        <button class="admin-btn admin-btn--primary" type="submit">Aktivera testkonto</button>
      </form>
    </section>`;
  return shell(input.admin, "Testkonton", "Särskilda interna konton med server-side full åtkomst.", "test", content, input.flash);
}

export function adminSystemPage(input: {
  admin: AdminRow;
  settings: Record<PlatformSettingKey, string>;
  stats: PlatformStats;
  flash?: string;
}): string {
  const flag = (key: PlatformSettingKey, label: string, description: string): string => `<label class="admin-check"><input type="checkbox" name="${key}" value="true" ${input.settings[key] !== "false" ? "checked" : ""}> <span><strong>${esc(label)}</strong><br><span class="admin-meta">${esc(description)}</span></span></label>`;
  const content = `
    <section class="admin-card"><div class="admin-card-head"><h2>Funktioner</h2></div>
      <form class="admin-form" method="post" action="/admin/system">
        ${flag("signups_enabled", "Självregistrering", "När avstängt avvisas nya kontoansökningar på servern.")}
        ${flag("imports_enabled", "Importer och analyser", "När avstängt blockeras nya uppladdningar utan att befintlig data ändras.")}
        ${flag("copilot_enabled", "Copilot", "När avstängt blockeras nya copilotfrågor.")}
        <label class="admin-field"><span>Supportmeddelande</span><textarea name="support_message" rows="3" maxlength="500">${esc(input.settings.support_message)}</textarea></label>
        <button class="admin-btn admin-btn--primary" type="submit">Spara systeminställningar</button>
      </form>
    </section>
    <section class="admin-card"><div class="admin-card-head"><h2>Driftstatus</h2></div>
      <dl class="admin-stats"><div><dt>Uptime</dt><dd>${input.stats.uptimeHours} h</dd></div><div><dt>Heap</dt><dd>${input.stats.heapMB} MB</dd></div><div><dt>Databas</dt><dd>${input.stats.databaseMB} MB</dd></div><div><dt>Analyser i mån</dt><dd>${num(input.stats.analysesThisMonth)}</dd></div></dl>
    </section>`;
  return shell(input.admin, "System", "Funktionsflaggor och övergripande driftstatus.", "system", content, input.flash);
}

export function adminSecurityPage(input: { admin: AdminRow; events: Array<{ source: string; action: string; actor: string | null; target: string | null; ip: string | null; created_at: string }> }): string {
  const content = `<section class="admin-card"><div class="admin-card-head"><h2>Säkerhets- och aktivitetshändelser</h2><span class="admin-meta">Admin- och kundhändelser, senaste 100</span></div>${table(
    ["Tid", "Källa", "Aktör", "Händelse", "Objekt", "IP"],
    input.events.map((event) => [dt(event.created_at), badge(event.source === "admin" ? "Admin" : "Kund", event.source === "admin" ? "warn" : "info"), esc(event.actor ?? "–"), `<span class="admin-mono">${esc(event.action)}</span>`, esc(event.target ?? "–"), `<span class="admin-mono">${esc(event.ip ?? "–")}</span>`]),
  )}</section>`;
  return shell(input.admin, "Säkerhet", "Inloggningar, kontoförändringar och administrativa åtgärder.", "security", content);
}
