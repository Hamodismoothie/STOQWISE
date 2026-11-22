/**
 * Stoqwise — HTTP entry point.
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
import { buildPdf } from "./pdf.ts";
import { writeXlsx } from "./xlsx.ts";
import { config, ensureRuntimeDirs } from "./config.ts";
import { db, createUser, findUserByEmail, deleteStaleDrafts, createLead } from "./db.ts";
import { FIELD_LABELS } from "./mapping.ts";
import { icon, shell } from "./ui/base.ts";
import { hashPassword, verifyPassword, startSession, endSession, isSameOrigin } from "./auth.ts";
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
  copilotMessagesThisMonth,
  membershipFor,
  orgForUser,
  limitsFor,
  updateOrg,
  queryItems,
  itemFacets,
  getItem,
  type Role,
} from "./data/repo.ts";
import { handleApi, rebuildInputs } from "./api.ts";
import { draftFor, ingest, ingestDraft, preview } from "./pipeline.ts";
import { listIntegrations } from "./integrations/index.ts";
import {
  buildDemoDataset,
  demoCsv,
  DEMO_ENVIRONMENTS,
  DEFAULT_DEMO_ENVIRONMENT,
  getDemoEnvironmentMeta,
  isDemoEnvironment,
  type DemoEnvironmentId,
} from "./demo.ts";
import { cookieFor, isAvailableLocale, localeFromCookie, safeNext, strings } from "./i18n.ts";
import { appAction, appText } from "./i18n-app.ts";
import { categoryLabels, fold, localizeCategory, planSearch } from "./terminology.ts";
import { Router, buildContext, html, json, redirect, requirePermission, requireUser, securityHeaders, str, numOr, rateLimit, readForm, type RequestContext } from "./http.ts";
import { dashboardPage, itemPage, itemsPage, forecastPage, simulatePage, copilotPage } from "./pages/core.ts";
import { auditPage, billingPage, importsPage, integrationsPage, mappingPage, settingsPage, teamPage } from "./pages/admin.ts";
import { commercialPage, estimatePage, pricingRulesPage, pricingStartPage } from "./pages/pricing.ts";
import { buildProcurementView, procurementPage } from "./pages/procurement.ts";
import { MODULE_IDS, calculateEstimate, normalizeProfile, sanitizeRules, type PricingProfile } from "./pricing.ts";
import { sandboxDashboard, sandboxItem, sandboxItems } from "./pages/sandbox.ts";
import {
  aboutPage,
  contactPage,
  productPage,
  developerPage,
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
} from "./pages/public.ts";
import type { DemoSummary } from "./pages/public.ts";

ensureRuntimeDirs();
deleteStaleDrafts();

/* ------------------------------------------------------------- demo cache */

interface DemoCache {
  dataset: ReturnType<typeof buildDemoDataset>;
  result: AnalysisResult;
  intel: IntelligenceSnapshot;
  narrative: Narrative;
  summary: DemoSummary;
  csv: string;
}

const demoCaches = new Map<DemoEnvironmentId, DemoCache>();
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

function demo(id: DemoEnvironmentId = DEFAULT_DEMO_ENVIRONMENT): DemoCache {
  const cached = demoCaches.get(id);
  if (cached) return cached;

  const dataset = buildDemoDataset(id);
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

  const cache: DemoCache = { dataset, result, intel, narrative, summary, csv: demoCsv(dataset) };
  demoCaches.set(id, cache);
  return cache;
}

/* ------------------------------------------------------------- analytics */

function analysisFor(orgId: string, id: string) {
  const row = db
    .query("SELECT * FROM analyses WHERE id = $id AND org_id = $o AND status = 'ok'")
    .get({ $id: id, $o: orgId }) as
    | { id: string; filename: string; rows: number; result_json: string; narrative_json: string | null; created_at: string; warehouse: string | null; period_months: number | null; source: string | null }
    | null;
  if (!row) return null;
  const result = JSON.parse(row.result_json) as AnalysisResult;
  const narrative = row.narrative_json ? (JSON.parse(row.narrative_json) as Narrative) : buildTemplateNarrative(result, { company: "", filename: row.filename });
  return { row, result, narrative };
}

function latestAnalysis(orgId: string) {
  const row = db
    .query("SELECT id FROM analyses WHERE org_id = $o AND status = 'ok' ORDER BY created_at DESC LIMIT 1")
    .get({ $o: orgId }) as { id: string } | null;
  return row ? analysisFor(orgId, row.id) : null;
}

function analysisList(orgId: string) {
  return db
    .query("SELECT id, filename, rows, created_at, source FROM analyses WHERE org_id = $o AND status = 'ok' ORDER BY created_at DESC LIMIT 40")
    .all({ $o: orgId }) as Array<{ id: string; filename: string; rows: number; created_at: string; source: string | null }>;
}

function snapshotsFor(orgId: string) {
  return db
    .query(
      `SELECT created_at AS date, json_extract(summary_json, '$.inventoryValue') AS value
       FROM analyses WHERE org_id = $o AND status = 'ok' AND summary_json IS NOT NULL
       ORDER BY created_at ASC LIMIT 24`,
    )
    .all({ $o: orgId })
    .filter((s) => typeof (s as { value: number }).value === "number") as Array<{ date: string; value: number }>;
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

const pageLocale = (ctx: Parameters<Parameters<typeof router.get>[1]>[0]): ReturnType<typeof localeFromCookie> =>
  localeFromCookie(ctx.req.headers.get("cookie"));

/**
 * The product is Swedish unless the visitor has explicitly chosen a language.
 * The public site defaults to English, but an existing account must not change
 * language just because no cookie is present.
 */
const appLocale = (ctx: Parameters<Parameters<typeof router.get>[1]>[0]): ReturnType<typeof localeFromCookie> => {
  const cookie = ctx.req.headers.get("cookie") ?? "";
  return /(?:^|;\s*)lr_lang=/.test(cookie) ? localeFromCookie(cookie) : "sv";
};

router.get("/", (ctx) =>
  html(landingPage({ user: ctx.user ? { name: ctx.user.name } : null, demo: demo(demoId(ctx)).summary, locale: pageLocale(ctx) })),
);

router.get("/priser", (ctx) =>
  html(pricingPage({ user: ctx.user ? { name: ctx.user.name } : null, locale: pageLocale(ctx) })),
);

/** Stores the language choice and returns to the page the visitor came from. */
router.get("/sprak", (ctx) => {
  const lang = ctx.url.searchParams.get("lang") ?? "";
  const next = safeNext(ctx.url.searchParams.get("next"));
  if (!isAvailableLocale(lang)) return redirect(next, 303);
  return redirect(next, 303, cookieFor(lang));
});

router.get("/produkt", (ctx) => {
  // Product preview: the same engine output as the authenticated sandbox, but
  // static. No item-level data and no interactive endpoints on the public site.
  const id = demoId(ctx);
  const d = demo(id);
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
  if (!name || !email.includes("@") || message.length < 10) {
    return html(contactPage({ user: null, error: contactCopy.errorRequired, locale: pageLocale(ctx) }), 400);
  }
  const subject = str(form?.get("amne")) || "General inquiry";
  createLead({ name, email, company: str(form?.get("foretag")), message: `[${subject}]\n\n${message}` });
  return html(contactPage({ user: null, sent: true, locale: pageLocale(ctx) }));
});

router.get("/halsa", () => json({ status: "ok", version: "2.0.0", uptime: Math.round(process.uptime()) }));

router.get("/exempelrapport.pdf", async (ctx) => {
  const d = demo(demoId(ctx));
  const pdf = await buildPdf(d.result, d.narrative, {
    company: d.dataset.company,
    filename: `exempel-${d.dataset.environment.id}.csv`,
    generatedAt: new Date().toISOString(),
    contactEmail: EMAILS.hello ?? undefined,
    fictional: true,
  });
  return new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="exempelrapport.pdf"' } });
});

router.get("/api/demo-csv", (ctx) => {
  const d = demo(demoId(ctx));
  return new Response(d.csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="exempel-${d.dataset.environment.id}.csv"`,
    },
  });
});

/* ------------------------------------------------------------------- auth */

router.get("/logga-in", (ctx) =>
  html(loginPage({ user: ctx.user ? { name: ctx.user.name } : null, next: ctx.url.searchParams.get("nasta") ?? "/app", locale: pageLocale(ctx) })),
);

router.post("/logga-in", async (ctx) => {
  const authCopy = strings(pageLocale(ctx)).auth;
  if (!isSameOrigin(ctx.req))
    return html(loginPage({ user: null, error: authCopy.errorOrigin, locale: pageLocale(ctx) }), 403);
  const form = await readForm(ctx);
  const email = str(form?.get("epost")).toLowerCase();
  const password = str(form?.get("losenord"));
  const next = str(form?.get("nasta")) || "/app";

  const limit = rateLimit(`login:${email || ctx.ip}`, 8, 900);
  if (!limit.ok) {
    return html(loginPage({ user: null, error: authCopy.errorRate.replace("{seconds}", String(limit.retryAfter)), locale: pageLocale(ctx) }), 429);
  }

  const user = findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    audit({ orgId: null, userId: user?.id ?? null, action: "login.failed", target: email, ip: ctx.ip });
    return html(loginPage({ user: null, error: authCopy.errorCredentials, locale: pageLocale(ctx) }), 401);
  }

  const membership = orgForUser(user.id);
  const session = startSession(user.id);
  audit({ orgId: membership?.org.id ?? null, userId: user.id, action: "login.success", ip: ctx.ip });
  const target = next.startsWith("/") ? next : "/app";
  return redirect(membership ? target : "/start", 303, session.cookie);
});

router.post("/logga-ut", (ctx) => {
  const cookie = endSession(ctx.req);
  return redirect("/", 303, cookie);
});

router.get("/skapa-konto", (ctx) =>
  html(registerPage({ user: ctx.user ? { name: ctx.user.name } : null, plan: ctx.url.searchParams.get("plan") ?? "trial", locale: pageLocale(ctx) })),
);

router.post("/skapa-konto", async (ctx) => {
  const authCopy = strings(pageLocale(ctx)).auth;
  if (!isSameOrigin(ctx.req))
    return html(registerPage({ user: null, error: authCopy.errorOrigin, locale: pageLocale(ctx) }), 403);
  const limit = rateLimit(`register:${ctx.ip}`, 5, 3600);
  if (!limit.ok) return html(registerPage({ user: null, error: authCopy.errorRegisterRate, locale: pageLocale(ctx) }), 429);

  const form = await readForm(ctx);
  const name = str(form?.get("namn"));
  const company = str(form?.get("foretag"));
  const email = str(form?.get("epost")).toLowerCase();
  const password = str(form?.get("losenord"));
  const plan = str(form?.get("plan")) || "trial";

  if (!name || !company || !email.includes("@") || password.length < 10) {
    return html(registerPage({ user: null, error: authCopy.errorFields, locale: pageLocale(ctx) }), 400);
  }
  if (findUserByEmail(email)) {
    return html(registerPage({ user: null, error: authCopy.errorEmailTaken, locale: pageLocale(ctx) }), 409);
  }

  const user = createUser({ email, passwordHash: hashPassword(password), name, company });
  const org = createOrganization({ name: company, userId: user.id, plan: plan === "trial" ? "trial" : plan });
  if (plan !== "trial" && ["basic", "multi", "business", "enterprise"].includes(plan)) setPlan(org.id, plan, "pending_payment");

  const session = startSession(user.id);
  audit({ orgId: org.id, userId: user.id, action: "org.created", target: org.name, ip: ctx.ip });
  return redirect("/start", 303, session.cookie);
});

router.get("/start", (ctx) => {
  const blocked = requireUser(ctx);
  if (blocked) return blocked;
  const membership = ctx.org && ctx.role ? { org: ctx.org, role: ctx.role } : null;
  if (!membership) {
    // Signed in but without an organisation: create one so the user is never stuck.
    createOrganization({ name: ctx.user!.company || `${ctx.user!.name}s företag`, userId: ctx.user!.id });
    return redirect("/start");
  }
  const record = getPricingProfile(membership.org.id);
  const latest = latestAnalysis(membership.org.id);
  return html(
    pricingStartPage({
      locale: appLocale(ctx),
      user: { id: ctx.user!.id, name: ctx.user!.name, email: ctx.user!.email },
      org: { name: membership.org.name, plan: membership.org.plan },
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

router.get("/bjud-in/:token", (ctx) => {
  const invitation = findInvitation(ctx.params.token!);
  if (!invitation) return html(notFoundPage(pageLocale(ctx)), 404);
  return html(invitePage({ token: ctx.params.token!, email: invitation.email, orgName: invitation.org_name, role: invitation.role }));
});

router.post("/bjud-in/:token", async (ctx) => {
  if (!isSameOrigin(ctx.req)) return html(notFoundPage(pageLocale(ctx)), 403);
  const invitation = findInvitation(ctx.params.token!);
  if (!invitation) return html(notFoundPage(pageLocale(ctx)), 404);

  const form = await readForm(ctx);
  const name = str(form?.get("namn"));
  const password = str(form?.get("losenord"));
  if (!name || password.length < 10) {
    return html(invitePage({ token: ctx.params.token!, email: invitation.email, orgName: invitation.org_name, role: invitation.role, error: "Namn och ett lösenord på minst 10 tecken krävs." }), 400);
  }

  let user = findUserByEmail(invitation.email);
  if (!user) user = createUser({ email: invitation.email, passwordHash: hashPassword(password), name, company: invitation.org_name });

  acceptInvitation(invitation.id, invitation.org_id, user.id, invitation.role);
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
    return html(
      requireAuthShell(ctx, "Översikt", `<div class="card"><div class="card-body">
        <div class="empty"><div class="empty-mark">${icon("upload", 26)}</div><h3>${appText(appLocale(ctx), "Ingen analys ännu")}</h3>
        <p>${appText(appLocale(ctx), "Ladda upp en CSV- eller Excel-export för att komma igång. Vill du se gränssnittet först, öppna sandboxen med syntetisk data.")}</p>
        <a class="btn mt-4" href="/app/importera">${appText(appLocale(ctx), "Ladda upp fil")}</a>
        <a class="btn btn-ghost mt-4" href="/app/sandbox">${appText(appLocale(ctx), "Öppna sandbox")}</a></div></div></div>`),
    );
  }

  const months = found.result.dataQuality.months;
  const intel = buildIntelligence(rebuildInputs(found.result), found.result, { months, snapshots: snapshotsFor(orgId) });

  return html(
    dashboardPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
      role: ctx.role!,
      url: ctx.url,
      result: found.result,
      intel,
      analysisId: found.row.id,
      analyses: analysisList(orgId),
      snapshots: snapshotsFor(orgId),
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
    org: { name: ctx.org?.name ?? "Ingen organisation", plan: ctx.org?.plan ?? "trial" },
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
  const d = demo(demoId(ctx));
  return html(
    sandboxDashboard({
      environment: d.dataset.environment,
      environments: DEMO_ENVIRONMENTS,
      locale: appLocale(ctx),
      path: ctx.url.pathname + ctx.url.search,
      user: ctx.user!,
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
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
  return html(
    sandboxItems({
      locale: appLocale(ctx),
      path: ctx.url.pathname + ctx.url.search,
      user: ctx.user!,
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
      role: ctx.role!,
      environment: demo(demoId(ctx)).dataset.environment,
      environments: DEMO_ENVIRONMENTS,
      result: demo(demoId(ctx)).result,
      intel: demo(demoId(ctx)).intel,
      query,
    }),
  );
});

router.get("/app/sandbox/artiklar/:sku", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const d = demo(demoId(ctx));
  const item = d.result.items.find((i) => i.sku === ctx.params.sku);
  if (!item) return html(notFoundPage(appLocale(ctx)), 404);
  return html(
    sandboxItem({
      environment: d.dataset.environment,
      environments: DEMO_ENVIRONMENTS,
      locale: appLocale(ctx),
      path: ctx.url.pathname + ctx.url.search,
      user: ctx.user!,
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
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

  const plan = planSearch(q, locale);
  const result = queryItems(orgId, found.row.id, { q, lang: locale, pageSize: 6 });
  const categories = categoryLabels(locale)
    .filter((label) => fold(label).includes(fold(q)))
    .slice(0, 3);
  return json({
    items: result.rows.map((row) => ({
      sku: String(row.sku),
      name: String(row.name),
      category: localizeCategory(row.category ? String(row.category) : null, locale),
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
  const page = Math.max(1, Number(q.get("page") ?? 1));
  const query = {
    q: q.get("q") ?? undefined,
    lang: appLocale(ctx),
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
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
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
  const similar = queryItems(orgId, found.row.id, { category: item.category ? String(item.category) : undefined, sort: "value", pageSize: 6 }).rows.filter(
    (r) => r.sku !== item.sku,
  );

  return html(
    itemPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
      role: ctx.role!,
      url: ctx.url,
      result: found.result,
      intel,
      analysisId: found.row.id,
      item,
      forecast,
      plan,
      history,
      similar: similar.map((s) => ({ sku: String(s.sku), name: String(s.name), value: Number(s.value), turns: Number(s.turns) })),
    }),
  );
});

/* --------------------------------------------------------------- forecast */

router.get("/app/inkop", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const found = selectedAnalysis(ctx, ctx.org!.id);
  if (!found) return redirect("/app/importera");
  return html(
    procurementPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
      role: ctx.role!,
      url: ctx.url,
      view: buildProcurementView(found.result.items),
    }),
  );
});

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
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
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
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
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
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
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
    const convo = getConversation(orgId, conversationId);
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
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
      role: ctx.role!,
      url: ctx.url,
      analysisId: found.row.id,
      turns,
      conversations: listConversations(orgId),
    }),
  );
});

router.post("/app/copilot", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "copilot.use");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const orgId = ctx.org!.id;
  const form = await readForm(ctx);
  const question = str(form?.get("q"));
  const analysisId = str(form?.get("analys"));
  if (!question) return redirect(`/app/copilot?analys=${analysisId}`);

  const found = analysisFor(orgId, analysisId);
  if (!found) return redirect("/app");

  const limits = limitsFor(ctx.org!.plan);
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

  const conversationId = str(form?.get("samtal")) || createConversation({ orgId, userId: ctx.user!.id, analysisId, title: question });
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

router.get("/app/importera", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.write");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const limits = limitsFor(ctx.org!.plan);
  return html(
    importsPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
      role: ctx.role!,
      url: ctx.url,
      analyses: analysisList(orgId),
      imports: listImports(orgId),
      limit: limits.maxAnalysesPerMonth,
      usedThisMonth: analysesThisMonth(orgId),
    }),
  );
});

router.post("/app/importera", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.write");
  if (blocked) return blocked;
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
  if (file.size > config.maxUploadBytes) {
    return redirect("/app/importera?fel=" + encodeURIComponent(appText(appLocale(ctx), "Filen är större än {n} MB.", { n: Math.round(config.maxUploadBytes / 1024 / 1024) })));
  }

  const limits = limitsFor(ctx.org!.plan);
  if (analysesThisMonth(orgId) >= limits.maxAnalysesPerMonth) {
    return redirect("/app/importera?fel=" + encodeURIComponent(appText(appLocale(ctx), "Planen {plan} tillåter {n} analyser per månad.", { plan: appText(appLocale(ctx), limits.name), n: limits.maxAnalysesPerMonth })));
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await preview({ orgId, userId: ctx.user!.id, bytes, filename: file.name || "uppladdning.csv" });
    return html(
      mappingPage({
        locale: appLocale(ctx),
      user: ctx.user!,
        org: { name: ctx.org!.name, plan: ctx.org!.plan },
        role: ctx.role!,
        url: ctx.url,
        draftId: result.draftId,
        filename: file.name || "uppladdning.csv",
        headers: result.headers,
        sampleRows: result.sampleRows,
        columns: result.mapping.columns as unknown as Record<string, number | null>,
        monthColumns: result.mapping.monthColumns.map((m) => ({ index: m.index, label: m.label })),
        warnings: result.warnings,
        fields: Object.entries(FIELD_LABELS).map(([key, label]) => ({ key, label })),
        rowCount: result.rowCount,
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

  const outcome = await ingestDraft({
    orgId,
    userId: ctx.user!.id,
    draftId,
    mappingOverride: columns,
    monthColumnIndexes: months,
    settings: {
      serviceLevel: numOr(form?.get("serviceniva"), 0.95),
      deadStockDays: numOr(form?.get("dodlager"), 180),
    },
    warehouse: str(form?.get("lager")) || "Huvudlager",
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
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
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
  if (!/^https?:\/\//.test(url)) return redirect("/app/integrationer?fel=" + encodeURIComponent("Webhook-URL måste börja med http:// eller https://."));
  createWebhook(ctx.org!.id, url, str(form?.get("events")).split(",").map((s) => s.trim()).filter(Boolean));
  return redirect("/app/integrationer?meddelande=" + encodeURIComponent("Webhook tillagd."));
});

router.post("/app/integrationer/webhook/radera", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "api.manage");
  if (blocked) return blocked;
  const form = await readForm(ctx);
  deleteWebhook(ctx.org!.id, str(form?.get("id")));
  return redirect("/app/integrationer?meddelande=" + encodeURIComponent("Webhook borttagen."));
});

/* ------------------------------------------------------------------- team */

router.get("/app/team", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const invitations = db
    .query("SELECT id, email, role, expires_at, accepted_at FROM invitations WHERE org_id = $o ORDER BY created_at DESC LIMIT 20")
    .all({ $o: orgId }) as Array<{ id: string; email: string; role: Role; expires_at: string; accepted_at: string | null }>;

  return html(
    teamPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
      role: ctx.role!,
      url: ctx.url,
      members: listMembers(orgId),
      invitations,
      limit: limitsFor(ctx.org!.plan).maxUsers,
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
  const role = (str(form?.get("roll")) || "analyst") as Role;
  if (!email.includes("@")) return redirect("/app/team?fel=" + encodeURIComponent("Ange en giltig e-postadress."));

  const limits = limitsFor(ctx.org!.plan);
  if (countMembers(ctx.org!.id) >= limits.maxUsers) {
    return redirect("/app/team?fel=" + encodeURIComponent(appText(appLocale(ctx), "Planen {plan} tillåter {n} användare.", { plan: appText(appLocale(ctx), limits.name), n: limits.maxUsers })));
  }

  const token = createInvitation({ orgId: ctx.org!.id, email, role });
  audit({ orgId: ctx.org!.id, userId: ctx.user!.id, action: "member.invited", target: email, ip: ctx.ip });
  const link = `${config.appOrigin}/bjud-in/${token}`;
  return redirect("/app/team?inbjudan=" + encodeURIComponent(link));
});

router.post("/app/team/roll", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "members.manage");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  const target = str(form?.get("user"));
  const role = str(form?.get("roll")) as Role;
  if (target === ctx.user!.id) return redirect("/app/team?fel=" + encodeURIComponent("Du kan inte ändra din egen roll."));
  const targetMember = membershipFor(ctx.org!.id, target);
  if (!targetMember || targetMember.role === "owner") return redirect("/app/team?fel=" + encodeURIComponent("Ägarens roll kan inte ändras."));
  setMemberRole(ctx.org!.id, target, role);
  audit({ orgId: ctx.org!.id, userId: ctx.user!.id, action: "member.role_changed", target: `${target} → ${role}`, ip: ctx.ip });
  return redirect("/app/team?meddelande=" + encodeURIComponent("Roll uppdaterad."));
});

router.post("/app/team/ta-bort", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "members.manage");
  if (blocked) return blocked;
  const form = await readForm(ctx);
  const target = str(form?.get("user"));
  const targetMember = membershipFor(ctx.org!.id, target);
  if (targetMember?.role === "owner") return redirect("/app/team?fel=" + encodeURIComponent("Ägaren kan inte tas bort."));
  removeMember(ctx.org!.id, target);
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
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
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
  return redirect("/app/prisestimat?meddelande=" + encodeURIComponent(appText(appLocale(ctx), "Aktivering är begärd. Ett avtal och betalning krävs innan kontot aktiveras.")));
});

/* ------------------------------------------------------- pricing rules */

router.get("/app/prissattning", (ctx) => {
  const blocked = requireUser(ctx);
  if (blocked) return blocked;
  if (!isPlatformAdmin(ctx)) return html(notFoundPage(appLocale(ctx)), 404);
  return html(
    pricingRulesPage({
      locale: appLocale(ctx),
      user: { id: ctx.user!.id, name: ctx.user!.name, email: ctx.user!.email },
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
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
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
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
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
      role: ctx.role!,
      url: ctx.url,
      subscription: getSubscription(orgId),
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
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "org.manage");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  const plan = str(form?.get("plan"));
  if (!["trial", "basic", "multi", "business", "enterprise"].includes(plan)) {
    return redirect("/app/abonnemang?fel=" + encodeURIComponent("Okänd plan."));
  }
  setPlan(ctx.org!.id, plan, config.stripe.secretKey ? "active" : "pending_payment");
  audit({ orgId: ctx.org!.id, userId: ctx.user!.id, action: "plan.changed", target: plan, ip: ctx.ip });
  return redirect("/app/abonnemang?meddelande=" + encodeURIComponent("Plan uppdaterad. Fakturering sker enligt avtal."));
});

/* ------------------------------------------------------------------ audit */

router.get("/app/logg", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "org.manage");
  if (blocked) return blocked;
  return html(
    auditPage({
      locale: appLocale(ctx),
      user: ctx.user!,
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
      role: ctx.role!,
      url: ctx.url,
      entries: recentAudit(ctx.org!.id),
    }),
  );
});

/* --------------------------------------------------------------- settings */

router.get("/app/installningar", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const settings = {
    serviceLevel: 0.95,
    deadStockDays: 180,
    capitalCostRate: 0.08,
  };
  const latest = latestAnalysis(orgId);
  if (latest) {
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
      org: { name: ctx.org!.name, plan: ctx.org!.plan },
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
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const form = await readForm(ctx);
  const name = str(form?.get("namn"));
  if (name) updateOrg(ctx.org!.id, { name });
  audit({ orgId: ctx.org!.id, userId: ctx.user!.id, action: "org.updated", target: name, ip: ctx.ip });
  return redirect("/app/installningar?meddelande=" + encodeURIComponent("Inställningarna sparade."));
});

router.get("/app/export", (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.read");
  if (blocked) return blocked;
  const orgId = ctx.org!.id;
  const payload = {
    organization: ctx.org,
    exportedAt: new Date().toISOString(),
    members: listMembers(orgId),
    analyses: (db.query("SELECT id, filename, rows, created_at, summary_json FROM analyses WHERE org_id = $o").all({ $o: orgId }) as unknown[]).map((a) => ({ ...(a as object) })),
    apiKeys: listApiKeys(orgId).map((k) => ({ name: k.name, prefix: k.prefix, scopes: k.scopes, created_at: k.created_at })),
  };
  return new Response(JSON.stringify(payload, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="lagerradar-export.json"' },
  });
});

router.post("/app/radera-analyser", async (ctx) => {
  const blocked = requireUser(ctx) ?? requirePermission(ctx, "data.delete");
  if (blocked) return blocked;
  if (!isSameOrigin(ctx.req)) return json({ error: "csrf" }, 403);
  const orgId = ctx.org!.id;
  const tx = db.transaction(() => {
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
  return new Response(pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="lagerrapport-${found.row.id.slice(0, 8)}.pdf"`,
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
  const escape = (v: unknown): string => {
    const s = String(v ?? "");
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const valueFor = (row: Record<string, unknown>, key: string): unknown => {
    if (key === "category") return row.category ? localizeCategory(String(row.category), exportLocale) : "";
    if (key === "action") return appAction(exportLocale, String(row.action ?? "ok"));
    return row[key];
  };
  const csv = [columns.map((c) => c.label).join(";"), ...rows.map((r) => columns.map((c) => escape(valueFor(r, c.key))).join(";"))].join("\r\n");

  return new Response("\ufeff" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exportLocale === "sv" ? "artiklar" : "items"}-${found.row.id.slice(0, 8)}.csv"`,
    },
  });
});

/* ------------------------------------------------------------- platform admin */

function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isPlatformAdmin(ctx: RequestContext): boolean {
  return platformAdminEmails().includes(ctx.user!.email.toLowerCase());
}

router.get("/admin", (ctx) => {
  const blocked = requireUser(ctx);
  if (blocked) return blocked;
  if (!platformAdminEmails().includes(ctx.user!.email.toLowerCase())) return html(notFoundPage(appLocale(ctx)), 404);

  const orgs = db
    .query(
      `SELECT o.id, o.name, o.plan, o.created_at,
        (SELECT COUNT(*) FROM members m WHERE m.org_id = o.id) AS members,
        (SELECT COUNT(*) FROM analyses a WHERE a.org_id = o.id AND a.status = 'ok') AS analyses,
        (SELECT json_extract(summary_json, '$.inventoryValue') FROM analyses a WHERE a.org_id = o.id AND a.status = 'ok' ORDER BY created_at DESC LIMIT 1) AS last_value
       FROM organizations o ORDER BY o.created_at DESC LIMIT 100`,
    )
    .all() as Array<{ id: string; name: string; plan: string; created_at: string; members: number; analyses: number; last_value: number | null }>;

  const rows = orgs
    .map(
      (o) => `<tr><td>${o.name}</td><td><span class="badge">${o.plan}</span></td><td class="num">${o.members}</td>
      <td class="num">${o.analyses}</td><td class="num">${o.last_value ? Math.round(o.last_value).toLocaleString("sv-SE") + " kr" : "–"}</td>
      <td class="tag-inline">${o.created_at.slice(0, 10)}</td></tr>`,
    )
    .join("");

  return html(
    shell({
      title: "Plattformsadministration",
      active: "admin",
      locale: appLocale(ctx),
      user: ctx.user!,
      org: { name: "Stoqwise", plan: "enterprise" },
      role: "owner",
      subtitle: `${orgs.length} organisationer`,
      content: `<section class="card"><div class="card-body"><div class="commercial-actions"><a class="btn" href="/app/prissattning">Prissättning</a><a class="btn btn-ghost" href="/app/ekonomi">Affärsplan</a></div></div></section>
      <section class="card"><div class="card-body flush"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Organisation</th><th>Plan</th><th class="num">Användare</th><th class="num">Analyser</th><th class="num">Senaste lagervärde</th><th>Skapad</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6">Inga organisationer ännu.</td></tr>`}</tbody></table></div></div></section>`,
    }),
  );
});

/* ---------------------------------------------------------------- static */

const STATIC: Record<string, string> = {
  "/v3.css": "text/css; charset=utf-8",
  "/v3.js": "text/javascript; charset=utf-8",
  "/styles.css": "text/css; charset=utf-8",
  "/app.js": "text/javascript; charset=utf-8",
  "/favicon.svg": "image/svg+xml",
};

async function serveStatic(path: string): Promise<Response | null> {
  const font = path.startsWith("/fonts/") && path.endsWith(".woff2");
  const brand = path.startsWith("/brand/") && path.endsWith(".svg");
  const image = path.startsWith("/images/") && /\.(jpe?g|png|webp)$/.test(path);
  const type = font
    ? "font/woff2"
    : brand
      ? "image/svg+xml"
      : image
        ? path.endsWith(".png")
          ? "image/png"
          : path.endsWith(".webp")
            ? "image/webp"
            : "image/jpeg"
        : STATIC[path];
  if (!type) return null;
  if (path.includes("..")) return null;
  const file = Bun.file(join(config.publicDir, path.slice(1)));
  if (!(await file.exists())) return null;
  if (font) {
    return new Response(file, { headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable" } });
  }
  // Styles and scripts keep their fixed names, so they must revalidate instead
  // of being cached for minutes after a deploy. Images and fonts may cache.
  const revalidate = /\.(css|js)$/.test(path);
  return new Response(file, {
    headers: { "content-type": type, "cache-control": revalidate ? "no-cache" : "public, max-age=86400" },
  });
}

/* ------------------------------------------------------------ entry point */

const server = Bun.serve({
  port: config.port,
  maxRequestBodySize: config.maxUploadBytes + 1024 * 1024,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    try {
      // The JSON API has its own authentication and error shape.
      if (url.pathname.startsWith("/api/v1")) {
        const ctx = await buildContext(req, {});
        const response = await handleApi(ctx);
        return securityHeaders(response ?? json({ error: "not_found" }, 404));
      }

      const match = router.match(req.method, url.pathname);
      if (!match) {
        const staticResponse = await serveStatic(url.pathname);
        if (staticResponse) return securityHeaders(staticResponse);
        return securityHeaders(html(notFoundPage(localeFromCookie(req.headers.get("cookie"))), 404));
      }

      const ctx = await buildContext(req, match.params);
      const response = await match.handler(ctx);
      return securityHeaders(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Okänt fel";
      console.error(`[lagerradar] ${req.method} ${url.pathname}:`, error);
      if (url.pathname.startsWith("/api/")) {
        return securityHeaders(json({ error: "internal", message }, 500));
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

/* Background: nightly cleanup of drafts that never completed. */
setInterval(() => {
  const removed = deleteStaleDrafts(24);
  if (removed > 0) console.log(`[lagerradar] rensade ${removed} utkast`);
}, 6 * 60 * 60 * 1000);
