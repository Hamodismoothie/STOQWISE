/**
 * Tenant-scoped data access.
 *
 * Every function that touches customer data takes `orgId` and puts it in the
 * WHERE clause. There is no "get by id" without an organisation, which makes a
 * cross-tenant read a compile error rather than a code review question.
 */
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { db } from "../db.ts";
import { categoryCandidates, planSearch, type PopulatedLanguage } from "../terminology.ts";
import { TECHNICAL_ITEM_CAPACITY } from "../capacity.ts";
import { defaultPricingRules, sanitizeRules, type PriceEstimate, type PricingProfile, type PricingRules } from "../pricing.ts";
import { trialEndIso, trialState, type TrialState } from "../trial-state.ts";
import { collapseDailyValues, type RawValuePoint } from "../core/history.ts";

const now = (): string => new Date().toISOString();

/* ------------------------------------------------------------------ roles */

export type Role = "owner" | "admin" | "analyst" | "viewer";

export type Permission =
  | "org.manage"
  | "members.manage"
  | "billing.manage"
  | "data.write"
  | "data.read"
  | "data.delete"
  | "api.manage"
  | "copilot.use";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ["org.manage", "members.manage", "billing.manage", "data.write", "data.read", "data.delete", "api.manage", "copilot.use"],
  admin: ["org.manage", "members.manage", "data.write", "data.read", "data.delete", "api.manage", "copilot.use"],
  analyst: ["data.write", "data.read", "copilot.use"],
  viewer: ["data.read"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export const roleRank: Record<Role, number> = { owner: 4, admin: 3, analyst: 2, viewer: 1 };

export function isRole(value: unknown): value is Role {
  return value === "owner" || value === "admin" || value === "analyst" || value === "viewer";
}

/* ---------------------------------------------------------------- plans */

export interface PlanLimits {
  id: string;
  name: string;
  priceSek: number;
  maxSkus: number;
  maxUsers: number;
  maxAnalysesPerMonth: number;
  copilotPerMonth: number;
  apiAccess: boolean;
  simulation: boolean;
  /** Whether the subscription may delete imported data at all. Roles decide
   * who inside the organisation may use it; this flag decides whether the
   * capability exists for the plan. */
  deleteData: boolean;
}

export const planLimits: Record<string, PlanLimits> = {
  trial: {
    id: "trial",
    name: "Prova på",
    priceSek: 0,
    maxSkus: 5_000,
    maxUsers: 3,
    maxAnalysesPerMonth: 3,
    copilotPerMonth: 50,
    apiAccess: false,
    simulation: true,
    deleteData: true,
  },
  basic: {
    id: "basic",
    name: "Starter",
    priceSek: 2_490,
    maxSkus: 10_000,
    maxUsers: 3,
    maxAnalysesPerMonth: 10,
    copilotPerMonth: 200,
    apiAccess: true,
    simulation: true,
    deleteData: true,
  },
  multi: {
    id: "multi",
    name: "Growth",
    priceSek: 4_900,
    maxSkus: 50_000,
    maxUsers: 10,
    maxAnalysesPerMonth: 50,
    copilotPerMonth: 1_000,
    apiAccess: true,
    simulation: true,
    deleteData: true,
  },
  business: {
    id: "business",
    name: "Business",
    priceSek: 9_900,
    maxSkus: 75_000,
    maxUsers: 30,
    maxAnalysesPerMonth: 200,
    copilotPerMonth: 5_000,
    apiAccess: true,
    simulation: true,
    deleteData: true,
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    priceSek: 14_900,
    maxSkus: TECHNICAL_ITEM_CAPACITY,
    maxUsers: 100,
    maxAnalysesPerMonth: 500,
    copilotPerMonth: 10_000,
    apiAccess: true,
    simulation: true,
    deleteData: true,
  },
  internal_test: {
    id: "internal_test",
    name: "Internt testkonto",
    priceSek: 0,
    maxSkus: TECHNICAL_ITEM_CAPACITY,
    maxUsers: 999,
    maxAnalysesPerMonth: 1_000_000,
    copilotPerMonth: 1_000_000,
    apiAccess: true,
    simulation: true,
    deleteData: true,
  },
};

export function limitsFor(plan: string): PlanLimits {
  return planLimits[plan] ?? planLimits.trial!;
}

/* -------------------------------------------------------------- orgs */

export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  trial_ends_at: string | null;
  settings_json: string | null;
  kind: "customer" | "test";
  status: "active" | "suspended";
  locale: string;
  limits_json: string | null;
  created_at: string;
  trial_welcome_sent_at: string | null;
  trial_midpoint_sent_at: string | null;
  trial_ending_sent_at: string | null;
  trial_ended_sent_at: string | null;
}

export interface Membership {
  org: OrgRow;
  role: Role;
}

export interface OrgEntitlements extends PlanLimits {
  kind: "customer" | "test";
  status: "active" | "suspended";
  isTest: boolean;
  sourcePlan: string;
  trial: TrialState;
  readOnly: boolean;
}

/** Server-side entitlement. A test tenant is recognised by the database marker
 * `kind`, never by an email domain, request field or frontend flag. */
export function limitsForOrg(orgId: string): OrgEntitlements {
  const row = db
    .query("SELECT plan, kind, status, limits_json, trial_ends_at FROM organizations WHERE id = $id")
    .get({ $id: orgId }) as
    | { plan: string; kind: "customer" | "test"; status: "active" | "suspended"; limits_json: string | null; trial_ends_at: string | null }
    | null;
  if (!row) {
    const trial = trialState({ plan: "trial", trial_ends_at: null });
    return { ...planLimits.trial!, kind: "customer", status: "active", isTest: false, sourcePlan: "trial", trial, readOnly: false };
  }

  const sourcePlan = planLimits[row.plan] ? row.plan : "trial";
  let limits: PlanLimits = { ...planLimits[sourcePlan]! };
  if (row.kind === "test") {
    limits = { ...planLimits.internal_test!, maxSkus: TECHNICAL_ITEM_CAPACITY };
  } else if (row.limits_json) {
    try {
      const overrides = JSON.parse(row.limits_json) as Partial<PlanLimits>;
      const integer = (value: unknown, fallback: number, cap = Number.MAX_SAFE_INTEGER): number => {
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? Math.min(cap, Math.floor(n)) : fallback;
      };
      limits = {
        ...limits,
        maxSkus: integer(overrides.maxSkus, limits.maxSkus, TECHNICAL_ITEM_CAPACITY),
        maxUsers: integer(overrides.maxUsers, limits.maxUsers, 10_000),
        maxAnalysesPerMonth: integer(overrides.maxAnalysesPerMonth, limits.maxAnalysesPerMonth, 10_000_000),
        copilotPerMonth: integer(overrides.copilotPerMonth, limits.copilotPerMonth, 100_000_000),
        apiAccess: overrides.apiAccess === undefined ? limits.apiAccess : Boolean(overrides.apiAccess),
        simulation: overrides.simulation === undefined ? limits.simulation : Boolean(overrides.simulation),
        deleteData: overrides.deleteData === undefined ? limits.deleteData : Boolean(overrides.deleteData),
      };
    } catch {
      // A corrupt override must never grant more than the plan allows.
    }
  }
  const trial = trialState({ plan: row.plan, trial_ends_at: row.trial_ends_at });
  return {
    ...limits,
    kind: row.kind,
    status: row.status,
    isTest: row.kind === "test",
    sourcePlan,
    trial,
    readOnly: row.kind !== "test" && row.plan === "trial" && trial.ended,
  };
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "foretag";
}

export function createOrganization(input: { name: string; userId: string; plan?: string; locale?: "sv" | "en" }): OrgRow {
  const id = randomUUID();
  let slug = slugify(input.name);
  const exists = db.query("SELECT 1 FROM organizations WHERE slug = $s").get({ $s: slug });
  if (exists) slug = `${slug}-${id.slice(0, 4)}`;
  const plan = input.plan && planLimits[input.plan] ? input.plan : "trial";

  const org: OrgRow = {
    id,
    name: input.name.trim(),
    slug,
    plan,
    trial_ends_at: trialEndIso(),
    settings_json: null,
    kind: "customer",
    status: "active",
    locale: input.locale === "en" ? "en" : "sv",
    limits_json: null,
    created_at: now(),
    trial_welcome_sent_at: null,
    trial_midpoint_sent_at: null,
    trial_ending_sent_at: null,
    trial_ended_sent_at: null,
  };

  const tx = db.transaction(() => {
    db.query(
      `INSERT INTO organizations (id, name, slug, plan, trial_ends_at, settings_json, locale, created_at)
       VALUES ($id, $n, $s, $p, $t, NULL, $l, $c)`,
    ).run({ $id: org.id, $n: org.name, $s: org.slug, $p: org.plan, $t: org.trial_ends_at, $l: org.locale, $c: org.created_at });
    db.query(
      `INSERT INTO members (org_id, user_id, role, created_at) VALUES ($o, $u, 'owner', $c)`,
    ).run({ $o: org.id, $u: input.userId, $c: now() });
    db.query(
      `INSERT INTO subscriptions (id, org_id, plan, status, seats, created_at, updated_at)
       VALUES ($id, $o, $p, 'trialing', 1, $c, $c)`,
    ).run({ $id: randomUUID(), $o: org.id, $p: org.plan, $c: now() });
  });
  tx();
  return org;
}

export function orgForUser(userId: string): Membership | null {
  const row = db
    .query(
      `SELECT o.*, m.role FROM members m
       JOIN organizations o ON o.id = m.org_id
       WHERE m.user_id = $u
       ORDER BY m.created_at ASC LIMIT 1`,
    )
    .get({ $u: userId }) as (OrgRow & { role: Role }) | null;
  if (!row) return null;
  const { role, ...org } = row;
  return { org: org as OrgRow, role };
}

export function getOrg(orgId: string): OrgRow | null {
  return (db.query("SELECT * FROM organizations WHERE id = $id").get({ $id: orgId }) as OrgRow | null) ?? null;
}

export function updateOrg(orgId: string, patch: { name?: string; plan?: string; settings?: unknown }): void {
  if (patch.name !== undefined) db.query("UPDATE organizations SET name = $n WHERE id = $id").run({ $n: patch.name.trim(), $id: orgId });
  if (patch.plan !== undefined) db.query("UPDATE organizations SET plan = $p WHERE id = $id").run({ $p: patch.plan, $id: orgId });
  if (patch.settings !== undefined)
    db.query("UPDATE organizations SET settings_json = $s WHERE id = $id").run({ $s: JSON.stringify(patch.settings), $id: orgId });
}

/* -------------------------------------------------------------- members */

export interface MemberRow {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  created_at: string;
}

export function listMembers(orgId: string): MemberRow[] {
  return db
    .query(
      `SELECT m.user_id, u.email, u.name, m.role, m.created_at
       FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $o ORDER BY m.created_at ASC`,
    )
    .all({ $o: orgId }) as MemberRow[];
}

export function membershipFor(orgId: string, userId: string): { role: Role } | null {
  return (
    (db.query("SELECT role FROM members WHERE org_id = $o AND user_id = $u").get({ $o: orgId, $u: userId }) as { role: Role } | null) ??
    null
  );
}

export function setMemberRole(orgId: string, userId: string, role: Role): void {
  db.query("UPDATE members SET role = $r WHERE org_id = $o AND user_id = $u").run({ $r: role, $o: orgId, $u: userId });
}

export function removeMember(orgId: string, userId: string): void {
  db.query("DELETE FROM members WHERE org_id = $o AND user_id = $u").run({ $o: orgId, $u: userId });
}

export function countMembers(orgId: string): number {
  return (db.query("SELECT COUNT(*) AS c FROM members WHERE org_id = $o").get({ $o: orgId }) as { c: number }).c;
}

/* --------------------------------------------------------- invitations */

export function createInvitation(input: {
  orgId: string;
  email: string;
  role: Role;
  /** The inviter's interface language: mail and invitation page share it. */
  locale?: string;
  days?: number;
}): string {
  if (!isRole(input.role)) throw new Error("Ogiltig roll för inbjudan.");
  const token = randomBytes(24).toString("base64url");
  db.query(
    `INSERT INTO invitations (id, org_id, email, role, locale, token_hash, expires_at, created_at)
     VALUES ($id, $o, $e, $r, $l, $t, $x, $c)`,
  ).run({
    $id: randomUUID(),
    $o: input.orgId,
    $e: input.email.toLowerCase().trim(),
    $r: input.role,
    $l: input.locale === "en" ? "en" : "sv",
    $t: createHash("sha256").update(token).digest("hex"),
    $x: new Date(Date.now() + (input.days ?? 7) * 86400_000).toISOString(),
    $c: now(),
  });
  return token;
}

export function findInvitation(token: string) {
  return (
    (db
      .query(
        `SELECT i.*, o.name AS org_name FROM invitations i JOIN organizations o ON o.id = i.org_id
         WHERE i.token_hash = $t AND i.accepted_at IS NULL AND i.expires_at > $n`,
      )
      .get({ $t: createHash("sha256").update(token).digest("hex"), $n: now() }) as
      | { id: string; org_id: string; email: string; role: Role; org_name: string; locale: string | null }
      | null) ?? null
  );
}

export function acceptInvitation(invitationId: string, orgId: string, userId: string, role: Role): boolean {
  const tx = db.transaction(() => {
    const claimed = db.query("UPDATE invitations SET accepted_at = $t WHERE id = $id AND accepted_at IS NULL").run({ $t: now(), $id: invitationId });
    if (Number((claimed as { changes?: number }).changes ?? 0) === 0) return false;
    const existing = db.query("SELECT 1 FROM members WHERE org_id = $o AND user_id = $u").get({ $o: orgId, $u: userId });
    if (!existing) {
      db.query("INSERT INTO members (org_id, user_id, role, created_at) VALUES ($o, $u, $r, $c)").run({
        $o: orgId,
        $u: userId,
        $r: isRole(role) ? role : "viewer",
        $c: now(),
      });
    }
    return true;
  });
  return tx();
}

/* -------------------------------------------------------------- api keys */

export interface ApiKeyRow {
  id: string;
  org_id: string;
  name: string;
  prefix: string;
  scopes: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export function createApiKey(orgId: string, name: string, scopes: "read" | "write"): { key: string; row: ApiKeyRow } {
  const raw = randomBytes(24).toString("base64url");
  const key = `lr_${scopes}_${raw}`;
  const row: ApiKeyRow = {
    id: randomUUID(),
    org_id: orgId,
    name: name.trim() || "API-nyckel",
    prefix: key.slice(0, 12),
    scopes,
    last_used_at: null,
    revoked_at: null,
    created_at: now(),
  };
  db.query(
    `INSERT INTO api_keys (id, org_id, name, prefix, key_hash, scopes, created_at)
     VALUES ($id, $o, $n, $p, $h, $s, $c)`,
  ).run({ $id: row.id, $o: orgId, $n: row.name, $p: row.prefix, $h: hashKey(key), $s: scopes, $c: row.created_at });
  return { key, row };
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function findApiKey(key: string): ApiKeyRow | null {
  const row = db
    .query("SELECT * FROM api_keys WHERE key_hash = $h AND revoked_at IS NULL")
    .get({ $h: hashKey(key) }) as ApiKeyRow | null;
  if (!row) return null;
  db.query("UPDATE api_keys SET last_used_at = $t WHERE id = $id").run({ $t: now(), $id: row.id });
  return row;
}

export function listApiKeys(orgId: string): ApiKeyRow[] {
  return db.query("SELECT * FROM api_keys WHERE org_id = $o ORDER BY created_at DESC").all({ $o: orgId }) as ApiKeyRow[];
}

export function revokeApiKey(orgId: string, id: string): void {
  db.query("UPDATE api_keys SET revoked_at = $t WHERE id = $id AND org_id = $o").run({ $t: now(), $id: id, $o: orgId });
}

/* -------------------------------------------------------------- webhooks */

export interface WebhookRow {
  id: string;
  org_id: string;
  url: string;
  secret: string;
  events: string;
  active: number;
  created_at: string;
}

export function createWebhook(orgId: string, url: string, events: string[]): WebhookRow {
  const row: WebhookRow = {
    id: randomUUID(),
    org_id: orgId,
    url,
    secret: randomBytes(24).toString("hex"),
    events: events.join(","),
    active: 1,
    created_at: now(),
  };
  db.query(
    `INSERT INTO webhooks (id, org_id, url, secret, events, active, created_at)
     VALUES ($id, $o, $u, $s, $e, 1, $c)`,
  ).run({ $id: row.id, $o: orgId, $u: url, $s: row.secret, $e: row.events, $c: row.created_at });
  return row;
}

export function listWebhooks(orgId: string): WebhookRow[] {
  return db.query("SELECT * FROM webhooks WHERE org_id = $o ORDER BY created_at DESC").all({ $o: orgId }) as WebhookRow[];
}

export function deleteWebhook(orgId: string, id: string): void {
  db.query("DELETE FROM webhooks WHERE id = $id AND org_id = $o").run({ $id: id, $o: orgId });
}

export function logDelivery(input: {
  webhookId: string;
  event: string;
  status: "ok" | "failed";
  responseCode: number | null;
  attempts: number;
  error: string | null;
}): void {
  db.query(
    `INSERT INTO webhook_deliveries (webhook_id, event, status, response_code, attempts, error, created_at)
     VALUES ($w, $e, $s, $c, $a, $err, $t)`,
  ).run({
    $w: input.webhookId,
    $e: input.event,
    $s: input.status,
    $c: input.responseCode,
    $a: input.attempts,
    $err: input.error,
    $t: now(),
  });
}

export function recentDeliveries(orgId: string, limit = 20) {
  return db
    .query(
      `SELECT d.*, w.url FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
       WHERE w.org_id = $o ORDER BY d.id DESC LIMIT $l`,
    )
    .all({ $o: orgId, $l: limit }) as Array<{
    event: string;
    status: string;
    response_code: number | null;
    attempts: number;
    error: string | null;
    created_at: string;
    url: string;
  }>;
}

/* --------------------------------------------------------------- imports */

export interface ImportRow {
  id: string;
  org_id: string;
  analysis_id: string | null;
  source: string;
  filename: string;
  rows: number;
  imported: number;
  skipped: number;
  status: string;
  error: string | null;
  log_json: string | null;
  started_at: string;
  finished_at: string | null;
}

export function startImport(input: { orgId: string; source: string; filename: string }): string {
  const id = randomUUID();
  db.query(
    `INSERT INTO imports (id, org_id, source, filename, status, started_at)
     VALUES ($id, $o, $s, $f, 'running', $t)`,
  ).run({ $id: id, $o: input.orgId, $s: input.source, $f: input.filename, $t: now() });
  return id;
}

export function finishImport(input: {
  id: string;
  status: "ok" | "failed";
  analysisId: string | null;
  rows: number;
  imported: number;
  skipped: number;
  error: string | null;
  log: unknown;
}): void {
  db.query(
    `UPDATE imports SET status = $s, analysis_id = $a, rows = $r, imported = $i, skipped = $k,
       error = $e, log_json = $l, finished_at = $f WHERE id = $id`,
  ).run({
    $s: input.status,
    $a: input.analysisId,
    $r: input.rows,
    $i: input.imported,
    $k: input.skipped,
    $e: input.error,
    $l: JSON.stringify(input.log ?? null),
    $f: now(),
    $id: input.id,
  });
}

export function listImports(orgId: string, limit = 25): ImportRow[] {
  return db
    .query("SELECT * FROM imports WHERE org_id = $o ORDER BY started_at DESC LIMIT $l")
    .all({ $o: orgId, $l: limit }) as ImportRow[];
}

/** The import that produced an analysis, used to trace a result back to its file. */
export function importForAnalysis(analysisId: string, orgId: string): ImportRow | null {
  return (
    db
      .query("SELECT * FROM imports WHERE analysis_id = $a AND org_id = $o ORDER BY started_at DESC LIMIT 1")
      .get({ $a: analysisId, $o: orgId }) as ImportRow | null
  ) ?? null;
}

/* ------------------------------------------------------- subscriptions */

export function getSubscription(orgId: string) {
  return (
    (db.query("SELECT * FROM subscriptions WHERE org_id = $o").get({ $o: orgId }) as {
      id: string;
      org_id: string;
      plan: string;
      status: string;
      seats: number;
      current_period_end: string | null;
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
    } | null) ?? null
  );
}

export function setPlan(orgId: string, plan: string, status = "active"): void {
  if (!planLimits[plan]) throw new Error(`Okänd plan: ${plan}`);
  const tx = db.transaction(() => {
    if (plan === "trial") {
      db.query(
        `UPDATE organizations
         SET plan = $p, trial_ends_at = $t, trial_welcome_sent_at = NULL,
             trial_midpoint_sent_at = NULL, trial_ending_sent_at = NULL, trial_ended_sent_at = NULL
         WHERE id = $o`,
      ).run({ $p: plan, $t: trialEndIso(), $o: orgId });
    } else {
      db.query("UPDATE organizations SET plan = $p WHERE id = $o").run({ $p: plan, $o: orgId });
    }
    const existing = db.query("SELECT 1 FROM subscriptions WHERE org_id = $o").get({ $o: orgId });
    if (existing) {
      db.query("UPDATE subscriptions SET plan = $p, status = $s, updated_at = $t WHERE org_id = $o").run({
        $p: plan,
        $s: status,
        $t: now(),
        $o: orgId,
      });
    } else {
      db.query(
        `INSERT INTO subscriptions (id, org_id, plan, status, seats, created_at, updated_at)
         VALUES ($id, $o, $p, $s, 1, $c, $c)`,
      ).run({ $id: randomUUID(), $o: orgId, $p: plan, $s: status, $c: now() });
    }
  });
  tx();
}

/** Starts a fresh fourteen-day trial for an organisation that is already on
 * the trial plan after an administrative reset. */
export function resetTrial(orgId: string): void {
  db.query(
    `UPDATE organizations
     SET plan = 'trial', trial_ends_at = $t, trial_welcome_sent_at = NULL,
         trial_midpoint_sent_at = NULL, trial_ending_sent_at = NULL, trial_ended_sent_at = NULL
     WHERE id = $o`,
  ).run({ $t: trialEndIso(), $o: orgId });
}

/* ------------------------------------------------------------- scenarios */

export function saveScenario(input: {
  orgId: string;
  analysisId: string;
  name: string;
  input: unknown;
  result: unknown;
}): string {
  const id = randomUUID();
  db.query(
    `INSERT INTO scenarios (id, org_id, analysis_id, name, input_json, result_json, created_at)
     VALUES ($id, $o, $a, $n, $i, $r, $t)`,
  ).run({
    $id: id,
    $o: input.orgId,
    $a: input.analysisId,
    $n: input.name,
    $i: JSON.stringify(input.input),
    $r: JSON.stringify(input.result),
    $t: now(),
  });
  return id;
}

export function listScenarios(orgId: string, analysisId: string) {
  return db
    .query("SELECT id, name, input_json, result_json, created_at FROM scenarios WHERE org_id = $o AND analysis_id = $a ORDER BY created_at DESC LIMIT 20")
    .all({ $o: orgId, $a: analysisId }) as Array<{ id: string; name: string; input_json: string; result_json: string; created_at: string }>;
}

/* --------------------------------------------------------- conversations */

export function createConversation(input: { orgId: string; userId: string; analysisId: string; title: string }): string {
  const id = randomUUID();
  db.query(
    `INSERT INTO conversations (id, org_id, user_id, analysis_id, title, created_at, updated_at)
     VALUES ($id, $o, $u, $a, $t, $c, $c)`,
  ).run({ $id: id, $o: input.orgId, $u: input.userId, $a: input.analysisId, $t: input.title.slice(0, 120), $c: now() });
  return id;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  payload_json: string | null;
  created_at: string;
}

export function appendMessage(input: {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  payload?: unknown;
}): MessageRow {
  const row: MessageRow = {
    id: randomUUID(),
    conversation_id: input.conversationId,
    role: input.role,
    content: input.content,
    payload_json: input.payload ? JSON.stringify(input.payload) : null,
    created_at: now(),
  };
  db.query(
    `INSERT INTO messages (id, conversation_id, role, content, payload_json, created_at)
     VALUES ($id, $c, $r, $m, $p, $t)`,
  ).run({ $id: row.id, $c: row.conversation_id, $r: row.role, $m: row.content, $p: row.payload_json, $t: row.created_at });
  db.query("UPDATE conversations SET updated_at = $t WHERE id = $c").run({ $t: row.created_at, $c: row.conversation_id });
  return row;
}

export function getConversation(orgId: string, id: string, userId: string) {
  return (
    (db.query("SELECT * FROM conversations WHERE id = $id AND org_id = $o AND user_id = $u").get({ $id: id, $o: orgId, $u: userId }) as {
      id: string;
      org_id: string;
      user_id: string;
      analysis_id: string;
      title: string;
      created_at: string;
      updated_at: string;
    } | null) ?? null
  );
}

export function listMessages(conversationId: string): MessageRow[] {
  return db.query("SELECT * FROM messages WHERE conversation_id = $c ORDER BY created_at ASC").all({ $c: conversationId }) as MessageRow[];
}

export function listConversations(orgId: string, userId: string, limit = 15) {
  return db
    .query("SELECT id, title, analysis_id, updated_at FROM conversations WHERE org_id = $o AND user_id = $u ORDER BY updated_at DESC LIMIT $l")
    .all({ $o: orgId, $u: userId, $l: limit }) as Array<{ id: string; title: string; analysis_id: string; updated_at: string }>;
}

/* ----------------------------------------------------------------- audit */

export function audit(input: {
  orgId: string | null;
  userId: string | null;
  action: string;
  target?: string | null;
  ip?: string | null;
  meta?: unknown;
}): void {
  db.query(
    `INSERT INTO audit_log (org_id, user_id, action, target, ip, meta_json, created_at)
     VALUES ($o, $u, $a, $t, $i, $m, $c)`,
  ).run({
    $o: input.orgId,
    $u: input.userId,
    $a: input.action,
    $t: input.target ?? null,
    $i: input.ip ?? null,
    $m: input.meta ? JSON.stringify(input.meta) : null,
    $c: now(),
  });
}

export function recentAudit(orgId: string, limit = 50) {
  return db
    .query(
      `SELECT a.*, u.email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.org_id = $o ORDER BY a.id DESC LIMIT $l`,
    )
    .all({ $o: orgId, $l: limit }) as Array<{
    action: string;
    target: string | null;
    ip: string | null;
    created_at: string;
    email: string | null;
    meta_json: string | null;
  }>;
}

/* ----------------------------------------------------------- saved views */

export function saveView(input: { orgId: string; userId: string; name: string; query: string }): string {
  const id = randomUUID();
  db.query(
    `INSERT INTO saved_views (id, org_id, user_id, name, query_json, created_at)
     VALUES ($id, $o, $u, $n, $q, $c)`,
  ).run({ $id: id, $o: input.orgId, $u: input.userId, $n: input.name.slice(0, 60), $q: input.query, $c: now() });
  return id;
}

export function listViews(orgId: string, userId: string) {
  return db
    .query("SELECT id, name, query_json FROM saved_views WHERE org_id = $o AND user_id = $u ORDER BY created_at DESC LIMIT 12")
    .all({ $o: orgId, $u: userId }) as Array<{ id: string; name: string; query_json: string }>;
}

export function deleteView(orgId: string, userId: string, id: string): void {
  db.query("DELETE FROM saved_views WHERE id = $id AND org_id = $o AND user_id = $u").run({ $id: id, $o: orgId, $u: userId });
}

/* ------------------------------------------------------------ item store */

export interface ItemRowInput {
  sku: string;
  name: string;
  category: string | null;
  supplier: string | null;
  stock: number;
  cost: number;
  price: number | null;
  value: number;
  sold: number;
  revenue: number;
  profit: number;
  marginPct: number | null;
  coverDays: number | null;
  turns: number;
  abc: string | null;
  xyz: string | null;
  action: string | null;
  priority: number;
  extra: unknown;
}

export function replaceItems(orgId: string, analysisId: string, warehouse: string, items: ItemRowInput[]): void {
  const insert = db.query(
    `INSERT OR REPLACE INTO items
      (analysis_id, org_id, sku, name, category, supplier, warehouse, stock, cost, price, value, sold, revenue,
       profit, margin_pct, cover_days, turns, abc, xyz, action, priority, extra_json)
     VALUES ($a, $o, $s, $n, $c, $sup, $w, $st, $co, $pr, $v, $so, $re, $pf, $mp, $cd, $tu, $abc, $xyz, $ac, $pi, $ex)`,
  );
  const tx = db.transaction(() => {
    db.query("DELETE FROM items WHERE analysis_id = $a AND org_id = $o").run({ $a: analysisId, $o: orgId });
    for (const item of items) {
      insert.run({
        $a: analysisId,
        $o: orgId,
        $s: item.sku,
        $n: item.name,
        $c: item.category,
        $sup: item.supplier,
        $w: warehouse,
        $st: item.stock,
        $co: item.cost,
        $pr: item.price,
        $v: item.value,
        $so: item.sold,
        $re: item.revenue,
        $pf: item.profit,
        $mp: item.marginPct,
        $cd: item.coverDays,
        $tu: item.turns,
        $abc: item.abc,
        $xyz: item.xyz,
        $ac: item.action,
        $pi: item.priority,
        $ex: JSON.stringify(item.extra ?? null),
      });
    }
  });
  tx();
}

/* --------------------------------------------------------------- deletion */

/** Deletion is a separate capability. A role may be allowed to delete on one
 * plan but not on another, and a customer plan can be configured per org. */
export function canDeleteOrgData(role: Role, limits: Pick<PlanLimits, "deleteData">): boolean {
  return can(role, "data.delete") && limits.deleteData === true;
}

export interface DeletionImpact {
  id: string;
  filename: string;
  items: number;
  value: number;
  imports: number;
  createdAt: string;
}

export function analysisDeletionImpact(orgId: string, analysisId: string): DeletionImpact | null {
  const row = db
    .query("SELECT id, filename, created_at FROM analyses WHERE id = $id AND org_id = $o")
    .get({ $id: analysisId, $o: orgId }) as { id: string; filename: string; created_at: string } | null;
  if (!row) return null;
  const stats = db
    .query("SELECT COUNT(*) AS items, COALESCE(SUM(value), 0) AS value FROM items WHERE analysis_id = $id AND org_id = $o")
    .get({ $id: analysisId, $o: orgId }) as { items: number; value: number };
  const imports = db
    .query("SELECT COUNT(*) AS n FROM imports WHERE analysis_id = $id AND org_id = $o")
    .get({ $id: analysisId, $o: orgId }) as { n: number };
  return { id: row.id, filename: row.filename, items: stats.items, value: stats.value, imports: imports.n, createdAt: row.created_at };
}

/** Removes one imported data set: its import log, its item rows and the
 * analysis itself. Other organisations are untouched because every statement
 * carries org_id. */
export function deleteAnalysisData(orgId: string, analysisId: string): boolean {
  let removed = 0;
  const tx = db.transaction(() => {
    db.query("DELETE FROM imports WHERE org_id = $o AND analysis_id = $a").run({ $o: orgId, $a: analysisId });
    db.query("DELETE FROM items WHERE org_id = $o AND analysis_id = $a").run({ $o: orgId, $a: analysisId });
    removed = db.query("DELETE FROM analyses WHERE org_id = $o AND id = $a").run({ $o: orgId, $a: analysisId }).changes ?? 0;
  });
  tx();
  return removed > 0;
}

/** Drops one import log entry. Its analysis is deleted separately, so a log
 * entry without an analysis can always be removed on its own. */
export function deleteImportRow(orgId: string, importId: string): boolean {
  return (db.query("DELETE FROM imports WHERE org_id = $o AND id = $i").run({ $o: orgId, $i: importId }).changes ?? 0) > 0;
}

export function itemDetailsFor(orgId: string, analysisId: string, skus: string[]): Array<{ sku: string; name: string; value: number }> {
  if (!skus.length) return [];
  const stmt = db.query(
    "SELECT sku, name, value FROM items WHERE org_id = $o AND analysis_id = $a AND sku = $s",
  );
  const rows: Array<{ sku: string; name: string; value: number }> = [];
  for (const sku of skus) {
    const row = stmt.get({ $o: orgId, $a: analysisId, $s: sku }) as { sku: string; name: string; value: number } | null;
    if (row) rows.push(row);
  }
  return rows;
}

export function deletedItemsLabel(orgId: string, analysisId: string, skus: string[]): number {
  if (!skus.length) return 0;
  const stmt = db.query("SELECT 1 FROM items WHERE org_id = $o AND analysis_id = $a AND sku = $s");
  return skus.reduce((sum, sku) => sum + (stmt.get({ $o: orgId, $a: analysisId, $s: sku }) ? 1 : 0), 0);
}

export function deleteItemRows(orgId: string, analysisId: string, skus: string[]): number {
  if (!skus.length) return 0;
  const stmt = db.query("DELETE FROM items WHERE org_id = $o AND analysis_id = $a AND sku = $s");
  let removed = 0;
  const tx = db.transaction(() => {
    for (const sku of skus) removed += stmt.run({ $o: orgId, $a: analysisId, $s: sku }).changes ?? 0;
  });
  tx();
  return removed;
}

export interface ItemQuery {
  q?: string;
  lang?: PopulatedLanguage;
  category?: string;
  supplier?: string;
  action?: string;
  abc?: string;
  xyz?: string;
  sort?: "value" | "name" | "stock" | "turns" | "margin" | "cover" | "priority" | "sold";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

const SORT_COLUMNS: Record<string, string> = {
  value: "value",
  name: "name",
  stock: "stock",
  turns: "turns",
  margin: "margin_pct",
  cover: "cover_days",
  priority: "priority",
  sold: "sold",
};

export function queryItems(orgId: string, analysisId: string, query: ItemQuery) {
  const where: string[] = ["org_id = $o", "analysis_id = $a"];
  const params: Record<string, string | number> = { $o: orgId, $a: analysisId };
  const qText = (query.q ?? "").trim().slice(0, 200);

  let rankSql = "";
  if (qText) {
    const lang = query.lang ?? "sv";
    const plan = planSearch(qText, lang);
    const direct = qText;
    const synonyms = [...plan.synonyms, ...plan.abbreviations];
    const translations = plan.translations;
    const variants = plan.variants;
    const categoryMatches = plan.categories;
    const all = [...new Set([direct, ...synonyms, ...translations, ...variants, ...categoryMatches])].filter(Boolean);
    const patternKeys = all.map((_, index) => `$q${index}`);
    all.forEach((term, index) => {
      params[`$q${index}`] = `%${term}%`;
    });
    params.$exact = direct;
    params.$prefix = `${direct}%`;
    params.$directLike = `%${direct}%`;
    const anyMatch = patternKeys
      .map((key) => `name LIKE ${key} OR sku LIKE ${key} OR category LIKE ${key}`)
      .join(" OR ");
    where.push(`(${anyMatch})`);
    const synonymConditions = synonyms
      .filter((term) => term.toLocaleLowerCase("sv-SE") !== direct.toLocaleLowerCase("sv-SE"))
      .map((term) => {
        const key = `$syn${params.__synCount = Number(params.__synCount ?? 0) + 1}`;
        params[key] = `%${term}%`;
        return `(name LIKE ${key} OR category LIKE ${key})`;
      })
      .join(" OR ");
    const translationConditions = translations
      .map((term) => {
        const key = `$tr${params.__trCount = Number(params.__trCount ?? 0) + 1}`;
        params[key] = `%${term}%`;
        return `(name LIKE ${key} OR category LIKE ${key})`;
      })
      .join(" OR ");
    const variantConditions = variants
      .map((term) => {
        const key = `$var${params.__varCount = Number(params.__varCount ?? 0) + 1}`;
        params[key] = `%${term}%`;
        return `(name LIKE ${key} OR category LIKE ${key})`;
      })
      .join(" OR ");
    const categoryConditions = categoryMatches
      .map((term) => {
        const key = `$catmatch${params.__catCount = Number(params.__catCount ?? 0) + 1}`;
        params[key] = term;
        return `category LIKE ${key}`;
      })
      .join(" OR ");
    rankSql = `CASE
      WHEN sku = $exact COLLATE NOCASE THEN 0
      WHEN name = $exact COLLATE NOCASE THEN 1
      WHEN sku LIKE $prefix THEN 2
      WHEN name LIKE $prefix THEN 3
      ${categoryConditions ? `WHEN (${categoryConditions}) THEN 4` : ""}
      WHEN name LIKE $directLike THEN 4
      WHEN category LIKE $directLike THEN 5
      ${variantConditions ? `WHEN (${variantConditions}) THEN 5` : ""}
      ${synonymConditions ? `WHEN (${synonymConditions}) THEN 6` : ""}
      ${translationConditions ? `WHEN (${translationConditions}) THEN 7` : ""}
      ELSE 8 END`;
    delete params.__synCount;
    delete params.__trCount;
    delete params.__varCount;
    delete params.__catCount;
  }
  if (query.category) {
    const candidates = categoryCandidates(query.category);
    where.push(`category IN (${candidates.map((_, i) => `$cat${i}`).join(", ")})`);
    candidates.forEach((value, i) => {
      params[`$cat${i}`] = value;
    });
  }
  if (query.supplier) {
    where.push("supplier = $sup");
    params.$sup = query.supplier;
  }
  if (query.action) {
    where.push("action = $act");
    params.$act = query.action;
  }
  if (query.abc) {
    where.push("abc = $abc");
    params.$abc = query.abc;
  }
  if (query.xyz) {
    where.push("xyz = $xyz");
    params.$xyz = query.xyz;
  }

  const order = SORT_COLUMNS[query.sort ?? "value"] ?? "value";
  const dir = query.dir === "asc" ? "ASC" : "DESC";
  const requestedPageSize = Number(query.pageSize ?? 50);
  const requestedPage = Number(query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, Number.isFinite(requestedPageSize) ? Math.floor(requestedPageSize) : 50));
  const page = Math.min(100_000, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));

  const whereSql = where.join(" AND ");
  const aggregate = db.query(`SELECT COUNT(*) AS c, COALESCE(SUM(value), 0) AS v FROM items WHERE ${whereSql}`).get(params) as { c: number; v: number };
  const total = aggregate.c;
  const totalValue = aggregate.v;

  const rows = db
    .query(
      `SELECT *${rankSql ? `, (${rankSql}) AS _rank` : ""} FROM items WHERE ${whereSql} ORDER BY ${
        rankSql ? "_rank ASC, " : ""
      }${order} ${dir} LIMIT $limit OFFSET $offset`,
    )
    .all({ ...params, $limit: pageSize, $offset: (page - 1) * pageSize }) as Array<Record<string, unknown>>;

  return { rows, total, totalValue, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function itemFacets(orgId: string, analysisId: string) {
  const categories = db
    .query("SELECT category AS key, COUNT(*) AS c, SUM(value) AS v FROM items WHERE org_id = $o AND analysis_id = $a AND category IS NOT NULL GROUP BY category ORDER BY v DESC LIMIT 30")
    .all({ $o: orgId, $a: analysisId }) as Array<{ key: string; c: number; v: number }>;
  const suppliers = db
    .query("SELECT supplier AS key, COUNT(*) AS c, SUM(value) AS v FROM items WHERE org_id = $o AND analysis_id = $a AND supplier IS NOT NULL GROUP BY supplier ORDER BY v DESC LIMIT 30")
    .all({ $o: orgId, $a: analysisId }) as Array<{ key: string; c: number; v: number }>;
  const actions = db
    .query("SELECT action AS key, COUNT(*) AS c, SUM(value) AS v FROM items WHERE org_id = $o AND analysis_id = $a GROUP BY action ORDER BY v DESC")
    .all({ $o: orgId, $a: analysisId }) as Array<{ key: string; c: number; v: number }>;
  return { categories, suppliers, actions };
}

export function getItem(orgId: string, analysisId: string, sku: string) {
  return (
    (db.query("SELECT * FROM items WHERE org_id = $o AND analysis_id = $a AND sku = $s").get({ $o: orgId, $a: analysisId, $s: sku }) as
      | Record<string, unknown>
      | null) ?? null
  );
}

/* ---------------------------------------------------------- usage counts */

export function analysesThisMonth(orgId: string): number {
  const start = new Date();
  const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)).toISOString();
  return (
    db
      .query("SELECT COUNT(*) AS c FROM analyses WHERE org_id = $o AND created_at >= $s AND status = 'ok'")
      .get({ $o: orgId, $s: first }) as { c: number }
  ).c;
}

export function copilotMessagesThisMonth(orgId: string): number {
  const start = new Date();
  const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)).toISOString();
  return (
    db
      .query(
        `SELECT COUNT(*) AS c FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.org_id = $o AND m.role = 'user' AND m.created_at >= $s`,
      )
      .get({ $o: orgId, $s: first }) as { c: number }
  ).c;
}

export function valueHistory(orgId: string, excludeId: string | null, limit = 24) {
  // Scan a generous window, then keep one point per calendar day. Several
  // imports on the same day describe the same business day, not extra months of
  // history; plotting each of them produced repeated dates on the trend.
  const scan = Math.max(limit * 8, 96);
  const rows = db
    .query(
      `SELECT created_at AS date, json_extract(summary_json, '$.inventoryValue') AS value
       FROM analyses
       WHERE org_id = $o AND status = 'ok' AND summary_json IS NOT NULL AND ($x IS NULL OR id != $x)
       ORDER BY created_at DESC LIMIT $l`,
    )
    .all({ $o: orgId, $x: excludeId, $l: scan }) as RawValuePoint[];
  return collapseDailyValues(rows, limit);
}

/* --------------------------------------------------------- pricing workspace */

export interface PricingProfileRecord {
  profile: PricingProfile;
  estimate: PriceEstimate;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function getPricingProfile(orgId: string): PricingProfileRecord | null {
  const row = db.query("SELECT * FROM pricing_profiles WHERE org_id = $o").get({ $o: orgId }) as
    | { org_id: string; profile_json: string; estimate_json: string; created_at: string; updated_at: string }
    | null;
  if (!row) return null;
  return {
    profile: parseJson<PricingProfile>(row.profile_json, {} as PricingProfile),
    estimate: parseJson<PriceEstimate>(row.estimate_json, {} as PriceEstimate),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function savePricingProfile(orgId: string, profile: PricingProfile, estimate: PriceEstimate): void {
  const timestamp = now();
  const existing = db.query("SELECT 1 FROM pricing_profiles WHERE org_id = $o").get({ $o: orgId });
  if (existing) {
    db.query("UPDATE pricing_profiles SET profile_json = $p, estimate_json = $e, updated_at = $t WHERE org_id = $o").run({
      $p: JSON.stringify(profile),
      $e: JSON.stringify(estimate),
      $t: timestamp,
      $o: orgId,
    });
    return;
  }
  db.query(
    `INSERT INTO pricing_profiles (org_id, profile_json, estimate_json, created_at, updated_at)
     VALUES ($o, $p, $e, $t, $t)`,
  ).run({ $o: orgId, $p: JSON.stringify(profile), $e: JSON.stringify(estimate), $t: timestamp });
}

export function getPricingRules(): PricingRules {
  const row = db.query("SELECT rules_json FROM pricing_rules WHERE id = 'default'").get() as { rules_json: string } | null;
  return sanitizeRules(parseJson<Partial<PricingRules>>(row?.rules_json, defaultPricingRules));
}

export function savePricingRules(rules: Partial<PricingRules>, userId: string | null): PricingRules {
  const clean = sanitizeRules(rules);
  const timestamp = now();
  const existing = db.query("SELECT 1 FROM pricing_rules WHERE id = 'default'").get();
  if (existing) {
    db.query("UPDATE pricing_rules SET rules_json = $r, updated_by = $u, updated_at = $t WHERE id = 'default'").run({
      $r: JSON.stringify(clean),
      $u: userId,
      $t: timestamp,
    });
  } else {
    db.query("INSERT INTO pricing_rules (id, rules_json, updated_by, updated_at) VALUES ('default', $r, $u, $t)").run({
      $r: JSON.stringify(clean),
      $u: userId,
      $t: timestamp,
    });
  }
  return clean;
}

export interface PricingQuoteRecord {
  id: string;
  org_id: string;
  user_id: string | null;
  profile_json: string;
  estimate_json: string;
  status: string;
  note: string | null;
  created_at: string;
}

export function createPricingQuote(input: {
  orgId: string;
  userId: string;
  profile: PricingProfile;
  estimate: PriceEstimate;
  status: "requested" | "accepted_pending_payment";
  note: string;
}): string {
  const id = randomUUID();
  db.query(
    `INSERT INTO pricing_quotes (id, org_id, user_id, profile_json, estimate_json, status, note, created_at)
     VALUES ($id, $o, $u, $p, $e, $s, $n, $t)`,
  ).run({
    $id: id,
    $o: input.orgId,
    $u: input.userId,
    $p: JSON.stringify(input.profile),
    $e: JSON.stringify(input.estimate),
    $s: input.status,
    $n: input.note,
    $t: now(),
  });
  return id;
}

export function latestPricingQuote(orgId: string): PricingQuoteRecord | null {
  return (
    (db.query("SELECT * FROM pricing_quotes WHERE org_id = $o ORDER BY created_at DESC LIMIT 1").get({ $o: orgId }) as PricingQuoteRecord | null) ??
    null
  );
}

export function listPricingQuotes(orgId: string, limit = 10): PricingQuoteRecord[] {
  return db
    .query("SELECT * FROM pricing_quotes WHERE org_id = $o ORDER BY created_at DESC LIMIT $l")
    .all({ $o: orgId, $l: limit }) as PricingQuoteRecord[];
}

export interface CommercialScenarioRecord {
  id: string;
  name: string;
  input_json: string;
  output_json: string;
  created_at: string;
}

export function saveCommercialScenario(input: {
  orgId: string;
  userId: string;
  name: string;
  assumptions: Record<string, number>;
  results: Record<string, number>;
}): string {
  const id = randomUUID();
  db.query(
    `INSERT INTO commercial_scenarios (id, org_id, user_id, name, input_json, output_json, created_at)
     VALUES ($id, $o, $u, $n, $i, $r, $t)`,
  ).run({
    $id: id,
    $o: input.orgId,
    $u: input.userId,
    $n: input.name,
    $i: JSON.stringify(input.assumptions),
    $r: JSON.stringify(input.results),
    $t: now(),
  });
  return id;
}

export function listCommercialScenarios(orgId: string, limit = 8): CommercialScenarioRecord[] {
  return db
    .query("SELECT id, name, input_json, output_json, created_at FROM commercial_scenarios WHERE org_id = $o ORDER BY created_at DESC LIMIT $l")
    .all({ $o: orgId, $l: limit }) as CommercialScenarioRecord[];
}
