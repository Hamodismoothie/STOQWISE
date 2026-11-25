/**
 * Privacy operations: complete organisation export and the two deletion paths.
 *
 * Export and deletion both cross almost every tenant table. Keeping the table
 * order here, next to the schema, means a new table is added in one place
 * instead of being forgotten by a route in `server.ts`.
 */
import { db } from "../db.ts";
import { audit } from "./repo.ts";

type Row = Record<string, any>;

const parseJson = (value: unknown): unknown => {
  if (typeof value !== "string" || value === "") return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const count = (sql: string, params: Record<string, string>): number =>
  (db.query(sql).get(params) as { c: number }).c;

/* ---------------------------------------------------------------- export */

export function buildOrganizationExport(orgId: string): Row {
  const org = db.query("SELECT * FROM organizations WHERE id = $o").get({ $o: orgId }) as Row | null;
  if (!org) throw new Error("organization_missing");

  const members = db
    .query(
      `SELECT m.user_id, u.email, u.name, u.status AS user_status, m.role, m.created_at
       FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $o ORDER BY m.created_at ASC, u.email ASC`,
    )
    .all({ $o: orgId }) as Row[];

  const invitations = db
    .query(
      `SELECT id, email, role, locale, expires_at, accepted_at, created_at
       FROM invitations WHERE org_id = $o ORDER BY created_at ASC, id ASC`,
    )
    .all({ $o: orgId }) as Row[];

  const analyses = (db
    .query("SELECT * FROM analyses WHERE org_id = $o ORDER BY created_at ASC, id ASC")
    .all({ $o: orgId }) as Row[]).map((analysis) => {
    const itemRows = db
      .query("SELECT * FROM items WHERE analysis_id = $a AND org_id = $o ORDER BY sku ASC")
      .all({ $a: analysis.id as string, $o: orgId }) as Row[];
    return {
      id: analysis.id,
      userId: analysis.user_id,
      filename: analysis.filename,
      status: analysis.status,
      rows: analysis.rows,
      warehouse: analysis.warehouse,
      source: analysis.source,
      periodMonths: analysis.period_months,
      error: analysis.error,
      createdAt: analysis.created_at,
      summary: parseJson(analysis.summary_json),
      result: parseJson(analysis.result_json),
      narrative: parseJson(analysis.narrative_json),
      input: parseJson(analysis.input_json),
      itemRows: itemRows.map((item) => ({
        sku: item.sku,
        name: item.name,
        category: item.category,
        supplier: item.supplier,
        warehouse: item.warehouse,
        stock: item.stock,
        cost: item.cost,
        price: item.price,
        value: item.value,
        sold: item.sold,
        revenue: item.revenue,
        profit: item.profit,
        marginPct: item.margin_pct,
        coverDays: item.cover_days,
        turns: item.turns,
        abc: item.abc,
        xyz: item.xyz,
        action: item.action,
        priority: item.priority,
        extra: parseJson(item.extra_json),
      })),
    };
  });

  const imports = (db
    .query("SELECT * FROM imports WHERE org_id = $o ORDER BY started_at ASC, id ASC")
    .all({ $o: orgId }) as Row[]).map((row) => ({
    id: row.id,
    analysisId: row.analysis_id,
    source: row.source,
    filename: row.filename,
    rows: row.rows,
    imported: row.imported,
    skipped: row.skipped,
    status: row.status,
    error: row.error,
    log: parseJson(row.log_json),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }));

  const scenarios = (db
    .query("SELECT * FROM scenarios WHERE org_id = $o ORDER BY created_at ASC, id ASC")
    .all({ $o: orgId }) as Row[]).map((row) => ({
    id: row.id,
    analysisId: row.analysis_id,
    name: row.name,
    input: parseJson(row.input_json),
    result: parseJson(row.result_json),
    createdAt: row.created_at,
  }));

  const savedViews = (db
    .query("SELECT * FROM saved_views WHERE org_id = $o ORDER BY created_at ASC, id ASC")
    .all({ $o: orgId }) as Row[]).map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    query: parseJson(row.query_json),
    createdAt: row.created_at,
  }));

  const conversationRows = db
    .query("SELECT * FROM conversations WHERE org_id = $o ORDER BY created_at ASC, id ASC")
    .all({ $o: orgId }) as Row[];
  const messageRows = db
    .query(
      `SELECT msg.* FROM messages msg
       JOIN conversations c ON c.id = msg.conversation_id
       WHERE c.org_id = $o ORDER BY msg.created_at ASC, msg.id ASC`,
    )
    .all({ $o: orgId }) as Row[];
  const messagesByConversation = new Map<string, Row[]>();
  for (const message of messageRows) {
    const list = messagesByConversation.get(message.conversation_id as string) ?? [];
    list.push(message);
    messagesByConversation.set(message.conversation_id as string, list);
  }
  const conversations = conversationRows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    analysisId: row.analysis_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: (messagesByConversation.get(row.id as string) ?? []).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      payload: parseJson(message.payload_json),
      createdAt: message.created_at,
    })),
  }));

  const apiKeys = (db
    .query(
      "SELECT id, name, prefix, scopes, last_used_at, revoked_at, created_at FROM api_keys WHERE org_id = $o ORDER BY created_at ASC, id ASC",
    )
    .all({ $o: orgId }) as Row[]).map((row) => ({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  }));

  const webhookRows = db
    .query("SELECT id, url, events, active, created_at FROM webhooks WHERE org_id = $o ORDER BY created_at ASC, id ASC")
    .all({ $o: orgId }) as Row[];
  const deliveryRows = db
    .query(
      `SELECT d.* FROM webhook_deliveries d
       JOIN webhooks w ON w.id = d.webhook_id
       WHERE w.org_id = $o ORDER BY d.created_at ASC, d.id ASC`,
    )
    .all({ $o: orgId }) as Row[];
  const deliveriesByWebhook = new Map<string, Row[]>();
  for (const delivery of deliveryRows) {
    const list = deliveriesByWebhook.get(delivery.webhook_id as string) ?? [];
    list.push(delivery);
    deliveriesByWebhook.set(delivery.webhook_id as string, list);
  }
  const webhooks = webhookRows.map((row) => ({
    id: row.id,
    url: row.url,
    events: row.events,
    active: Boolean(row.active),
    createdAt: row.created_at,
    deliveries: (deliveriesByWebhook.get(row.id as string) ?? []).map((delivery) => ({
      id: delivery.id,
      event: delivery.event,
      status: delivery.status,
      responseCode: delivery.response_code,
      attempts: delivery.attempts,
      error: delivery.error,
      createdAt: delivery.created_at,
    })),
  }));

  const syncSchedules = (db
    .query("SELECT * FROM sync_schedules WHERE org_id = $o ORDER BY created_at ASC, id ASC")
    .all({ $o: orgId }) as Row[]).map((row) => ({
    id: row.id,
    integrationId: row.integration_id,
    frequency: row.frequency,
    config: parseJson(row.config_json),
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status,
    active: Boolean(row.active),
    createdAt: row.created_at,
  }));

  const subscriptions = (db
    .query(
      "SELECT plan, status, seats, current_period_end, created_at, updated_at FROM subscriptions WHERE org_id = $o",
    )
    .all({ $o: orgId }) as Row[]).map((row) => ({
    plan: row.plan,
    status: row.status,
    seats: row.seats,
    currentPeriodEnd: row.current_period_end,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  const profile = db.query("SELECT * FROM pricing_profiles WHERE org_id = $o").get({ $o: orgId }) as Row | null;
  const pricingQuotes = (db
    .query("SELECT * FROM pricing_quotes WHERE org_id = $o ORDER BY created_at ASC, id ASC")
    .all({ $o: orgId }) as Row[]).map((row) => ({
    id: row.id,
    userId: row.user_id,
    profile: parseJson(row.profile_json),
    estimate: parseJson(row.estimate_json),
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
  }));
  const commercialScenarios = (db
    .query("SELECT * FROM commercial_scenarios WHERE org_id = $o ORDER BY created_at ASC, id ASC")
    .all({ $o: orgId }) as Row[]).map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    input: parseJson(row.input_json),
    output: parseJson(row.output_json),
    createdAt: row.created_at,
  }));

  const auditRows = (db
    .query(
      `SELECT a.id, a.user_id, u.email, a.action, a.target, a.ip, a.meta_json, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.org_id = $o ORDER BY a.id ASC`,
    )
    .all({ $o: orgId }) as Row[]).map((row) => ({
    id: row.id,
    userId: row.user_id,
    userEmail: row.email,
    action: row.action,
    target: row.target,
    ip: row.ip,
    meta: parseJson(row.meta_json),
    createdAt: row.created_at,
  }));

  const events = (db
    .query(
      `SELECT id, user_id, analysis_id, kind, message, created_at FROM events
       WHERE analysis_id IN (SELECT id FROM analyses WHERE org_id = $o) ORDER BY id ASC`,
    )
    .all({ $o: orgId }) as Row[]).map((row) => ({
    id: row.id,
    userId: row.user_id,
    analysisId: row.analysis_id,
    kind: row.kind,
    message: row.message,
    createdAt: row.created_at,
  }));

  return {
    format: "stoqwise-organization-export",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      plan: org.plan,
      trialEndsAt: org.trial_ends_at,
      trial: {
        endsAt: org.trial_ends_at,
        welcomeSentAt: org.trial_welcome_sent_at,
        midpointSentAt: org.trial_midpoint_sent_at,
        endingSentAt: org.trial_ending_sent_at,
        endedSentAt: org.trial_ended_sent_at,
      },
      settings: parseJson(org.settings_json),
      kind: org.kind,
      status: org.status,
      limits: parseJson(org.limits_json),
      createdAt: org.created_at,
    },
    counts: {
      members: members.length,
      invitations: invitations.length,
      analyses: analyses.length,
      itemRows: analyses.reduce((sum, analysis) => sum + analysis.itemRows.length, 0),
      imports: imports.length,
      scenarios: scenarios.length,
      savedViews: savedViews.length,
      conversations: conversations.length,
      messages: messageRows.length,
      apiKeys: apiKeys.length,
      webhooks: webhooks.length,
      webhookDeliveries: deliveryRows.length,
      syncSchedules: syncSchedules.length,
      subscriptions: subscriptions.length,
      pricingQuotes: pricingQuotes.length,
      commercialScenarios: commercialScenarios.length,
      audit: auditRows.length,
      events: events.length,
    },
    members,
    invitations,
    analyses,
    imports,
    scenarios,
    savedViews,
    conversations,
    apiKeys,
    webhooks,
    syncSchedules,
    subscriptions,
    pricing: {
      profile: profile
        ? {
            profile: parseJson(profile.profile_json),
            estimate: parseJson(profile.estimate_json),
            createdAt: profile.created_at,
            updatedAt: profile.updated_at,
          }
        : null,
      quotes: pricingQuotes,
      commercialScenarios,
    },
    audit: auditRows,
    events,
  };
}

/* ------------------------------------------------------------- deletion */

export interface OrganizationCounts {
  analyses: number;
  itemRows: number;
  members: number;
  invitations: number;
  imports: number;
  conversations: number;
  messages: number;
  scenarios: number;
  savedViews: number;
  apiKeys: number;
  webhooks: number;
  webhookDeliveries: number;
  syncSchedules: number;
  subscriptions: number;
  pricingQuotes: number;
  commercialScenarios: number;
  auditRows: number;
  events: number;
}

export interface OrganizationDeletionResult {
  counts: OrganizationCounts;
  actorHasOtherOrg: boolean;
}

export function organizationDeletionCounts(orgId: string): OrganizationCounts {
  return {
    analyses: count("SELECT COUNT(*) AS c FROM analyses WHERE org_id = $o", { $o: orgId }),
    itemRows: count("SELECT COUNT(*) AS c FROM items WHERE org_id = $o", { $o: orgId }),
    members: count("SELECT COUNT(*) AS c FROM members WHERE org_id = $o", { $o: orgId }),
    invitations: count("SELECT COUNT(*) AS c FROM invitations WHERE org_id = $o", { $o: orgId }),
    imports: count("SELECT COUNT(*) AS c FROM imports WHERE org_id = $o", { $o: orgId }),
    conversations: count("SELECT COUNT(*) AS c FROM conversations WHERE org_id = $o", { $o: orgId }),
    messages: count(
      "SELECT COUNT(*) AS c FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE org_id = $o)",
      { $o: orgId },
    ),
    scenarios: count("SELECT COUNT(*) AS c FROM scenarios WHERE org_id = $o", { $o: orgId }),
    savedViews: count("SELECT COUNT(*) AS c FROM saved_views WHERE org_id = $o", { $o: orgId }),
    apiKeys: count("SELECT COUNT(*) AS c FROM api_keys WHERE org_id = $o", { $o: orgId }),
    webhooks: count("SELECT COUNT(*) AS c FROM webhooks WHERE org_id = $o", { $o: orgId }),
    webhookDeliveries: count(
      "SELECT COUNT(*) AS c FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM webhooks WHERE org_id = $o)",
      { $o: orgId },
    ),
    syncSchedules: count("SELECT COUNT(*) AS c FROM sync_schedules WHERE org_id = $o", { $o: orgId }),
    subscriptions: count("SELECT COUNT(*) AS c FROM subscriptions WHERE org_id = $o", { $o: orgId }),
    pricingQuotes: count("SELECT COUNT(*) AS c FROM pricing_quotes WHERE org_id = $o", { $o: orgId }),
    commercialScenarios: count("SELECT COUNT(*) AS c FROM commercial_scenarios WHERE org_id = $o", { $o: orgId }),
    auditRows: count("SELECT COUNT(*) AS c FROM audit_log WHERE org_id = $o", { $o: orgId }),
    events: count(
      "SELECT COUNT(*) AS c FROM events WHERE analysis_id IN (SELECT id FROM analyses WHERE org_id = $o)",
      { $o: orgId },
    ),
  };
}

export function deleteOrganizationData(input: {
  orgId: string;
  actorUserId: string;
  actorIp: string;
  target: string;
}): OrganizationDeletionResult {
  const result = db.transaction(() => {
    const counts = organizationDeletionCounts(input.orgId);

    const actorHasOtherOrg = Boolean(
      db
        .query("SELECT 1 AS one FROM members WHERE user_id = $u AND org_id <> $o LIMIT 1")
        .get({ $u: input.actorUserId, $o: input.orgId }),
    );
    const memberIds = (db.query("SELECT user_id FROM members WHERE org_id = $o").all({ $o: input.orgId }) as Row[]).map(
      (row) => row.user_id as string,
    );

    // A member who only belonged to this organisation has nowhere to land after
    // deletion. Their account survives, but the session must not keep a stale
    // organisation context. The actor keeps the session so the account-deletion
    // page is reachable immediately afterwards.
    for (const userId of memberIds) {
      if (userId === input.actorUserId) continue;
      const hasOtherOrg = db
        .query("SELECT 1 AS one FROM members WHERE user_id = $u AND org_id <> $o LIMIT 1")
        .get({ $u: userId, $o: input.orgId });
      if (!hasOtherOrg) db.query("DELETE FROM sessions WHERE user_id = $u").run({ $u: userId });
    }

    db.query("DELETE FROM events WHERE analysis_id IN (SELECT id FROM analyses WHERE org_id = $o)").run({ $o: input.orgId });
    db.query("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE org_id = $o)").run({ $o: input.orgId });
    db.query("DELETE FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM webhooks WHERE org_id = $o)").run({ $o: input.orgId });
    db.query("DELETE FROM items WHERE org_id = $o").run({ $o: input.orgId });
    db.query("DELETE FROM analyses WHERE org_id = $o").run({ $o: input.orgId });
    db.query("DELETE FROM imports WHERE org_id = $o").run({ $o: input.orgId });
    db.query("DELETE FROM scenarios WHERE org_id = $o").run({ $o: input.orgId });
    db.query("DELETE FROM saved_views WHERE org_id = $o").run({ $o: input.orgId });
    db.query("DELETE FROM conversations WHERE org_id = $o").run({ $o: input.orgId });
    db.query("DELETE FROM commercial_scenarios WHERE org_id = $o").run({ $o: input.orgId });
    db.query("DELETE FROM pricing_quotes WHERE org_id = $o").run({ $o: input.orgId });
    db.query("DELETE FROM pricing_profiles WHERE org_id = $o").run({ $o: input.orgId });
    db.query("DELETE FROM subscriptions WHERE org_id = $o").run({ $o: input.orgId });
    db.query("DELETE FROM sync_schedules WHERE org_id = $o").run({ $o: input.orgId });
    db.query("DELETE FROM api_keys WHERE org_id = $o").run({ $o: input.orgId });
    db.query("DELETE FROM webhooks WHERE org_id = $o").run({ $o: input.orgId });
    db.query("DELETE FROM invitations WHERE org_id = $o").run({ $o: input.orgId });
    db.query("DELETE FROM members WHERE org_id = $o").run({ $o: input.orgId });
    db.query("DELETE FROM audit_log WHERE org_id = $o").run({ $o: input.orgId });
    db.query("DELETE FROM organizations WHERE id = $o").run({ $o: input.orgId });

    return { counts, actorHasOtherOrg };
  })();

  audit({
    orgId: null,
    userId: input.actorUserId,
    action: "organization.deleted",
    target: input.target,
    ip: input.actorIp,
    meta: result.counts,
  });
  return result;
}

export interface AccountMembershipSummary {
  orgId: string;
  orgName: string;
  role: string;
  ownerCount: number;
  soleOwner: boolean;
}

export interface AccountDeletionSummary {
  memberships: AccountMembershipSummary[];
  soleOwned: AccountMembershipSummary[];
  analyses: number;
  conversations: number;
  savedViews: number;
  sessions: number;
}

export function accountDeletionSummary(userId: string): AccountDeletionSummary {
  const memberships = (db
    .query(
      `SELECT o.id AS org_id, o.name AS org_name, m.role,
         (SELECT COUNT(*) FROM members owner WHERE owner.org_id = o.id AND owner.role = 'owner') AS owner_count
       FROM members m JOIN organizations o ON o.id = m.org_id
       WHERE m.user_id = $u ORDER BY m.created_at ASC, o.name ASC`,
    )
    .all({ $u: userId }) as Row[]).map((row) => {
    const ownerCount = Number(row.owner_count ?? 0);
    return {
      orgId: row.org_id as string,
      orgName: row.org_name as string,
      role: row.role as string,
      ownerCount,
      soleOwner: row.role === "owner" && ownerCount === 1,
    };
  });

  return {
    memberships,
    soleOwned: memberships.filter((membership) => membership.soleOwner),
    analyses: count("SELECT COUNT(*) AS c FROM analyses WHERE user_id = $u", { $u: userId }),
    conversations: count("SELECT COUNT(*) AS c FROM conversations WHERE user_id = $u", { $u: userId }),
    savedViews: count("SELECT COUNT(*) AS c FROM saved_views WHERE user_id = $u", { $u: userId }),
    sessions: count("SELECT COUNT(*) AS c FROM sessions WHERE user_id = $u", { $u: userId }),
  };
}

export interface AccountDeletionCounts {
  memberships: number;
  analysesReassigned: number;
  analysesDeleted: number;
  conversations: number;
  savedViews: number;
  mailRows: number;
}

export interface AccountDeletionResult {
  counts: AccountDeletionCounts;
}

/**
 * Deletes the account, not the organisations it belongs to. Analyses in an
 * organisation are reassigned to another active member so tenant data is not
 * destroyed as a side effect of a personal erasure request. A sole owner must
 * delete the organisation first; the caller renders that path explicitly.
 */
export function deleteAccount(input: { userId: string; email: string; actorIp: string }): AccountDeletionResult {
  const result = db.transaction(() => {
    const memberships = accountDeletionSummary(input.userId);
    if (memberships.soleOwned.length) throw new Error("sole_owner");

    const analysisOrgs = (db
      .query("SELECT DISTINCT org_id FROM analyses WHERE user_id = $u AND org_id IS NOT NULL")
      .all({ $u: input.userId }) as Row[]).map((row) => row.org_id as string);

    let analysesReassigned = 0;
    for (const orgId of analysisOrgs) {
      const recipient = db
        .query(
          `SELECT m.user_id FROM members m JOIN users u ON u.id = m.user_id
           WHERE m.org_id = $o AND m.user_id <> $u AND u.status = 'active'
           ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'analyst' THEN 2 ELSE 3 END,
                    m.created_at ASC LIMIT 1`,
        )
        .get({ $o: orgId, $u: input.userId }) as { user_id: string } | null;
      if (!recipient) throw new Error("no_recipient");
      const updated = db
        .query("UPDATE analyses SET user_id = $r WHERE org_id = $o AND user_id = $u")
        .run({ $r: recipient.user_id, $o: orgId, $u: input.userId });
      analysesReassigned += updated.changes;
    }

    const legacyAnalyses = (db
      .query("SELECT id FROM analyses WHERE user_id = $u AND org_id IS NULL")
      .all({ $u: input.userId }) as Row[]).map((row) => row.id as string);
    for (const analysisId of legacyAnalyses) {
      db.query(
        "DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE analysis_id = $a)",
      ).run({ $a: analysisId });
      db.query("DELETE FROM conversations WHERE analysis_id = $a").run({ $a: analysisId });
      db.query("DELETE FROM scenarios WHERE analysis_id = $a").run({ $a: analysisId });
      db.query("DELETE FROM imports WHERE analysis_id = $a").run({ $a: analysisId });
      db.query("DELETE FROM events WHERE analysis_id = $a").run({ $a: analysisId });
      db.query("DELETE FROM items WHERE analysis_id = $a").run({ $a: analysisId });
      db.query("DELETE FROM analyses WHERE id = $a AND user_id = $u").run({ $a: analysisId, $u: input.userId });
    }

    const counts: AccountDeletionCounts = {
      memberships: memberships.memberships.length,
      analysesReassigned,
      analysesDeleted: legacyAnalyses.length,
      conversations: memberships.conversations,
      savedViews: memberships.savedViews,
      mailRows: count("SELECT COUNT(*) AS c FROM mail_log WHERE lower(to_email) = lower($e)", { $e: input.email }),
    };

    db.query("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = $u)").run({ $u: input.userId });
    db.query("DELETE FROM conversations WHERE user_id = $u").run({ $u: input.userId });
    db.query("DELETE FROM saved_views WHERE user_id = $u").run({ $u: input.userId });
    db.query("UPDATE pricing_quotes SET user_id = NULL WHERE user_id = $u").run({ $u: input.userId });
    db.query("UPDATE commercial_scenarios SET user_id = NULL WHERE user_id = $u").run({ $u: input.userId });
    db.query("UPDATE audit_log SET user_id = NULL WHERE user_id = $u").run({ $u: input.userId });
    db.query("UPDATE events SET user_id = NULL WHERE user_id = $u").run({ $u: input.userId });
    db.query("DELETE FROM mail_log WHERE lower(to_email) = lower($e)").run({ $e: input.email });
    db.query("DELETE FROM members WHERE user_id = $u").run({ $u: input.userId });
    db.query("DELETE FROM sessions WHERE user_id = $u").run({ $u: input.userId });

    const remaining = count("SELECT COUNT(*) AS c FROM analyses WHERE user_id = $u", { $u: input.userId });
    if (remaining > 0) throw new Error("analyses_remaining");
    db.query("DELETE FROM users WHERE id = $u").run({ $u: input.userId });

    return { counts };
  })();

  audit({
    orgId: null,
    userId: null,
    action: "account.deleted",
    target: "self-service",
    ip: input.actorIp,
    meta: result.counts,
  });
  return result;
}