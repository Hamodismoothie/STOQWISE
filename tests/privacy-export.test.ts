/**
 * Complete export and the two self-service deletion paths.
 *
 * The export is read through HTTP so the test sees the same file a customer
 * downloads. Deletion is checked both through the routes and in the database so
 * a redirect cannot hide half-deleted tenant data.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomBytes, scryptSync } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PORT = 3996;
const BASE = `http://localhost:${PORT}`;
const DB = join(ROOT, "data", "test-privacy.db");
const OWNER_EMAIL = "privacy-owner@test.se";
const OWNER_PASSWORD = "privacy-owner-password-2026";
const VIEWER_EMAIL = "privacy-viewer@test.se";
const VIEWER_PASSWORD = "privacy-viewer-password-2026";

let proc: ReturnType<typeof Bun.spawn> | null = null;
let db: Database | null = null;

const cookieFrom = (response: Response): string => (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

const passwordHash = (password: string): string => {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
};

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

function run(sql: string, params: Record<string, string | number | null> = {}): void {
  db!.query(sql).run(params);
}

beforeAll(async () => {
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${DB}${suffix}`, { force: true });

  proc = Bun.spawn([process.execPath, "src/server.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
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

  const deadline = Date.now() + 20_000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/halsa`)).ok) {
        up = true;
        break;
      }
    } catch {
      /* still starting */
    }
    await Bun.sleep(150);
  }
  if (!up) throw new Error("Servern startade inte inom 20 sekunder");
  db = new Database(DB);
});

afterAll(() => {
  db?.close();
  proc?.kill();
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${DB}${suffix}`, { force: true });
});

describe("dataexport och radering", () => {
  let ownerCookie = "";
  let viewerCookie = "";
  let ownerId = "";
  let viewerId = "";
  let orgId = "";

  test("förbereder en organisation med fullständig analysdata", async () => {
    const register = await post("/skapa-konto", {
      namn: "Privacy Ägare",
      foretag: "Privacybolaget AB",
      epost: OWNER_EMAIL,
      losenord: OWNER_PASSWORD,
      plan: "trial",
    }, "lr_lang=sv");
    expect(register.status).toBe(303);
    ownerCookie = cookieFrom(register);
    ownerId = rows<{ id: string }>("SELECT id FROM users WHERE email = $e", { $e: OWNER_EMAIL })[0]!.id;

    const profile = await post(
      "/start",
      {
        industry: "Retail",
        country: "SE",
        businessType: "Omnichannel",
        employees: "12",
        locations: "2",
        warehouses: "1",
        stores: "2",
        skus: "900",
        inventoryValue: "1200000",
        users: "3",
        support: "standard",
        billingCycle: "monthly",
      },
      ownerCookie,
    );
    expect(profile.status).toBe(303);
    orgId = rows<{ id: string }>("SELECT id FROM organizations WHERE name = 'Privacybolaget AB'")[0]!.id;

    viewerId = "privacy-viewer-id";
    run(
      `INSERT INTO users (id, email, password_hash, name, company, status, created_at)
       VALUES ($id, $e, $p, 'Privacy Granskare', 'Privacybolaget AB', 'active', $c)`,
      { $id: viewerId, $e: VIEWER_EMAIL, $p: passwordHash(VIEWER_PASSWORD), $c: new Date().toISOString() },
    );
    run("INSERT INTO members (org_id, user_id, role, created_at) VALUES ($o, $u, 'viewer', $c)", {
      $o: orgId,
      $u: viewerId,
      $c: new Date().toISOString(),
    });

    const now = new Date().toISOString();
    run(
      `INSERT INTO analyses (id, user_id, filename, status, rows, input_json, result_json, narrative_json, error, created_at, org_id, warehouse, source, period_months, summary_json)
       VALUES ('analysis-1', $u, 'lager.csv', 'ok', 2, $input, $result, $narrative, NULL, $c, $o, 'Huvudlager', 'csv', 12, $summary)`,
      {
        $u: ownerId,
        $input: JSON.stringify({ filename: "lager.csv", source: "csv" }),
        $result: JSON.stringify({ kpis: { skuCount: 2, inventoryValue: 1250 }, items: [{ sku: "A-1" }, { sku: "B-2" }] }),
        $narrative: JSON.stringify({ summary: "Två artiklar analyserade.", actions: ["Följ upp A-1"] }),
        $c: now,
        $o: orgId,
        $summary: JSON.stringify({ kpis: { skuCount: 2 } }),
      },
    );
    run(
      `INSERT INTO items (analysis_id, org_id, sku, name, category, supplier, warehouse, stock, cost, price, value, sold, revenue, profit, margin_pct, cover_days, turns, abc, xyz, action, priority, extra_json)
       VALUES ('analysis-1', $o, 'A-1', 'Artikel A', 'Kategori', 'Leverantör', 'Huvudlager', 10, 50, 80, 500, 30, 2400, 900, 37.5, 45, 10, 'A', 'X', 'Behåll', 0.9, $extra)`,
      { $o: orgId, $extra: JSON.stringify({ note: "full rad" }) },
    );
    run(
      `INSERT INTO items (analysis_id, org_id, sku, name, category, supplier, warehouse, stock, cost, price, value, sold, revenue, profit, margin_pct, cover_days, turns, abc, xyz, action, priority, extra_json)
       VALUES ('analysis-1', $o, 'B-2', 'Artikel B', NULL, NULL, 'Huvudlager', 5, 20, 30, 750, 10, 300, 100, 33.3, 60, 6, 'B', 'Y', 'Minska', 0.4, NULL)`,
      { $o: orgId },
    );
    run(
      `INSERT INTO imports (id, org_id, analysis_id, source, filename, rows, imported, skipped, status, error, log_json, started_at, finished_at)
       VALUES ('import-1', $o, 'analysis-1', 'csv', 'lager.csv', 2, 2, 0, 'ok', NULL, $log, $c, $c)`,
      { $o: orgId, $log: JSON.stringify({ rows: 2, warnings: [] }), $c: now },
    );
    run(
      `INSERT INTO scenarios (id, org_id, analysis_id, name, input_json, result_json, created_at)
       VALUES ('scenario-1', $o, 'analysis-1', 'Höjd service', $input, $result, $c)`,
      {
        $o: orgId,
        $input: JSON.stringify({ serviceLevel: 0.98 }),
        $result: JSON.stringify({ inventoryValue: 1500 }),
        $c: now,
      },
    );
    run(
      `INSERT INTO saved_views (id, org_id, user_id, name, query_json, created_at)
       VALUES ('view-1', $o, $u, 'Kritiska A', $query, $c)`,
      { $o: orgId, $u: ownerId, $query: JSON.stringify({ abc: "A", action: "Behåll" }), $c: now },
    );
    run(
      `INSERT INTO conversations (id, org_id, user_id, analysis_id, title, created_at, updated_at)
       VALUES ('conversation-1', $o, $u, 'analysis-1', 'Fråga om A-1', $c, $c)`,
      { $o: orgId, $u: ownerId, $c: now },
    );
    run(
      `INSERT INTO messages (id, conversation_id, role, content, payload_json, created_at)
       VALUES ('message-1', 'conversation-1', 'user', 'Varför ligger A-1 högt?', $payload, $c)`,
      { $payload: JSON.stringify({ analysisId: "analysis-1" }), $c: now },
    );
    run(
      `INSERT INTO api_keys (id, org_id, name, prefix, key_hash, scopes, created_at)
       VALUES ('key-1', $o, 'Testnyckel', 'sq_test', 'hemlig-hash', 'read', $c)`,
      { $o: orgId, $c: now },
    );
    run(
      `INSERT INTO webhooks (id, org_id, url, secret, events, active, created_at)
       VALUES ('webhook-1', $o, 'https://example.test/hook', 'hemlig-hemlighet', 'analysis.completed', 1, $c)`,
      { $o: orgId, $c: now },
    );
    run(
      `INSERT INTO webhook_deliveries (webhook_id, event, status, response_code, attempts, error, created_at)
       VALUES ('webhook-1', 'analysis.completed', 'ok', 200, 1, NULL, $c)`,
      { $c: now },
    );
    run(
      `INSERT INTO sync_schedules (id, org_id, integration_id, frequency, config_json, next_run_at, last_run_at, last_status, active, created_at)
       VALUES ('sync-1', $o, 'fortnox', 'daily', $config, $c, NULL, 'ok', 1, $c)`,
      { $o: orgId, $config: JSON.stringify({ warehouse: "Huvudlager" }), $c: now },
    );
    run(
      `INSERT OR REPLACE INTO pricing_profiles (org_id, profile_json, estimate_json, created_at, updated_at)
       VALUES ($o, $profile, $estimate, $c, $c)`,
      {
        $o: orgId,
        $profile: JSON.stringify({ industry: "Retail", users: 3 }),
        $estimate: JSON.stringify({ monthlySek: 4900 }),
        $c: now,
      },
    );
    run(
      `INSERT INTO pricing_quotes (id, org_id, user_id, profile_json, estimate_json, status, note, created_at)
       VALUES ('quote-1', $o, $u, $profile, $estimate, 'requested', 'Vill börja i januari.', $c)`,
      {
        $o: orgId,
        $u: ownerId,
        $profile: JSON.stringify({ industry: "Retail" }),
        $estimate: JSON.stringify({ monthlySek: 4900 }),
        $c: now,
      },
    );
    run(
      `INSERT INTO commercial_scenarios (id, org_id, user_id, name, input_json, output_json, created_at)
       VALUES ('commercial-1', $o, $u, 'Tillväxt', $input, $output, $c)`,
      {
        $o: orgId,
        $u: ownerId,
        $input: JSON.stringify({ growth: 0.1 }),
        $output: JSON.stringify({ monthlySek: 5390 }),
        $c: now,
      },
    );
    run("UPDATE subscriptions SET stripe_customer_id = 'cus_hemlig', stripe_subscription_id = 'sub_hemlig' WHERE org_id = $o", { $o: orgId });
    run(
      `INSERT INTO invitations (id, org_id, email, role, token_hash, expires_at, accepted_at, created_at, locale)
       VALUES ('invite-1', $o, 'ny@test.se', 'analyst', 'hemlig-token', $x, NULL, $c, 'sv')`,
      { $o: orgId, $x: new Date(Date.now() + 86400_000).toISOString(), $c: now },
    );
    run(
      `INSERT INTO audit_log (org_id, user_id, action, target, ip, meta_json, created_at)
       VALUES ($o, $u, 'analysis.created', 'analysis-1', '127.0.0.1', $meta, $c)`,
      { $o: orgId, $u: ownerId, $meta: JSON.stringify({ items: 2 }), $c: now },
    );
    run(
      `INSERT INTO events (user_id, analysis_id, kind, message, created_at)
       VALUES ($u, 'analysis-1', 'analysis.completed', 'Klart', $c)`,
      { $u: ownerId, $c: now },
    );
  });

  test("exporten innehåller fullständiga analysresultat och artikelrader", async () => {
    const response = await get("/app/export", ownerCookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("stoqwise-export-privacybolaget-ab-");
    const payload = (await response.json()) as any;

    expect(payload.format).toBe("stoqwise-organization-export");
    expect(payload.organization.name).toBe("Privacybolaget AB");
    expect(payload.members).toHaveLength(2);
    expect(payload.analyses).toHaveLength(1);
    expect(payload.analyses[0].result.kpis.skuCount).toBe(2);
    expect(payload.analyses[0].result.items).toHaveLength(2);
    expect(payload.analyses[0].narrative.summary).toBe("Två artiklar analyserade.");
    expect(payload.analyses[0].input.filename).toBe("lager.csv");
    expect(payload.analyses[0].summary.kpis.skuCount).toBe(2);
    expect(payload.analyses[0].itemRows).toHaveLength(2);
    expect(payload.analyses[0].itemRows[0].sku).toBe("A-1");
    expect(payload.analyses[0].itemRows[0].extra.note).toBe("full rad");
    expect(payload.imports[0].log.rows).toBe(2);
    expect(payload.scenarios[0].input.serviceLevel).toBe(0.98);
    expect(payload.savedViews[0].query.abc).toBe("A");
    expect(payload.conversations[0].messages[0].content).toBe("Varför ligger A-1 högt?");
    expect(payload.apiKeys[0].name).toBe("Testnyckel");
    expect(payload.apiKeys[0].key_hash).toBeUndefined();
    expect(payload.webhooks[0].url).toBe("https://example.test/hook");
    expect(payload.webhooks[0].secret).toBeUndefined();
    expect(payload.webhooks[0].deliveries).toHaveLength(1);
    expect(payload.syncSchedules[0].integrationId).toBe("fortnox");
    expect(payload.subscriptions[0].stripe_customer_id).toBeUndefined();
    expect(payload.subscriptions[0].stripe_subscription_id).toBeUndefined();
    expect(payload.pricing.profile.estimate.monthlySek).toBe(4900);
    expect(payload.pricing.quotes[0].note).toBe("Vill börja i januari.");
    expect(payload.pricing.commercialScenarios[0].name).toBe("Tillväxt");
    expect(payload.audit.some((entry: any) => entry.action === "analysis.created")).toBe(true);
    expect(payload.events[0].kind).toBe("analysis.completed");
    expect(payload.counts.itemRows).toBe(2);
    expect(JSON.stringify(payload)).not.toContain("hemlig-hash");
    expect(JSON.stringify(payload)).not.toContain("hemlig-hemlighet");
    expect(JSON.stringify(payload)).not.toContain("hemlig-token");
  });

  test("endast ägare får öppna raderingen av organisationen", async () => {
    const login = await post("/logga-in", { epost: VIEWER_EMAIL, losenord: VIEWER_PASSWORD });
    expect(login.status).toBe(303);
    viewerCookie = cookieFrom(login);

    const response = await get(`/app/radera/organisation?org=${encodeURIComponent(orgId)}`, viewerCookie);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Endast ägare kan radera organisationen");
  });

  test("ett medlemskonto kan raderas och analyser flyttas till en annan medlem", async () => {
    const now = new Date().toISOString();
    run(
      `INSERT INTO analyses (id, user_id, filename, status, rows, input_json, result_json, narrative_json, error, created_at, org_id, warehouse, source, period_months, summary_json)
       VALUES ('analysis-viewer', $u, 'granskning.csv', 'ok', 1, $input, $result, NULL, NULL, $c, $o, 'Huvudlager', 'csv', 12, NULL)`,
      {
        $u: viewerId,
        $input: JSON.stringify({ filename: "granskning.csv" }),
        $result: JSON.stringify({ kpis: { skuCount: 1 } }),
        $c: now,
        $o: orgId,
      },
    );
    run(
      `INSERT INTO items (analysis_id, org_id, sku, name, warehouse, stock, cost, value, sold, revenue, profit, turns, priority)
       VALUES ('analysis-viewer', $o, 'V-1', 'Artikel V', 'Huvudlager', 1, 10, 10, 0, 0, 0, 0, 0)`,
      { $o: orgId },
    );

    const page = await get("/app/radera/konto", viewerCookie);
    expect(page.status).toBe(200);
    expect(await page.text()).not.toContain("ensam ägare");

    const deleted = await post(
      "/app/radera/konto",
      { forstaatt: "ja", bekrafta: VIEWER_EMAIL, losenord: VIEWER_PASSWORD },
      viewerCookie,
    );
    expect(deleted.status).toBe(303);
    expect(deleted.headers.get("location")).toBe("/logga-in?raderad=konto");
    expect(rows<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE id = $u", { $u: viewerId })[0]!.c).toBe(0);
    expect(rows<{ c: number }>("SELECT COUNT(*) AS c FROM members WHERE user_id = $u", { $u: viewerId })[0]!.c).toBe(0);

    const moved = rows<{ user_id: string }>("SELECT user_id FROM analyses WHERE id = 'analysis-viewer'")[0]!;
    expect(moved.user_id).toBe(ownerId);
    expect(rows<{ c: number }>("SELECT COUNT(*) AS c FROM items WHERE analysis_id = 'analysis-viewer'")[0]!.c).toBe(1);
  });

  test("kontot blockeras när användaren är ensam ägare", async () => {
    const page = await get("/app/radera/konto", ownerCookie);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("ensam ägare");
    expect(html).toContain(`/app/radera/organisation?org=${encodeURIComponent(orgId)}`);

    const attempt = await post(
      "/app/radera/konto",
      { forstaatt: "ja", bekrafta: OWNER_EMAIL, losenord: OWNER_PASSWORD },
      ownerCookie,
    );
    expect(attempt.status).toBe(303);
    expect(attempt.headers.get("location")).toContain("/app/radera/konto?fel=");
    expect(rows<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE id = $u", { $u: ownerId })[0]!.c).toBe(1);
  });

  test("fel namn eller lösenord raderar inte organisationen", async () => {
    const page = await get(`/app/radera/organisation?org=${encodeURIComponent(orgId)}`, ownerCookie);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Privacybolaget AB");

    const wrongName = await post(
      "/app/radera/organisation",
      { org: orgId, forstaatt: "ja", bekrafta: "Fel namn", losenord: OWNER_PASSWORD },
      ownerCookie,
    );
    expect(wrongName.status).toBe(303);
    expect(rows<{ c: number }>("SELECT COUNT(*) AS c FROM organizations WHERE id = $o", { $o: orgId })[0]!.c).toBe(1);

    const wrongPassword = await post(
      "/app/radera/organisation",
      { org: orgId, forstaatt: "ja", bekrafta: "Privacybolaget AB", losenord: "fel-losenord" },
      ownerCookie,
    );
    expect(wrongPassword.status).toBe(303);
    expect(rows<{ c: number }>("SELECT COUNT(*) AS c FROM organizations WHERE id = $o", { $o: orgId })[0]!.c).toBe(1);
  });

  test("organisationen raderas i alla tenant-tabeller", async () => {
    const response = await post(
      "/app/radera/organisation",
      { org: orgId, forstaatt: "ja", bekrafta: "Privacybolaget AB", losenord: OWNER_PASSWORD },
      ownerCookie,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/app/radera/konto?meddelande=");

    const forbidden = [
      "organizations",
      "members",
      "invitations",
      "analyses",
      "items",
      "imports",
      "scenarios",
      "saved_views",
      "conversations",
      "api_keys",
      "webhooks",
      "sync_schedules",
      "subscriptions",
      "pricing_profiles",
      "pricing_quotes",
      "commercial_scenarios",
    ];
    for (const table of forbidden) {
      const key = table === "organizations" ? "id" : "org_id";
      const value = rows<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table} WHERE ${key} = $o`, { $o: orgId })[0]!.c;
      expect(value).toBe(0);
    }
    expect(rows<{ c: number }>("SELECT COUNT(*) AS c FROM messages")[0]!.c).toBe(0);
    expect(rows<{ c: number }>("SELECT COUNT(*) AS c FROM webhook_deliveries")[0]!.c).toBe(0);
    expect(rows<{ c: number }>("SELECT COUNT(*) AS c FROM events")[0]!.c).toBe(0);

    const deletionAudit = rows<{ org_id: string | null; action: string; target: string }>(
      "SELECT org_id, action, target FROM audit_log WHERE action = 'organization.deleted'",
    );
    expect(deletionAudit).toHaveLength(1);
    expect(deletionAudit[0]!.org_id).toBeNull();
    expect(deletionAudit[0]!.target).toBe("Privacybolaget AB");
    expect(rows<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE id = $u", { $u: ownerId })[0]!.c).toBe(1);
  });

  test("kontot kan raderas när organisationen är borta", async () => {
    const page = await get("/app/radera/konto", ownerCookie);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Skriv din e-postadress");

    const wrong = await post(
      "/app/radera/konto",
      { forstaatt: "ja", bekrafta: OWNER_EMAIL, losenord: "fel-losenord" },
      ownerCookie,
    );
    expect(wrong.status).toBe(303);
    expect(rows<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE id = $u", { $u: ownerId })[0]!.c).toBe(1);

    const deleted = await post(
      "/app/radera/konto",
      { forstaatt: "ja", bekrafta: OWNER_EMAIL, losenord: OWNER_PASSWORD },
      ownerCookie,
    );
    expect(deleted.status).toBe(303);
    expect(deleted.headers.get("location")).toBe("/logga-in?raderad=konto");
    expect(deleted.headers.get("set-cookie")).toContain("lr_session=");
    expect(rows<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE id = $u", { $u: ownerId })[0]!.c).toBe(0);
    expect(rows<{ c: number }>("SELECT COUNT(*) AS c FROM sessions WHERE user_id = $u", { $u: ownerId })[0]!.c).toBe(0);
    expect(rows<{ c: number }>("SELECT COUNT(*) AS c FROM mail_log WHERE lower(to_email) = lower($e)", { $e: OWNER_EMAIL })[0]!.c).toBe(0);
    expect(rows<{ c: number }>("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'account.deleted'")[0]!.c).toBe(2);

    const login = await get("/logga-in?raderad=konto");
    expect(login.status).toBe(200);
    expect(await login.text()).toMatch(/Your account and its personal data have been deleted|Ditt konto och dess personuppgifter är raderade/);
  });
});
