/**
 * Administrative routes. Registered on the main router but fully isolated from
 * customer authentication: every handler below resolves its own admin session
 * from the `sq_admin` cookie, and nothing trusts the customer session.
 */
import { isSameOrigin } from "../auth.ts";
import type { RequestContext } from "../http.ts";
import { Router, html, json, redirect, rateLimit, readForm, str } from "../http.ts";
import { legalPage, legalSectionIndex, legalSectionSource } from "../pages/legal.ts";
import type { DemoSummary } from "../pages/public.ts";
import { landingPage } from "../pages/public.ts";
import { db } from "../db.ts";
import { ADMIN_COOKIE, adminCount, createAdmin, currentAdmin, deleteAdminSessions, endAdminSession, getAdmin, otpauthUrl, setTotpSecret, setupTokenConfigured, setupTokenValid, startAdminSession, touchAdminLogin, updateAdminPassword, verifyAdminPassword, verifyDummyAdminPassword, verifyTotp, newTotpSecret, type AdminRow } from "./auth.ts";
import { LEGAL_GROUPS, LEGAL_SECTION_KEYS, SITE_GROUPS, fieldByKey, type FieldGroup } from "./fields.ts";
import { withDraft } from "./preview.ts";
import {
  draftDiff,
  fieldCoverage,
  fieldValues,
  getVersion,
  invalidateContentCache,
  listVersions,
  logAdmin,
  missingFields,
  publish,
  recentAdminAudit,
  restoreVersion,
  saveDraft,
  saveDrafts,
  versionValues,
} from "./store.ts";
import {
  adminAccountPage,
  adminAuditPage,
  adminContentForm,
  adminDashboard,
  adminLegalPage,
  adminLoginPage,
  adminSectionPage,
  adminSetupPage,
  adminShell,
  adminVersionPage,
  adminVersionsPage,
} from "./pages.ts";

const CMS_LOCALE = "sv";

type CmsLocale = "sv" | "en";

/** Editor language: Swedish is binding, English keeps its own copy. */
const editorLocale = (ctx: RequestContext): CmsLocale => (ctx.url.searchParams.get("sprak") === "en" ? "en" : "sv");

const submittedLocale = (form: Awaited<ReturnType<Request["formData"]>> | null): CmsLocale => (str(form?.get("sprak")) === "en" ? "en" : "sv");

/* --------------------------------------------------------------- small tools */

const flashFrom = (ctx: RequestContext): string | undefined => {
  if (ctx.url.searchParams.get("sparat")) return "Utkastet är sparat.";
  if (ctx.url.searchParams.get("publicerat")) return `Publicerat som version ${ctx.url.searchParams.get("publicerat")}.`;
  if (ctx.url.searchParams.get("aterstalld")) return "Versionen är återställd som utkast. Granska och publicera när du är klar.";
  if (ctx.url.searchParams.get("2fa")) return "Tvåfaktorsautentisering är aktiverad.";
  if (ctx.url.searchParams.get("2fa-av")) return "Tvåfaktorsautentisering är avstängd.";
  if (ctx.url.searchParams.get("losenord")) return "Lösenordet är uppdaterat.";
  return undefined;
};

/** Draft value if present, otherwise the published value, for form display. */
function editorValues(scope: "site" | "legal", locale: string): Record<string, string> {
  return { ...fieldValues(scope, locale, "published"), ...fieldValues(scope, locale, "draft") };
}

function csrfBlocked(ctx: RequestContext): Response | null {
  if (isSameOrigin(ctx.req)) return null;
  return html(
    `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Ogiltig begäran</title></head>
     <body class="admin-body"><main class="admin-auth"><h1>Ogiltig begäran</h1>
     <p>Formuläret kom från en annan domän. Ladda om sidan och försök igen.</p>
     <p><a href="/admin">Till administrationen</a></p></main></body></html>`,
    403,
  );
}

type Gate = { admin: AdminRow; response?: undefined } | { admin?: undefined; response: Response };

function requireAdmin(ctx: RequestContext, kind: "page" | "api" = "page"): Gate {
  const admin = currentAdmin(ctx.req);
  if (admin) return { admin };
  const wantsJson = kind === "api" || (ctx.req.headers.get("accept") ?? "").includes("application/json");
  if (wantsJson) return { response: json({ error: "unauthorized", message: "Administratörsinloggning krävs." }, 401) };
  if (adminCount() === 0) return { response: redirect("/admin/init") };
  return { response: redirect(`/admin/logg-in?nasta=${encodeURIComponent(ctx.url.pathname)}`) };
}

function safeNext(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return "/admin";
  }
  return decoded.startsWith("/admin") && !decoded.startsWith("//") && !/[\\\u0000-\u001f]/.test(decoded) ? decoded : "/admin";
}

/** Turns an HTML section body into editable plain text for the admin form. */
function htmlToPlain(markup: string): string {
  return markup
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h2|h3|ul|ol|table)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------------ routes */

export function registerAdmin(router: Router, options: { demoSummary: (ctx: RequestContext) => DemoSummary }): void {
  /* ------------------------------------------------------------ setup */

  router.get("/admin/init", (ctx) => {
    if (adminCount() > 0) return redirect(currentAdmin(ctx.req) ? "/admin" : "/admin/logg-in");
    if (!setupTokenConfigured()) {
      logAdmin({ adminId: null, action: "admin.setup_blocked", ip: ctx.ip, meta: { reason: "no_token" } });
      return html(adminSetupPage({ configured: false }), 503);
    }
    return html(adminSetupPage({ configured: true }));
  });

  router.post("/admin/init", async (ctx) => {
    const csrf = csrfBlocked(ctx);
    if (csrf) return csrf;
    if (adminCount() > 0) return redirect("/admin/logg-in");
    if (!setupTokenConfigured()) return html(adminSetupPage({ configured: false }), 503);

    const limit = rateLimit(`admin-init:${ctx.ip}`, 5, 3600);
    if (!limit.ok) return html(adminSetupPage({ configured: true, error: "För många försök. Vänta och försök igen." }), 429);

    const form = await readForm(ctx);
    const token = str(form?.get("token"));
    const name = str(form?.get("namn"));
    const email = str(form?.get("epost")).toLowerCase().slice(0, 254);
    const password = str(form?.get("losenord"));
    const repeat = str(form?.get("losenord2"));

    const fail = (error: string): Response => {
      logAdmin({ adminId: null, action: "admin.setup_failed", ip: ctx.ip, meta: { email } });
      return html(adminSetupPage({ configured: true, error, email, name }), 400);
    };

    if (!setupTokenValid(token)) return fail("Engångstoken stämmer inte.");
    if (!name || !email.includes("@")) return fail("Ange namn och en giltig e-postadress.");
    if (password.length < 14) return fail("Lösenordet måste vara minst 14 tecken.");
    if (password !== repeat) return fail("Lösenorden stämmer inte överens.");

    const admin = createAdmin({ email, password, name });
    touchAdminLogin(admin.id);
    const session = startAdminSession(admin.id, ctx.ip);
    logAdmin({ adminId: admin.id, action: "admin.setup", target: email, ip: ctx.ip });
    return redirect("/admin", 303, session.cookie);
  });

  /* ------------------------------------------------------------ login */

  router.get("/admin/logg-in", (ctx) => {
    if (currentAdmin(ctx.req)) return redirect("/admin");
    if (adminCount() === 0) return redirect("/admin/init");
    return html(adminLoginPage({ next: safeNext(str(ctx.url.searchParams.get("nasta") ?? "/admin")) }));
  });

  router.post("/admin/logg-in", async (ctx) => {
    const csrf = csrfBlocked(ctx);
    if (csrf) return csrf;

    const form = await readForm(ctx);
    const email = str(form?.get("epost")).toLowerCase();
    const password = str(form?.get("losenord"));
    const code = str(form?.get("kod"));
    const next = safeNext(str(form?.get("nasta") ?? "/admin"));

    const ipLimit = rateLimit(`admin-login-ip:${ctx.ip}`, 30, 900);
    const accountLimit = rateLimit(`admin-login:${email || "tom"}:${ctx.ip}`, 5, 900);
    if (!ipLimit.ok || !accountLimit.ok) {
      const retryAfter = Math.max(ipLimit.retryAfter, accountLimit.retryAfter);
      return html(adminLoginPage({ next, email, error: `För många inloggningsförsök. Försök igen om ${retryAfter} sekunder.` }), 429);
    }

    const admin = findAdmin(email);
    if (!admin) {
      verifyDummyAdminPassword(password);
      logAdmin({ adminId: null, action: "admin.login_failed", target: email, ip: ctx.ip, meta: { reason: "credentials" } });
      return html(adminLoginPage({ next, email, error: "Fel e-post eller lösenord." }), 401);
    }
    if (!verifyAdminPassword(admin, password)) {
      logAdmin({ adminId: admin?.id ?? null, action: "admin.login_failed", target: email, ip: ctx.ip, meta: { reason: "credentials" } });
      return html(adminLoginPage({ next, email, error: "Fel e-post eller lösenord." }), 401);
    }
    if (admin.totp_enabled && (!admin.totp_secret || !verifyTotp(admin.totp_secret, code))) {
      logAdmin({ adminId: admin.id, action: "admin.login_failed", target: email, ip: ctx.ip, meta: { reason: "totp" } });
      return html(adminLoginPage({ next, email, error: "Engångskoden stämmer inte." }), 401);
    }

    touchAdminLogin(admin.id);
    const session = startAdminSession(admin.id, ctx.ip);
    logAdmin({ adminId: admin.id, action: "admin.login", target: email, ip: ctx.ip });
    return redirect(next, 303, session.cookie);
  });

  router.post("/admin/logg-ut", (ctx) => {
    const csrf = csrfBlocked(ctx);
    if (csrf) return csrf;
    const admin = currentAdmin(ctx.req);
    const cookie = endAdminSession(ctx.req);
    if (admin) logAdmin({ adminId: admin.id, action: "admin.logout", ip: ctx.ip });
    return redirect("/admin/logg-in", 303, cookie);
  });

  /* -------------------------------------------------------- dashboard */

  router.get("/admin", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const admin = gate.admin!;

    const edits = db
      .query(
        `SELECT key, scope, updated_at, updated_by FROM cms_fields
         WHERE draft IS NOT NULL AND (published IS NULL OR published <> draft)
         ORDER BY updated_at DESC LIMIT 12`,
      )
      .all() as Array<{ key: string; scope: string; updated_at: string; updated_by: string | null }>;

    const siteVersions = listVersions("site", 1);
    const legalVersions = listVersions("legal", 1);

    return html(
      adminShell({
        admin,
        title: "Översikt",
        subtitle: "Webbplatsens innehåll, juridiska dokument och publiceringsstatus.",
        active: "dashboard",
        flash: flashFrom(ctx),
        content: adminDashboard({
          siteCoverage: fieldCoverage("site", CMS_LOCALE),
          legalCoverage: fieldCoverage("legal", CMS_LOCALE),
          siteMissing: missingFields("site", CMS_LOCALE),
          legalMissing: missingFields("legal", CMS_LOCALE),
          siteDrafts: draftDiff("site", CMS_LOCALE),
          legalDrafts: draftDiff("legal", CMS_LOCALE),
          siteVersion: siteVersions[0] ?? null,
          legalVersion: legalVersions[0] ?? null,
          siteVersions: listVersions("site", 200).length,
          legalVersions: listVersions("legal", 200).length,
          edits: edits.map((row) => ({
            key: row.key,
            label: fieldByKey(row.key)?.label ?? row.key.replace(`legal.sections.`, "Avsnitt: "),
            updated_at: row.updated_at,
            updated_by: row.updated_by,
          })),
          audit: recentAdminAudit(10),
        }),
      }),
    );
  });

  /* ------------------------------------------------------- website CMS */

  const siteForm = (admin: AdminRow, locale: CmsLocale) =>
    adminContentForm({
      groups: SITE_GROUPS,
      values: editorValues("site", locale),
      action: "/admin/innehall",
      heading: "Webbplatsens innehåll",
      description: "Centralt innehåll på de publika sidorna.",
      drafts: draftDiff("site", locale),
      missing: missingFields("site", locale),
      hasDrafts: draftDiff("site", locale).length > 0,
      previewHref: `/admin/forhandsgranska/webbplats?sprak=${locale}`,
      publishScope: "site",
      locale,
    });

  router.get("/admin/innehall", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    return html(
      adminShell({
        admin: gate.admin!,
        title: "Webbplats",
        subtitle: "Hero, sektioner, kontakt, FAQ, sidfot och metadata. Svenska är den text som publiceras.",
        active: "content",
        flash: flashFrom(ctx),
        content: siteForm(gate.admin!, editorLocale(ctx)),
      }),
    );
  });

  router.post("/admin/innehall", async (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const csrf = csrfBlocked(ctx);
    if (csrf) return csrf;
    const form = await readForm(ctx);
    const locale = submittedLocale(form);
    const entries: Record<string, string> = {};
    for (const group of SITE_GROUPS) for (const def of group.fields) entries[def.key] = str(form?.get(def.key));
    const count = saveDrafts("site", locale, entries, gate.admin!.id);
    logAdmin({ adminId: gate.admin!.id, action: "content.draft", target: `site/${locale}`, ip: ctx.ip, meta: { fields: count } });
    return redirect(`/admin/innehall?sparat=1&sprak=${locale}`);
  });

  /* ------------------------------------------------------------ legal */

  router.get("/admin/juridik", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const locale = editorLocale(ctx);
    const values = editorValues("legal", locale);
    return html(
      adminShell({
        admin: gate.admin!,
        title: "Juridiska dokument",
        subtitle: "Strukturerade fält fyller platshållarna i integritetspolicyn och användarvillkoren. Dokumentens text och struktur ligger fast.",
        active: "legal",
        flash: flashFrom(ctx),
        content: adminLegalPage({
          groups: LEGAL_GROUPS,
          values,
          drafts: draftDiff("legal", locale),
          missing: missingFields("legal", locale),
          locale,
          sections: legalSectionIndex().map((section) => ({
            ...section,
            hasOverride: Boolean(values[LEGAL_SECTION_KEYS(section.doc, section.id, "body")] || values[LEGAL_SECTION_KEYS(section.doc, section.id, "title")]),
          })),
        }),
      }),
    );
  });

  router.post("/admin/juridik", async (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const csrf = csrfBlocked(ctx);
    if (csrf) return csrf;
    const form = await readForm(ctx);
    const locale = submittedLocale(form);
    const entries: Record<string, string> = {};
    for (const group of LEGAL_GROUPS) for (const def of group.fields) entries[def.key] = str(form?.get(def.key));
    const count = saveDrafts("legal", locale, entries, gate.admin!.id);
    logAdmin({ adminId: gate.admin!.id, action: "content.draft", target: `legal/${locale}`, ip: ctx.ip, meta: { fields: count } });
    return redirect(`/admin/juridik?sparat=1&sprak=${locale}`);
  });

  const sectionParam = (value: string): "integritet" | "villkor" | null => (value === "integritet" || value === "villkor" ? value : null);

  router.get("/admin/juridik/avsnitt/:dok/:id", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const doc = sectionParam(ctx.params.dok ?? "");
    const id = ctx.params.id ?? "";
    const source = doc ? legalSectionSource(doc, id) : null;
    if (!doc || !source) return html(adminShell({ admin: gate.admin!, title: "Avsnitt saknas", active: "legal", content: `<p class="admin-meta">Avsnittet finns inte.</p>` }), 404);

    const values = editorValues("legal", CMS_LOCALE);
    const titleKey = LEGAL_SECTION_KEYS(doc, id, "title");
    const bodyKey = LEGAL_SECTION_KEYS(doc, id, "body");
    const editedBody = values[bodyKey];

    return html(
      adminShell({
        admin: gate.admin!,
        title: source.title,
        subtitle: doc === "integritet" ? "Integritetspolicy" : "Användarvillkor",
        active: "legal",
        flash: flashFrom(ctx),
        content: adminSectionPage({
          doc,
          sectionId: id,
          title: values[titleKey] ?? source.title,
          body: editedBody ?? htmlToPlain(source.body),
          builtInTitle: source.title,
          saved: Boolean(editedBody),
        }),
      }),
    );
  });

  router.post("/admin/juridik/avsnitt/:dok/:id", async (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const csrf = csrfBlocked(ctx);
    if (csrf) return csrf;
    const doc = sectionParam(ctx.params.dok ?? "");
    const id = ctx.params.id ?? "";
    const source = doc ? legalSectionSource(doc, id) : null;
    if (!doc || !source) return redirect("/admin/juridik");

    const form = await readForm(ctx);
    if (str(form?.get("atgard")) === "aterstall") {
      saveDraft("legal", LEGAL_SECTION_KEYS(doc, id, "title"), CMS_LOCALE, "", gate.admin!.id);
      saveDraft("legal", LEGAL_SECTION_KEYS(doc, id, "body"), CMS_LOCALE, "", gate.admin!.id);
      logAdmin({ adminId: gate.admin!.id, action: "section.draft", target: `${doc}/${id}`, ip: ctx.ip, meta: { reset: true } });
      return redirect(`/admin/juridik/avsnitt/${doc}/${id}?sparat=1`);
    }

    const title = str(form?.get("rubrik")).slice(0, 180);
    const body = str(form?.get("brodtext")).slice(0, 12000);
    saveDraft("legal", LEGAL_SECTION_KEYS(doc, id, "title"), CMS_LOCALE, title === source.title ? "" : title, gate.admin!.id);
    saveDraft("legal", LEGAL_SECTION_KEYS(doc, id, "body"), CMS_LOCALE, body === htmlToPlain(source.body) ? "" : body, gate.admin!.id);
    logAdmin({ adminId: gate.admin!.id, action: "section.draft", target: `${doc}/${id}`, ip: ctx.ip });
    return redirect(`/admin/juridik/avsnitt/${doc}/${id}?sparat=1`);
  });

  /* --------------------------------------------------------- publishing */

  router.post("/admin/publicera", async (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const csrf = csrfBlocked(ctx);
    if (csrf) return csrf;
    const form = await readForm(ctx);
    const area = str(form?.get("omrade"));
    const locale = submittedLocale(form);
    const note = str(form?.get("notering"));
    const confirmed = str(form?.get("bekrafta")) === "1";
    if (!confirmed) return redirect(area === "legal" ? "/admin/juridik" : "/admin/innehall");
    if (area !== "site" && area !== "legal") return redirect("/admin");

    const result = publish(area, locale, gate.admin!.id, note || "Publicering");
    logAdmin({ adminId: gate.admin!.id, action: "content.publish", target: `${area}/${locale}`, ip: ctx.ip, meta: { version: result.version, changed: result.changed } });
    return redirect(`/admin${area === "legal" ? "/juridik" : "/innehall"}?publicerat=${result.version}&sprak=${locale}`);
  });

  /* ------------------------------------------------------------ versions */

  router.get("/admin/versioner", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const scope = ctx.url.searchParams.get("omrade") === "juridik" ? "legal" : "site";
    const versions = listVersions(scope, 60);
    return html(
      adminShell({
        admin: gate.admin!,
        title: "Versioner",
        subtitle: "Varje publicering skapar en ny version. Historiken skrivs aldrig över.",
        active: "versions",
        flash: flashFrom(ctx),
        content: adminVersionsPage({ scope, versions, current: versions[0] ?? null }),
      }),
    );
  });

  router.get("/admin/versioner/:id", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const row = getVersion(ctx.params.id ?? "");
    if (!row) return html(adminShell({ admin: gate.admin!, title: "Version saknas", active: "versions", content: `<p class="admin-meta">Versionen finns inte.</p>` }), 404);
    const scope = row.scope === "legal" ? "legal" : "site";
    const { locale, values } = versionValues(row);
    const now = fieldValues(scope, locale || CMS_LOCALE, "published");
    const changes = Object.entries(values)
      .filter(([key, value]) => (now[key] ?? "") !== value)
      .map(([key, value]) => ({ key, label: fieldByKey(key)?.label ?? key, then: value, now: now[key] ?? "" }));

    return html(
      adminShell({
        admin: gate.admin!,
        title: `Version ${row.version}`,
        subtitle: row.note ?? undefined,
        active: "versions",
        flash: flashFrom(ctx),
        content: adminVersionPage({ version: row, scope, changes }),
      }),
    );
  });

  router.post("/admin/versioner/:id/aterstall", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const csrf = csrfBlocked(ctx);
    if (csrf) return csrf;
    const row = getVersion(ctx.params.id ?? "");
    if (!row) return redirect("/admin/versioner");
    const result = restoreVersion(row.id, gate.admin!.id);
    invalidateContentCache();
    logAdmin({ adminId: gate.admin!.id, action: "content.restore", target: `${row.scope} v${row.version}`, ip: ctx.ip, meta: { fields: result?.restored ?? 0 } });
    return redirect(`/admin${row.scope === "legal" ? "/juridik" : "/innehall"}?aterstalld=1`);
  });

  /* --------------------------------------------------------------- audit */

  router.get("/admin/logg", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const rows = recentAdminAudit(100);
    const admins = db.query("SELECT id, name, email FROM admin_users").all() as Array<{ id: string; name: string; email: string }>;
    const adminNames: Record<string, string> = {};
    for (const admin of admins) adminNames[admin.id] = `${admin.name} (${admin.email})`;
    return html(
      adminShell({
        admin: gate.admin!,
        title: "Aktivitetslogg",
        subtitle: "Inloggningar, utkast och publiceringar.",
        active: "audit",
        content: adminAuditPage({ rows, adminNames }),
      }),
    );
  });

  /* ------------------------------------------------------------- account */

  router.get("/admin/konto", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const admin = getAdmin(gate.admin!.id)!;
    const pending = !admin.totp_enabled && admin.totp_secret ? admin.totp_secret : null;
    return html(
      adminShell({
        admin,
        title: "Konto och tvåfaktorsautentisering",
        subtitle: "Lösenord och engångskoder för ditt administratörskonto.",
        active: "account",
        flash: flashFrom(ctx),
        content: adminAccountPage({
          admin,
          totpSecret: pending,
          totpUri: pending ? otpauthUrl(admin.email, pending) : null,
        }),
      }),
    );
  });

  router.post("/admin/konto/losenord", async (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const csrf = csrfBlocked(ctx);
    if (csrf) return csrf;
    const form = await readForm(ctx);
    const current = str(form?.get("nuvarande"));
    const next = str(form?.get("nytt"));
    const repeat = str(form?.get("nytt2"));
    const admin = getAdmin(gate.admin!.id)!;
    const fail = (error: string) =>
      html(adminShell({ admin, title: "Konto och tvåfaktorsautentisering", active: "account", error, content: adminAccountPage({ admin, totpSecret: null, totpUri: null }) }), 400);

    if (!verifyAdminPassword(admin, current)) return fail("Nuvarande lösenord stämmer inte.");
    if (next.length < 14 || next.length > 200) return fail("Det nya lösenordet måste vara 14–200 tecken.");
    if (next !== repeat) return fail("De nya lösenorden stämmer inte överens.");
    updateAdminPassword(admin.id, next);
    deleteAdminSessions(admin.id);
    logAdmin({ adminId: admin.id, action: "admin.password", ip: ctx.ip });
    return redirect("/admin/logg-in?losenord=1", 303, endAdminSession(ctx.req));
  });

  router.post("/admin/konto/totp/start", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const csrf = csrfBlocked(ctx);
    if (csrf) return csrf;
    if (gate.admin!.totp_enabled) {
      return html(
        adminShell({
          admin: gate.admin!,
          title: "Konto och tvåfaktorsautentisering",
          active: "account",
          error: "Stäng av tvåfaktorsautentisering med lösenord och engångskod innan en ny hemlighet skapas.",
          content: adminAccountPage({ admin: gate.admin!, totpSecret: null, totpUri: null }),
        }),
        400,
      );
    }
    setTotpSecret(gate.admin!.id, newTotpSecret(), false);
    logAdmin({ adminId: gate.admin!.id, action: "admin.totp_started", ip: ctx.ip });
    return redirect("/admin/konto");
  });

  router.post("/admin/konto/totp/aktivera", async (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const csrf = csrfBlocked(ctx);
    if (csrf) return csrf;
    const form = await readForm(ctx);
    const admin = getAdmin(gate.admin!.id)!;
    const code = str(form?.get("kod"));
    if (!admin.totp_secret || !verifyTotp(admin.totp_secret, code)) {
      const pending = admin.totp_secret;
      return html(
        adminShell({
          admin,
          title: "Konto och tvåfaktorsautentisering",
          active: "account",
          error: "Koden stämmer inte. Kontrollera att klockan i appen är rätt och försök igen.",
          content: adminAccountPage({ admin, totpSecret: pending, totpUri: pending ? otpauthUrl(admin.email, pending) : null }),
        }),
        400,
      );
    }
    setTotpSecret(admin.id, admin.totp_secret, true);
    logAdmin({ adminId: admin.id, action: "admin.totp_enabled", ip: ctx.ip });
    return redirect("/admin/konto?2fa=1");
  });

  router.post("/admin/konto/totp/stang", async (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const csrf = csrfBlocked(ctx);
    if (csrf) return csrf;
    const form = await readForm(ctx);
    if (str(form?.get("bekrafta")) !== "1") return redirect("/admin/konto");
    const admin = getAdmin(gate.admin!.id)!;
    const password = str(form?.get("losenord"));
    const code = str(form?.get("kod"));
    const allowed =
      admin.totp_enabled &&
      Boolean(admin.totp_secret) &&
      verifyAdminPassword(admin, password) &&
      verifyTotp(admin.totp_secret!, code);
    if (!allowed) {
      return html(
        adminShell({
          admin,
          title: "Konto och tvåfaktorsautentisering",
          active: "account",
          error: "Stäng av 2FA kräver rätt lösenord och en giltig engångskod.",
          content: adminAccountPage({ admin, totpSecret: null, totpUri: null }),
        }),
        400,
      );
    }
    setTotpSecret(gate.admin!.id, null, false);
    logAdmin({ adminId: gate.admin!.id, action: "admin.totp_disabled", ip: ctx.ip });
    return redirect("/admin/konto?2fa-av=1");
  });

  /* -------------------------------------------------------------- preview */

  router.get("/admin/forhandsgranska/juridik", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const kind = ctx.url.searchParams.get("dokument") === "villkor" ? "villkor" : "integritet";
    return html(withDraft(() => legalPage(kind, null, "sv")));
  });

  router.get("/admin/forhandsgranska/webbplats", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const demo = options.demoSummary(ctx);
    return html(withDraft(() => landingPage({ user: null, demo, locale: editorLocale(ctx) })));
  });

  /* ----------------------------------------------------------------- api */

  router.get("/admin/api/status", (ctx) => {
    const gate = requireAdmin(ctx, "api");
    if (gate.response) return gate.response;
    return json({
      admin: { id: gate.admin!.id, name: gate.admin!.name, email: gate.admin!.email, role: gate.admin!.role, totp: Boolean(gate.admin!.totp_enabled) },
      site: {
        coverage: fieldCoverage("site", CMS_LOCALE),
        missing: missingFields("site", CMS_LOCALE).map((field) => field.key),
        unpublished: draftDiff("site", CMS_LOCALE).length,
        version: listVersions("site", 1)[0]?.version ?? null,
      },
      legal: {
        coverage: fieldCoverage("legal", CMS_LOCALE),
        missing: missingFields("legal", CMS_LOCALE).map((field) => field.key),
        unpublished: draftDiff("legal", CMS_LOCALE).length,
        version: listVersions("legal", 1)[0]?.version ?? null,
      },
    });
  });
}

/** Exported for tests: the group list the CMS renders. */
export const siteGroups = (): FieldGroup[] => SITE_GROUPS;

function findAdmin(email: string): AdminRow | null {
  const row = db.query("SELECT * FROM admin_users WHERE email = $e").get({ $e: email.toLowerCase().trim() }) as AdminRow | null;
  return row ?? null;
}

export { ADMIN_COOKIE };
