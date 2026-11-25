/**
 * Trial lifecycle and read-only mode.
 *
 * The database is seeded before the server starts, so the boot sweep is the
 * actual sender. A second server is then started on the same database to prove
 * the mail markers are idempotent, not just written once by accident.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "../src/data/migrate.ts";
import { trialEndedMail, trialEndingMail, trialMidpointMail, trialWelcomeMail } from "../src/mail.ts";
import { trialState } from "../src/trial-state.ts";

const ROOT = join(import.meta.dir, "..");
const PORT = 3997;
const PORT2 = 3998;
const BASE = `http://localhost:${PORT}`;
const DB = join(ROOT, "data", "test-trial.db");
const PASSWORD = "trial-password-2026";
const API_KEY = "lr_write_trial_ended_test";

let proc: ReturnType<typeof Bun.spawn> | null = null;
let proc2: ReturnType<typeof Bun.spawn> | null = null;
let db: Database | null = null;

const hash = (password: string): string => {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
};

const cookieFrom = (response: Response): string => (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

async function get(path: string, cookie = ""): Promise<Response> {
  return fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
}

async function post(path: string, fields: Record<string, string>, cookie = ""): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: BASE, cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

function rows<T>(sql: string, params: Record<string, string | number | null> = {}): T[] {
  return db!.query(sql).all(params) as T[];
}

async function waitFor<T>(read: () => T | undefined, label: string, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = read();
    if (found) return found;
    await Bun.sleep(50);
  }
  throw new Error(`Saknar ${label} inom ${timeoutMs} ms`);
}

async function waitForServer(port: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://localhost:${port}/halsa`)).ok) return;
    } catch {
      /* still starting */
    }
    await Bun.sleep(100);
  }
  throw new Error(`Servern på ${port} startade inte`);
}

function startServer(port: number): ReturnType<typeof Bun.spawn> {
  return Bun.spawn([process.execPath, "src/server.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: DB,
      NODE_ENV: "test",
      RESEND_API_KEY: "",
      MAIL_FROM: "",
      MAIL_NOTIFY: "inbox@test.se",
      BRAND_EMAIL_DOMAIN: "",
    },
    stdout: "ignore",
    stderr: "pipe",
  });
}

function seed(): void {
  const now = Date.now();
  const iso = (offsetMs: number): string => new Date(now + offsetMs).toISOString();
  const day = 86_400_000;
  const orgs = [
    { id: "trial-welcome", name: "Welcome Trial AB", email: "welcome@test.se", ends: iso(13 * day), created: iso(0), welcome: null, midpoint: null, ending: null, ended: null },
    { id: "trial-midpoint", name: "Midpoint Trial AB", email: "midpoint@test.se", ends: iso(5 * day), created: iso(-9 * day), welcome: iso(-9 * day), midpoint: null, ending: null, ended: null },
    { id: "trial-ending", name: "Ending Trial AB", email: "ending@test.se", ends: iso(1 * day), created: iso(-13 * day), welcome: iso(-13 * day), midpoint: iso(-6 * day), ending: null, ended: null },
    { id: "trial-late", name: "Late Trial AB", email: "late@test.se", ends: iso(1 * day), created: iso(-13 * day), welcome: null, midpoint: null, ending: null, ended: null },
    { id: "trial-ended", name: "Ended Trial AB", email: "ended@test.se", ends: iso(-60 * 60_000), created: iso(-14 * day), welcome: iso(-14 * day), midpoint: iso(-7 * day), ending: iso(-2 * day), ended: null },
  ];
  const userPassword = hash(PASSWORD);
  for (const org of orgs) {
    db!.query(
      `INSERT INTO users (id, email, password_hash, name, company, status, created_at)
       VALUES ($id, $email, $password, $name, $company, 'active', $created)`,
    ).run({ $id: `user-${org.id}`, $email: org.email, $password: userPassword, $name: `Owner ${org.name}`, $company: org.name, $created: org.created });
    db!.query(
      `INSERT INTO organizations (id, name, slug, plan, trial_ends_at, settings_json, kind, status, limits_json, created_at,
         trial_welcome_sent_at, trial_midpoint_sent_at, trial_ending_sent_at, trial_ended_sent_at)
       VALUES ($id, $name, $slug, 'trial', $ends, NULL, 'customer', 'active', NULL, $created, $welcome, $midpoint, $ending, $ended)`,
    ).run({
      $id: org.id,
      $name: org.name,
      $slug: org.id,
      $ends: org.ends,
      $created: org.created,
      $welcome: org.welcome,
      $midpoint: org.midpoint,
      $ending: org.ending,
      $ended: org.ended,
    });
    db!.query("INSERT INTO members (org_id, user_id, role, created_at) VALUES ($org, $user, 'owner', $created)").run({
      $org: org.id,
      $user: `user-${org.id}`,
      $created: org.created,
    });
    db!.query(
      `INSERT INTO subscriptions (id, org_id, plan, status, seats, created_at, updated_at)
       VALUES ($id, $org, 'trial', 'trialing', 1, $created, $created)`,
    ).run({ $id: `sub-${org.id}`, $org: org.id, $created: org.created });
  }
  db!.query(
    `INSERT INTO api_keys (id, org_id, name, prefix, key_hash, scopes, created_at)
     VALUES ('key-trial-ended', 'trial-ended', 'Test', 'lr_write_', $hash, 'write', $created)`,
  ).run({ $hash: createHash("sha256").update(API_KEY).digest("hex"), $created: iso(-day) });
}

beforeAll(async () => {
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${DB}${suffix}`, { force: true });
  db = new Database(DB);
  migrate(db);
  seed();
  proc = startServer(PORT);
  await waitForServer(PORT);
});

afterAll(async () => {
  proc?.kill();
  await proc?.exited;
  proc2?.kill();
  await proc2?.exited;
  db?.close();
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${DB}${suffix}`, { force: true });
});

describe("provperiodens livscykel", () => {
  test("välkomst, halvtid, slutspurt och avslut mejlas exakt en gång", async () => {
    const expected = [
      { kind: "trial_welcome", email: "welcome@test.se", phrase: "Provperioden för Welcome Trial AB är igång", count: 1 },
      { kind: "trial_midpoint", email: "midpoint@test.se", phrase: "Halva provperioden för Midpoint Trial AB", count: 1 },
      { kind: "trial_ending", email: "ending@test.se", phrase: "Provperioden för Ending Trial AB slutar", count: 2 },
      { kind: "trial_ended", email: "ended@test.se", phrase: "Provperioden för Ended Trial AB tog slut", count: 1 },
    ] as const;

    for (const { kind, email, phrase, count } of expected) {
      const mail = await waitFor(
        () =>
          rows<{ body: string; status: string }>("SELECT body, status FROM mail_log WHERE kind = $k AND to_email = $e ORDER BY id DESC LIMIT 1", {
            $k: kind,
            $e: email,
          })[0],
        kind,
      );
      expect(mail.status).toBe("outbox");
      expect(mail.body).toContain(phrase);
      await waitFor(
        () =>
          rows<{ c: number }>("SELECT COUNT(*) AS c FROM mail_log WHERE kind = $k", { $k: kind })[0]!.c === count ? true : undefined,
        `${kind} count`,
      );
      expect(rows<{ c: number }>("SELECT COUNT(*) AS c FROM mail_log WHERE kind = $k", { $k: kind })[0]!.c).toBe(count);
    }

    const lateEnding = await waitFor(
      () =>
        rows<{ body: string }>("SELECT body FROM mail_log WHERE kind = 'trial_ending' AND to_email = 'late@test.se' LIMIT 1")[0],
      "late ending mail",
    );
    expect(lateEnding.body).toContain("Provperioden för Late Trial AB slutar");
    expect(
      rows<{ c: number }>("SELECT COUNT(*) AS c FROM mail_log WHERE to_email = 'late@test.se' AND kind IN ('trial_welcome', 'trial_midpoint')")[0]!.c,
    ).toBe(0);
    const lateMarkers = rows<{ trial_welcome_sent_at: string | null; trial_midpoint_sent_at: string | null; trial_ending_sent_at: string | null }>(
      "SELECT trial_welcome_sent_at, trial_midpoint_sent_at, trial_ending_sent_at FROM organizations WHERE id = 'trial-late'",
    )[0]!;
    expect(lateMarkers.trial_welcome_sent_at).not.toBeNull();
    expect(lateMarkers.trial_midpoint_sent_at).not.toBeNull();
    expect(lateMarkers.trial_ending_sent_at).not.toBeNull();

    const endedMail = rows<{ body: string }>("SELECT body FROM mail_log WHERE kind = 'trial_ended'")[0]!;
    expect(endedMail.body).toContain("/app/export");
    expect(endedMail.body).toContain("läsbart läge");

    for (const orgId of ["trial-welcome", "trial-midpoint", "trial-ending", "trial-late", "trial-ended"]) {
      const row = rows<{ trial_welcome_sent_at: string | null; trial_midpoint_sent_at: string | null; trial_ending_sent_at: string | null; trial_ended_sent_at: string | null }>(
        "SELECT trial_welcome_sent_at, trial_midpoint_sent_at, trial_ending_sent_at, trial_ended_sent_at FROM organizations WHERE id = $o",
        { $o: orgId },
      )[0]!;
      expect(Boolean(row.trial_welcome_sent_at || row.trial_midpoint_sent_at || row.trial_ending_sent_at || row.trial_ended_sent_at)).toBe(true);
    }
  });

  test("en andra serverinstans skickar inga dubbletter", async () => {
    const before = rows<{ kind: string; c: number }>("SELECT kind, COUNT(*) AS c FROM mail_log GROUP BY kind ORDER BY kind");
    proc2 = startServer(PORT2);
    await waitForServer(PORT2);
    await Bun.sleep(800);
    const after = rows<{ kind: string; c: number }>("SELECT kind, COUNT(*) AS c FROM mail_log GROUP BY kind ORDER BY kind");
    expect(after).toEqual(before);
    proc2.kill();
    await proc2.exited;
    proc2 = null;
  });

  test("aktiv provperiod visar banner med dagar kvar", async () => {
    const login = await post("/logga-in", { epost: "welcome@test.se", losenord: PASSWORD });
    expect(login.status).toBe(303);
    const cookie = `${cookieFrom(login)}; lr_lang=sv`;
    const page = await get("/app", cookie);
    expect(page.status).toBe(200);
    const body = await page.text();
    expect(body).toContain("Provperiod:");
    expect(body).toContain("dagar kvar");
    expect(body).toContain("Begär offert");
    expect(body).toContain("Kom igång med din första analys");

    const subscription = await get("/app/abonnemang", cookie);
    expect(subscription.status).toBe(200);
    const subscriptionBody = await subscription.text();
    expect(subscriptionBody).toContain("Provperiod");
    expect(subscriptionBody).toContain("Dagar kvar");
    expect(subscriptionBody).toContain("Exportera data");
  });

  test("avslutad provperiod är läsbar, inte raderad", async () => {
    const login = await post("/logga-in", { epost: "ended@test.se", losenord: PASSWORD });
    expect(login.status).toBe(303);
    const cookie = `${cookieFrom(login)}; lr_lang=sv`;

    const dashboard = await get("/app", cookie);
    expect(dashboard.status).toBe(200);
    const body = await dashboard.text();
    expect(body).toContain("Provperioden har tagit slut.");
    expect(body).toContain("läsbart läge");

    expect((await get("/app/importera", cookie)).status).toBe(200);
    expect((await get("/app/export", cookie)).status).toBe(200);
    expect((await get("/app/radera/konto", cookie)).status).toBe(200);

    const importAttempt = await post("/app/importera", {}, cookie);
    expect(importAttempt.status).toBe(403);
    expect(await importAttempt.text()).toContain("läsbart läge");

    const settingsAttempt = await post("/app/installningar", { namn: "Ended Trial AB" }, cookie);
    expect(settingsAttempt.status).toBe(403);
    expect(await settingsAttempt.text()).toContain("läsbart läge");

    const apiMe = await fetch(`${BASE}/api/v1/me`, { headers: { authorization: `Bearer ${API_KEY}` } });
    expect(apiMe.status).toBe(200);
    const apiPayload = (await apiMe.json()) as { readOnly: boolean; trial: { ended: boolean } };
    expect(apiPayload.readOnly).toBe(true);
    expect(apiPayload.trial.ended).toBe(true);

    const apiWrite = await fetch(`${BASE}/api/v1/analyses`, {
      method: "POST",
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(apiWrite.status).toBe(403);
    expect(((await apiWrite.json()) as { error: string }).error).toBe("trial_ended");

    expect(rows<{ c: number }>("SELECT COUNT(*) AS c FROM organizations WHERE id = 'trial-ended'")[0]!.c).toBe(1);
  });

  test("livscykelmejlen följer engelsk locale", () => {
    const common = {
      name: "English Owner",
      orgName: "English Trial AB",
      trialEndsAt: "2026-12-01T12:00:00.000Z",
      appUrl: "https://example.test/app",
      quoteUrl: "https://example.test/app/prisestimat",
      locale: "en" as const,
    };
    const welcome = trialWelcomeMail(common);
    expect(welcome.text).toContain("You have 14 days");
    expect(welcome.locale).toBe("en");
    expect(trialMidpointMail({ ...common, daysLeft: 7 }).subject).toContain("Half of the trial");
    expect(trialMidpointMail({ ...common, daysLeft: 1 }).text).toContain("1 day left");
    expect(trialEndingMail({ ...common, daysLeft: 2 }).subject).toContain("2 days left");
    expect(trialEndingMail({ ...common, daysLeft: 1 }).subject).toBe("1 day left of the trial");
    expect(trialEndingMail({ ...common, daysLeft: 1, locale: "sv" }).subject).toBe("1 dag kvar av provperioden");
    const ended = trialEndedMail({ ...common, exportUrl: "https://example.test/app/export" });
    expect(ended.subject).toContain("Your trial has ended");
    expect(ended.text).toContain("read-only mode");
    expect(ended.text).toContain("/app/export");
    expect(ended.locale).toBe("en");
  });

  test("trialstatus räknas från slutdatumet, inte från plansträngen", () => {
    const now = Date.now();
    expect(trialState({ plan: "trial", trial_ends_at: new Date(now + 86_400_000).toISOString() }, now)).toMatchObject({
      isTrial: true,
      ended: false,
      daysLeft: 1,
    });
    expect(trialState({ plan: "trial", trial_ends_at: new Date(now - 1).toISOString() }, now)).toMatchObject({
      isTrial: true,
      ended: true,
      daysLeft: 0,
    });
    expect(trialState({ plan: "basic", trial_ends_at: new Date(now - 1).toISOString() }, now).ended).toBe(false);
  });
});
