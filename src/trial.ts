/**
 * Trial lifecycle. One sweep drives welcome, halfway, final reminder and the
 * read-only notice. Each step is claimed in the database before it is sent, so
 * a restart or two overlapping ticks cannot mail the same step twice.
 */
import { db } from "./db.ts";
import { config } from "./config.ts";
import {
  sendMail,
  trialEndedMail,
  trialEndingMail,
  trialMidpointMail,
  trialWelcomeMail,
} from "./mail.ts";
import { DAY_MS, trialState, type TrialState } from "./trial-state.ts";
import { contentLocale, resolveLocale } from "./i18n.ts";

type Stage = "welcome" | "midpoint" | "ending" | "ended";

interface TrialOrgRow {
  org_id: string;
  org_name: string;
  org_locale: string | null;
  plan: string;
  trial_ends_at: string | null;
  trial_welcome_sent_at: string | null;
  trial_midpoint_sent_at: string | null;
  trial_ending_sent_at: string | null;
  trial_ended_sent_at: string | null;
}

interface OwnerRow extends TrialOrgRow {
  email: string;
  name: string;
  user_locale: string | null;
}

const STAGE_COLUMN: Record<Stage, string> = {
  welcome: "trial_welcome_sent_at",
  midpoint: "trial_midpoint_sent_at",
  ending: "trial_ending_sent_at",
  ended: "trial_ended_sent_at",
};

/** A late first sweep should send the current stage, not a burst of every
 * stage it missed. Earlier markers are filled with the same timestamp so a
 * later tick cannot send them out of order. */
const EARLIER_STAGES: Record<Stage, Stage[]> = {
  welcome: [],
  midpoint: ["welcome"],
  ending: ["welcome", "midpoint"],
  ended: ["welcome", "midpoint", "ending"],
};

const TRIAL_OWNERS_SQL = `SELECT o.id AS org_id, o.name AS org_name, o.locale AS org_locale, o.plan, o.trial_ends_at,
    o.trial_welcome_sent_at, o.trial_midpoint_sent_at, o.trial_ending_sent_at, o.trial_ended_sent_at,
    u.email, u.name, u.locale AS user_locale
  FROM organizations o
  JOIN members m ON m.org_id = o.id AND m.role = 'owner'
  JOIN users u ON u.id = m.user_id AND u.status = 'active'
  WHERE o.plan = 'trial' AND o.kind = 'customer' AND o.status = 'active'`;

function trialOwners(orgId?: string): OwnerRow[] {
  const scope = orgId ? " AND o.id = $o" : "";
  const order = orgId ? "m.created_at ASC" : "o.created_at ASC, m.created_at ASC";
  const query = db.query(`${TRIAL_OWNERS_SQL}${scope} ORDER BY ${order}`);
  return (orgId ? query.all({ $o: orgId }) : query.all()) as OwnerRow[];
}

let running = false;

function claim(orgId: string, stage: Stage, at: string): boolean {
  const column = STAGE_COLUMN[stage];
  const result = db
    .query(`UPDATE organizations SET ${column} = $t WHERE id = $o AND ${column} IS NULL`)
    .run({ $t: at, $o: orgId });
  return result.changes === 1;
}

function release(orgId: string, stage: Stage, at: string): void {
  const column = STAGE_COLUMN[stage];
  db.query(`UPDATE organizations SET ${column} = NULL WHERE id = $o AND ${column} = $t`).run({ $t: at, $o: orgId });
}

function markEarlier(orgId: string, stage: Stage, at: string): void {
  for (const earlier of EARLIER_STAGES[stage]) {
    const column = STAGE_COLUMN[earlier];
    db.query(`UPDATE organizations SET ${column} = COALESCE(${column}, $t) WHERE id = $o`).run({ $t: at, $o: orgId });
  }
}

function dueStage(row: TrialOrgRow, state: TrialState, nowMs: number): Stage | null {
  if (!state.endsAtMs) return null;
  if (state.ended) return row.trial_ended_sent_at ? null : "ended";
  if (!row.trial_ending_sent_at && nowMs >= state.endsAtMs - 2 * DAY_MS) return "ending";
  if (!row.trial_midpoint_sent_at && nowMs >= state.endsAtMs - 7 * DAY_MS) return "midpoint";
  return row.trial_welcome_sent_at ? null : "welcome";
}

function messageFor(stage: Stage, org: TrialOrgRow, owner: OwnerRow, state: TrialState) {
  const appUrl = `${config.appOrigin}/app`;
  const quoteUrl = `${config.appOrigin}/app/prisestimat`;
  const trialEndsAt = org.trial_ends_at!;
  const locale = contentLocale(
    resolveLocale({ userLocale: owner.user_locale, orgLocale: org.org_locale, fallback: "sv" }),
  );
  if (stage === "welcome") {
    return trialWelcomeMail({ name: owner.name, orgName: org.org_name, trialEndsAt, appUrl, quoteUrl, locale });
  }
  if (stage === "midpoint") {
    return trialMidpointMail({ name: owner.name, orgName: org.org_name, trialEndsAt, daysLeft: state.daysLeft, appUrl, quoteUrl, locale });
  }
  if (stage === "ending") {
    return trialEndingMail({ name: owner.name, orgName: org.org_name, trialEndsAt, daysLeft: state.daysLeft, appUrl, quoteUrl, locale });
  }
  return trialEndedMail({
    name: owner.name,
    orgName: org.org_name,
    trialEndsAt,
    appUrl,
    exportUrl: `${config.appOrigin}/app/export`,
    quoteUrl,
    locale,
  });
}

async function sendStage(org: TrialOrgRow, owners: OwnerRow[], stage: Stage, state: TrialState, now: Date): Promise<boolean> {
  if (!owners.length) return false;
  const at = now.toISOString();
  if (!claim(org.org_id, stage, at)) return false;

  const results = await Promise.all(
    owners.map((owner) =>
      sendMail({
        to: owner.email,
        ...messageFor(stage, org, owner, state),
      }),
    ),
  );
  if (results.every((result) => result.status === "failed")) {
    release(org.org_id, stage, at);
    return false;
  }
  markEarlier(org.org_id, stage, at);
  return true;
}

/** Runs one idempotent pass over every customer trial. */
export async function runTrialLifecycle(now = new Date()): Promise<{ sent: number; organizations: number }> {
  if (running) return { sent: 0, organizations: 0 };
  running = true;
  try {
    const rows = trialOwners();

    const grouped = new Map<string, OwnerRow[]>();
    for (const row of rows) {
      const list = grouped.get(row.org_id) ?? [];
      list.push(row);
      grouped.set(row.org_id, list);
    }

    let sent = 0;
    for (const owners of grouped.values()) {
      const org = owners[0]!;
      const state = trialState({ plan: org.plan, trial_ends_at: org.trial_ends_at }, now.getTime());
      const stage = dueStage(org, state, now.getTime());
      if (stage && (await sendStage(org, owners, stage, state, now))) sent++;
    }
    return { sent, organizations: grouped.size };
  } finally {
    running = false;
  }
}

/** Immediate welcome after sign-up, without waiting for the hourly sweep. */
export async function sendTrialWelcomeForOrg(orgId: string, now = new Date()): Promise<boolean> {
  const owners = trialOwners(orgId);
  if (!owners.length) return false;
  const org = owners[0]!;
  const state = trialState({ plan: org.plan, trial_ends_at: org.trial_ends_at }, now.getTime());
  if (state.ended || !state.endsAtMs) return false;
  return sendStage(org, owners, "welcome", state, now);
}