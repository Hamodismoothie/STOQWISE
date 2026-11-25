/** Platform administration routes. They use the separate sq_admin session. */
import { isSameOrigin } from "../auth.ts";
import type { RequestContext } from "../http.ts";
import { Router, html, redirect, readForm, str } from "../http.ts";
import { db } from "../db.ts";
import { planLimits } from "../data/repo.ts";
import { config } from "../config.ts";
import { planActivatedMail, sendMail } from "../mail.ts";
import { runTrialLifecycle } from "../trial.ts";
import { adminCount, currentAdmin, type AdminRow } from "./auth.ts";
import { logAdmin } from "./store.ts";
import {
  adminOrganizationsPage,
  adminOrganizationPage,
  adminQuotesPage,
  adminSecurityPage,
  adminSystemPage,
  adminTestAccountsPage,
  adminUserPage,
  adminUsersPage,
  platformOverviewPage,
} from "./platform-pages.ts";
import {
  deleteUserSessions,
  activatePricingQuotesForOrg,
  getAdminOrganization,
  getAdminUser,
  isAssignablePlan,
  listAdminOrganizations,
  listAdminUsers,
  listPricingQuotesForAdmin,
  organizationImports,
  organizationMembers,
  platformSettings,
  platformStats,
  recentPlatformAnalyses,
  recentPlatformImports,
  recentSecurityEvents,
  recentTrialMails,
  savePlatformSettings,
  setMemberRoleByAdmin,
  setTestTenant,
  setUserStatus,
  updateOrganization,
  updatePricingQuoteStatus,
  userEvents,
  userOrganizations,
  type AssignablePlan,
  type PlatformSettingKey,
} from "./platform-store.ts";

import { timeToPdfStats } from "../import-timing.ts";

type Gate = { admin: AdminRow; response?: undefined } | { admin?: undefined; response: Response };

function requireAdmin(ctx: RequestContext): Gate {
  const admin = currentAdmin(ctx.req);
  if (admin) return { admin };
  if (adminCount() === 0) return { response: redirect("/admin/init") };
  return { response: redirect(`/admin/logg-in?nasta=${encodeURIComponent(ctx.url.pathname)}`) };
}

function csrf(ctx: RequestContext): Response | null {
  return isSameOrigin(ctx.req) ? null : html("Ogiltig begäran.", 403);
}

function canMutate(admin: AdminRow): Response | null {
  return admin.role === "owner" ? null : html("Endast ägaradministratören får ändra plattformen.", 403);
}

function flash(ctx: RequestContext): string | undefined {
  if (ctx.url.searchParams.get("sweep")) return "Trial-sweep körd. Nya utskick loggas i mail_log.";
  return ctx.url.searchParams.get("sparat") ? "Ändringen är sparad och loggad." : undefined;
}

export function registerPlatformAdmin(router: Router): void {
  router.get("/admin/plattform", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    return html(
      platformOverviewPage({
        admin: gate.admin!,
        stats: platformStats(),
        imports: recentPlatformImports(30),
        analyses: recentPlatformAnalyses(20),
        trialMails: recentTrialMails(12),
        timeToPdf: timeToPdfStats(),
        flash: flash(ctx),
      }),
    );
  });

  router.post("/admin/plattform/trial-sweep", async (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const denied = canMutate(gate.admin!) ?? csrf(ctx);
    if (denied) return denied;
    try {
      const result = await runTrialLifecycle();
      logAdmin({ adminId: gate.admin!.id, action: "trial.sweep", ip: ctx.ip, meta: result });
      return redirect("/admin/plattform?sweep=1");
    } catch (error) {
      console.error("[admin] trial sweep:", error);
      return html("Trial-sweepen kunde inte köras. Försök igen.", 500);
    }
  });

  /* ------------------------------------------------------------- users */

  router.get("/admin/anvandare", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const query = str(ctx.url.searchParams.get("q"));
    return html(adminUsersPage({ admin: gate.admin!, users: listAdminUsers(query), query, flash: flash(ctx) }));
  });

  router.get("/admin/anvandare/:id", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const user = getAdminUser(ctx.params.id ?? "");
    if (!user) return html("Användaren finns inte.", 404);
    return html(
      adminUserPage({
        admin: gate.admin!,
        user,
        organizations: userOrganizations(user.id),
        events: userEvents(user.id),
        flash: flash(ctx),
      }),
    );
  });

  router.post("/admin/anvandare/:id/status", async (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const denied = canMutate(gate.admin!) ?? csrf(ctx);
    if (denied) return denied;
    const form = await readForm(ctx);
    const status = str(form?.get("status"));
    if (status !== "active" && status !== "suspended") return html("Ogiltig status.", 400);
    const user = getAdminUser(ctx.params.id ?? "");
    if (!user) return html("Användaren finns inte.", 404);
    setUserStatus(user.id, status);
    logAdmin({ adminId: gate.admin!.id, action: "account.status", target: user.email, ip: ctx.ip, meta: { status } });
    return redirect(`/admin/anvandare/${encodeURIComponent(user.id)}?sparat=1`);
  });

  router.post("/admin/anvandare/:id/sessioner", async (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const denied = canMutate(gate.admin!) ?? csrf(ctx);
    if (denied) return denied;
    const user = getAdminUser(ctx.params.id ?? "");
    if (!user) return html("Användaren finns inte.", 404);
    deleteUserSessions(user.id);
    logAdmin({ adminId: gate.admin!.id, action: "account.sessions_revoked", target: user.email, ip: ctx.ip });
    return redirect(`/admin/anvandare/${encodeURIComponent(user.id)}?sparat=1`);
  });

  /* ------------------------------------------------------- organizations */

  router.get("/admin/organisationer", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const query = str(ctx.url.searchParams.get("q"));
    return html(adminOrganizationsPage({ admin: gate.admin!, organizations: listAdminOrganizations(query), query, flash: flash(ctx) }));
  });

  /* --------------------------------------------------------------- quotes */

  router.get("/admin/offerter", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    return html(
      adminQuotesPage({
        admin: gate.admin!,
        quotes: listPricingQuotesForAdmin(),
        flash: flash(ctx),
      }),
    );
  });

  router.post("/admin/offerter/:id/status", async (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const denied = canMutate(gate.admin!) ?? csrf(ctx);
    if (denied) return denied;
    const form = await readForm(ctx);
    const status = str(form?.get("status"));
    if (status !== "handled" && status !== "declined") return html("Ogiltig status.", 400);
    const id = ctx.params.id ?? "";
    if (!updatePricingQuoteStatus(id, status)) return html("Offertförfrågan finns inte.", 404);
    logAdmin({ adminId: gate.admin!.id, action: "pricing_quote.status", target: id, ip: ctx.ip, meta: { status } });
    return redirect("/admin/offerter?sparat=1");
  });

  router.get("/admin/organisationer/:id", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const org = getAdminOrganization(ctx.params.id ?? "");
    if (!org) return html("Organisationen finns inte.", 404);
    const limits = (() => {
      const fallback = planLimits[org.plan] ?? planLimits.trial!;
      if (org.kind === "test") return { ...planLimits.internal_test!, isTest: true };
      try {
        const overrides = org.limits_json ? (JSON.parse(org.limits_json) as Record<string, unknown>) : {};
        const n = (key: string, value: number): number => (Number.isFinite(Number(overrides[key])) ? Number(overrides[key]) : value);
        return {
          ...fallback,
          maxSkus: n("maxSkus", fallback.maxSkus),
          maxUsers: n("maxUsers", fallback.maxUsers),
          maxAnalysesPerMonth: n("maxAnalysesPerMonth", fallback.maxAnalysesPerMonth),
          copilotPerMonth: n("copilotPerMonth", fallback.copilotPerMonth),
          apiAccess: overrides.apiAccess === undefined ? fallback.apiAccess : Boolean(overrides.apiAccess),
          simulation: overrides.simulation === undefined ? fallback.simulation : Boolean(overrides.simulation),
          isTest: false,
        };
      } catch {
        return { ...fallback, isTest: false };
      }
    })();
    return html(
      adminOrganizationPage({
        admin: gate.admin!,
        org,
        limits,
        members: organizationMembers(org.id),
        imports: organizationImports(org.id),
        flash: flash(ctx),
      }),
    );
  });

  router.post("/admin/organisationer/:id", async (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const denied = canMutate(gate.admin!) ?? csrf(ctx);
    if (denied) return denied;
    const org = getAdminOrganization(ctx.params.id ?? "");
    if (!org) return html("Organisationen finns inte.", 404);
    const form = await readForm(ctx);
    const name = str(form?.get("namn")).slice(0, 160);
    const requestedPlan = str(form?.get("plan"));
    const plan = org.kind === "test" ? "internal_test" : requestedPlan;
    const status = str(form?.get("status")) === "suspended" ? "suspended" : "active";
    if (!name) return html("Namn krävs.", 400);
    if (org.kind !== "test" && !isAssignablePlan(plan)) return html("Ogiltig plan.", 400);
    if (!planLimits[plan]) return html("Ogiltig plan.", 400);

    const limits = org.kind === "test" ? null : {
      maxSkus: Math.min(500_000, Math.max(1, Number(form?.get("maxSkus")) || 1)),
      maxUsers: Math.min(10_000, Math.max(1, Number(form?.get("maxUsers")) || 1)),
      maxAnalysesPerMonth: Math.min(10_000_000, Math.max(1, Number(form?.get("maxAnalysesPerMonth")) || 1)),
      copilotPerMonth: Math.min(100_000_000, Math.max(0, Number(form?.get("copilotPerMonth")) || 0)),
      apiAccess: str(form?.get("apiAccess")) === "1",
      simulation: str(form?.get("simulation")) === "1",
    };
    const previousPlan = org.plan;
    if (!updateOrganization({ orgId: org.id, name, plan: plan as AssignablePlan | "internal_test", status, limits })) return html("Ogiltig plan.", 400);
    logAdmin({ adminId: gate.admin!.id, action: "organization.updated", target: org.name, ip: ctx.ip, meta: { plan, status, customLimits: Boolean(limits) } });
    const paidPlans = new Set(["basic", "multi", "business", "enterprise"]);
    if (org.kind !== "test" && paidPlans.has(plan) && !paidPlans.has(previousPlan)) {
      activatePricingQuotesForOrg(org.id);
      const recipient = organizationMembers(org.id).find((member) => member.role === "owner" && member.status === "active") ?? organizationMembers(org.id).find((member) => member.status === "active");
      if (recipient) {
        const planDefaults = planLimits[plan]!;
        const delivery = await sendMail({
          to: recipient.email,
          ...planActivatedMail({
            name: recipient.name,
            orgName: org.name,
            planName: planDefaults.name,
            monthlyPrice: planDefaults.priceSek,
            maxSkus: limits?.maxSkus ?? planDefaults.maxSkus,
            maxUsers: limits?.maxUsers ?? planDefaults.maxUsers,
            maxAnalysesPerMonth: limits?.maxAnalysesPerMonth ?? planDefaults.maxAnalysesPerMonth,
            appUrl: `${config.appOrigin}/app`,
            contactUrl: `${config.appOrigin}/kontakt`,
          }),
        });
        logAdmin({ adminId: gate.admin!.id, action: "organization.activated", target: org.name, ip: ctx.ip, meta: { plan, recipient: recipient.email, mailStatus: delivery.status } });
      }
    }
    return redirect(`/admin/organisationer/${encodeURIComponent(org.id)}?sparat=1`);
  });

  router.post("/admin/organisationer/:id/medlem", async (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const denied = canMutate(gate.admin!) ?? csrf(ctx);
    if (denied) return denied;
    const orgId = ctx.params.id ?? "";
    const form = await readForm(ctx);
    const userId = str(form?.get("user"));
    const role = str(form?.get("roll"));
    const current = db.query("SELECT role FROM members WHERE org_id = $o AND user_id = $u").get({ $o: orgId, $u: userId }) as { role: string } | null;
    if (!current || current.role === "owner" || !setMemberRoleByAdmin(orgId, userId, role)) {
      return html("Medlemmen eller rollen är ogiltig. Ägarrollen kan inte ändras här.", 400);
    }
    logAdmin({ adminId: gate.admin!.id, action: "organization.member_role", target: `${orgId}/${userId}`, ip: ctx.ip, meta: { role } });
    return redirect(`/admin/organisationer/${encodeURIComponent(orgId)}?sparat=1`);
  });

  /* --------------------------------------------------------- test tenants */

  router.get("/admin/testkonton", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const all = listAdminOrganizations("");
    return html(
      adminTestAccountsPage({
        admin: gate.admin!,
        accounts: all.filter((org) => org.kind === "test"),
        candidates: all.filter((org) => org.kind !== "test"),
        flash: flash(ctx),
      }),
    );
  });

  router.post("/admin/testkonton/promote", async (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const denied = canMutate(gate.admin!) ?? csrf(ctx);
    if (denied) return denied;
    const form = await readForm(ctx);
    if (str(form?.get("bekrafta")) !== "1") return redirect("/admin/testkonton");
    const org = getAdminOrganization(str(form?.get("org")));
    if (!org || org.kind === "test") return html("Organisationen är ogiltig.", 400);
    setTestTenant(org.id, true);
    logAdmin({ adminId: gate.admin!.id, action: "test_account.enabled", target: org.name, ip: ctx.ip, meta: { orgId: org.id } });
    return redirect("/admin/testkonton?sparat=1");
  });

  router.post("/admin/testkonton/:id", async (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const denied = canMutate(gate.admin!) ?? csrf(ctx);
    if (denied) return denied;
    const form = await readForm(ctx);
    if (str(form?.get("bekrafta")) !== "1") return redirect("/admin/testkonton");
    const org = getAdminOrganization(ctx.params.id ?? "");
    if (!org || org.kind !== "test") return html("Testkontot finns inte.", 404);
    if (str(form?.get("enabled")) === "0") {
      setTestTenant(org.id, false);
      logAdmin({ adminId: gate.admin!.id, action: "test_account.disabled", target: org.name, ip: ctx.ip, meta: { orgId: org.id } });
    }
    return redirect("/admin/testkonton?sparat=1");
  });

  /* --------------------------------------------------------------- system */

  router.get("/admin/system", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    return html(adminSystemPage({ admin: gate.admin!, settings: platformSettings(), stats: platformStats(), flash: flash(ctx) }));
  });

  router.post("/admin/system", async (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    const denied = canMutate(gate.admin!) ?? csrf(ctx);
    if (denied) return denied;
    const form = await readForm(ctx);
    const keys: PlatformSettingKey[] = ["signups_enabled", "imports_enabled", "copilot_enabled"];
    const values: Partial<Record<PlatformSettingKey, string>> = { support_message: str(form?.get("support_message")).slice(0, 500) };
    for (const key of keys) values[key] = str(form?.get(key)) === "true" ? "true" : "false";
    savePlatformSettings(values, gate.admin!.id);
    logAdmin({ adminId: gate.admin!.id, action: "platform.settings", ip: ctx.ip, meta: values });
    return redirect("/admin/system?sparat=1");
  });

  router.get("/admin/sakerhet", (ctx) => {
    const gate = requireAdmin(ctx);
    if (gate.response) return gate.response;
    return html(adminSecurityPage({ admin: gate.admin!, events: recentSecurityEvents(100) }));
  });
}
