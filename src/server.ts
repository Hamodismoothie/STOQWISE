/**
 * Stoqwise - HTTP entry point.
 *
 * Layout of this file:
 *   1. boot (migrations already ran in db.ts, demo cache, background tasks)
 *   2. request handling pipeline (security headers, rate limits, errors)
 *   3. public routes
 *   4. authentication
 *   5. authenticated app routes
 *   6. platform administration
 *   7. static files
 *
 * Business logic lives in `core/`, `pipeline.ts` and `pages/`. This file only
 * decides who may see what and wires data into views.
 */
import { join } from "node:path";
import { EMAILS } from "./brand.ts";
import { analyze, type AnalysisResult } from "./analysis.ts";
import { buildIntelligence, type IntelligenceSnapshot } from "./core/intelligence.ts";
import { ask, polishWithAi, type ConversationTurn } from "./core/copilot.ts";
import { buildBaseline, simulate, type ScenarioInput } from "./core/simulate.ts";
import { forecastSeries, supplyPlan, aggregateSeries } from "./core/forecast.ts";
import { buildTemplateNarrative, type Narrative } from "./insights.ts";
import { buildPdf, reportFileName } from "./pdf.ts";
import { writeXlsx } from "./xlsx.ts";
import { config, ensureRuntimeDirs } from "./config.ts";
import {
  db,
  createUser,
  findUserByEmail,
  findUserById,
  deleteStaleDrafts,
  deleteSessionsForUser,
  deleteExpiredSessions,
  createLead,
  createPasswordReset,
  findPasswordReset,
  consumePasswordReset,
  deletePasswordResetsForUser,
  updateUserPassword,
  updateUserLocale,
} from "./db.ts";
import { FIELD_LABELS } from "./mapping.ts";
import { esc, icon, shell } from "./ui/base.ts";
import {
  hashPassword,
  verifyPassword,
  startSession,
  endSession,
  isSameOrigin,
  sessionStartedAt,
  newPasswordResetToken,
  PASSWORD_RESET_TTL_MINUTES,
  sha256,
} from "./auth.ts";
import { recordTimeToPdf } from "./import-timing.ts";
import {
  acceptInvitation,
  audit,
  can,
  createApiKey,
  createConversation,
  createInvitation,
  createOrganization,
  createWebhook,
  deleteView,
  findInvitation,
  getConversation,
  getOrg,
  getSubscription,
  getPricingProfile,
  savePricingProfile,
  getPricingRules,
  savePricingRules,
  createPricingQuote,
  listPricingQuotes,
  saveCommercialScenario,
  listCommercialScenarios,
  listMessages,
  appendMessage,
  listApiKeys,
  listConversations,
  listImports,
  listMembers,
  listWebhooks,
  recentAudit,
  recentDeliveries,
  removeMember,
  revokeApiKey,
  deleteWebhook,
  saveScenario,
  setMemberRole,
  setPlan,
  countMembers,
  analysesThisMonth,
  analysisDeletionImpact,
  itemDetailsFor,
  canDeleteOrgData,
  deleteAnalysisData,
  deletedItemsLabel,
  deleteImportRow,
  deleteItemRows,
  copilotMessagesThisMonth,
  membershipFor,
  orgForUser,
  limitsForOrg,
  updateOrg,
  queryItems,
  itemFacets,
  getItem,
  importForAnalysis,
  isRole,
  roleRank,
  valueHistory,
  type Role,
} from "./data/repo.ts";
import {
  accountDeletionSummary,
  buildOrganizationExport,
  deleteAccount,
  deleteOrganizationData,
  organizationDeletionCounts,
} from "./data/privacy.ts";
import { handleApi, normalizeAnalysis, rebuildInputs } from "./api.ts";
import { appWorldPage, appWorldTable, itemActionLabel, itemWhy } from "./pages/world-app.ts";
import { APP_WORLD_LIMIT, buildAppWorld, simulatePortfolio } from "./world.ts";
import { normalizeSimulation, runPortfolioSimulation, type PortfolioArticle } from "./ui/live-simulation.ts";
import type { AnalyzedItem } from "./analysis.ts";
import { liveClusterDetail, locateLiveArticle, locateLiveArticles } from "./ui/live-warehouse.ts";
import { draftFor, ingest, ingestDraft, preview, recomputeAfterDeletion } from "./pipeline.ts";
import { isIndustryId } from "./industry.ts";
import { runTrialLifecycle, sendTrialWelcomeForOrg } from "./trial.ts";
import { assertUploadAllowed, listIntegrations, safeUploadFilename } from "./integrations/index.ts";
import { csvCell } from "./csv.ts";
import { assertSafeWebhookUrl, webhookEvents } from "./webhooks.ts";
import {
  buildDemoDataset,
  demoCsv,
  DEMO_ENVIRONMENTS,
  DEFAULT_DEMO_ENVIRONMENT,
  getDemoEnvironmentMeta,
  isDemoEnvironment,
  type DemoEnvironmentId,
} from "./demo.ts";
import { contentLocale, cookieFor, DEFAULT_LOCALE, isAvailableLocale, resolveLocale, safeNext, strings, type Locale } from "./i18n.ts";
import { PSEUDO_LOCALE, appAction, appRole, appText } from "./i18n-app.ts";
import {
  activationConfirmationMail,
  activationRequestedMail,
  contactInbox,
  contactNotificationMail,
  invitationMail,
  passwordChangedMail,
  passwordResetMail,
  quoteConfirmationMail,
  quoteRequestedMail,
  sendMail,
} from "./mail.ts";
import { categoryLabels, fold, localizeCategory, planSearch } from "./terminology.ts";
import { Router, binary, buildContext, html, json, plain, redirect, requirePermission, requireUser, requireWritable, securityHeaders, str, numOr, rateLimit, readForm, type RequestContext } from "./http.ts";
import { robotsTxt, sitemapXml } from "./seo.ts";
import { dashboardEmptyState, dashboardPage, itemPage, itemsPage, forecastPage, simulatePage, copilotPage } from "./pages/core.ts";
import {
  auditPage,
  billingPage,
  deleteAccountPage,
  deleteOrganizationPage,
  deletePage,
  importsPage,
  integrationsPage,
  mappingPage,
  settingsPage,
  teamPage,
} from "./pages/admin.ts";
import { exportGuidesPage } from "./pages/guides.ts";
import { commercialPage, estimatePage, pricingRulesPage, pricingStartPage } from "./pages/pricing.ts";
import { buildProcurementView, procurementPage, type ProcurementView } from "./pages/procurement.ts";
import { orderCsv, orderFileName, orderXlsx } from "./procurement-export.ts";
import { MODULE_IDS, calculateEstimate, normalizeProfile, sanitizeRules, type PricingProfile } from "./pricing.ts";
import { sandboxDashboard, sandboxItem, sandboxItems } from "./pages/sandbox.ts";
import {
  aboutPage,
  contactPage,
  productPage,
  developerPage,
  forgotPasswordPage,
  getStartedPage,
  helpPage,
  invitePage,
  landingPage,
  legalPage,
  loginPage,
  notFoundPage,
  onboardingPage,
  pricingPage,
  registerPage,
  resetPasswordPage,
} from "./pages/public.ts";
import type { DemoSummary } from "./pages/public.ts";
import { registerAdmin } from "./admin/routes.ts";
import { registerPlatformAdmin } from "./admin/platform-routes.ts";
import { settingEnabled } from "./admin/platform-store.ts";
import { pruneAdminSessions } from "./admin/auth.ts";

ensureRuntimeDirs();
deleteStaleDrafts();
deleteExpiredSessions();
pruneAdminSessions();

// Unknown accounts still pay the scrypt cost, so login timing does not reveal
// whether an e-mail address exists.
const DUMMY_PASSWORD_HASH = hashPassword("dummy-password-for-timing-only");

/* ------------------------------------------------------------- demo cache */

interface DemoCache {
  dataset: ReturnType<typeof buildDemoDataset>;
  result: AnalysisResult;
  intel: IntelligenceSnapshot;
  narrative: Narrative;
  summary: DemoSummary;
  csv: string;
}

const demoCaches = new Map<string, DemoCache>();
const DEMO_ENV_COOKIE = "lr_demo_env";

function demoCookie(id: DemoEnvironmentId): string {
  return `${DEMO_ENV_COOKIE}=${id}; Path=/; SameSite=Lax; Max-Age=31536000`;
}

function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

/** Public pages read `?miljo=`; the sandbox remembers the choice in a cookie. */
function demoId(ctx: RequestContext): DemoEnvironmentId {
  const query = ctx.url.searchParams.get("miljo");
  if (isDemoEnvironment(query)) return query;
  const cookie = cookieValue(ctx.req.headers.get("cookie"), DEMO_ENV_COOKIE);
  return isDemoEnvironment(cookie) ? cookie : DEFAULT_DEMO_ENVIRONMENT;
}

function demo(id: DemoEnvironmentId = DEFAULT_DEMO_ENVIRONMENT, locale: Locale = "sv"): DemoCache {
  const cacheKey = `${id}:${locale}`;
  const cached = demoCaches.get(cacheKey);
  if (cached) return cached;

  const dataset = buildDemoDataset(id, locale === "sv" ? "sv" : "en");
  const result = analyze(dataset.items, { months: dataset.months }, []);
  const monthLabels: string[] = [];
  const now = new Date();
  for (let i = dataset.months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthLabels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const intel = buildIntelligence(dataset.items, result, { months: dataset.months, monthLabels });
  const narrative = buildTemplateNarrative(result, { company: dataset.company, filename: `exempel-${id}.csv` });

  // The public forecast shows the whole assortment, not one arbitrarily chosen
  // article. The item pages still show each article's own demand history.
  const aggregate = Array.from({ length: dataset.months }, (_, month) =>
    dataset.items.reduce((sum, item) => sum + (item.monthly?.[month] ?? 0), 0),
  );
  const sampleForecast = forecastSeries(aggregate, { horizon: 6 });
  const summary: DemoSummary = {
    inventoryValue: result.kpis.inventoryValue,
    deadStockValue: result.kpis.deadStockValue,
    overstockValue: result.kpis.overstockValue,
    turns: result.kpis.turns,
    skuCount: result.kpis.skuCount,
    releaseLow: result.kpis.potentialReleaseLow,
    releaseHigh: result.kpis.potentialReleaseHigh,
    health: intel.health.score,
    categories: intel.capital.byCategory.slice(0, 8).map((c) => ({ label: c.label, value: c.value, dead: c.deadValue })),
    matrix: intel.classification.matrix,
    history: sampleForecast.history,
    forecastPoints: sampleForecast.points,
    priorities: intel.priorities.slice(0, 6).map((p) => ({ name: p.name, reasons: p.reasons, score: p.score, value: p.value })),
  };

  const localizedDataset = {
    ...dataset,
    environment: { ...dataset.environment, company: dataset.company },
  };
  const cache: DemoCache = { dataset: localizedDataset, result, intel, narrative, summary, csv: demoCsv(localizedDataset) };
  demoCaches.set(cacheKey, cache);
  return cache;
}

/* ------------------------------------------------------------- analytics */

// Parsing a 500k-article result JSON costs hundreds of milliseconds and a large
// temporary allocation. The analysis rows are immutable once status is ok, so
// keep the most recently used one. A single entry bounds memory for Enterprise
// portfolios while making page, search and article requests reuse one object.
type LoadedAnalysis = { row: { id: string; filename: string; rows: number; result_json: string; narrative_json: string | null; created_at: string; warehouse: string | null; period_months: number | null; source: string | null }; result: AnalysisResult; narrative: Narrative };
let analysisCache: { key: string; value: LoadedAnalysis } | null = null;

function analysisFor(orgId: string, id: string) {
  const key = `${orgId}:${id}`;
  const row = db
    .query("SELECT * FROM analyses WHERE id = $id AND org_id = $o AND status = 'ok'")
    .get({ $id: id, $o: orgId }) as
    | { id: string; filename: string; rows: number; result_json: string; narrative_json: string | null; created_at: string; warehouse: string | null; period_months: number | null; source: string | null }
    | null;
  if (!row) return null;
  if (analysisCache?.key === key) return analysisCache.value;
  const stored = JSON.parse(row.result_json) as AnalysisResult;
  const result = normalizeAnalysis(stored);
  const narrative =
    result !== stored
      ? buildTemplateNarrative(result, { company: orgName(orgId), filename: row.filename })
      : row.narrative_json
        ? (JSON.parse(row.narrative_json) as Narrative)
        : buildTemplateNarrative(result, { company: "", filename: row.filename });
  const value = { row, result, narrative };
  analysisCache = { key, value };
  return value;
}

function latestAnalysis(orgId: string) {
  const row = db
    .query("SELECT id FROM analyses WHERE org_id = $o AND status = 'ok' ORDER BY created_at DESC LIMIT 1")
    .get({ $o: orgId }) as { id: string } | null;
  return row ? analysisFor(orgId, row.id) : null;
}

function analysisList(orgId: string) {
  return db
    .query(
      `SELECT a.id, a.filename, a.rows, a.created_at, a.source,
         i.id AS import_id, i.started_at AS imported_at, i.imported AS imported_rows, i.status AS import_status
       FROM analyses a
       LEFT JOIN imports i ON i.id = (
         SELECT i2.id FROM imports i2
         WHERE i2.analysis_id = a.id AND i2.org_id = a.org_id
         ORDER BY i2.started_at DESC LIMIT 1
       )
       WHERE a.org_id = $o AND a.status = 'ok'
       ORDER BY a.created_at DESC LIMIT 40`,
    )
    .all({ $o: orgId }) as Array<{
    id: string;
    filename: string;
    rows: number;
    created_at: string;
    source: string | null;
    import_id: string | null;
    imported_at: string | null;
    imported_rows: number | null;
    import_status: string | null;
  }>;
}

function snapshotsFor(orgId: string) {
  return valueHistory(orgId, null, 24);
}

function orgName(orgId: string): string {
  return (db.query("SELECT name FROM organizations WHERE id = $o").get({ $o: orgId }) as { name: string } | null)?.name ?? "Företaget";
}

function profileFromForm(form: Awaited<ReturnType<Request["formData"]>>): PricingProfile {
  const modules = form
    .getAll("modules")
    .map((value) => str(value))
    .filter((value) => MODULE_IDS.includes(value as never)) as PricingProfile["modules"];
  return normalizeProfile({
    industry: str(form.get("industry")),
    country: str(form.get("country")),
    businessType: str(form.get("businessType")),
    employees: numOr(form.get("employees"), 1),
    locations: numOr(form.get("locations"), 1),
    warehouses: numOr(form.get("warehouses"), 0),
    stores: numOr(form.get("stores"), 0),
    skus: numOr(form.get("skus"), 1),
    inventoryValue: numOr(form.get("inventoryValue"), 0),
    monthlyTransactions: numOr(form.get("monthlyTransactions"), 0),
    suppliers: numOr(form.get("suppliers"), 0),
    users: numOr(form.get("users"), 1),
    modules: modules.length ? modules : ["inventory"],
    support: (str(form.get("support")) as PricingProfile["support"]) || "standard",
    billingCycle: str(form.get("billingCycle")) === "annual" ? "annual" : "monthly",
    integrations: numOr(form.get("integrations"), 0),
    erp: str(form.get("erp")),
    wms: str(form.get("wms")),
    pos: str(form.get("pos")),
    ecommerce: str(form.get("ecommerce")),
    dataFormats: form.getAll("dataFormats").map((value) => str(value)),
    notes: str(form.get("notes")),
  });
}

function rulesFromForm(form: Awaited<ReturnType<Request["formData"]>>, current: ReturnType<typeof getPricingRules>): ReturnType<typeof getPricingRules> {
  const modulePrices = { ...current.modulePrices };
  for (const id of MODULE_IDS) modulePrices[id] = numOr(form.get(`module_${id}`), modulePrices[id]);
  const supportPrices = {
    standard: numOr(form.get("support_standard"), current.supportPrices.standard),
    priority: numOr(form.get("support_priority"), current.supportPrices.priority),
    dedicated: numOr(form.get("support_dedicated"), current.supportPrices.dedicated),
  };
  const packages = current.packages.map((pkg, index) => {
    const read = (key: string, fallback: number): number => {
      const value = numOr(form.get(key), fallback);
      return value <= 0 ? Number.MAX_SAFE_INTEGER : value;
    };
    return {
      ...pkg,
      maxSkus: read(`pkg_${index}_skus`, pkg.maxSkus),
      maxUsers: read(`pkg_${index}_users`, pkg.maxUsers),
      maxLocations: read(`pkg_${index}_locations`, pkg.maxLocations),
    };
  });
  return sanitizeRules({
    ...current,
    baseMonthly: numOr(form.get("baseMonthly"), current.baseMonthly),
    minimumMonthly: numOr(form.get("minimumMonthly"), current.minimumMonthly),
    annualDiscountPct: numOr(form.get("annualDiscountPct"), current.annualDiscountPct),
    roundingSek: numOr(form.get("roundingSek"), current.roundingSek),
    includedSkus: numOr(form.get("includedSkus"), current.includedSkus),
    skuBlock: numOr(form.get("skuBlock"), current.skuBlock),
    skuBlockPrice: numOr(form.get("skuBlockPrice"), current.skuBlockPrice),
    includedUsers: numOr(form.get("includedUsers"), current.includedUsers),
    extraUserPrice: numOr(form.get("extraUserPrice"), current.extraUserPrice),
    includedLocations: numOr(form.get("includedLocations"), current.includedLocations),
    extraLocationPrice: numOr(form.get("extraLocationPrice"), current.extraLocationPrice),
    includedTransactions: numOr(form.get("includedTransactions"), current.includedTransactions),
    transactionBlock: numOr(form.get("transactionBlock"), current.transactionBlock),
    transactionBlockPrice: numOr(form.get("transactionBlockPrice"), current.transactionBlockPrice),
    includedSuppliers: numOr(form.get("includedSuppliers"), current.includedSuppliers),
    supplierBlock: numOr(form.get("supplierBlock"), current.supplierBlock),
    supplierBlockPrice: numOr(form.get("supplierBlockPrice"), current.supplierBlockPrice),
    includedEmployees: numOr(form.get("includedEmployees"), current.includedEmployees),
    employeeBlock: numOr(form.get("employeeBlock"), current.employeeBlock),
    employeeBlockPrice: numOr(form.get("employeeBlockPrice"), current.employeeBlockPrice),
    includedInventoryValue: numOr(form.get("includedInventoryValue"), current.includedInventoryValue),
    inventoryValueBlock: numOr(form.get("inventoryValueBlock"), current.inventoryValueBlock),
    inventoryValueBlockPrice: numOr(form.get("inventoryValueBlockPrice"), current.inventoryValueBlockPrice),
    modulePrices,
    supportPrices,
    integrationMonthly: numOr(form.get("integrationMonthly"), current.integrationMonthly),
    implementationBase: numOr(form.get("implementationBase"), current.implementationBase),
    implementationPerIntegration: numOr(form.get("implementationPerIntegration"), current.implementationPerIntegration),
    implementationPerWarehouse: numOr(form.get("implementationPerWarehouse"), current.implementationPerWarehouse),
    packages,
  });
}

/** Resolves an analysis id from the query string, or the newest one. */
function selectedAnalysis(ctx: RequestContext, orgId: string) {
  const id = ctx.url.searchParams.get("analys");
  if (id) {
    const found = analysisFor(orgId, id);
    if (found) return found;
  }
  return latestAnalysis(orgId);
}

/* ------------------------------------------------------------------ router */

const router = new Router();

/* --------------------------------------------------------------- public */

const pageLocale = (ctx: Parameters<Parameters<typeof router.get>[1]>[0]): Locale =>
  resolveLocale({
    cookie: ctx.req.headers.get("cookie"),
    userLocale: ctx.user?.locale,
    orgLocale: ctx.org?.locale,
    fallback: DEFAULT_LOCALE,
  });

/**
 * The app falls back to Swedish only for legacy accounts without a stored
 * preference. Cookie, user and organisation are resolved in that order.
 */
const appLocale = (ctx: Parameters<Parameters<typeof router.get>[1]>[0]): Locale => {
  if (process.env.APP_LOCALE_OVERRIDE === PSEUDO_LOCALE && process.env.NODE_ENV !== "production") return PSEUDO_LOCALE;
  return resolveLocale({
    cookie: ctx.req.headers.get("cookie"),
    userLocale: ctx.user?.locale,
    orgLocale: ctx.org?.locale,
    fallback: "sv",
  });
};

router.get("/", (ctx) =>
  html(landingPage({ user: ctx.user ? { name: ctx.user.name } : null, demo: demo(demoId(ctx), pageLocale(ctx)).summary, locale: pageLocale(ctx) })),
);

router.get("/priser", (ctx) =>
  html(pricingPage({ user: ctx.user ? { name: ctx.user.name } : null, locale: pageLocale(ctx) })),
);

/** Stores the language choice and returns to the page the visitor came from. */
router.get("/sprak", (ctx) => {
  const lang = ctx.url.searchParams.get("lang") ?? "";
  const next = safeNext(ctx.url.searchParams.get("next"));
  if (!isAvailableLocale(lang)) return redirect(next, 303);
  if (ctx.user) updateUserLocale(ctx.user.id, lang);
  return redirect(next, 303, cookieFor(lang));
});

router.get("/produkt", (ctx) => {
  // Product preview: the same engine output as the authenticated sandbox, but
  // static. No item-level data and no interactive endpoints on the public site.
  const id = demoId(ctx);
  const d = demo(id, pageLocale(ctx));
  return html(
    productPage({
      user: ctx.user ? { name: ctx.user.name } : null,
      demo: d.summary,
      environment: d.dataset.environment,
      environments: DEMO_ENVIRONMENTS,
      locale: pageLocale(ctx),
    }),
  );
});

// The interactive sample moved behind authentication; old links land on the
// public product tour, preserving the chosen fictional environment.
router.get("/demo", (ctx) => {
  const id = demoId(ctx);
  return redirect(`/produkt?miljo=${id}`, 301);
});

// The technical documentation is not part of the customer-facing site. Old
// links land on the customer guide; developers find the API behind a permission.
router.get("/dokumentation", () => redirect("/kom-igang", 301));

router.get("/kom-igang", (ctx) =>
  html(getStartedPage({ user: ctx.user ? { name: ctx.user.name } : null, locale: pageLocale(ctx) })),
);

router.get("/utvecklare", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "api.manage");
  if (blocked) return blocked;
  return html(developerPage({ user: ctx.user ? { name: ctx.user.name } : null, locale: pageLocale(ctx) }));
});

router.get("/hjalp", (ctx) =>
  html(helpPage({ user: ctx.user ? { name: ctx.user.name } : null, locale: pageLocale(ctx) })),
);

router.get("/integritet", (ctx) =>
  html(legalPage("integritet", ctx.user ? { name: ctx.user.name } : null, pageLocale(ctx))),
);

router.get("/villkor", (ctx) =>
  html(legalPage("villkor", ctx.user ? { name: ctx.user.name } : null, pageLocale(ctx))),
);

router.get("/om-oss", (ctx) =>
  html(aboutPage({ user: ctx.user ? { name: ctx.user.name } : null, locale: pageLocale(ctx) })),
);

router.get("/kontakt", (ctx) =>
  html(
    contactPage({
      user: ctx.user ? { name: ctx.user.name } : null,
      subject: ctx.url.searchParams.get("amne") ?? undefined,
      locale: pageLocale(ctx),
    }),
  ),
);

router.post("/kontakt", async (ctx) => {
  const contactCopy = strings(pageLocale(ctx)).contact;
  if (!isSameOrigin(ctx.req)) return html(contactPage({ user: null, error: contactCopy.errorOrigin, locale: pageLocale(ctx) }), 403);
  const limit = rateLimit(`contact:${ctx.ip}`, 5, 3600);
  if (!limit.ok) return html(contactPage({ user: null, error: contactCopy.errorRate, locale: pageLocale(ctx) }), 429);
  const form = await readForm(ctx);
  const name = str(form?.get("namn"));
  const email = str(form?.get("epost"));
  const message = str(form?.get("meddelande"));
  if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || message.length < 10 || message.length > 5000) {
    return html(contactPage({ user: null, error: contactCopy.errorRequired, locale: pageLocale(ctx) }), 400);
  }
  const company = str(form?.get("foretag")).slice(0, 160);
  const subject = (str(form?.get("amne")) || "General inquiry").slice(0, 80);
  createLead({ name, email, company, message: `[${subject}]\n\n${message}` });
  const inbox = contactInbox();
  if (inbox) {
    // Best effort: the lead is stored first, so a mail outage never loses it.
    await sendMail({ to: inbox, ...contactNotificationMail({ name, email, company, subject, message }) });
  }
  return html(contactPage({ user: null, sent: true, locale: pageLocale(ctx) }));
});

router.get("/halsa", () => json({ status: "ok", version: "2.0.0", uptime: Math.round(process.uptime()) }));

// Crawl surface. Generated from src/seo.ts so the sitemap and the robots rules
// cannot disagree with the pages the app actually serves.
router.get("/robots.txt", () => plain(robotsTxt()));
router.get("/sitemap.xml", () => plain(sitemapXml(), "application/xml; charset=utf-8"));

router.get("/exempelrapport.pdf", async (ctx) => {
  const locale = pageLocale(ctx);
  const d = demo(demoId(ctx), locale);
  const pdf = await buildPdf(d.result, d.narrative, {
    locale,
    company: d.dataset.company,
    filename: `${locale === "sv" ? "exempel" : "sample"}-${d.dataset.environment.id}.csv`,
    generatedAt: new Date().toISOString(),
    contactEmail: EMAILS.hello ?? undefined,
    fictional: true,
  });
  return new Response(pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${reportFileName(locale)}"`,
    },
  });
});

router.get("/api/demo-csv", (ctx) => {
  const d = demo(demoId(ctx), pageLocale(ctx));
  return new Response(d.csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="exempel-${d.dataset.environment.id}.csv"`,
    },
  });
});

/* ------------------------------------------------------------------- auth */

function nextAfterLogin(raw: string | null | undefined): string {
  const safe = safeNext(raw);
  return safe === "/" && raw !== "/" ? "/app" : safe;
}

router.get("/logga-in", (ctx) => {
  const authCopy = strings(pageLocale(ctx)).auth;
  const deleted = ctx.url.searchParams.get("raderad");
  return html(
    loginPage({
      user: ctx.user ? { name: ctx.user.name } : null,
      next: nextAfterLogin(ctx.url.searchParams.get("nasta")),
      notice: deleted === "konto" ? authCopy.accountDeleted : ctx.url.searchParams.get("aterstalld") ? authCopy.resetDone : undefined,
      locale: pageLocale(ctx),
    }),
  );
});

router.post("/logga-in", async (ctx) => {
  const authCopy = strings(pageLocale(ctx)).auth;
  if (!isSameOrigin(ctx.req))
    return html(loginPage({ user: null, error: authCopy.errorOrigin, locale: pageLocale(ctx) }), 403);
  const form = await readForm(ctx);
  const email = str(form?.get("epost")).toLowerCase().slice(0, 254);
  const password = str(form?.get("losenord"));
  const next = str(form?.get("nasta")) || "/app";

  // Separate buckets: one per source address (many addresses cannot bypass) and
  // one per account (one address cannot spray many accounts as easily).
  const ipLimit = rateLimit(`login-ip:${ctx.ip}`, 30, 900);
  const accountLimit = rateLimit(`login-account:${email || "tom"}`, 8, 900);
  if (!ipLimit.ok || !accountLimit.ok) {
    const retryAfter = Math.max(ipLimit.retryAfter, accountLimit.retryAfter);
    return html(loginPage({ user: null, error: authCopy.errorRate.replace("{seconds}", String(retryAfter)), locale: pageLocale(ctx) }), 429);
  }

  const user = findUserByEmail(email);
  const passwordOk = password.length <= 200 && verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!user || !passwordOk) {
    audit({ orgId: null, userId: user?.id ?? null, action: "login.failed", target: email, ip: ctx.ip });
    return html(loginPage({ user: null, error: authCopy.errorCredentials, locale: pageLocale(ctx) }), 401);
  }

  const membership = orgForUser(user.id);
  if (user.status === "suspended" || membership?.org.status === "suspended") {
    audit({ orgId: membership?.org.id ?? null, userId: user.id, action: "login.suspended", ip: ctx.ip });
    return html(loginPage({ user: null, error: "Kontot är pausat. Kontakta supporten.", locale: pageLocale(ctx) }), 403);
  }
  const session = startSession(user.id);
  audit({ orgId: membership?.org.id ?? null, userId: user.id, action: "login.success", ip: ctx.ip });
  const target = nextAfterLogin(next);
  return redirect(membership ? target : "/start", 303, session.cookie);
});

/* ------------------------------------------------- password reset by e-mail */

const resetExpired = (iso: string): boolean => new Date(iso).getTime() <= Date.now();

router.get("/glomt-losenord", (ctx) => html(forgotPasswordPage({ locale: pageLocale(ctx) })));

router.post("/glomt-losenord", async (ctx) => {
  const authCopy = strings(pageLocale(ctx)).auth;
  if (!isSameOrigin(ctx.req))
    return html(forgotPasswordPage({ error: authCopy.errorOrigin, locale: pageLocale(ctx) }), 403);
  const limit = rateLimit(`reset-ip:${ctx.ip}`, 10, 3600);
  if (!limit.ok)
    return html(
      forgotPasswordPage({
        error: authCopy.errorRate.replace("{seconds}", String(limit.retryAfter)),
        locale: pageLocale(ctx),
      }),
      429,
    );

  const form = await readForm(ctx);
  const email = str(form?.get("epost")).toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return html(forgotPasswordPage({ error: authCopy.errorEmail, locale: pageLocale(ctx) }), 400);

  // The answer is identical whether or not the address exists, so the form
  // cannot be used to enumerate accounts. Existing but suspended accounts get
  // no link: they would still be blocked at sign-in.
  if (rateLimit(`reset-account:${email}`, 3, 3600).ok) {
    const user = findUserByEmail(email);
    if (user && user.status === "active") {
      const reset = newPasswordResetToken();
      createPasswordReset(user.id, reset.tokenHash, reset.expiresAt);
      const link = `${config.appOrigin}/aterstall-losenord/${reset.token}`;
      await sendMail({
        to: user.email,
        ...passwordResetMail({ name: user.name, link, expiresInMinutes: PASSWORD_RESET_TTL_MINUTES }),
      });
      audit({
        orgId: orgForUser(user.id)?.org.id ?? null,
        userId: user.id,
        action: "password.reset.requested",
        ip: ctx.ip,
      });
    }
  }
  return html(forgotPasswordPage({ sent: true, locale: pageLocale(ctx) }));
});

router.get("/aterstall-losenord/:token", (ctx) => {
  const reset = findPasswordReset(sha256(ctx.params.token!));
  const user = reset ? findUserById(reset.user_id) : null;
  const valid = Boolean(reset && user && !resetExpired(reset.expires_at));
  return html(
    resetPasswordPage({
      token: valid ? ctx.params.token! : "",
      email: valid ? user!.email : "",
      invalid: !valid,
      locale: pageLocale(ctx),
    }),
    valid ? 200 : 410,
  );
});

router.post("/aterstall-losenord/:token", async (ctx) => {
  const authCopy = strings(pageLocale(ctx)).auth;
  const token = ctx.params.token!;
  if (!isSameOrigin(ctx.req))
    return html(
      resetPasswordPage({ token: "", email: "", invalid: true, error: authCopy.errorOrigin, locale: pageLocale(ctx) }),
      403,
    );
  const limit = rateLimit(`reset-submit:${ctx.ip}`, 10, 900);
  if (!limit.ok)
    return html(
      resetPasswordPage({
        token: "",
        email: "",
        invalid: true,
        error: authCopy.errorRate.replace("{seconds}", String(limit.retryAfter)),
        locale: pageLocale(ctx),
      }),
      429,
    );

  const reset = findPasswordReset(sha256(token));
  const user = reset ? findUserById(reset.user_id) : null;
  if (!reset || !user || resetExpired(reset.expires_at))
    return html(resetPasswordPage({ token: "", email: "", invalid: true, locale: pageLocale(ctx) }), 410);

  const form = await readForm(ctx);
  const password = str(form?.get("losenord"));
  const confirmation = str(form?.get("losenord2"));
  if (password.length < 10 || password.length > 200)
    return html(
      resetPasswordPage({ token, email: user.email, error: authCopy.errorFields, locale: pageLocale(ctx) }),
      400,
    );
  if (password !== confirmation)
    return html(
      resetPasswordPage({ token, email: user.email, error: authCopy.resetMismatch, locale: pageLocale(ctx) }),
      400,
    );

  // Claiming the token before the update makes reuse impossible even when two
  // requests arrive at the same time.
  if (!consumePasswordReset(reset.id))
    return html(resetPasswordPage({ token: "", email: "", invalid: true, locale: pageLocale(ctx) }), 409);

  updateUserPassword(user.id, hashPassword(password));
  // A reset must also evict anyone already holding a session for the account.
  deleteSessionsForUser(user.id);
  deletePasswordResetsForUser(user.id);
  audit({
    orgId: orgForUser(user.id)?.org.id ?? null,
    userId: user.id,
    action: "password.reset.completed",
    ip: ctx.ip,
  });
  // The password is already stored, so the confirmation is not awaited: a slow
  // or failing provider must never turn a completed reset into an error page.
  void sendMail({
    to: user.email,
    ...passwordChangedMail({
      name: user.name,
      changedAt: new Date(),
      contactUrl: `${config.appOrigin}/kontakt`,
    }),
  });
  return redirect("/logga-in?aterstalld=1");
});

router.post("/logga-ut", (ctx) => {
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const cookie = endSession(ctx.req);
  return redirect("/", 303, cookie);
});

router.get("/skapa-konto", (ctx) =>
  html(
    registerPage({
      user: ctx.user ? { name: ctx.user.name } : null,
      plan: ctx.url.searchParams.get("plan") ?? "trial",
      locale: pageLocale(ctx),
      error: settingEnabled("signups_enabled") ? undefined : "Självregistrering är tillfälligt stängd. Kontakta oss för att skapa ett konto.",
    }),
    settingEnabled("signups_enabled") ? 200 : 503,
  ),
);

router.post("/skapa-konto", async (ctx) => {
  const authCopy = strings(pageLocale(ctx)).auth;
  if (!settingEnabled("signups_enabled")) {
    return html(registerPage({ user: null, error: "Självregistrering är tillfälligt stängd. Kontakta oss för att skapa ett konto.", locale: pageLocale(ctx) }), 503);
  }
  if (!isSameOrigin(ctx.req))
    return html(registerPage({ user: null, error: authCopy.errorOrigin, locale: pageLocale(ctx) }), 403);
  const limit = rateLimit(`register:${ctx.ip}`, 5, 3600);
  if (!limit.ok) return html(registerPage({ user: null, error: authCopy.errorRegisterRate, locale: pageLocale(ctx) }), 429);

  const form = await readForm(ctx);
  const name = str(form?.get("namn"));
  const company = str(form?.get("foretag"));
  const email = str(form?.get("epost")).toLowerCase();
  const password = str(form?.get("losenord"));
  const requestedPlan = (str(form?.get("plan")) || "trial").slice(0, 40);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
  if (!name || name.length > 120 || !company || company.length > 160 || !emailValid || password.length < 10 || password.length > 200) {
    return html(registerPage({ user: null, error: authCopy.errorFields, locale: pageLocale(ctx) }), 400);
  }
  if (findUserByEmail(email)) {
    return html(registerPage({ user: null, error: authCopy.errorEmailTaken, locale: pageLocale(ctx) }), 409);
  }

  const locale = contentLocale(pageLocale(ctx));
  const user = createUser({ email, passwordHash: hashPassword(password), name, company, locale });
  // Self-service registration always starts on the trial. A plan named in a
  // form or query string is a request for a quote, never an entitlement.
  const org = createOrganization({ name: company, userId: user.id, plan: "trial", locale });

  const session = startSession(user.id);
  audit({ orgId: org.id, userId: user.id, action: "org.created", target: org.name, ip: ctx.ip, meta: { requestedPlan } });
  try {
    await sendTrialWelcomeForOrg(org.id);
  } catch (error) {
    console.error("[lagerradar] kunde inte skicka välkomstmejl:", error);
  }
  return redirect("/start", 303, session.cookie);
});

router.get("/start", async (ctx) => {
  const blocked = requireUser(ctx);
  if (blocked) return blocked;
  const membership = ctx.org && ctx.role ? { org: ctx.org, role: ctx.role } : null;
  if (!membership) {
    // Signed in but without an organisation: create one so the user is never stuck.
    const org = createOrganization({
      name: ctx.user!.company || `${ctx.user!.name}s företag`,
      userId: ctx.user!.id,
      locale: ctx.user!.locale === "en" ? "en" : "sv",
    });
    try {
      await sendTrialWelcomeForOrg(org.id);
    } catch (error) {
      console.error("[lagerradar] kunde inte skicka välkomstmejl:", error);
    }
    return redirect("/start");
  }
  const record = getPricingProfile(membership.org.id);
  const latest = latestAnalysis(membership.org.id);
  return html(
    pricingStartPage({
      locale: appLocale(ctx),
      user: { id: ctx.user!.id, name: ctx.user!.name, email: ctx.user!.email },
      org: membership.org,
      role: membership.role,
      url: ctx.url,
      profile: record?.profile ?? null,
      estimate: record?.estimate ?? null,
      dataSummary: latest
        ? {
            skus: latest.result.kpis.skuCount,
            inventoryValue: latest.result.kpis.inventoryValue,
            months: latest.result.dataQuality.months,
          }
        : null,
    }),
  );
});

router.post("/start", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "org.manage");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  if (!form) return redirect("/start?fel=" + encodeURIComponent(appText(appLocale(ctx), "Formuläret kunde inte läsas.")));
  const profile = profileFromForm(form);
  const estimate = calculateEstimate(profile, getPricingRules());
  savePricingProfile(ctx.org!.id, profile, estimate);
  audit({ orgId: ctx.org!.id, userId: ctx.user!.id, action: "pricing.profile.saved", target: profile.industry, ip: ctx.ip });
  return redirect("/app/prisestimat?meddelande=" + encodeURIComponent(appText(appLocale(ctx), "Ditt prisestimat är beräknat.")));
});

/**
 * The invitation carries the inviter's language, so the recipient gets the
 * same language in the mail and on the page, independent of the recipient's
 * own cookie. Invitations from before the column existed were mailed in
 * Swedish, which is why anything but an explicit "en" falls back to Swedish.
 */
const invitePageLocale = (stored: string | null): "sv" | "en" => (stored === "en" ? "en" : "sv");

router.get("/bjud-in/:token", (ctx) => {
  const invitation = findInvitation(ctx.params.token!);
  if (!invitation) return html(notFoundPage(pageLocale(ctx)), 404);
  return html(
    invitePage({
      token: ctx.params.token!,
      email: invitation.email,
      orgName: invitation.org_name,
      role: invitation.role,
      locale: invitePageLocale(invitation.locale),
    }),
  );
});

router.post("/bjud-in/:token", async (ctx) => {
  if (!isSameOrigin(ctx.req)) return html(notFoundPage(pageLocale(ctx)), 403);
  const invitation = findInvitation(ctx.params.token!);
  if (!invitation) return html(notFoundPage(pageLocale(ctx)), 404);
  const locale = invitePageLocale(invitation.locale);
  const inviteCopy = strings(locale).invite;
  // Owner is never an invitable role. Rejecting it here also neutralises any
  // pending invitation created before the role checks were introduced.
  if (!isRole(invitation.role) || invitation.role === "owner") {
    return html(invitePage({ token: ctx.params.token!, email: invitation.email, orgName: invitation.org_name, role: invitation.role, error: inviteCopy.errorOwner, locale }), 400);
  }

  const form = await readForm(ctx);
  const name = str(form?.get("namn"));
  const password = str(form?.get("losenord"));
  if (!name || name.length > 120 || password.length < 10 || password.length > 200) {
    return html(invitePage({ token: ctx.params.token!, email: invitation.email, orgName: invitation.org_name, role: invitation.role, error: inviteCopy.errorFields, locale }), 400);
  }

  let user = findUserByEmail(invitation.email);
  if (user) {
    // An invitation must never be a password reset. The existing account has to
    // prove its password (or already be signed in as that account) before the
    // membership is added.
    const signedInAsTarget = ctx.user?.id === user.id;
    if (!signedInAsTarget && !verifyPassword(password, user.password_hash)) {
      audit({ orgId: invitation.org_id, userId: null, action: "invitation.failed", target: invitation.email, ip: ctx.ip, meta: { reason: "password" } });
      return html(invitePage({ token: ctx.params.token!, email: invitation.email, orgName: invitation.org_name, role: invitation.role, error: inviteCopy.errorPassword, locale }), 401);
    }
  } else {
    user = createUser({
      email: invitation.email,
      passwordHash: hashPassword(password),
      name,
      company: invitation.org_name,
      locale: invitation.locale === "en" ? "en" : "sv",
    });
  }

  if (!acceptInvitation(invitation.id, invitation.org_id, user.id, invitation.role)) {
    return html(invitePage({ token: ctx.params.token!, email: invitation.email, orgName: invitation.org_name, role: invitation.role, error: inviteCopy.errorUsed, locale }), 409);
  }
  audit({ orgId: invitation.org_id, userId: user.id, action: "member.joined", target: invitation.email, ip: ctx.ip });
  const session = startSession(user.id);
  return redirect("/app", 303, session.cookie);
});

/* -------------------------------------------------------------- dashboard */

router.get("/app", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const found = selectedAnalysis(ctx, orgId);
  if (!found) {
    return html(requireAuthShell(ctx, "Översikt", dashboardEmptyState({ locale: appLocale(ctx), org: ctx.org! })));
  }

  const months = found.result.dataQuality.months;
  const snapshots = snapshotsFor(orgId);
  const intel = buildIntelligence(rebuildInputs(found.result), found.result, { months, snapshots });

  return html(
    dashboardPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      result: found.result,
      intel,
      analysisId: found.row.id,
      analyses: analysisList(orgId),
      snapshots,
    }),
  );
});

function requireAuthShell(ctx: RequestContext, title: string, content: string): string {
  return shell({
    title: appText(appLocale(ctx), title),
    locale: appLocale(ctx),
    path: ctx.url.pathname + ctx.url.search,
    active: "dashboard",
    user: ctx.user!,
    org: ctx.org ?? { name: "Ingen organisation", plan: "trial" },
    role: ctx.role ?? "viewer",
    content,
  });
}

/* ------------------------------------------------------------------ items */

/* ---------------------------------------------------------------- sandbox */

router.get("/app/sandbox/miljo/:id", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  if (!isDemoEnvironment(ctx.params.id)) return html(notFoundPage(appLocale(ctx)), 404);
  return redirect("/app/sandbox", 303, demoCookie(ctx.params.id));
});

router.get("/app/sandbox", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const locale = appLocale(ctx);
  const d = demo(demoId(ctx), locale);
  return html(
    sandboxDashboard({
      environment: d.dataset.environment,
      environments: DEMO_ENVIRONMENTS,
      locale,
      path: ctx.url.pathname + ctx.url.search,
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      result: d.result,
      intel: d.intel,
      history: d.summary.history,
      forecastPoints: d.summary.forecastPoints,
    }),
  );
});

router.get("/app/sandbox/artiklar", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const query: Record<string, string> = {};
  for (const key of ["q", "category", "action", "sort", "dir", "page"]) {
    const value = ctx.url.searchParams.get(key);
    if (value) query[key] = value;
  }
  const locale = appLocale(ctx);
  const d = demo(demoId(ctx), locale);
  return html(
    sandboxItems({
      locale,
      path: ctx.url.pathname + ctx.url.search,
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      environment: d.dataset.environment,
      environments: DEMO_ENVIRONMENTS,
      result: d.result,
      intel: d.intel,
      query,
    }),
  );
});

router.get("/app/sandbox/artiklar/:sku", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const locale = appLocale(ctx);
  const d = demo(demoId(ctx), locale);
  const item = d.result.items.find((i) => i.sku === ctx.params.sku);
  if (!item) return html(notFoundPage(locale), 404);
  return html(
    sandboxItem({
      environment: d.dataset.environment,
      environments: DEMO_ENVIRONMENTS,
      locale,
      path: ctx.url.pathname + ctx.url.search,
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      result: d.result,
      intel: d.intel,
      item,
    }),
  );
});

router.get("/app/sokforslag", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const found = selectedAnalysis(ctx, orgId);
  const q = (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const locale = appLocale(ctx);
  if (!found || q.length < 2) return json({ items: [], categories: [], synonyms: [] });

  const plan = planSearch(q, contentLocale(locale));
  const result = queryItems(orgId, found.row.id, { q, lang: contentLocale(locale), pageSize: 6 });
  const categories = categoryLabels(contentLocale(locale))
    .filter((label) => fold(label).includes(fold(q)))
    .slice(0, 3);
  return json({
    items: result.rows.map((row) => ({
      sku: String(row.sku),
      name: String(row.name),
      category: localizeCategory(row.category ? String(row.category) : null, contentLocale(locale)),
      href: `/app/artiklar/${encodeURIComponent(String(row.sku))}?analys=${encodeURIComponent(found.row.id)}`,
    })),
    categories: categories.map((label) => ({ label, href: `/app/artiklar?analys=${encodeURIComponent(found.row.id)}&category=${encodeURIComponent(label)}` })),
    synonyms: plan.synonyms.slice(0, 4),
  });
});

router.get("/app/artiklar", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const found = selectedAnalysis(ctx, orgId);
  if (!found) return redirect("/app/importera");

  const q = ctx.url.searchParams;
  const requestedPage = Number(q.get("page") ?? 1);
  const page = Math.min(100_000, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  const query = {
    q: q.get("q") ?? undefined,
    lang: contentLocale(appLocale(ctx)),
    category: q.get("category") ?? undefined,
    action: q.get("action") ?? undefined,
    abc: q.get("abc") ?? undefined,
    xyz: q.get("xyz") ?? undefined,
    sort: (q.get("sort") as "value" | "name" | "stock" | "turns" | "margin" | "cover" | "priority" | "sold") ?? "value",
    dir: (q.get("dir") as "asc" | "desc") ?? "desc",
    page,
    pageSize: 50,
  };
  const items = queryItems(orgId, found.row.id, query);
  const intel = buildIntelligence(rebuildInputs(found.result), found.result, { months: found.result.dataQuality.months });

  return html(
    itemsPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      result: found.result,
      intel,
      analysisId: found.row.id,
      rows: items.rows,
      total: items.total,
      totalValue: items.totalValue,
      page: items.page,
      pages: items.pages,
      facets: itemFacets(orgId, found.row.id),
      canDelete: canDeleteOrgData(ctx.role!, limitsForOrg(orgId)),
      query: {
        analys: found.row.id,
        q: query.q ?? "",
        category: query.category ?? "",
        action: query.action ?? "",
        abc: query.abc ?? "",
        xyz: query.xyz ?? "",
        sort: query.sort ?? "value",
        dir: query.dir ?? "desc",
      },
    }),
  );
});

/* -------------------------------------------------------------- lagervärld */

router.get("/app/lagervarld", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const found = selectedAnalysis(ctx, ctx.org!.id);
  if (!found) return redirect("/app/importera");
  const locale = appLocale(ctx);
  const model = buildAppWorld(found.result.items, found.result.kpis, locale);
  // Above the detail budget the browser cannot hold a per-article simulation
  // input, so the same model runs once here and the page receives the finished
  // day series. Every article is part of those totals.
  const portfolioRun = model.mode === "hierarchical" ? portfolioPlayback(found.result.items, found.row.id) : null;
  const monthLabel = new Intl.DateTimeFormat(locale === "sv" ? "sv-SE" : "en-US", { month: "long" }).format(
    new Date(Date.UTC(2026, 11, 1)),
  );
  return html(
    appWorldPage({
      locale,
      path: ctx.url.pathname + ctx.url.search,
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      analysisId: found.row.id,
      monthLabel,
      months: found.result.dataQuality.months,
      items: found.result.items,
      kpis: found.result.kpis,
      model,
      categories: model.categories.map((c) => c.category),
      serviceLevel: found.result.settings.serviceLevel,
      portfolioRun,
    }),
  );
});

/** Streams the analysis through the portfolio engine without building a second
 * array of full article objects, then returns the compact day series. */
function portfolioPlayback(items: AnalyzedItem[], seed: string) {
  return runPortfolioSimulation(portfolioView(items), { days: 90 }, { seed });
}

function* portfolioView(items: AnalyzedItem[]): Generator<PortfolioArticle> {
  for (const item of items) {
    yield {
      sku: item.sku,
      name: item.name,
      stock: item.stock,
      cost: item.cost,
      avgMonthly: item.avgMonthlyDemand,
      leadTimeDays: item.leadTimeDays,
      safetyStock: item.safetyStock,
      reorderPoint: item.reorderPoint,
      overstockQty: item.overstockQty,
      moq: Math.max(1, Math.ceil(item.moq ?? item.avgMonthlyDemand / 4)),
      status:
        item.action === "write_off" || item.action === "liquidate"
          ? "inactive"
          : item.stockoutRisk
            ? "stockout"
            : item.overstockQty > 0
              ? "overstock"
              : "balanced",
    };
  }
}

/** Server-backed table for the complete portfolio: category, ABC, XYZ, status,
 * search, sort and page all run here rather than on a rendered subset. */
router.get("/app/lagervarld/tabell", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const found = selectedAnalysis(ctx, ctx.org!.id);
  if (!found) return json({ error: "no_analysis" }, 404);
  const page = Number.parseInt(ctx.url.searchParams.get("page") ?? "1", 10);
  const result = appWorldTable({
    items: found.result.items,
    locale: appLocale(ctx),
    analysisId: found.row.id,
    page: Number.isFinite(page) ? page : 1,
    sort: ctx.url.searchParams.get("sort") ?? undefined,
    dir: ctx.url.searchParams.get("dir") ?? undefined,
    category: ctx.url.searchParams.get("category") ?? undefined,
    abc: ctx.url.searchParams.get("abc") ?? undefined,
    xyz: ctx.url.searchParams.get("xyz") ?? undefined,
    status: ctx.url.searchParams.get("status") ?? undefined,
    query: ctx.url.searchParams.get("q") ?? undefined,
  });
  return json(result);
});

/** Server-backed search across the complete portfolio, independent of the
 * rendered table page and of the 3D detail budget. */
router.get("/app/lagervarld/sok", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const found = selectedAnalysis(ctx, ctx.org!.id);
  if (!found) return json({ error: "no_analysis" }, 404);
  const query = (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 200);
  if (query.length < 2) return json({ items: [], query });
  const locale = appLocale(ctx);
  const sv = locale === "sv";
  // Search the already-loaded analysis in memory. A 500k SQL LIKE scan with
  // synonym expansion takes ~1.8 s; the same substring scan over the cached
  // objects is far cheaper and always uses the exact rows the world represents.
  const needle = query.toLocaleLowerCase(locale === "sv" ? "sv-SE" : "en-US");
  const matches = found.result.items
    .filter((item) =>
      `${item.sku} ${item.name} ${item.category ?? ""} ${item.supplier ?? ""}`
        .toLocaleLowerCase(locale === "sv" ? "sv-SE" : "en-US")
        .includes(needle),
    )
    .sort((a, b) => b.value - a.value || a.sku.localeCompare(b.sku))
    .slice(0, 12);
  const total = matches.length;
  const locations = locateLiveArticles(
    found.result.items,
    matches.map((item) => item.sku),
    contentLocale(locale),
  );
  const items = matches.map((analysed) => {
    const location = locations.get(analysed.sku) ?? null;
    const status = analysed.action === "write_off" || analysed.action === "liquidate"
      ? "inactive"
      : analysed.stockoutRisk
        ? "stockout"
        : analysed.overstockQty > 0
          ? "overstock"
          : "balanced";
    const locationLabel = location
      ? location.clusterLabel
        ? sv
          ? `Zon ${location.clusterLabel} · nivå ${location.level + 1}`
          : `Zone ${location.clusterLabel} · level ${location.level + 1}`
        : sv
          ? `${location.band === "inactive" ? "Inaktivt lager" : `Zon ${location.band}`} · gång ${location.aisle + 1} · fack ${location.bay + 1} · nivå ${location.level + 1}`
          : `${location.band === "inactive" ? "Inactive stock" : `Zone ${location.band}`} · aisle ${location.aisle + 1} · bay ${location.bay + 1} · level ${location.level + 1}`
      : sv ? "Placering saknas" : "No location";
    return {
      sku: analysed.sku,
      name: analysed.name,
      category: analysed.category,
      stock: analysed.stock,
      value: analysed.value,
      abc: analysed.abc,
      xyz: analysed.xyz,
      status,
      location: locationLabel,
      locationPoint: location,
    };
  });
  return json({ items, query, total });
});

/** Expand one aggregate cluster into individual articles, loaded on demand. */
router.get("/app/lagervarld/kluster/:id", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const found = selectedAnalysis(ctx, ctx.org!.id);
  if (!found) return json({ error: "no_analysis" }, 404);
  const raw = ctx.params.id ?? "";
  const index = Number.parseInt(raw.replace(/^cluster-/, ""), 10);
  const detail = liveClusterDetail(found.result.items, index, contentLocale(appLocale(ctx)));
  if (!detail) return json({ error: "not_found" }, 404);
  return json(detail);
});

/** One article for the click panel; the 3D payload only carries positions. */
router.get("/app/lagervarld/artikel/:sku", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const found = selectedAnalysis(ctx, ctx.org!.id);
  if (!found) return json({ error: "no_analysis" }, 404);
  const item = getItem(ctx.org!.id, found.row.id, ctx.params.sku!);
  if (!item) return json({ error: "not_found" }, 404);
  const analysed = found.result.items.find((entry) => entry.sku === item.sku);
  if (!analysed) return json({ error: "not_found" }, 404);
  const locale = appLocale(ctx);
  const sv = locale === "sv";
  // Locating one SKU is O(n) and never rebuilds the full world, so the panel
  // stays responsive at 500,000 articles.
  const locationPoint = locateLiveArticle(found.result.items, analysed.sku, contentLocale(locale));
  const zoneName = locationPoint
    ? locationPoint.band === "inactive"
      ? sv ? "Inaktivt lager" : "Inactive stock"
      : sv ? `${locationPoint.band}-zon` : `Zone ${locationPoint.band}`
    : null;
  const location = locationPoint
    ? locationPoint.clusterLabel
      ? `${zoneName} · ${locationPoint.clusterLabel} · ${sv ? "nivå" : "level"} ${locationPoint.level + 1}`
      : `${zoneName} · ${sv ? "gång" : "aisle"} ${locationPoint.aisle + 1} · ${sv ? "fack" : "bay"} ${locationPoint.bay + 1} · ${sv ? "nivå" : "level"} ${locationPoint.level + 1}`
    : null;
  const unitMargin = analysed.price === null ? null : analysed.price - analysed.cost;
  const marginPct = analysed.price !== null && analysed.price > 0 ? Math.round(((analysed.price - analysed.cost) / analysed.price) * 1000) / 10 : null;
  const demand = analysed.monthlyDemand ? analysed.monthlyDemand.slice(-12) : [];
  return json({
    sku: analysed.sku,
    name: analysed.name,
    category: analysed.category,
    supplier: analysed.supplier,
    abc: analysed.abc,
    xyz: analysed.xyz,
    status: analysed.action === "write_off" || analysed.action === "liquidate"
      ? "inactive"
      : analysed.stockoutRisk
        ? "stockout"
        : analysed.overstockQty > 0
          ? "overstock"
          : "balanced",
    stock: analysed.stock,
    reserved: analysed.reserved,
    available: analysed.available,
    value: analysed.value,
    cost: analysed.cost,
    price: analysed.price,
    unitMargin,
    marginPct,
    coverDays: analysed.coverDays,
    leadTimeDays: analysed.leadTimeDays,
    reorderPoint: analysed.reorderPoint,
    safetyStock: analysed.safetyStock,
    overstockQty: analysed.overstockQty,
    avgMonthly: analysed.avgMonthlyDemand,
    demand,
    action: analysed.action,
    actionLabel: itemActionLabel(analysed, locale),
    why: itemWhy(analysed, locale),
    location,
    zone: locationPoint ? locationPoint.band : null,
    locationPoint,
    href: `/app/artiklar/${encodeURIComponent(analysed.sku)}?analys=${encodeURIComponent(found.row.id)}`,
  });
});

/** Temporary what-if on the signed-in portfolio. Nothing is written. */
router.get("/app/lagervarld/simulera", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const found = selectedAnalysis(ctx, ctx.org!.id);
  if (!found) return json({ error: "no_analysis" }, 404);
  const simulation = simulatePortfolio(
    rebuildInputs(found.result),
    { months: found.result.dataQuality.months, serviceLevel: found.result.settings.serviceLevel },
    {
      leadDeltaDays: Number(ctx.url.searchParams.get("lead") ?? 0),
      serviceLevel: Number(ctx.url.searchParams.get("service") ?? found.result.settings.serviceLevel),
      demandPct: Number(ctx.url.searchParams.get("demand") ?? 0),
    },
    appLocale(ctx),
  );
  return json({ ...simulation, limit: APP_WORLD_LIMIT });
});

router.post("/app/lagervarld/simulera", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const found = selectedAnalysis(ctx, ctx.org!.id);
  if (!found) return json({ error: "no_analysis" }, 404);
  const form = await readForm(ctx);
  const scenario = normalizeSimulation({
    preset: (str(form?.get("preset")) || "normal") as never,
    days: numOr(form?.get("days"), 90),
    demandPct: numOr(form?.get("demandPct"), 0),
    leadDays: numOr(form?.get("leadDays"), 0),
    safetyPct: numOr(form?.get("safetyPct"), 0),
    moqPct: numOr(form?.get("moqPct"), 0),
    delayDeliveries: str(form?.get("delayDeliveries")) === "1",
    delayRate: numOr(form?.get("delayRate"), 0.04),
    sku: str(form?.get("sku")) || null,
    boostPct: numOr(form?.get("boostPct"), 0),
  });
  const run = runPortfolioSimulation(portfolioView(found.result.items), scenario, { seed: found.row.id });
  return json(run);
});

router.get("/app/artiklar/:sku", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const found = selectedAnalysis(ctx, orgId);
  if (!found) return redirect("/app/importera");

  const item = getItem(orgId, found.row.id, ctx.params.sku!);
  if (!item) return html(notFoundPage(appLocale(ctx)), 404);

  const inputs = rebuildInputs(found.result);
  const raw = inputs.find((i) => i.sku === item.sku);
  const intel = buildIntelligence(inputs, found.result, { months: found.result.dataQuality.months });
  const history = raw?.monthly ?? [];
  const forecast = raw?.monthly ? forecastSeries(raw.monthly, { horizon: 6 }) : null;
  const plan = raw && forecast ? supplyPlan(raw, forecast, { serviceLevel: found.result.settings.serviceLevel }) : null;
  const importRef = importForAnalysis(found.row.id, orgId);
  const similar = queryItems(orgId, found.row.id, { category: item.category ? String(item.category) : undefined, sort: "value", pageSize: 6 }).rows.filter(
    (r) => r.sku !== item.sku,
  );

  return html(
    itemPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      result: found.result,
      intel,
      analysisId: found.row.id,
      item,
      forecast,
      plan,
      history,
      importRef: importRef ? { id: importRef.id, started_at: importRef.started_at, filename: importRef.filename } : null,
      similar: similar.map((s) => ({ sku: String(s.sku), name: String(s.name), value: Number(s.value), turns: Number(s.turns) })),
    }),
  );
});

/* --------------------------------------------------------------- forecast */

/** One procurement view for the page and its order files, so a downloaded
 * quantity can never differ from the one that was reviewed on screen. */
function procurementView(ctx: RequestContext): ProcurementView | null {
  const found = selectedAnalysis(ctx, ctx.org!.id);
  if (!found) return null;
  return buildProcurementView(found.result.items, {
    supplier: ctx.url.searchParams.get("leverantor") || null,
    groupBySupplier: ctx.url.searchParams.get("grupp") === "leverantor",
    serviceLevel: found.result.settings.serviceLevel,
  });
}

router.get("/app/inkop", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const view = procurementView(ctx);
  if (!view) return redirect("/app/importera");
  return html(
    procurementPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      view,
    }),
  );
});

/** Both order files are the same view in two containers, so they share one
 * handler: the CSV differs only by its BOM. */
function orderFile(extension: "csv" | "xlsx") {
  return (ctx: RequestContext): Response => {
    const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
    if (blocked) return blocked;
    const view = procurementView(ctx);
    if (!view) return redirect("/app/importera");
    const locale = appLocale(ctx);
    const [body, contentType] =
      extension === "csv"
        ? [new TextEncoder().encode(`\ufeff${orderCsv(view, locale)}`), "text/csv; charset=utf-8"]
        : [orderXlsx(view, locale), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
    return binary(body, contentType, orderFileName(view, extension));
  };
}

router.get("/app/inkop/bestallning.csv", orderFile("csv"));
router.get("/app/inkop/bestallning.xlsx", orderFile("xlsx"));

router.get("/app/prognos", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const found = selectedAnalysis(ctx, orgId);
  if (!found) return redirect("/app/importera");

  const horizon = Math.min(24, Math.max(1, Number(ctx.url.searchParams.get("horisont") ?? 6)));
  const inputs = rebuildInputs(found.result).filter((i) => i.monthly && i.monthly.length >= 3);
  const ordered = [...inputs].sort((a, b) => b.stock * b.cost - a.stock * a.cost).slice(0, 40);

  const itemForecasts = ordered
    .map((item) => {
      const forecast = forecastSeries(item.monthly!, { horizon });
      return { sku: item.sku, name: item.name, forecast, plan: supplyPlan(item, forecast, { serviceLevel: found.result.settings.serviceLevel }) };
    })
    .sort((a, b) => b.forecast.points[0]!.value * 1000 - a.forecast.points[0]!.value * 1000);

  const topCategory = (found.result.items[0]?.category ?? null) as string | null;
  const categoryItems = topCategory ? inputs.filter((i) => i.category === topCategory) : inputs;
  const series = aggregateSeries(categoryItems);

  return html(
    forecastPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      result: found.result,
      intel: buildIntelligence(inputs.length ? inputs : rebuildInputs(found.result), found.result, { months: found.result.dataQuality.months }),
      analysisId: found.row.id,
      itemForecasts,
      categoryForecast: series ? { category: topCategory ?? "Alla artiklar", series: forecastSeries(series, { horizon }) } : null,
      horizon,
    }),
  );
});

/* --------------------------------------------------------------- simulate */

function scenarioFromForm(form: Awaited<ReturnType<Request["formData"]>> | null): Partial<ScenarioInput> {
  const demand = numOr(form?.get("demand"), 0);
  const lead = numOr(form?.get("lead"), 100);
  return {
    name: str(form?.get("namn")) || "Scenario",
    demandMultiplier: 1 + demand / 100,
    leadTimeMultiplier: lead / 100,
    supplierDelayDays: numOr(form?.get("delay"), 0),
    supplierDelayProbability: numOr(form?.get("delayprob"), 0) / 100,
    costMultiplier: numOr(form?.get("cost"), 100) / 100,
    priceMultiplier: numOr(form?.get("price"), 100) / 100,
    serviceLevel: Math.min(0.99, Math.max(0.8, numOr(form?.get("service"), 95) / 100)),
    stockReductionPct: numOr(form?.get("reduce"), 0) / 100,
    orderQtyMultiplier: numOr(form?.get("orderqty"), 100) / 100,
    holdingRate: 0.22,
  };
}

router.get("/app/simulering", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const found = selectedAnalysis(ctx, orgId);
  if (!found) return redirect("/app/importera");

  const inputs = rebuildInputs(found.result);
  const baseline = buildBaseline(inputs, found.result.dataQuality.months);
  const defaultInput: Partial<ScenarioInput> = {
    name: "Reducera överlager 15 %",
    demandMultiplier: 1,
    leadTimeMultiplier: 1,
    supplierDelayDays: 0,
    supplierDelayProbability: 0,
    costMultiplier: 1,
    priceMultiplier: 1,
    serviceLevel: found.result.settings.serviceLevel,
    stockReductionPct: 0.15,
    orderQtyMultiplier: 1,
    holdingRate: 0.22,
  };
  const active = defaultInput;
  const scenarios = [
    simulate(baseline, { name: "Basfall" }),
    simulate(baseline, active),
  ];

  return html(
    simulatePage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      result: found.result,
      intel: buildIntelligence(inputs, found.result, { months: found.result.dataQuality.months }),
      analysisId: found.row.id,
      scenarios,
      active: scenarios[1]!.input,
      saved: [],
    }),
  );
});

router.post("/app/simulering", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const orgId = ctx.org!.id;
  const form = await readForm(ctx);
  const analysisId = str(form?.get("analys"));
  const found = analysisFor(orgId, analysisId);
  if (!found) return redirect("/app");

  const inputs = rebuildInputs(found.result);
  const baseline = buildBaseline(inputs, found.result.dataQuality.months);
  const active = scenarioFromForm(form);
  const scenarios = [simulate(baseline, { name: "Basfall" }), simulate(baseline, active)];

  if (str(form?.get("spara")) === "1") {
    saveScenario({ orgId, analysisId, name: String(active.name), input: active, result: scenarios[1]!.totals });
  }

  return html(
    simulatePage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      result: found.result,
      intel: buildIntelligence(inputs, found.result, { months: found.result.dataQuality.months }),
      analysisId,
      scenarios,
      active: scenarios[1]!.input,
      saved: [],
    }),
  );
});

/* ---------------------------------------------------------------- copilot */

router.get("/app/copilot", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "copilot.use");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const found = selectedAnalysis(ctx, orgId);
  if (!found) return redirect("/app/importera");

  const conversationId = ctx.url.searchParams.get("samtal");
  let turns: Array<{ role: "user" | "assistant"; content: string; answer?: ReturnType<typeof ask> }> = [];
  if (conversationId) {
    const convo = getConversation(orgId, conversationId, ctx.user!.id);
    if (convo) {
      turns = listMessages(convo.id).map((m) => ({
        role: m.role,
        content: m.content,
        answer: m.payload_json ? (JSON.parse(m.payload_json) as ReturnType<typeof ask>) : undefined,
      }));
    }
  }

  return html(
    copilotPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      analysisId: found.row.id,
      turns,
      conversations: listConversations(orgId, ctx.user!.id),
    }),
  );
});

router.post("/app/copilot", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "copilot.use");
  if (blocked) return blocked;
  if (!settingEnabled("copilot_enabled")) return html("Copilot är tillfälligt avstängd av plattformsadministrationen.", 503);
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const orgId = ctx.org!.id;
  const form = await readForm(ctx);
  const question = str(form?.get("q"));
  const analysisId = str(form?.get("analys"));
  if (!question) return redirect(`/app/copilot?analys=${analysisId}`);
  if (question.length > 2000) {
    return redirect(`/app/copilot?analys=${analysisId}&fel=` + encodeURIComponent("Frågan får vara högst 2 000 tecken."));
  }

  const found = analysisFor(orgId, analysisId);
  if (!found) return redirect("/app");

  const limits = limitsForOrg(ctx.org!.id);
  if (copilotMessagesThisMonth(orgId) >= limits.copilotPerMonth) {
    return html(
      requireAuthShell(
        ctx,
        "Copilot",
        `<div class="alert alert-warn">Månadens frågebudget i planen ${limits.name} är slut. Uppgradera under Abonnemang.</div>`,
      ),
      402,
    );
  }

  let conversationId = str(form?.get("samtal"));
  const existingConversation = conversationId ? getConversation(orgId, conversationId, ctx.user!.id) : null;
  if (!existingConversation || existingConversation.analysis_id !== analysisId) {
    conversationId = createConversation({ orgId, userId: ctx.user!.id, analysisId, title: question });
  }
  const previous = listMessages(conversationId)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ question: m.content, intent: m.payload_json ? (JSON.parse(m.payload_json) as { intent: string }).intent : "unknown", params: {} }));
  const history: ConversationTurn[] = previous
    .filter((p) => p.intent !== "unknown")
    .map((p) => ({ question: p.question, intent: p.intent, params: {} }));

  const inputs = rebuildInputs(found.result);
  const intel = buildIntelligence(inputs, found.result, { months: found.result.dataQuality.months });
  let answer = ask(
    { result: found.result, intelligence: intel, items: inputs, company: ctx.org!.name, months: found.result.dataQuality.months, snapshots: snapshotsFor(orgId) },
    question,
    history,
  );
  answer = await polishWithAi(answer, config.ai);

  appendMessage({ conversationId, role: "user", content: question });
  appendMessage({ conversationId, role: "assistant", content: answer.answer, payload: answer });
  audit({ orgId, userId: ctx.user!.id, action: "copilot.asked", target: answer.intent, ip: ctx.ip });

  return redirect(`/app/copilot?analys=${analysisId}&samtal=${conversationId}`);
});

/* ---------------------------------------------------------------- imports */

// Preserve the old navigation target used by earlier releases.
router.get("/app/importer", () => redirect("/app/importera", 301));

router.get("/app/importera/guider", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  return html(
    exportGuidesPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
    }),
  );
});

router.get("/app/importera", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.write");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const limits = limitsForOrg(ctx.org!.id);
  return html(
    importsPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      analyses: analysisList(orgId),
      imports: listImports(orgId),
      limit: limits.maxAnalysesPerMonth,
      usedThisMonth: analysesThisMonth(orgId),
      canDelete: canDeleteOrgData(ctx.role!, limits),
    }),
  );
});

/* --------------------------------------------------------------- deletion */

router.get("/app/radera", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.delete");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const limits = limitsForOrg(orgId);
  if (!canDeleteOrgData(ctx.role!, limits)) {
    return html(
      `<main class="standalone-card"><p class="eyebrow">403</p><h1>Radering är inte tillåten</h1><p>Planen ${limits.name} tillåter inte radering av importerad data. Kontakta support om du behöver det.</p><a class="btn" href="/app/importera">Tillbaka</a></main>`,
      403,
    );
  }
  const analysisId = ctx.url.searchParams.get("analys") || selectedAnalysis(ctx, orgId)?.row.id || "";
  const impact = analysisDeletionImpact(orgId, analysisId);
  if (!impact) return redirect("/app/importera?fel=" + encodeURIComponent("Analysen hittades inte."));
  const requested = ctx.url.searchParams.getAll("sku").filter(Boolean).slice(0, 200);
  const items = itemDetailsFor(orgId, analysisId, requested);
  return html(
    deletePage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      analysisId,
      dataset: impact.filename,
      kind: items.length ? "items" : "analysis",
      items,
      totalItems: impact.items,
      totalValue: impact.value,
      imports: impact.imports,
      createdAt: impact.createdAt,
      action: "/app/radera/analys",
      back: items.length ? `/app/artiklar?analys=${encodeURIComponent(analysisId)}` : "/app/importera",
    }),
  );
});

router.post("/app/radera/analys", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.delete");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const orgId = ctx.org!.id;
  if (!canDeleteOrgData(ctx.role!, limitsForOrg(orgId))) return json({ error: "plan" }, 403);
  const form = await readForm(ctx);
  const analysisId = str(form?.get("analys"));
  const impact = analysisDeletionImpact(orgId, analysisId);
  if (!impact) return redirect("/app/importera?fel=" + encodeURIComponent("Analysen hittades inte."));
  deleteAnalysisData(orgId, analysisId);
  analysisCache = null;
  audit({ orgId, userId: ctx.user!.id, action: "analysis.deleted", target: analysisId, ip: ctx.ip, meta: { items: impact.items, filename: impact.filename } });
  return redirect(
    "/app/importera?meddelande=" +
      encodeURIComponent(`Raderade ${impact.filename} med ${impact.items} artiklar.`),
  );
});

router.post("/app/radera/artiklar", async (ctx) => {
  // Review step: the row selection arrives here, gets a full confirmation page
  // and only the confirmation form on that page deletes anything.
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.delete");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const orgId = ctx.org!.id;
  if (!canDeleteOrgData(ctx.role!, limitsForOrg(orgId))) return json({ error: "plan" }, 403);
  const form = await readForm(ctx);
  const analysisId = str(form?.get("analys"));
  const skus = [...new Set(form?.getAll("sku").map((sku) => str(sku)).filter(Boolean) ?? [])].slice(0, 200);
  const impact = analysisDeletionImpact(orgId, analysisId);
  if (!impact) return redirect("/app/artiklar?fel=" + encodeURIComponent("Analysen hittades inte."));
  const items = itemDetailsFor(orgId, analysisId, skus);
  if (!items.length) return redirect("/app/artiklar?fel=" + encodeURIComponent("Inget urval att radera."));
  return html(
    deletePage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      analysisId,
      dataset: impact.filename,
      kind: "items",
      action: "/app/radera/artiklar/bekrafta",
      items,
      totalItems: impact.items,
      totalValue: impact.value,
      imports: impact.imports,
      createdAt: impact.createdAt,
      back: `/app/artiklar?analys=${encodeURIComponent(analysisId)}`,
    }),
  );
});

router.post("/app/radera/artiklar/bekrafta", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.delete");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const orgId = ctx.org!.id;
  if (!canDeleteOrgData(ctx.role!, limitsForOrg(orgId))) return json({ error: "plan" }, 403);
  const form = await readForm(ctx);
  const analysisId = str(form?.get("analys"));
  const skus = [...new Set(form?.getAll("sku").map((sku) => str(sku)).filter(Boolean) ?? [])].slice(0, 200);
  const impact = analysisDeletionImpact(orgId, analysisId);
  if (!impact || !skus.length) return redirect("/app/artiklar?fel=" + encodeURIComponent("Inget urval att radera."));
  const outcome = recomputeAfterDeletion(orgId, analysisId, skus);
  if (!outcome.ok && outcome.error === "empty") {
    deleteAnalysisData(orgId, analysisId);
    analysisCache = null;
    audit({ orgId, userId: ctx.user!.id, action: "analysis.deleted", target: analysisId, ip: ctx.ip, meta: { items: impact.items } });
    return redirect(
      "/app/importera?meddelande=" +
        encodeURIComponent(`Alla artiklar raderades, så datasetet ${impact.filename} togs bort.`),
    );
  }
  if (!outcome.ok) return redirect("/app/artiklar?fel=" + encodeURIComponent("Kunde inte uppdatera analysen efter raderingen."));
  analysisCache = null;
  audit({
    orgId,
    userId: ctx.user!.id,
    action: "items.deleted",
    target: analysisId,
    ip: ctx.ip,
    meta: { skus: skus.slice(0, 50), removed: outcome.removed },
  });
  return redirect(
    `/app/artiklar?analys=${encodeURIComponent(analysisId)}&meddelande=` +
      encodeURIComponent(`Raderade ${skus.length} artiklar. Analysen räknades om på ${outcome.remaining}.`),
  );
});

router.post("/app/importera", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.write");
  if (blocked) return blocked;
  if (!settingEnabled("imports_enabled")) return redirect("/app/importera?fel=" + encodeURIComponent("Importer är tillfälligt avstängda av plattformsadministrationen."));
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const orgId = ctx.org!.id;

  let form: Awaited<ReturnType<Request["formData"]>>;
  try {
    form = await ctx.req.formData();
  } catch {
    return redirect("/app/importera?fel=" + encodeURIComponent("Kunde inte läsa filen."));
  }
  const file = form.get("file");
  if (!(file instanceof File)) return redirect("/app/importera?fel=" + encodeURIComponent("Välj en fil att ladda upp."));
  const filename = safeUploadFilename(file.name || "uppladdning.csv");
  try {
    assertUploadAllowed(filename, file.size);
  } catch (error) {
    return redirect("/app/importera?fel=" + encodeURIComponent(error instanceof Error ? error.message : "Filen är inte tillåten."));
  }

  const limits = limitsForOrg(ctx.org!.id);
  if (analysesThisMonth(orgId) >= limits.maxAnalysesPerMonth) {
    return redirect("/app/importera?fel=" + encodeURIComponent(appText(appLocale(ctx), "Planen {plan} tillåter {n} analyser per månad.", { plan: appText(appLocale(ctx), limits.name), n: limits.maxAnalysesPerMonth })));
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await preview({ orgId, userId: ctx.user!.id, bytes, filename });
    return html(
      mappingPage({
        locale: appLocale(ctx),
      user: ctx.user!,
        org: ctx.org!,
        role: ctx.role!,
        url: ctx.url,
        draftId: result.draftId,
        filename,
        headers: result.headers,
        sampleRows: result.sampleRows,
        columns: result.mapping.columns as unknown as Record<string, number | null>,
        monthColumns: result.mapping.monthColumns.map((m) => ({ index: m.index, label: m.label })),
        warnings: result.warnings,
        fields: Object.entries(FIELD_LABELS).map(([key, label]) => ({ key, label })),
        rowCount: result.rowCount,
        defaults: orgDefaults(ctx.org!),
        industry: result.industry,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kunde inte läsa filen.";
    return redirect("/app/importera?fel=" + encodeURIComponent(message));
  }
});

router.post("/app/importera/kor", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.write");
  if (blocked) return blocked;
  if (!settingEnabled("imports_enabled")) return redirect("/app/importera?fel=" + encodeURIComponent("Importer är tillfälligt avstängda av plattformsadministrationen."));
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const orgId = ctx.org!.id;
  const form = await readForm(ctx);
  const draftId = str(form?.get("draft"));
  const draft = draftFor(orgId, draftId);
  if (!draft) return redirect("/app/importera?fel=" + encodeURIComponent("Utkastet är borta. Ladda upp filen igen."));

  // Only fields the form actually sent override the detected mapping. A missing
  // key means "keep what was detected", an empty value means "no column" - the
  // difference matters when the mapping step is submitted from an API client.
  const columns: Record<string, number | null> = {};
  for (const key of ["sku", "name", "category", "supplier", "stock", "cost", "price", "leadTime", "moq", "totalSold", "totalRevenue"]) {
    if (!form?.has(`col_${key}`)) continue;
    const raw = form.get(`col_${key}`);
    columns[key] = raw === null || raw === "" ? null : Number(raw);
  }
  const months = form?.getAll("months").map((m) => Number(m)) ?? [];
  const defaults = orgDefaults(ctx.org!);
  const industry = form?.get("bransch");
  const industryId = isIndustryId(industry) ? industry : null;

  const outcome = await ingestDraft({
    orgId,
    userId: ctx.user!.id,
    draftId,
    mappingOverride: columns,
    monthColumnIndexes: months,
    settings: {
      serviceLevel: numOr(form?.get("serviceniva"), defaults.serviceLevel),
      deadStockDays: numOr(form?.get("dodlager"), defaults.deadStockDays),
      capitalCostRate: defaults.capitalCostRate,
    },
    warehouse: str(form?.get("lager")) || "Huvudlager",
    industry: industryId,
  });

  if (!outcome.ok) {
    return redirect("/app/importera?fel=" + encodeURIComponent(outcome.error));
  }
  audit({ orgId, userId: ctx.user!.id, action: "analysis.created", target: outcome.analysisId, ip: ctx.ip });
  return redirect(`/app?analys=${outcome.analysisId}&meddelande=` + encodeURIComponent(appText(appLocale(ctx), "Analys klar: {n} artiklar.", { n: outcome.result.kpis.skuCount })));
});

/* ----------------------------------------------------------- integrations */

router.get("/app/integrationer", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "api.manage");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  return html(
    integrationsPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      integrations: listIntegrations(),
      apiKeys: listApiKeys(orgId),
      webhooks: listWebhooks(orgId),
      deliveries: recentDeliveries(orgId),
      newKey: ctx.url.searchParams.get("nyckel") ?? undefined,
    }),
  );
});

router.post("/app/integrationer/nyckel", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "api.manage");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  const { key } = createApiKey(ctx.org!.id, str(form?.get("namn")) || "API-nyckel", str(form?.get("scope")) === "write" ? "write" : "read");
  audit({ orgId: ctx.org!.id, userId: ctx.user!.id, action: "apikey.created", target: key.slice(0, 12), ip: ctx.ip });
  return redirect("/app/integrationer?nyckel=" + encodeURIComponent(key));
});

router.post("/app/integrationer/nyckel/aterkalla", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "api.manage");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  revokeApiKey(ctx.org!.id, str(form?.get("id")));
  return redirect("/app/integrationer?meddelande=" + encodeURIComponent("API-nyckeln är återkallad."));
});

router.post("/app/integrationer/webhook", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "api.manage");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  const url = str(form?.get("url"));
  let safeUrl: string;
  try {
    safeUrl = await assertSafeWebhookUrl(url);
  } catch (error) {
    return redirect("/app/integrationer?fel=" + encodeURIComponent(error instanceof Error ? error.message : "Webhook-URL är inte tillåten."));
  }
  const events = str(form?.get("events"))
    .split(",")
    .map((s) => s.trim())
    .filter((event): event is (typeof webhookEvents)[number] => webhookEvents.includes(event as (typeof webhookEvents)[number]));
  createWebhook(ctx.org!.id, safeUrl, events);
  return redirect("/app/integrationer?meddelande=" + encodeURIComponent("Webhook tillagd."));
});

router.post("/app/integrationer/webhook/radera", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "api.manage");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  deleteWebhook(ctx.org!.id, str(form?.get("id")));
  return redirect("/app/integrationer?meddelande=" + encodeURIComponent("Webhook borttagen."));
});

/* ------------------------------------------------------------------- team */

router.get("/app/team", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "members.manage");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const invitations = db
    .query("SELECT id, email, role, expires_at, accepted_at FROM invitations WHERE org_id = $o ORDER BY created_at DESC LIMIT 20")
    .all({ $o: orgId }) as Array<{ id: string; email: string; role: Role; expires_at: string; accepted_at: string | null }>;

  return html(
    teamPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      members: listMembers(orgId),
      invitations,
      limit: limitsForOrg(ctx.org!.id).maxUsers,
      inviteLink: ctx.url.searchParams.get("inbjudan") ?? undefined,
    }),
  );
});

router.post("/app/team/bjud-in", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "members.manage");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  const email = str(form?.get("email"));
  const roleValue = str(form?.get("roll")) || "analyst";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return redirect("/app/team?fel=" + encodeURIComponent("Ange en giltig e-postadress."));
  if (!isRole(roleValue) || roleRank[roleValue] >= roleRank[ctx.role!]) {
    return redirect("/app/team?fel=" + encodeURIComponent("Du kan inte bjuda in någon med samma eller högre roll än din egen."));
  }
  const role: Role = roleValue;

  const limits = limitsForOrg(ctx.org!.id);
  if (countMembers(ctx.org!.id) >= limits.maxUsers) {
    return redirect("/app/team?fel=" + encodeURIComponent(appText(appLocale(ctx), "Planen {plan} tillåter {n} användare.", { plan: appText(appLocale(ctx), limits.name), n: limits.maxUsers })));
  }

  // The inviter's language travels with the invitation, so the recipient sees
  // one language in the mail and on the page, also when the link is opened days
  // later in another browser.
  const inviteLocale = contentLocale(appLocale(ctx));
  const token = createInvitation({ orgId: ctx.org!.id, email, role, locale: inviteLocale });
  audit({ orgId: ctx.org!.id, userId: ctx.user!.id, action: "member.invited", target: email, ip: ctx.ip });
  const link = `${config.appOrigin}/bjud-in/${token}`;
  // The link is still shown to the inviter, so a mail outage leaves a manual
  // fallback instead of a blocked invitation.
  await sendMail({
    to: email,
    ...invitationMail({
      locale: inviteLocale,
      orgName: ctx.org!.name,
      inviterName: ctx.user!.name,
      role: appRole(inviteLocale, role),
      link,
      expiresInDays: 7,
    }),
  });
  return redirect("/app/team?inbjudan=" + encodeURIComponent(link));
});

router.post("/app/team/roll", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "members.manage");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  const target = str(form?.get("user"));
  const roleValue = str(form?.get("roll"));
  if (target === ctx.user!.id) return redirect("/app/team?fel=" + encodeURIComponent("Du kan inte ändra din egen roll."));
  const targetMember = membershipFor(ctx.org!.id, target);
  if (!targetMember || targetMember.role === "owner") return redirect("/app/team?fel=" + encodeURIComponent("Ägarens roll kan inte ändras."));
  if (!isRole(roleValue) || roleRank[roleValue] >= roleRank[ctx.role!]) {
    return redirect("/app/team?fel=" + encodeURIComponent("Rollen måste vara lägre än din egen."));
  }
  if (roleRank[targetMember.role] >= roleRank[ctx.role!]) {
    return redirect("/app/team?fel=" + encodeURIComponent("Du kan inte ändra en medlem med samma eller högre roll."));
  }
  const role: Role = roleValue;
  setMemberRole(ctx.org!.id, target, role);
  audit({ orgId: ctx.org!.id, userId: ctx.user!.id, action: "member.role_changed", target: `${target} → ${role}`, ip: ctx.ip });
  return redirect("/app/team?meddelande=" + encodeURIComponent("Roll uppdaterad."));
});

router.post("/app/team/ta-bort", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "members.manage");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  const target = str(form?.get("user"));
  if (target === ctx.user!.id) return redirect("/app/team?fel=" + encodeURIComponent("Du kan inte ta bort dig själv."));
  const targetMember = membershipFor(ctx.org!.id, target);
  if (targetMember?.role === "owner") return redirect("/app/team?fel=" + encodeURIComponent("Ägaren kan inte tas bort."));
  if (!targetMember) return redirect("/app/team?fel=" + encodeURIComponent("Medlemmen finns inte."));
  if (roleRank[targetMember.role] >= roleRank[ctx.role!]) {
    return redirect("/app/team?fel=" + encodeURIComponent("Du kan inte ta bort en medlem med samma eller högre roll."));
  }
  removeMember(ctx.org!.id, target);
  deleteSessionsForUser(target);
  audit({ orgId: ctx.org!.id, userId: ctx.user!.id, action: "member.removed", target, ip: ctx.ip });
  return redirect("/app/team?meddelande=" + encodeURIComponent("Användaren är borttagen."));
});

/* --------------------------------------------------------------- estimates */

router.get("/app/prisestimat", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const record = getPricingProfile(ctx.org!.id);
  if (!record) return redirect("/start");
  return html(
    estimatePage({
      locale: appLocale(ctx),
      user: { id: ctx.user!.id, name: ctx.user!.name, email: ctx.user!.email },
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      profile: record.profile,
      estimate: calculateEstimate(record.profile, getPricingRules()),
      quotes: listPricingQuotes(ctx.org!.id),
      rules: getPricingRules(),
    }),
  );
});

router.post("/app/prisestimat", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "org.manage");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  if (!form) return redirect("/app/prisestimat?fel=" + encodeURIComponent(appText(appLocale(ctx), "Formuläret kunde inte läsas.")));
  const profile = profileFromForm(form);
  const estimate = calculateEstimate(profile, getPricingRules());
  savePricingProfile(ctx.org!.id, profile, estimate);
  audit({ orgId: ctx.org!.id, userId: ctx.user!.id, action: "pricing.estimate.recalculated", target: String(estimate.monthly), ip: ctx.ip });
  return redirect("/app/prisestimat?meddelande=" + encodeURIComponent(appText(appLocale(ctx), "Estimatet är uppdaterat.")));
});

router.post("/app/prisestimat/offert", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "org.manage");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const record = getPricingProfile(ctx.org!.id);
  if (!record) return redirect("/start");
  const form = await readForm(ctx);
  const note = str(form?.get("note")).slice(0, 2_000);
  const estimate = calculateEstimate(record.profile, getPricingRules());
  createPricingQuote({
    orgId: ctx.org!.id,
    userId: ctx.user!.id,
    profile: record.profile,
    estimate,
    status: "requested",
    note,
  });
  savePricingProfile(ctx.org!.id, record.profile, estimate);
  audit({ orgId: ctx.org!.id, userId: ctx.user!.id, action: "pricing.quote.requested", target: String(estimate.monthly), ip: ctx.ip });
  const inbox = contactInbox();
  const notifications = [
    sendMail({
      to: ctx.user!.email,
      ...quoteConfirmationMail({
        name: ctx.user!.name,
        orgName: ctx.org!.name,
        monthly: estimate.monthly,
        contactUrl: `${config.appOrigin}/kontakt`,
      }),
    }),
  ];
  if (inbox) {
    notifications.push(sendMail({
      to: inbox,
      ...quoteRequestedMail({
        orgName: ctx.org!.name,
        requesterName: ctx.user!.name,
        requesterEmail: ctx.user!.email,
        monthly: estimate.monthly,
        annualMonthly: estimate.annualMonthly,
        implementation: estimate.implementation,
        note,
        queueUrl: `${config.appOrigin}/admin/offerter`,
      }),
    }));
  }
  await Promise.all(notifications);
  return redirect("/app/prisestimat?meddelande=" + encodeURIComponent(appText(appLocale(ctx), "Offertförfrågan är skickad. Ingen betalning har aktiverats.")));
});

router.post("/app/prisestimat/acceptera", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "org.manage");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  if (str(form?.get("confirm")) !== "yes") {
    return redirect("/app/prisestimat?fel=" + encodeURIComponent(appText(appLocale(ctx), "Bekräfta aktiveringsbegäran först.")));
  }
  const record = getPricingProfile(ctx.org!.id);
  if (!record) return redirect("/start");
  const estimate = calculateEstimate(record.profile, getPricingRules());
  createPricingQuote({
    orgId: ctx.org!.id,
    userId: ctx.user!.id,
    profile: record.profile,
    estimate,
    status: "accepted_pending_payment",
    note: "Aktivering begärd från prisestimatet.",
  });
  audit({ orgId: ctx.org!.id, userId: ctx.user!.id, action: "pricing.activation.requested", target: String(estimate.monthly), ip: ctx.ip });
  const inbox = contactInbox();
  const notifications = [
    sendMail({
      to: ctx.user!.email,
      ...activationConfirmationMail({
        name: ctx.user!.name,
        orgName: ctx.org!.name,
        monthly: estimate.monthly,
        contactUrl: `${config.appOrigin}/kontakt`,
      }),
    }),
  ];
  if (inbox) {
    notifications.push(sendMail({
      to: inbox,
      ...activationRequestedMail({
        orgName: ctx.org!.name,
        requesterName: ctx.user!.name,
        requesterEmail: ctx.user!.email,
        monthly: estimate.monthly,
        annualMonthly: estimate.annualMonthly,
        implementation: estimate.implementation,
        note: "Aktivering begärd från prisestimatet.",
        organizationUrl: `${config.appOrigin}/admin/organisationer/${ctx.org!.id}`,
      }),
    }));
  }
  await Promise.all(notifications);
  return redirect("/app/prisestimat?meddelande=" + encodeURIComponent(appText(appLocale(ctx), "Aktivering är begärd. Ett avtal och betalning krävs innan kontot aktiveras.")));
});

/* ------------------------------------------------------- pricing rules */

/**
 * Internal pricing and commercial tools inside the customer app. These keep the
 * existing env allowlist (PLATFORM_ADMINS); the website administration under
 * /admin has its own accounts and never relies on this list.
 */
function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isPlatformAdmin(ctx: RequestContext): boolean {
  return Boolean(ctx.user && platformAdminEmails().includes(ctx.user.email.toLowerCase()));
}


router.get("/app/prissattning", (ctx) => {
  const blocked = requireUser(ctx);
  if (blocked) return blocked;
  if (!isPlatformAdmin(ctx)) return html(notFoundPage(appLocale(ctx)), 404);
  return html(
    pricingRulesPage({
      locale: appLocale(ctx),
      user: { id: ctx.user!.id, name: ctx.user!.name, email: ctx.user!.email },
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      rules: getPricingRules(),
    }),
  );
});

router.post("/app/prissattning", async (ctx) => {
  const blocked = requireUser(ctx);
  if (blocked) return blocked;
  if (!isPlatformAdmin(ctx)) return html(notFoundPage(appLocale(ctx)), 404);
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  if (!form) return redirect("/app/prissattning?fel=" + encodeURIComponent(appText(appLocale(ctx), "Formuläret kunde inte läsas.")));
  const rules = rulesFromForm(form, getPricingRules());
  savePricingRules(rules, ctx.user!.id);
  audit({ orgId: ctx.org!.id, userId: ctx.user!.id, action: "pricing.rules.updated", target: String(rules.baseMonthly), ip: ctx.ip });
  return redirect("/app/prissattning?meddelande=" + encodeURIComponent(appText(appLocale(ctx), "Prisreglerna är sparade.")));
});

/* ------------------------------------------------------ commercial planning */

const commercialDefaults = {
  customers: 25,
  arpu: 3_500,
  newCustomers: 4,
  churnPct: 2,
  cac: 12_000,
  grossMarginPct: 80,
  operatingCosts: 300_000,
  months: 24,
};

function commercialResults(input: Record<string, number>): Record<string, number> {
  const customers = Math.max(0, input.customers ?? 0);
  const arpu = Math.max(0, input.arpu ?? 0);
  const newCustomers = Math.max(0, input.newCustomers ?? 0);
  const churn = Math.max(0, Math.min(100, input.churnPct ?? 0)) / 100;
  const margin = Math.max(0, Math.min(100, input.grossMarginPct ?? 0)) / 100;
  const cac = Math.max(0, input.cac ?? 0);
  const opex = Math.max(0, input.operatingCosts ?? 0);
  const months = Math.max(1, Math.round(input.months ?? 12));
  let projected = customers;
  for (let month = 0; month < months; month += 1) projected = projected * (1 - churn) + newCustomers;
  const mrr = customers * arpu;
  const grossProfitPerCustomer = arpu * margin;
  const ltv = churn > 0 ? grossProfitPerCustomer / churn : grossProfitPerCustomer * 60;
  const paybackMonths = grossProfitPerCustomer > 0 ? cac / grossProfitPerCustomer : 0;
  return {
    mrr,
    arr: mrr * 12,
    grossProfit: mrr * margin,
    operatingResult: mrr * margin - opex,
    ltv,
    ltvCac: cac > 0 ? ltv / cac : 0,
    paybackMonths,
    customersEnd: projected,
  };
}

function commercialAssumptions(source: Record<string, unknown> | null): Record<string, number> {
  const input: Record<string, unknown> = source ?? commercialDefaults;
  return Object.fromEntries(
    Object.entries(commercialDefaults).map(([key, fallback]) => [key, numOr(input[key], fallback)]),
  ) as Record<string, number>;
}

router.get("/app/ekonomi", (ctx) => {
  const blocked = requireUser(ctx);
  if (blocked) return blocked;
  if (!isPlatformAdmin(ctx)) return html(notFoundPage(appLocale(ctx)), 404);
  const scenarios = listCommercialScenarios(ctx.org!.id);
  const latest = scenarios[0];
  const assumptions = latest ? commercialAssumptions(JSON.parse(latest.input_json) as Record<string, unknown>) : commercialDefaults;
  const results = latest ? (JSON.parse(latest.output_json) as Record<string, number>) : commercialResults(assumptions);
  return html(
    commercialPage({
      locale: appLocale(ctx),
      user: { id: ctx.user!.id, name: ctx.user!.name, email: ctx.user!.email },
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      assumptions,
      results,
      scenarios,
    }),
  );
});

router.post("/app/ekonomi", async (ctx) => {
  const blocked = requireUser(ctx);
  if (blocked) return blocked;
  if (!isPlatformAdmin(ctx)) return html(notFoundPage(appLocale(ctx)), 404);
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  if (!form) return redirect("/app/ekonomi?fel=" + encodeURIComponent(appText(appLocale(ctx), "Formuläret kunde inte läsas.")));
  const assumptions = Object.fromEntries(
    Object.entries(commercialDefaults).map(([key, fallback]) => [key, numOr(form.get(key), fallback)]),
  ) as Record<string, number>;
  const results = commercialResults(assumptions);
  saveCommercialScenario({
    orgId: ctx.org!.id,
    userId: ctx.user!.id,
    name: `Scenario ${new Date().toISOString().slice(0, 10)}`,
    assumptions,
    results,
  });
  audit({ orgId: ctx.org!.id, userId: ctx.user!.id, action: "commercial.scenario.saved", target: String(results.mrr), ip: ctx.ip });
  return redirect("/app/ekonomi?meddelande=" + encodeURIComponent(appText(appLocale(ctx), "Scenariot är sparat som antagande, inte faktisk intäkt.")));
});

/* ---------------------------------------------------------------- billing */

router.get("/app/abonnemang", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const latest = latestAnalysis(orgId);
  return html(
    billingPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      subscription: getSubscription(orgId),
      limits: limitsForOrg(orgId),
      usage: {
        analyses: analysesThisMonth(orgId),
        copilot: copilotMessagesThisMonth(orgId),
        members: countMembers(orgId),
        skus: latest?.result.kpis.skuCount ?? 0,
      },
      stripeReady: Boolean(config.stripe.secretKey),
    }),
  );
});

router.post("/app/abonnemang/byt", async (ctx) => {
  // Plan changes affect the whole organisation's entitlement and billing.
  // `org.manage` would let an admin downgrade the owner's subscription.
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "billing.manage");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  const plan = str(form?.get("plan"));
  if (!["trial", "basic", "multi", "business", "enterprise"].includes(plan)) {
    return redirect("/app/abonnemang?fel=" + encodeURIComponent("Okänd plan."));
  }
  // A plan is an entitlement, not a preference. Only cancelling back to the
  // trial is self-service; upgrades require an accepted quote and an operator
  // action. Without this guard any owner could grant their organisation an
  // Enterprise plan for free.
  if (plan !== "trial" && plan !== ctx.org!.plan) {
    audit({ orgId: ctx.org!.id, userId: ctx.user!.id, action: "plan.upgrade_blocked", target: plan, ip: ctx.ip });
    return redirect("/app/abonnemang?fel=" + encodeURIComponent("Planbyten till en betald plan kräver offert och avtal. Kontakta oss så aktiverar vi planen."));
  }
  if (plan === ctx.org!.plan) {
    return redirect("/app/abonnemang?meddelande=" + encodeURIComponent("Planen är oförändrad."));
  }
  setPlan(ctx.org!.id, "trial", "trialing");
  audit({ orgId: ctx.org!.id, userId: ctx.user!.id, action: "plan.changed", target: plan, ip: ctx.ip });
  return redirect("/app/abonnemang?meddelande=" + encodeURIComponent("Planen är ändrad till Prova på."));
});

/* ------------------------------------------------------------------ audit */

router.get("/app/logg", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "org.manage");
  if (blocked) return blocked;
  return html(
    auditPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      entries: recentAudit(ctx.org!.id),
    }),
  );
});

/* --------------------------------------------------------------- settings */

function orgDefaults(org: { settings_json: string | null }): { serviceLevel: number; deadStockDays: number; capitalCostRate: number } {
  const defaults = { serviceLevel: 0.95, deadStockDays: 180, capitalCostRate: 0.08 };
  if (!org.settings_json) return defaults;
  try {
    const saved = JSON.parse(org.settings_json) as Partial<typeof defaults>;
    return {
      serviceLevel: typeof saved.serviceLevel === "number" && saved.serviceLevel > 0 && saved.serviceLevel < 1 ? saved.serviceLevel : defaults.serviceLevel,
      deadStockDays: typeof saved.deadStockDays === "number" && saved.deadStockDays > 0 ? saved.deadStockDays : defaults.deadStockDays,
      capitalCostRate: typeof saved.capitalCostRate === "number" && saved.capitalCostRate >= 0 && saved.capitalCostRate <= 1 ? saved.capitalCostRate : defaults.capitalCostRate,
    };
  } catch {
    return defaults;
  }
}

router.get("/app/installningar", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const settings = orgDefaults(ctx.org!);
  const latest = latestAnalysis(orgId);
  if (!ctx.org!.settings_json && latest) {
    settings.serviceLevel = latest.result.settings.serviceLevel;
    settings.deadStockDays = latest.result.settings.deadStockDays;
    settings.capitalCostRate = latest.result.settings.capitalCostRate;
  }
  const counts = {
    analyses: (db.query("SELECT COUNT(*) AS c FROM analyses WHERE org_id = $o AND status = 'ok'").get({ $o: orgId }) as { c: number }).c,
    items: (db.query("SELECT COUNT(*) AS c FROM items WHERE org_id = $o").get({ $o: orgId }) as { c: number }).c,
    members: countMembers(orgId),
  };

  return html(
    settingsPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: ctx.org!,
      role: ctx.role!,
      url: ctx.url,
      orgName: ctx.org!.name,
      settings,
      counts,
    }),
  );
});

router.post("/app/installningar", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "org.manage");
  if (blocked) return blocked;
  const readOnly = requireWritable(ctx);
  if (readOnly) return readOnly;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  const name = str(form?.get("namn"));
  const current = orgDefaults(ctx.org!);
  const service = numOr(form?.get("service"), current.serviceLevel);
  const deadDays = Math.round(numOr(form?.get("dodlager"), current.deadStockDays));
  const ratePercent = numOr(form?.get("ranta"), current.capitalCostRate * 100);
  const settings = {
    serviceLevel: service > 0 && service < 1 ? service : current.serviceLevel,
    deadStockDays: deadDays > 0 && deadDays <= 3650 ? deadDays : current.deadStockDays,
    capitalCostRate: ratePercent >= 0 && ratePercent <= 30 ? ratePercent / 100 : current.capitalCostRate,
  };
  if (name) updateOrg(ctx.org!.id, { name: name.slice(0, 160), settings });
  else updateOrg(ctx.org!.id, { settings });
  audit({ orgId: ctx.org!.id, userId: ctx.user!.id, action: "org.updated", target: name, ip: ctx.ip });
  return redirect("/app/installningar?meddelande=" + encodeURIComponent("Inställningarna sparade."));
});

router.get("/app/export", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const payload = buildOrganizationExport(orgId);
  const slug = (ctx.org!.slug || "organisation").replace(/[^a-z0-9-]/gi, "-");
  const filename = `stoqwise-export-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
  audit({ orgId, userId: ctx.user!.id, action: "data.exported", target: "organization", ip: ctx.ip, meta: { format: "json" } });
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
});

router.get("/app/radera/organisation", (ctx) => {
  const blocked = requireUser(ctx);
  if (blocked) return blocked;
  const orgId = ctx.url.searchParams.get("org") || ctx.org?.id;
  if (!orgId) return redirect("/start");
  const org = getOrg(orgId);
  if (!org) return html(notFoundPage(appLocale(ctx)), 404);
  if (membershipFor(org.id, ctx.user!.id)?.role !== "owner") {
    return html(
      `<main class="standalone-card"><p class="eyebrow">403</p><h1>Endast ägare kan radera organisationen</h1><p>Be en ägare i ${esc(org.name)} om att radera organisationen.</p><a class="btn" href="/app/installningar">Tillbaka</a></main>`,
      403,
    );
  }
  return html(
    deleteOrganizationPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org,
      role: ctx.role ?? "owner",
      url: ctx.url,
      orgId: org.id,
      counts: organizationDeletionCounts(org.id),
    }),
  );
});

router.post("/app/radera/organisation", async (ctx) => {
  const blocked = requireUser(ctx);
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  const orgId = str(form?.get("org")) || ctx.org?.id || "";
  const org = orgId ? getOrg(orgId) : null;
  if (!org) return html(notFoundPage(appLocale(ctx)), 404);
  const orgUrl = `/app/radera/organisation?org=${encodeURIComponent(org.id)}`;
  if (membershipFor(org.id, ctx.user!.id)?.role !== "owner") {
    return html(
      `<main class="standalone-card"><p class="eyebrow">403</p><h1>Endast ägare kan radera organisationen</h1><p>Be en ägare i ${esc(org.name)} om att radera organisationen.</p><a class="btn" href="/app/installningar">Tillbaka</a></main>`,
      403,
    );
  }
  if (str(form?.get("forstaatt")) !== "ja") {
    return redirect(orgUrl + "&fel=" + encodeURIComponent("Bekräfta att du förstår att raderingen är permanent."));
  }
  if (str(form?.get("bekrafta")) !== org.name) {
    return redirect(orgUrl + "&fel=" + encodeURIComponent("Organisationens namn stämmer inte."));
  }
  const password = str(form?.get("losenord"));
  if (password.length > 200 || !verifyPassword(password, ctx.user!.password_hash)) {
    return redirect(orgUrl + "&fel=" + encodeURIComponent("Lösenordet stämmer inte."));
  }

  const result = deleteOrganizationData({
    orgId: org.id,
    actorUserId: ctx.user!.id,
    actorIp: ctx.ip,
    target: org.name,
  });
  if (result.actorHasOtherOrg) {
    return redirect("/app?meddelande=" + encodeURIComponent("Organisationen är raderad."));
  }
  return redirect(
    "/app/radera/konto?meddelande=" +
      encodeURIComponent("Organisationen är raderad. Ditt konto finns kvar och kan raderas här."),
  );
});

router.get("/app/radera/konto", (ctx) => {
  const blocked = requireUser(ctx);
  if (blocked) return blocked;
  return html(
    deleteAccountPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: ctx.org ? { name: ctx.org.name, plan: ctx.org.plan } : null,
      role: ctx.role,
      url: ctx.url,
      summary: accountDeletionSummary(ctx.user!.id),
    }),
  );
});

router.post("/app/radera/konto", async (ctx) => {
  const blocked = requireUser(ctx);
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  const back = "/app/radera/konto";
  if (str(form?.get("forstaatt")) !== "ja") {
    return redirect(back + "?fel=" + encodeURIComponent("Bekräfta att du förstår att kontot raderas permanent."));
  }
  if (str(form?.get("bekrafta")).toLowerCase() !== ctx.user!.email.toLowerCase()) {
    return redirect(back + "?fel=" + encodeURIComponent("E-postadressen stämmer inte."));
  }
  const password = str(form?.get("losenord"));
  if (password.length > 200 || !verifyPassword(password, ctx.user!.password_hash)) {
    return redirect(back + "?fel=" + encodeURIComponent("Lösenordet stämmer inte."));
  }
  if (accountDeletionSummary(ctx.user!.id).soleOwned.length) {
    return redirect(
      back + "?fel=" + encodeURIComponent("Du är ensam ägare till en organisation. Radera organisationen först."),
    );
  }
  try {
    deleteAccount({ userId: ctx.user!.id, email: ctx.user!.email, actorIp: ctx.ip });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "sole_owner") {
      return redirect(
        back + "?fel=" + encodeURIComponent("Du är ensam ägare till en organisation. Radera organisationen först."),
      );
    }
    if (code === "no_recipient" || code === "analyses_remaining") {
      return redirect(
        back + "?fel=" + encodeURIComponent("Kontot kunde inte raderas eftersom organisationens data saknar en mottagare. Kontakta supporten."),
      );
    }
    throw error;
  }
  return redirect("/logga-in?raderad=konto", 303, endSession(ctx.req));
});

router.post("/app/radera-analyser", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.delete");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const orgId = ctx.org!.id;
  const tx = db.transaction(() => {
    db.query("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE org_id = $o)").run({ $o: orgId });
    db.query("DELETE FROM conversations WHERE org_id = $o").run({ $o: orgId });
    db.query("DELETE FROM scenarios WHERE org_id = $o").run({ $o: orgId });
    db.query("DELETE FROM saved_views WHERE org_id = $o").run({ $o: orgId });
    db.query("DELETE FROM imports WHERE org_id = $o").run({ $o: orgId });
    db.query("DELETE FROM items WHERE org_id = $o").run({ $o: orgId });
    db.query("DELETE FROM analyses WHERE org_id = $o").run({ $o: orgId });
  });
  tx();
  audit({ orgId, userId: ctx.user!.id, action: "data.deleted", target: "all analyses", ip: ctx.ip });
  return redirect("/app/importera?meddelande=" + encodeURIComponent("Alla analyser är raderade."));
});

/* ---------------------------------------------------------------- exports */

router.get("/app/analys/:id/rapport.pdf", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const found = analysisFor(ctx.org!.id, ctx.params.id!);
  if (!found) return html(notFoundPage(appLocale(ctx)), 404);

  const locale = appLocale(ctx);
  const company = orgName(ctx.org!.id);
  const narrative = locale === "sv" ? found.narrative : buildTemplateNarrative(found.result, { company, filename: found.row.filename }, locale);
  const pdf = await buildPdf(found.result, narrative, {
    locale,
    company,
    filename: found.row.filename,
    generatedAt: found.row.created_at,
    contactEmail: EMAILS.hello ?? undefined,
  });
  // Measured once per analysis: sign-in to first finished PDF.
  recordTimeToPdf({
    userId: ctx.user!.id,
    analysisId: found.row.id,
    rows: found.row.rows,
    sessionStartedAt: sessionStartedAt(ctx.req),
  });
  return new Response(pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${reportFileName(locale, found.row.id)}"`,
      "cache-control": "private, no-store",
    },
  });
});

router.get("/app/analys/:id/export.xlsx", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const found = analysisFor(orgId, ctx.params.id!);
  if (!found) return html(notFoundPage(appLocale(ctx)), 404);

  const all = db
    .query("SELECT * FROM items WHERE org_id = $o AND analysis_id = $a ORDER BY value DESC LIMIT 100000")
    .all({ $o: orgId, $a: found.row.id }) as Array<Record<string, unknown>>;

  const exportLocale = appLocale(ctx);
  const exportText = (source: string): string => appText(exportLocale, source);
  const sheet = writeXlsx({
    name: exportText("Artiklar"),
    columns: [
      { header: exportText("Artikel"), width: 18 },
      { header: exportText("Benämning"), width: 42 },
      { header: exportText("Kategori"), width: 18 },
      { header: exportText("Leverantör"), width: 22 },
      { header: exportText("Lager"), width: 16 },
      { header: exportText("Saldo"), width: 12 },
      { header: exportText("Inköpspris"), width: 13 },
      { header: exportText("Lagervärde"), width: 15 },
      { header: exportText("Sålt"), width: 12 },
      { header: exportText("Omsättning"), width: 13 },
      { header: exportText("Täckning (d)"), width: 13 },
      { header: exportText("Marginal %"), width: 12 },
      { header: "ABC", width: 7 },
      { header: "XYZ", width: 7 },
      { header: exportText("Åtgärd"), width: 15 },
      { header: exportText("Prioritet"), width: 11 },
    ],
    rows: all.map((r) => [
      String(r.sku),
      String(r.name),
      r.category ? localizeCategory(String(r.category), exportLocale) : "",
      String(r.supplier ?? ""),
      String(r.warehouse ?? ""),
      Number(r.stock),
      Number(r.cost),
      Number(r.value),
      Number(r.sold),
      Number(r.turns),
      r.cover_days === null ? "" : Number(r.cover_days),
      r.margin_pct === null ? "" : Number(r.margin_pct),
      String(r.abc ?? ""),
      String(r.xyz ?? ""),
      String(r.action ?? ""),
      Number(r.priority),
    ]),
  });

  return new Response(sheet, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="lagerradar-${found.row.id.slice(0, 8)}.xlsx"`,
      "cache-control": "private, no-store",
    },
  });
});

router.get("/app/analys/:id/export.csv", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const found = analysisFor(orgId, ctx.params.id!);
  if (!found) return html(notFoundPage(appLocale(ctx)), 404);

  const rows = db.query("SELECT * FROM items WHERE org_id = $o AND analysis_id = $a ORDER BY value DESC").all({ $o: orgId, $a: found.row.id }) as Array<Record<string, unknown>>;
  const exportLocale = appLocale(ctx);
  const exportText = (source: string): string => appText(exportLocale, source);
  const columns = [
    { key: "sku", label: exportText("Artikel") },
    { key: "name", label: exportText("Benämning") },
    { key: "category", label: exportText("Kategori") },
    { key: "supplier", label: exportText("Leverantör") },
    { key: "stock", label: exportText("Saldo") },
    { key: "cost", label: exportText("Inköpspris") },
    { key: "value", label: exportText("Lagervärde") },
    { key: "sold", label: exportText("Sålt") },
    { key: "turns", label: exportText("Omsättning") },
    { key: "cover_days", label: exportText("Täckning (d)") },
    { key: "margin_pct", label: exportText("Marginal %") },
    { key: "abc", label: "ABC" },
    { key: "xyz", label: "XYZ" },
    { key: "action", label: exportText("Åtgärd") },
  ];
  const valueFor = (row: Record<string, unknown>, key: string): unknown => {
    if (key === "category") return row.category ? localizeCategory(String(row.category), exportLocale) : "";
    if (key === "action") return appAction(exportLocale, String(row.action ?? "ok"));
    return row[key];
  };
  const csv = [columns.map((c) => csvCell(c.label)).join(";"), ...rows.map((r) => columns.map((c) => csvCell(valueFor(r, c.key))).join(";"))].join("\r\n");

  return new Response("\ufeff" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exportLocale === "sv" ? "artiklar" : "items"}-${found.row.id.slice(0, 8)}.csv"`,
      "cache-control": "private, no-store",
    },
  });
});

/* -------------------------------------------------- administration (CMS) */

// The administration lives at /admin with its own accounts, sessions and audit
// log; the customer session is never accepted there. See src/admin/.
registerAdmin(router, { demoSummary: (ctx) => demo(demoId(ctx), appLocale(ctx)).summary });
registerPlatformAdmin(router);

/* ---------------------------------------------------------------- static */

const STATIC: Record<string, string> = {
  "/v3.css": "text/css; charset=utf-8",
  "/v3.js": "text/javascript; charset=utf-8",
  "/styles.css": "text/css; charset=utf-8",
  "/app.js": "text/javascript; charset=utf-8",
  "/app-import.js": "text/javascript; charset=utf-8",
  "/favicon.svg": "image/svg+xml",
  "/world/boot.js": "text/javascript; charset=utf-8",
  "/world/arcade.js": "text/javascript; charset=utf-8",
  "/world/warehouse.js": "text/javascript; charset=utf-8",
  "/world/app-world.js": "text/javascript; charset=utf-8",
  "/world/textures.js": "text/javascript; charset=utf-8",
  "/world/models.js": "text/javascript; charset=utf-8",
};

async function serveStatic(path: string, acceptEncoding = ""): Promise<Response | null> {
  const wantsGzip = acceptEncoding.includes("gzip");
  // Samma TypeScript-moduler som servern och testerna använder transpileras vid
  // förfrågan, så att browsern inte kan driva ifrån den testade logiken och
  // ingen andra implementering behöver underhållas.
  const transpiledModules: Record<string, string> = {
    "/world/sim-engine.js": "ui/live-simulation.ts",
    "/perf.js": "ui/perf.ts",
    "/motion.js": "ui/motion.ts",
  };
  const transpiledSource = transpiledModules[path];
  if (transpiledSource) {
    const source = await Bun.file(join(import.meta.dir, transpiledSource)).text();
    const js = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
    return jsResponse(path, new TextEncoder().encode(js), "no-store", wantsGzip);
  }
  // three.js is served straight from node_modules so the version in the
  // lockfile is the version the browser runs. Only the build output is exposed.
  // The unminified module is 2.1 MB, so it is gzipped once and cached in
  // memory: the browser downloads roughly 550 KB instead.
  if (path.startsWith("/vendor/three/")) {
    const name = path.slice("/vendor/three/".length);
    if (!/^[a-z0-9.]+$/i.test(name)) return null;
    const file = Bun.file(join(import.meta.dir, "..", "node_modules", "three", "build", name));
    if (!(await file.exists())) return null;
    return jsResponse(name, new Uint8Array(await file.arrayBuffer()), "public, max-age=31536000, immutable", wantsGzip);
  }
  const font = path.startsWith("/fonts/") && path.endsWith(".woff2");
  // Brand artwork ships as SVG, with a raster social card beside it.
  const brand = path.startsWith("/brand/") && /\.(svg|png|jpe?g|webp)$/.test(path);
  const image = path.startsWith("/images/") && /\.(jpe?g|png|webp)$/.test(path);
  const rasterType = (p: string): string =>
    p.endsWith(".png")
      ? "image/png"
      : p.endsWith(".webp")
        ? "image/webp"
        : p.endsWith(".svg")
          ? "image/svg+xml"
          : "image/jpeg";
  const type = font ? "font/woff2" : brand || image ? rasterType(path) : STATIC[path];
  if (!type) return null;
  if (path.includes("..")) return null;
  const file = Bun.file(join(config.publicDir, path.slice(1)));
  if (!(await file.exists())) return null;
  if (font) {
    return new Response(file, { headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable" } });
  }
  // World modules are big enough to be worth compressing, and they must
  // revalidate so a deploy is visible on the next load.
  if (path.startsWith("/world/") && path.endsWith(".js")) {
    return jsResponse(path, new Uint8Array(await file.arrayBuffer()), "no-store", wantsGzip);
  }
  // Styles and scripts keep their fixed names, so they must revalidate instead
  // of being cached for minutes after a deploy. Images and fonts may cache.
  const revalidate = /\.(css|js)$/.test(path);
  return new Response(file, {
    headers: { "content-type": type, "cache-control": revalidate ? "no-cache" : "public, max-age=86400" },
  });
}


/** Pre-compressed JS, cached per file so a busy landing page gzips once. */
const gzipCache = new Map<string, Uint8Array>();
function jsResponse(key: string, bytes: Uint8Array, cacheControl: string, compress = true): Response {
  if (!compress) {
    return new Response(bytes, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": cacheControl } });
  }
  let gzipped = gzipCache.get(key);
  if (!gzipped) {
    gzipped = Bun.gzipSync(Buffer.from(bytes));
    if (gzipCache.size > 40) gzipCache.clear();
    gzipCache.set(key, gzipped);
  }
  return new Response(gzipped, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "content-encoding": "gzip",
      "vary": "accept-encoding",
      "content-length": String(gzipped.byteLength),
      "cache-control": cacheControl,
    },
  });
}

/* ------------------------------------------------------------ entry point */


const server = Bun.serve({
  port: config.port,
  maxRequestBodySize: config.maxUploadBytes + 1024 * 1024,
  async fetch(req: Request, server): Promise<Response> {
    const url = new URL(req.url);
    const peerAddress = server.requestIP(req)?.address ?? null;
    try {
      // The JSON API has its own authentication and error shape.
      if (url.pathname.startsWith("/api/v1")) {
        const ctx = await buildContext(req, {}, peerAddress);
        const response = await handleApi(ctx);
        return securityHeaders(response ?? json({ error: "not_found" }, 404));
      }

      const match = router.match(req.method, url.pathname);
      if (!match) {
        const staticResponse = await serveStatic(url.pathname, req.headers.get("accept-encoding") ?? "");
        if (staticResponse) return securityHeaders(staticResponse);
        return securityHeaders(
          html(notFoundPage(resolveLocale({ cookie: req.headers.get("cookie"), fallback: DEFAULT_LOCALE })), 404),
        );
      }

      const ctx = await buildContext(req, match.params, peerAddress);
      const response = await match.handler(ctx);
      return securityHeaders(response);
    } catch (error) {
      console.error(`[lagerradar] ${req.method} ${url.pathname}:`, error);
      if (url.pathname.startsWith("/api/")) {
        return securityHeaders(json({ error: "internal", message: "Ett internt fel inträffade." }, 500));
      }
      return securityHeaders(
        html(
          `<!doctype html><html lang="sv" data-theme="light"><head><meta charset="utf-8"><title>Fel · STOQWISE</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <link rel="stylesheet" href="/v3.css"></head><body class="app-body"><main class="error-page">
          <p class="error-folio">500</p><h1 class="onboarding-title">Något gick fel.</h1>
          <p class="health-note">Händelsen är loggad. Försök igen, eller kontakta support om det upprepas.</p>
          <div class="hero-actions"><a class="btn" href="/app">Tillbaka till appen</a><a class="btn btn-ghost" href="/">Startsidan</a></div></main></body></html>`,
          500,
        ),
      );
    }
  },
});

console.log(`Stoqwise körs på http://localhost:${server.port}`);
console.log(`Product: http://localhost:${server.port}/produkt · Sandbox: /app/sandbox (after sign-in)`);
console.log(`API:  http://localhost:${server.port}/api/v1/health`);
console.log(`AI:   ${config.ai.apiKey ? config.ai.model : "av (deterministisk mall används)"}`);

/* Background: trial lifecycle mail. The sweep is idempotent, so an hourly tick
 * is enough and a restart catches anything that was missed while offline. */
void runTrialLifecycle().catch((error) => console.error("[lagerradar] trial sweep:", error));
setInterval(() => {
  void runTrialLifecycle().catch((error) => console.error("[lagerradar] trial sweep:", error));
}, 60 * 60 * 1000);

/* Background: nightly cleanup of drafts that never completed. */
setInterval(() => {
  const removed = deleteStaleDrafts(24);
  deleteExpiredSessions();
  pruneAdminSessions();
  if (removed > 0) console.log(`[lagerradar] rensade ${removed} utkast`);
}, 6 * 60 * 60 * 1000);
