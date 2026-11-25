/**
 * Platform-wide administration queries.
 *
 * This module is server-only and is never imported by customer pages. Every
 * mutation is parameterised and the route layer checks the separate admin
 * session before calling it. Customer data is read for support purposes; it is
 * never returned through a customer-authenticated route.
 */
import { db } from "../db.ts";
import { isRole, planLimits, resetTrial, type PlanLimits, type Role } from "../data/repo.ts";
import { DAY_MS, trialEndIso } from "../trial-state.ts";

const now = (): string => new Date().toISOString();

export type PlatformSettingKey = "signups_enabled" | "imports_enabled" | "copilot_enabled" | "support_message";

const SETTING_DEFAULTS: Record<PlatformSettingKey, string> = {
  signups_enabled: "true",
  imports_enabled: "true",
  copilot_enabled: "true",
  support_message: "",
};

export function platformSettings(): Record<PlatformSettingKey, string> {
  const rows = db.query("SELECT key, value FROM platform_settings").all() as Array<{ key: string; value: string }>;
  const values = { ...SETTING_DEFAULTS };
  for (const row of rows) if (row.key in values) values[row.key as PlatformSettingKey] = row.value;
  return values;
}

export function settingEnabled(key: PlatformSettingKey): boolean {
  return platformSettings()[key] !== "false";
}

export function savePlatformSettings(input: Partial<Record<PlatformSettingKey, string>>, adminId: string): void {
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(input)) {
      if (!(key in SETTING_DEFAULTS)) continue;
      db.query(
        `INSERT INTO platform_settings (key, value, updated_at, updated_by)
         VALUES ($k, $v, $t, $a)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      ).run({ $k: key, $v: String(value), $t: now(), $a: adminId });
    }
  });
  tx();
}

export interface PlatformStats {
  users: number;
  activeUsers: number;
  suspendedUsers: number;
  organizations: number;
  testOrganizations: number;
  suspendedOrganizations: number;
  analyses: number;
  analysesThisMonth: number;
  failedAnalyses: number;
  items: number;
  imports: number;
  failedImports: number;
  openQuotes: number;
  activeTrials: number;
  trialsEndingSoon: number;
  readOnlyTrials: number;
  trialMailFailures24h: number;
  databaseMB: number;
  uptimeHours: number;
  heapMB: number;
}

export function platformStats(): PlatformStats {
  const count = (sql: string, params: Record<string, string | number> = {}): number =>
    (db.query(sql).get(params) as { c: number } | null)?.c ?? 0;
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const nowIso = now();
  const soonIso = new Date(Date.now() + 3 * DAY_MS).toISOString();
  const dayAgoIso = new Date(Date.now() - DAY_MS).toISOString();
  const page = db.query("PRAGMA page_count").get() as { page_count: number } | null;
  const size = db.query("PRAGMA page_size").get() as { page_size: number } | null;
  return {
    users: count("SELECT COUNT(*) AS c FROM users"),
    activeUsers: count("SELECT COUNT(*) AS c FROM users WHERE status = 'active'"),
    suspendedUsers: count("SELECT COUNT(*) AS c FROM users WHERE status = 'suspended'"),
    organizations: count("SELECT COUNT(*) AS c FROM organizations"),
    testOrganizations: count("SELECT COUNT(*) AS c FROM organizations WHERE kind = 'test'"),
    suspendedOrganizations: count("SELECT COUNT(*) AS c FROM organizations WHERE status = 'suspended'"),
    analyses: count("SELECT COUNT(*) AS c FROM analyses WHERE status = 'ok'"),
    analysesThisMonth: count("SELECT COUNT(*) AS c FROM analyses WHERE status = 'ok' AND created_at >= $s", { $s: monthStart }),
    failedAnalyses: count("SELECT COUNT(*) AS c FROM analyses WHERE status = 'failed'"),
    items: count("SELECT COUNT(*) AS c FROM items"),
    imports: count("SELECT COUNT(*) AS c FROM imports"),
    failedImports: count("SELECT COUNT(*) AS c FROM imports WHERE status = 'failed'"),
    openQuotes: count("SELECT COUNT(*) AS c FROM pricing_quotes WHERE status IN ('requested', 'accepted_pending_payment')"),
    activeTrials: count(
      "SELECT COUNT(*) AS c FROM organizations WHERE plan = 'trial' AND kind = 'customer' AND status = 'active' AND trial_ends_at > $n",
      { $n: nowIso },
    ),
    trialsEndingSoon: count(
      "SELECT COUNT(*) AS c FROM organizations WHERE plan = 'trial' AND kind = 'customer' AND status = 'active' AND trial_ends_at > $n AND trial_ends_at <= $s",
      { $n: nowIso, $s: soonIso },
    ),
    readOnlyTrials: count(
      "SELECT COUNT(*) AS c FROM organizations WHERE plan = 'trial' AND kind = 'customer' AND status = 'active' AND trial_ends_at <= $n",
      { $n: nowIso },
    ),
    trialMailFailures24h: count(
      "SELECT COUNT(*) AS c FROM mail_log WHERE kind LIKE 'trial_%' AND status = 'failed' AND created_at >= $d",
      { $d: dayAgoIso },
    ),
    databaseMB: Math.round((((page?.page_count ?? 0) * (size?.page_size ?? 0)) / 1024 / 1024) * 10) / 10,
    uptimeHours: Math.round((process.uptime() / 3600) * 10) / 10,
    heapMB: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10,
  };
}

export interface AdminTrialMailRow {
  created_at: string;
  kind: string;
  to_email: string;
  status: string;
  error: string | null;
}

/** Trial lifecycle mail is the conversion channel. Operators need to see it
 * without opening SQLite, especially when a provider rejects an address. */
export function recentTrialMails(limit = 12): AdminTrialMailRow[] {
  return db
    .query(
      `SELECT created_at, kind, to_email, status, error FROM mail_log
       WHERE kind LIKE 'trial_%' ORDER BY id DESC LIMIT $l`,
    )
    .all({ $l: limit }) as AdminTrialMailRow[];
}

export interface AdminPricingQuoteRow {
  id: string;
  org_id: string;
  org_name: string;
  org_plan: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  status: string;
  note: string | null;
  estimate_json: string;
  created_at: string;
}

/** Every request stays in the queue until an operator handles or activates it. */
export function listPricingQuotesForAdmin(limit = 100): AdminPricingQuoteRow[] {
  return db
    .query(
      `SELECT q.id, q.org_id, o.name AS org_name, o.plan AS org_plan,
        q.user_id, u.name AS user_name, u.email AS user_email,
        q.status, q.note, q.estimate_json, q.created_at
       FROM pricing_quotes q
       JOIN organizations o ON o.id = q.org_id
       LEFT JOIN users u ON u.id = q.user_id
       ORDER BY q.created_at DESC LIMIT $l`,
    )
    .all({ $l: limit }) as AdminPricingQuoteRow[];
}

export function updatePricingQuoteStatus(id: string, status: "handled" | "declined"): boolean {
  const result = db.query("UPDATE pricing_quotes SET status = $s WHERE id = $id").run({ $s: status, $id: id });
  return Number((result as { changes?: number }).changes ?? 0) > 0;
}

/** Clears the open requests for an organisation when its paid plan is switched on. */
export function activatePricingQuotesForOrg(orgId: string): number {
  const result = db
    .query("UPDATE pricing_quotes SET status = 'activated' WHERE org_id = $o AND status IN ('requested', 'accepted_pending_payment')")
    .run({ $o: orgId });
  return Number((result as { changes?: number }).changes ?? 0);
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  company: string | null;
  status: "active" | "suspended";
  created_at: string;
  org_id: string | null;
  org_name: string | null;
  plan: string | null;
  role: Role | null;
  org_count: number;
  analyses: number;
}

export function listAdminUsers(query = ""): AdminUserRow[] {
  const q = query.trim().slice(0, 120);
  const pattern = `%${q}%`;
  return db
    .query(
      `SELECT u.id, u.email, u.name, u.company, u.status, u.created_at,
        (SELECT o.id FROM members m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = u.id ORDER BY m.created_at ASC LIMIT 1) AS org_id,
        (SELECT o.name FROM members m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = u.id ORDER BY m.created_at ASC LIMIT 1) AS org_name,
        (SELECT o.plan FROM members m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = u.id ORDER BY m.created_at ASC LIMIT 1) AS plan,
        (SELECT m.role FROM members m WHERE m.user_id = u.id ORDER BY m.created_at ASC LIMIT 1) AS role,
        (SELECT COUNT(*) FROM members m WHERE m.user_id = u.id) AS org_count,
        (SELECT COUNT(*) FROM analyses a WHERE a.user_id = u.id AND a.status = 'ok') AS analyses
       FROM users u
       WHERE ($q = '' OR u.email LIKE $p OR u.name LIKE $p OR u.company LIKE $p)
       ORDER BY u.created_at DESC LIMIT 200`,
    )
    .all({ $q: q, $p: pattern }) as AdminUserRow[];
}

export function getAdminUser(id: string): AdminUserRow | null {
  const rows = listAdminUsers("");
  const direct = rows.find((row) => row.id === id);
  if (direct) return direct;
  return (db.query("SELECT id, email, name, company, status, created_at FROM users WHERE id = $id").get({ $id: id }) as AdminUserRow | null) ?? null;
}

export function setUserStatus(userId: string, status: "active" | "suspended"): void {
  db.query("UPDATE users SET status = $s WHERE id = $id").run({ $s: status, $id: userId });
  if (status === "suspended") db.query("DELETE FROM sessions WHERE user_id = $id").run({ $id: userId });
}

export function deleteUserSessions(userId: string): void {
  db.query("DELETE FROM sessions WHERE user_id = $id").run({ $id: userId });
}

export function userOrganizations(userId: string): Array<{ id: string; name: string; plan: string; kind: string; status: string; role: Role }> {
  return db
    .query(
      `SELECT o.id, o.name, o.plan, o.kind, o.status, m.role FROM members m
       JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $u ORDER BY m.created_at ASC`,
    )
    .all({ $u: userId }) as Array<{ id: string; name: string; plan: string; kind: string; status: string; role: Role }>;
}

export function userEvents(userId: string, limit = 30): Array<{ action: string; target: string | null; ip: string | null; created_at: string }> {
  return db
    .query("SELECT action, target, ip, created_at FROM audit_log WHERE user_id = $u ORDER BY id DESC LIMIT $l")
    .all({ $u: userId, $l: limit }) as Array<{ action: string; target: string | null; ip: string | null; created_at: string }>;
}

export interface AdminOrgRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  kind: "customer" | "test";
  status: "active" | "suspended";
  limits_json: string | null;
  created_at: string;
  trial_ends_at: string | null;
  trial_welcome_sent_at?: string | null;
  trial_midpoint_sent_at?: string | null;
  trial_ending_sent_at?: string | null;
  trial_ended_sent_at?: string | null;
  members: number;
  analyses: number;
  items: number;
  subscription_status: string | null;
  last_analysis_at: string | null;
}

export function listAdminOrganizations(query = ""): AdminOrgRow[] {
  const q = query.trim().slice(0, 120);
  return db
    .query(
      `SELECT o.id, o.name, o.slug, o.plan, o.kind, o.status, o.limits_json, o.created_at, o.trial_ends_at,
        (SELECT COUNT(*) FROM members m WHERE m.org_id = o.id) AS members,
        (SELECT COUNT(*) FROM analyses a WHERE a.org_id = o.id AND a.status = 'ok') AS analyses,
        (SELECT COUNT(*) FROM items i WHERE i.org_id = o.id) AS items,
        s.status AS subscription_status,
        (SELECT MAX(a.created_at) FROM analyses a WHERE a.org_id = o.id AND a.status = 'ok') AS last_analysis_at
       FROM organizations o LEFT JOIN subscriptions s ON s.org_id = o.id
       WHERE ($q = '' OR o.name LIKE $p OR o.slug LIKE $p OR o.id LIKE $p)
       ORDER BY o.created_at DESC LIMIT 200`,
    )
    .all({ $q: q, $p: `%${q}%` }) as AdminOrgRow[];
}

export function getAdminOrganization(id: string): AdminOrgRow | null {
  return (
    (db
      .query(
        `SELECT o.*, (SELECT COUNT(*) FROM members m WHERE m.org_id = o.id) AS members,
          (SELECT COUNT(*) FROM analyses a WHERE a.org_id = o.id AND a.status = 'ok') AS analyses,
          (SELECT COUNT(*) FROM items i WHERE i.org_id = o.id) AS items,
          s.status AS subscription_status,
          (SELECT MAX(a.created_at) FROM analyses a WHERE a.org_id = o.id AND a.status = 'ok') AS last_analysis_at
         FROM organizations o LEFT JOIN subscriptions s ON s.org_id = o.id WHERE o.id = $id`,
      )
      .get({ $id: id }) as AdminOrgRow | null) ?? null
  );
}

export function organizationMembers(orgId: string): Array<{ user_id: string; email: string; name: string; status: string; role: Role; created_at: string }> {
  return db
    .query(
      `SELECT m.user_id, u.email, u.name, u.status, m.role, m.created_at FROM members m
       JOIN users u ON u.id = m.user_id WHERE m.org_id = $o ORDER BY m.created_at ASC`,
    )
    .all({ $o: orgId }) as Array<{ user_id: string; email: string; name: string; status: string; role: Role; created_at: string }>;
}

export function organizationImports(orgId: string, limit = 20): Array<{ filename: string; status: string; rows: number; imported: number; error: string | null; started_at: string }> {
  return db
    .query("SELECT filename, status, rows, imported, error, started_at FROM imports WHERE org_id = $o ORDER BY started_at DESC LIMIT $l")
    .all({ $o: orgId, $l: limit }) as Array<{ filename: string; status: string; rows: number; imported: number; error: string | null; started_at: string }>;
}

export function recentPlatformImports(limit = 30): Array<{ id: string; organization: string; filename: string; status: string; rows: number; imported: number; error: string | null; started_at: string }> {
  return db
    .query(
      `SELECT i.id, o.name AS organization, i.filename, i.status, i.rows, i.imported, i.error, i.started_at
       FROM imports i JOIN organizations o ON o.id = i.org_id ORDER BY i.started_at DESC LIMIT $l`,
    )
    .all({ $l: limit }) as Array<{ id: string; organization: string; filename: string; status: string; rows: number; imported: number; error: string | null; started_at: string }>;
}

export function recentPlatformAnalyses(limit = 20): Array<{ id: string; organization: string; filename: string; rows: number; status: string; created_at: string }> {
  return db
    .query(
      `SELECT a.id, o.name AS organization, a.filename, a.rows, a.status, a.created_at
       FROM analyses a JOIN organizations o ON o.id = a.org_id ORDER BY a.created_at DESC LIMIT $l`,
    )
    .all({ $l: limit }) as Array<{ id: string; organization: string; filename: string; rows: number; status: string; created_at: string }>;
}

export function recentSecurityEvents(limit = 100): Array<{ source: string; action: string; actor: string | null; target: string | null; ip: string | null; created_at: string }> {
  return db
    .query(
      `SELECT * FROM (
         SELECT 'admin' AS source, a.action, COALESCE(ad.email, 'system') AS actor, a.target, a.ip, a.created_at
         FROM admin_audit a LEFT JOIN admin_users ad ON ad.id = a.admin_id
         UNION ALL
         SELECT 'customer' AS source, a.action, COALESCE(u.email, 'system') AS actor, a.target, a.ip, a.created_at
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ) ORDER BY created_at DESC LIMIT $l`,
    )
    .all({ $l: limit }) as Array<{ source: string; action: string; actor: string | null; target: string | null; ip: string | null; created_at: string }>;
}

export const assignablePlans = ["trial", "basic", "multi", "business", "enterprise"] as const;
export type AssignablePlan = (typeof assignablePlans)[number];

export function isAssignablePlan(value: string): value is AssignablePlan {
  return (assignablePlans as readonly string[]).includes(value);
}

export function updateOrganization(input: {
  orgId: string;
  name: string;
  plan: string;
  status: "active" | "suspended";
  limits: Partial<PlanLimits> | null;
}): boolean {
  if (!planLimits[input.plan]) return false;
  const tx = db.transaction(() => {
    const previous = db.query("SELECT plan FROM organizations WHERE id = $id").get({ $id: input.orgId }) as { plan: string } | null;
    db.query("UPDATE organizations SET name = $n, plan = $p, status = $s, limits_json = $l WHERE id = $id").run({
      $n: input.name.trim().slice(0, 160),
      $p: input.plan,
      $s: input.status,
      $l: input.limits ? JSON.stringify(input.limits) : null,
      $id: input.orgId,
    });
    if (input.plan === "trial" && previous?.plan !== "trial") {
      db.query(
        `UPDATE organizations
         SET trial_ends_at = $t, trial_welcome_sent_at = NULL, trial_midpoint_sent_at = NULL,
             trial_ending_sent_at = NULL, trial_ended_sent_at = NULL
         WHERE id = $id`,
      ).run({ $t: trialEndIso(), $id: input.orgId });
    }
    const existing = db.query("SELECT 1 FROM subscriptions WHERE org_id = $o").get({ $o: input.orgId });
    if (existing) {
      db.query("UPDATE subscriptions SET plan = $p, status = $s, updated_at = $t WHERE org_id = $o").run({
        $p: input.plan,
        $s: input.status === "suspended" ? "paused" : "active",
        $t: now(),
        $o: input.orgId,
      });
    } else {
      db.query(
        `INSERT INTO subscriptions (id, org_id, plan, status, seats, created_at, updated_at)
         VALUES ($id, $o, $p, $s, 1, $t, $t)`,
      ).run({ $id: crypto.randomUUID(), $o: input.orgId, $p: input.plan, $s: input.status === "suspended" ? "paused" : "active", $t: now() });
    }
  });
  tx();
  return true;
}

export function setMemberRoleByAdmin(orgId: string, userId: string, role: string): boolean {
  if (!isRole(role)) return false;
  db.query("UPDATE members SET role = $r WHERE org_id = $o AND user_id = $u").run({ $r: role, $o: orgId, $u: userId });
  return true;
}

export function setTestTenant(orgId: string, enabled: boolean): void {
  const tx = db.transaction(() => {
    if (enabled) {
      db.query("UPDATE organizations SET kind = 'test', plan = 'internal_test', status = 'active', limits_json = NULL WHERE id = $id").run({ $id: orgId });
      const existing = db.query("SELECT 1 FROM subscriptions WHERE org_id = $o").get({ $o: orgId });
      if (existing) db.query("UPDATE subscriptions SET plan = 'internal_test', status = 'internal', updated_at = $t WHERE org_id = $o").run({ $t: now(), $o: orgId });
      else db.query("INSERT INTO subscriptions (id, org_id, plan, status, seats, created_at, updated_at) VALUES ($id, $o, 'internal_test', 'internal', 1, $t, $t)").run({ $id: crypto.randomUUID(), $o: orgId, $t: now() });
    } else {
      db.query("UPDATE organizations SET kind = 'customer', plan = 'trial', status = 'active', limits_json = NULL WHERE id = $id").run({ $id: orgId });
      db.query("UPDATE subscriptions SET plan = 'trial', status = 'trialing', updated_at = $t WHERE org_id = $o").run({ $t: now(), $o: orgId });
      resetTrial(orgId);
    }
  });
  tx();
}
