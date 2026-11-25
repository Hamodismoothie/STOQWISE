/**
 * Quote and activation loop.
 *
 * Runs against a real server and a throwaway database. Mail is in outbox mode,
 * so the test reads the exact messages a customer and an operator would get.
 * The admin queue is exercised through the separate admin session, not by
 * importing route internals.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PORT = 3995;
const BASE = `http://localhost:${PORT}`;
const DB = join(ROOT, "data", "test-quotes.db");
const SETUP_TOKEN = "quote-test-setup-token-0123456789";
const ADMIN_EMAIL = "quote-admin@stoqwise.test";
const ADMIN_PASSWORD = "quote-admin-password-2026";
const CUSTOMER_EMAIL = "quote-owner@test.se";
const CUSTOMER_PASSWORD = "quote-customer-password-2026";

let proc: ReturnType<typeof Bun.spawn> | null = null;
let db: Database | null = null;

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

function rows<T>(sql: string, params: Record<string, string | number> = {}): T[] {
  return db!.query(sql).all(params) as T[];
}

async function waitFor<T>(read: () => T | undefined, label: string, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = read();
    if (found) return found;
    await Bun.sleep(50);
  }
  throw new Error(`Saknar ${label} inom ${timeoutMs} ms`);
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
      ADMIN_SETUP_TOKEN: SETUP_TOKEN,
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

describe("offert- och aktiveringsloopen", () => {
  let customerCookie = "";
  let adminCookie = "";
  let orgId = "";

  test("en offertförfrågan notifierar både kunden och den interna adressen", async () => {
    const register = await post("/skapa-konto", {
      namn: "Offertägare",
      foretag: "Offertbolaget AB",
      epost: CUSTOMER_EMAIL,
      losenord: CUSTOMER_PASSWORD,
      plan: "trial",
    }, "lr_lang=sv");
    expect(register.status).toBe(303);
    customerCookie = cookieFrom(register);

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
      customerCookie,
    );
    expect(profile.status).toBe(303);
    orgId = rows<{ id: string }>("SELECT id FROM organizations WHERE name = 'Offertbolaget AB'")[0]!.id;

    const quote = await post("/app/prisestimat/offert", { note: "Vi vill börja i januari." }, customerCookie);
    expect(quote.status).toBe(303);

    const customerMail = await waitFor(
      () => rows<{ to_email: string; body: string; status: string }>("SELECT to_email, body, status FROM mail_log WHERE kind = 'quote_confirmation' ORDER BY id DESC LIMIT 1")[0],
      "kundbekräftelse",
    );
    expect(customerMail.to_email).toBe(CUSTOMER_EMAIL);
    expect(customerMail.status).toBe("outbox");
    expect(customerMail.body).toContain("Vi har tagit emot din offertförfrågan");
    expect(customerMail.body).toContain("Ingen betalning har dragits");

    const internalMail = await waitFor(
      () => rows<{ to_email: string; body: string; status: string }>("SELECT to_email, body, status FROM mail_log WHERE kind = 'quote_requested' ORDER BY id DESC LIMIT 1")[0],
      "intern offertnotis",
    );
    expect(internalMail.to_email).toBe("inbox@test.se");
    expect(internalMail.status).toBe("outbox");
    expect(internalMail.body).toContain("Offertbolaget AB");
    expect(internalMail.body).toContain(CUSTOMER_EMAIL);
    expect(internalMail.body).toContain("Vi vill börja i januari.");
    expect(internalMail.body).toContain(`${BASE}/admin/offerter`);

    const stored = rows<{ status: string }>("SELECT status FROM pricing_quotes WHERE org_id = $o", { $o: orgId })[0]!;
    expect(stored.status).toBe("requested");
  });

  test("admin initieras och ser offerten i kön", async () => {
    const init = await post("/admin/init", {
      token: SETUP_TOKEN,
      namn: "Offertadmin",
      epost: ADMIN_EMAIL,
      losenord: ADMIN_PASSWORD,
      losenord2: ADMIN_PASSWORD,
    });
    expect(init.status).toBe(303);
    adminCookie = cookieFrom(init);
    expect(adminCookie).toContain("sq_admin=");

    const queue = await get("/admin/offerter", adminCookie);
    expect(queue.status).toBe(200);
    const body = await queue.text();
    expect(body).toContain("Offertkö");
    expect(body).toContain("Offertbolaget AB");
    expect(body).toContain(CUSTOMER_EMAIL);
    expect(body).toContain("Vi vill börja i januari.");
    expect(body).toContain("Offert begärd");
  });

  test("en aktiveringsbegäran notifierar båda parter och syns som aktivering", async () => {
    const activation = await post("/app/prisestimat/acceptera", { confirm: "yes" }, customerCookie);
    expect(activation.status).toBe(303);

    const customerMail = await waitFor(
      () => rows<{ to_email: string; body: string }>("SELECT to_email, body FROM mail_log WHERE kind = 'activation_confirmation' ORDER BY id DESC LIMIT 1")[0],
      "kundbekräftelse för aktivering",
    );
    expect(customerMail.to_email).toBe(CUSTOMER_EMAIL);
    expect(customerMail.body).toContain("Vi har tagit emot din begäran om att aktivera");
    expect(customerMail.body).toContain("Ingen betalning har dragits");

    const internalMail = await waitFor(
      () => rows<{ to_email: string; body: string }>("SELECT to_email, body FROM mail_log WHERE kind = 'activation_requested' ORDER BY id DESC LIMIT 1")[0],
      "intern aktiveringsnotis",
    );
    expect(internalMail.to_email).toBe("inbox@test.se");
    expect(internalMail.body).toContain("Avtal och betalning krävs");
    expect(internalMail.body).toContain(`${BASE}/admin/organisationer/${orgId}`);

    const queue = await get("/admin/offerter", adminCookie);
    expect(queue.status).toBe(200);
    const body = await queue.text();
    expect(body).toContain("Aktivering begärd");
    expect(body).toContain("Aktivera plan");
  });

  test("aktiverad plan skickar välkomstmejl och rensar kön", async () => {
    const update = await post(
      `/admin/organisationer/${orgId}`,
      {
        namn: "Offertbolaget AB",
        plan: "basic",
        status: "active",
        maxSkus: "10000",
        maxUsers: "3",
        maxAnalysesPerMonth: "10",
        copilotPerMonth: "200",
        apiAccess: "1",
        simulation: "1",
      },
      adminCookie,
    );
    expect(update.status).toBe(303);

    const welcome = await waitFor(
      () => rows<{ to_email: string; body: string; status: string }>("SELECT to_email, body, status FROM mail_log WHERE kind = 'plan_activated' ORDER BY id DESC LIMIT 1")[0],
      "välkomstmejl",
    );
    expect(welcome.to_email).toBe(CUSTOMER_EMAIL);
    expect(welcome.status).toBe("outbox");
    expect(welcome.body).toContain("Planen Starter är nu aktiverad");
    expect(welcome.body).toMatch(/2\s490 kr per månad/);
    expect(welcome.body).toContain(`${BASE}/app`);
    expect(welcome.body).toContain(`${BASE}/kontakt`);

    const org = rows<{ plan: string }>("SELECT plan FROM organizations WHERE id = $id", { $id: orgId })[0]!;
    expect(org.plan).toBe("basic");
    const quote = rows<{ status: string }>("SELECT status FROM pricing_quotes WHERE org_id = $o ORDER BY id DESC LIMIT 1", { $o: orgId })[0]!;
    expect(quote.status).toBe("activated");

    const queue = await get("/admin/offerter", adminCookie);
    const body = await queue.text();
    expect(body).toContain("Aktiverad");

    // A later edit of the same paid plan must not send another welcome mail.
    const before = rows<{ c: number }>("SELECT COUNT(*) AS c FROM mail_log WHERE kind = 'plan_activated'")[0]!.c;
    const edit = await post(
      `/admin/organisationer/${orgId}`,
      {
        namn: "Offertbolaget AB",
        plan: "basic",
        status: "active",
        maxSkus: "10000",
        maxUsers: "3",
        maxAnalysesPerMonth: "10",
        copilotPerMonth: "200",
        apiAccess: "1",
        simulation: "1",
      },
      adminCookie,
    );
    expect(edit.status).toBe(303);
    await Bun.sleep(150);
    expect(rows<{ c: number }>("SELECT COUNT(*) AS c FROM mail_log WHERE kind = 'plan_activated'")[0]!.c).toBe(before);
  });
});
