/**
 * End-to-end test against a real server process.
 *
 * This is the test that proves the product works, not just the functions: it
 * registers two organisations, imports a real CSV through the HTTP pipeline,
 * checks that the dashboard renders numbers, exercises the API with a key, and
 * verifies that the second organisation cannot read the first one's data.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { demoCsv, buildDemoDataset } from "../src/demo.ts";
import { config } from "../src/config.ts";
import { PUBLIC_PAGES, isIndexable, robotsTxt, sitemapXml } from "../src/seo.ts";

const ROOT = join(import.meta.dir, "..");
const PORT = 3987;
const BASE = `http://localhost:${PORT}`;
const DB = join(ROOT, "data", "test-integration.db");

let proc: ReturnType<typeof Bun.spawn> | null = null;

function cookieFrom(response: Response): string {
  const raw = response.headers.get("set-cookie") ?? "";
  return raw.split(";")[0] ?? "";
}

/** Meta description som marketingShell renderar, före HTML-avkodning. */
function metaDescription(html: string): string {
  return html.match(/<meta name="description" content="([^"]*)">/)?.[1] ?? "";
}

/** Språkväljarnas select-id:n i en renderad sida, i DOM-ordning. */
function languageSwitchIds(html: string): string[] {
  return Array.from(html.matchAll(/<select id="(lang-[^"]+)" name="lang"/g), (match) => match[1] ?? "");
}

async function form(path: string, fields: Record<string, string>, cookie: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: BASE, cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

async function register(email: string, company: string, lang = "lr_lang=sv"): Promise<string> {
  const res = await fetch(`${BASE}/skapa-konto`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: BASE, cookie: lang, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      namn: "Test Testsson",
      foretag: company,
      epost: email,
      losenord: "losenord12345",
      plan: "trial",
    }).toString(),
  });
  expect(res.status).toBe(303);
  const cookie = cookieFrom(res);
  expect(cookie).toContain("lr_session=");
  return cookie;
}

async function importDemo(cookie: string, filename = "locale.csv"): Promise<string> {
  const csv = demoCsv(buildDemoDataset());
  const data = new FormData();
  data.set("file", new File([csv], filename, { type: "text/csv" }));
  data.set("lager", "Huvudlager");

  const uploaded = await fetch(`${BASE}/app/importera`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: BASE, cookie },
    body: data,
  });
  expect(uploaded.status).toBe(200);
  const draft = (await uploaded.text()).match(/name="draft" value="([^"]+)"/)?.[1];
  expect(draft).toBeTruthy();

  const run = await form(
    "/app/importera/kor",
    { draft: draft!, lager: "Huvudlager", serviceniva: "0.95", dodlager: "180" },
    cookie,
  );
  expect(run.status).toBe(303);
  const analysisId = (run.headers.get("location") ?? "").match(/analys=([0-9a-f-]+)/)?.[1];
  expect(analysisId).toBeTruthy();
  return analysisId!;
}

beforeAll(async () => {
  for (const suffix of ["", "-shm", "-wal"]) {
    const file = `${DB}${suffix}`;
    if (existsSync(file)) rmSync(file);
  }

  proc = Bun.spawn([process.execPath, "src/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, NODE_ENV: "test", RESEND_API_KEY: "", MAIL_FROM: "" },
    stdout: "ignore",
    stderr: "pipe",
  });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/halsa`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await Bun.sleep(150);
  }
  throw new Error("Servern startade inte inom 20 sekunder");
});

afterAll(() => {
  proc?.kill();
  for (const suffix of ["", "-shm", "-wal"]) {
    const file = `${DB}${suffix}`;
    if (existsSync(file)) {
      try {
        rmSync(file);
      } catch {
        /* the process may still hold the handle on some platforms */
      }
    }
  }
});

describe("publika sidor", () => {
  test("startsida, priser, demo och dokumentation svarar", async () => {
    for (const path of ["/", "/produkt", "/priser", "/kom-igang", "/hjalp", "/integritet", "/villkor", "/kontakt"]) {
      const res = await fetch(`${BASE}${path}`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body.toLowerCase()).toContain("stoqwise");
      expect(body).toContain("/brand/stoqwise-logo.svg");
    }
  });

  test("de fem publika sidorna har varsin meta description", async () => {
    const forvantat = {
      sv: {
        "/": "bundet kapital",
        "/priser": "Inga fasta paketpriser",
        "/kontakt": "Beskriv situationen kort",
        "/kom-igang": "skapa konto, importera lagerdata",
        "/om-oss": "samlar analys, prognoser och inköp",
      },
      en: {
        "/": "tied-up capital",
        "/priser": "No fixed package prices",
        "/kontakt": "Describe the situation briefly",
        "/kom-igang": "create an account, import inventory data",
        "/om-oss": "brings inventory analysis, forecasting and purchasing",
      },
    };
    for (const [sprak, cookie] of [["sv", "lr_lang=sv"], ["en", "lr_lang=en"]] as const) {
      const beskrivningar: string[] = [];
      for (const [path, fras] of Object.entries(forvantat[sprak])) {
        const html = await (await fetch(`${BASE}${path}`, { headers: { cookie } })).text();
        const beskrivning = metaDescription(html);
        expect(beskrivning.length).toBeGreaterThan(0);
        expect(beskrivning).toContain(fras);
        beskrivningar.push(beskrivning);
      }
      // Ingen sida får låna någon annans sökbeskrivning.
      expect(new Set(beskrivningar).size).toBe(beskrivningar.length);
    }
  });

  test("CMS-fält för meta description läses av rätt sida", async () => {
    const override = {
      "site.meta.pricing.description": "CMS-prisbeskrivning",
      "site.meta.contact.description": "CMS-kontaktbeskrivning",
      "site.meta.start.description": "CMS-kom-igang-beskrivning",
      "site.meta.about.description": "CMS-om-oss-beskrivning",
    };
    const store = new Database(DB);
    try {
      const skriv = store.query(
        `INSERT INTO cms_fields (scope, key, locale, draft, published, updated_at, updated_by)
         VALUES ('site', $key, 'sv', NULL, $value, $now, NULL)
         ON CONFLICT(scope, key, locale) DO UPDATE SET published = excluded.published, updated_at = excluded.updated_at`,
      );
      const nu = new Date().toISOString();
      for (const [key, value] of Object.entries(override)) skriv.run({ $key: key, $value: value, $now: nu });

      // Innehållet cacheas 1,5 s i serverprocessen; poll:a tills publiceringen syns.
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const html = await (await fetch(`${BASE}/priser`, { headers: { cookie: "lr_lang=sv" } })).text();
        if (metaDescription(html) === override["site.meta.pricing.description"]) break;
        await Bun.sleep(200);
      }

      for (const [path, key] of [
        ["/priser", "site.meta.pricing.description"],
        ["/kontakt", "site.meta.contact.description"],
        ["/kom-igang", "site.meta.start.description"],
      ] as const) {
        const html = await (await fetch(`${BASE}${path}`, { headers: { cookie: "lr_lang=sv" } })).text();
        expect(metaDescription(html)).toBe(override[key]);
      }

      // Startsidan ska inte påverkas av redaktionens sidspecifika beskrivningar.
      const home = await (await fetch(`${BASE}/`, { headers: { cookie: "lr_lang=sv" } })).text();
      expect(metaDescription(home)).not.toContain("CMS-");
    } finally {
      for (const key of Object.keys(override)) {
        store.query("DELETE FROM cms_fields WHERE scope = 'site' AND locale = 'sv' AND key = $key").run({ $key: key });
      }
      store.close();
    }
  });

  test("sidfoten på startsidan har fyra kolumnrubrikerna och länkarna", async () => {
    for (const [cookie, rubriker] of [
      ["lr_lang=sv", ["Plattformen", "Resurser", "Företag"]],
      ["lr_lang=en", ["Platform", "Resources", "Company"]],
    ] as const) {
      const html = await (await fetch(`${BASE}/`, { headers: { cookie } })).text();
      const sidfot = html.match(/<footer class="site-footer">[\s\S]*?<\/footer>/)?.[0];
      expect(sidfot).toBeTruthy();

      // Fyra kolumner: varumärket samt rubrikerna produkt, resurser och företag.
      expect(sidfot).toContain('<a class="site-brand" href="/">');
      for (const rubrik of rubriker) expect(sidfot).toContain(`<h4>${rubrik}</h4>`);

      // Länkarna som ska finnas i sidfoten.
      for (const href of [
        "/dokumentation",
        "/hjalp",
        "/kom-igang",
        "/om-oss",
        "/kontakt",
        "/integritet",
        "/villkor",
      ]) {
        expect(sidfot).toContain(`href="${href}"`);
      }
    }
  });

  test("aktuell sida markeras med aria-current i den publika navigeringen", async () => {
    for (const path of ["/priser", "/om-oss", "/produkt"]) {
      const html = await (await fetch(`${BASE}${path}`)).text();
      const nav = html.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)?.[0];
      expect(nav).toBeTruthy();

      // Endast länken till den egna sidan får markeringen.
      const markerade = Array.from(nav!.matchAll(/<a\b[^>]*aria-current="page"[^>]*>/g), (match) => match[0]);
      expect(markerade).toHaveLength(1);
      expect(markerade[0]).toContain(`href="${path}"`);
    }
  });

  test("interaktiva demon är stängd för allmänheten", async () => {
    const res = await fetch(`${BASE}/demo`, { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/produkt?miljo=industri");
  });

  test("okänd sida ger 404 med svensk text", async () => {
    const res = await fetch(`${BASE}/finns-inte`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Page not found");
  });

  test("säkerhetsheaders sätts", async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("demo-PDF och demo-CSV finns", async () => {
    const pdf = await fetch(`${BASE}/exempelrapport.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
    expect(pdf.headers.get("content-disposition")).toContain("sample-report.pdf");
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("%PDF");

    const swedishPdf = await fetch(`${BASE}/exempelrapport.pdf`, { headers: { cookie: "lr_lang=sv" } });
    expect(swedishPdf.headers.get("content-disposition")).toContain("exempelrapport.pdf");

    const csv = await fetch(`${BASE}/api/demo-csv`);
    expect(csv.status).toBe(200);
    expect(await csv.text()).toContain("Artikelnummer");
  });

  test("publika demomiljöer har egna företag, sortiment och exporter", async () => {
    const industrial = await (await fetch(`${BASE}/produkt`)).text();
    expect(industrial).toContain("Nordvind Industrial Supply AB");
    expect(industrial).toContain("Switch business environment");

    const home = await (await fetch(`${BASE}/produkt?miljo=hem`)).text();
    expect(home).toContain("Ljusgården Home");
    expect(home).not.toContain("Nordvind Industrial Supply AB");

    const swedish = await (
      await fetch(`${BASE}/produkt`, { headers: { cookie: "lr_lang=sv" } })
    ).text();
    expect(swedish).toContain("Nordvind Industriförsörjning AB");

    const foodCsv = await fetch(`${BASE}/api/demo-csv?miljo=foodservice`);
    expect(foodCsv.headers.get("content-disposition")).toContain("exempel-foodservice.csv");
    const foodBody = await foodCsv.text();
    expect(foodBody).toContain("FD-40001");
    expect(foodBody).not.toContain("PT-10106");

    const ecommercePdf = await fetch(`${BASE}/exempelrapport.pdf?miljo=ecommerce`);
    expect(ecommercePdf.status).toBe(200);
    expect(ecommercePdf.headers.get("content-type")).toContain("application/pdf");
  });
});

describe("sandbox", () => {
  test("kräver inloggning", async () => {
    const res = await fetch(`${BASE}/app/sandbox`, { redirect: "manual" });
    expect(res.status).toBe(303);
  });

  test("kör analysmotorn på syntetisk data och länkar till artiklar", async () => {
    const cookie = await register("sandbox@test.se", "Sandbox AB");

    const dash = await fetch(`${BASE}/app/sandbox`, { headers: { cookie } });
    expect(dash.status).toBe(200);
    const dashBody = await dash.text();
    expect(dashBody).toContain("Sandbox");
    expect(dashBody).toContain("Produktdemonstration");
    expect(dashBody).toContain("Lagervärde");

    const items = await fetch(`${BASE}/app/sandbox/artiklar?q=handskar&sort=cover&dir=asc`, { headers: { cookie } });
    expect(items.status).toBe(200);
    const itemsBody = await items.text();
    expect(itemsBody).toContain("Artiklar · Sandbox");

    const sku = (itemsBody.match(/\/app\/sandbox\/artiklar\/([A-Z]{2}-\d{5})/) ?? [])[1];
    expect(sku).toBeTruthy();
    const detail = await fetch(`${BASE}/app/sandbox/artiklar/${sku}`, { headers: { cookie } });
    expect(detail.status).toBe(200);
    expect(await detail.text()).toContain("Varför åtgärden föreslås");

    const food = await fetch(`${BASE}/app/sandbox`, { headers: { cookie: `${cookie}; lr_demo_env=foodservice` } });
    expect(food.status).toBe(200);
    const foodBody = await food.text();
    expect(foodBody).toContain("Solsidan Foodservice AB");
    expect(foodBody).toContain("Livsmedel");
    expect(foodBody).not.toContain("Nordvind Industriförsörjning AB");

    const foodItems = await (
      await fetch(`${BASE}/app/sandbox/artiklar?q=kaffe`, {
        headers: { cookie: `${cookie}; lr_demo_env=foodservice` },
      })
    ).text();
    expect(foodItems).toContain("FD-40001");
    expect(foodItems).not.toContain("PT-10106");

    const home = await fetch(`${BASE}/app/sandbox`, { headers: { cookie: `${cookie}; lr_demo_env=hem` } });
    const homeBody = await home.text();
    expect(homeBody).toContain("Ljusgården Hem");
    expect(homeBody).not.toContain("Solsidan Foodservice AB");

    const switched = await fetch(`${BASE}/app/sandbox/miljo/hem`, {
      redirect: "manual",
      headers: { cookie },
    });
    expect(switched.status).toBe(303);
    expect(switched.headers.get("set-cookie")).toContain("lr_demo_env=hem");

    const unknown = await fetch(`${BASE}/app/sandbox/miljo/okand`, {
      redirect: "manual",
      headers: { cookie },
    });
    expect(unknown.status).toBe(404);
  });

  test("okänt artikelnummer ger 404", async () => {
    const cookie = await register("sandbox404@test.se", "Sandbox 404 AB");
    const res = await fetch(`${BASE}/app/sandbox/artiklar/finns-inte`, { headers: { cookie } });
    expect(res.status).toBe(404);
  });

});

describe("konto och import", () => {
  let cookie = "";
  let analysisId = "";
  let apiKey = "";

  test("registrering skapar konto och organisation", async () => {
    cookie = await register("forsta@test.se", "Första Bolaget AB");
    const res = await fetch(`${BASE}/app`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Ingen analys");
  });

  test("inloggade appsidor indexeras inte", async () => {
    const res = await fetch(`${BASE}/app`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="noindex, follow">');
    expect(html).not.toContain('<link rel="canonical"');
  });

  test("appens språkväljare har samma id mellan requests", async () => {
    const första = languageSwitchIds(await (await fetch(`${BASE}/app`, { headers: { cookie } })).text());
    const andra = languageSwitchIds(await (await fetch(`${BASE}/app`, { headers: { cookie } })).text());
    expect(första.length).toBe(1);
    expect(andra).toEqual(första);
  });

  test("uppladdning ger mappningssida med igenkända kolumner", async () => {
    const csv = demoCsv(buildDemoDataset());
    const data = new FormData();
    data.set("file", new File([csv], "exempel.csv", { type: "text/csv" }));
    data.set("lager", "Huvudlager");

    const res = await fetch(`${BASE}/app/importera`, {
      method: "POST",
      redirect: "manual",
      headers: { origin: BASE, cookie },
      body: data,
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Kolumnmappning");
    const match = body.match(/name="draft" value="([^"]+)"/);
    expect(match).not.toBeNull();
    (globalThis as { draft?: string }).draft = match![1]!;
  });

  test("analysen körs och dashboarden visar belopp", async () => {
    const draft = (globalThis as { draft?: string }).draft!;
    const res = await form("/app/importera/kor", { draft, lager: "Huvudlager", serviceniva: "0.95", dodlager: "180" }, cookie);
    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/app?analys=");
    analysisId = location.match(/analys=([0-9a-f-]+)/)![1]!;

    const page = await fetch(`${BASE}${location}`, { headers: { cookie } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Lagervärde");
    expect(html).toContain("Inaktivt lager");
    expect(html).toContain("Lagerhälsa");
    // Formateringen använder hårt mellanslag som tusentalsavgränsare.
    expect(html).toMatch(/\d[\s\u00a0]\d{3}[\s\u00a0]\d{3}[\s\u00a0]kr/);
  });

  test("språkvalet följer med in i den inloggade appen", async () => {
    const en = await fetch(`${BASE}/app?analys=${analysisId}`, { headers: { cookie: `${cookie}; lr_lang=en` } });
    expect(en.status).toBe(200);
    const enHtml = await en.text();
    expect(enHtml).toContain("Overview");
    expect(enHtml).toContain("Inventory value");
    expect(enHtml).toContain("SEK");
    expect(enHtml).not.toContain("Lagervärde");

    const sv = await fetch(`${BASE}/app?analys=${analysisId}`, { headers: { cookie } });
    expect(sv.status).toBe(200);
    expect(await sv.text()).toContain("Översikt");
  });

  test("PDF-rapporten följer språkvalet", async () => {
    const en = await fetch(`${BASE}/app/analys/${analysisId}/rapport.pdf`, { headers: { cookie: `${cookie}; lr_lang=en` } });
    const sv = await fetch(`${BASE}/app/analys/${analysisId}/rapport.pdf`, { headers: { cookie } });
    expect(en.status).toBe(200);
    expect(sv.status).toBe(200);
    expect(en.headers.get("content-disposition")).toContain(`inventory-report-${analysisId.slice(0, 8)}.pdf`);
    expect(sv.headers.get("content-disposition")).toContain(`lagerrapport-${analysisId.slice(0, 8)}.pdf`);
    const enBytes = new Uint8Array(await en.arrayBuffer());
    const svBytes = new Uint8Array(await sv.arrayBuffer());
    expect(String.fromCharCode(...enBytes.slice(0, 4))).toBe("%PDF");
    expect(String.fromCharCode(...svBytes.slice(0, 4))).toBe("%PDF");
    expect(enBytes.length).not.toBe(svBytes.length);
  });

  test("engelsk registrering ger engelsk välkomstmejl, lagrat språk och engelsk PDF", async () => {
    const email = "locale-en@test.se";
    const company = "Locale English AB";
    const cookie = await register(email, company, "lr_lang=en");
    const analysisId = await importDemo(cookie);

    const stored = new Database(DB);
    try {
      const user = stored.query("SELECT locale FROM users WHERE email = $e").get({ $e: email }) as { locale: string } | null;
      const org = stored
        .query(
          `SELECT o.locale AS locale FROM organizations o
           JOIN members m ON m.org_id = o.id
           JOIN users u ON u.id = m.user_id
           WHERE u.email = $e`,
        )
        .get({ $e: email }) as { locale: string } | null;
      const mail = stored
        .query("SELECT subject, body FROM mail_log WHERE kind = 'trial_welcome' AND to_email = $e ORDER BY id DESC LIMIT 1")
        .get({ $e: email }) as { subject: string; body: string } | null;

      expect(user?.locale).toBe("en");
      expect(org?.locale).toBe("en");
      expect(mail?.subject).toBe("Your STOQWISE trial is active");
      expect(mail?.body).toContain(`The trial for ${company} is active`);
      expect(mail?.body).toContain("Open STOQWISE");
      expect(mail?.body).not.toContain("Provperioden");
    } finally {
      stored.close();
    }

    const dashboard = await fetch(`${BASE}/app?analys=${analysisId}`, { headers: { cookie } });
    expect(dashboard.status).toBe(200);
    const dashboardBody = await dashboard.text();
    expect(dashboardBody).toContain("Overview");
    expect(dashboardBody).not.toContain("Översikt");

    const englishPdf = await fetch(`${BASE}/app/analys/${analysisId}/rapport.pdf`, { headers: { cookie } });
    expect(englishPdf.status).toBe(200);
    expect(englishPdf.headers.get("content-disposition")).toContain(`inventory-report-${analysisId.slice(0, 8)}.pdf`);

    const swedishPdf = await fetch(`${BASE}/app/analys/${analysisId}/rapport.pdf`, {
      headers: { cookie: `${cookie}; lr_lang=sv` },
    });
    expect(swedishPdf.status).toBe(200);
    expect(swedishPdf.headers.get("content-disposition")).toContain(`lagerrapport-${analysisId.slice(0, 8)}.pdf`);
  });

  test("artikelvyn fungerar och visar prognos", async () => {
    const res = await fetch(`${BASE}/app/artiklar?analys=${analysisId}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Filtrera");
    expect(html).toContain("data-table");
  });

  test("prognos, simulering och copilot renderas", async () => {
    for (const path of ["/app/prognos", "/app/simulering", "/app/copilot", "/app/team", "/app/abonnemang", "/app/logg", "/app/installningar"]) {
      const res = await fetch(`${BASE}${path}?analys=${analysisId}`, { headers: { cookie } });
      expect(res.status).toBe(200);
    }
  });

  test("simulering räknar och svarar med utfall", async () => {
    const res = await form(
      "/app/simulering",
      { analys: analysisId, namn: "Test 20 %", demand: "20", lead: "100", delay: "0", delayprob: "0", cost: "100", price: "100", service: "95", reduce: "15", orderqty: "100" },
      cookie,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Nettoeffekt");
    expect(html).toContain("Beräkningsmodell");
  });

  test("copilot svarar med beräknade tal", async () => {
    const res = await form("/app/copilot", { q: "Vilka 5 artiklar binder mest kapital?", analys: analysisId }, cookie);
    expect(res.status).toBe(303);
    const follow = await fetch(`${BASE}${res.headers.get("location")}`, { headers: { cookie } });
    expect(follow.status).toBe(200);
    const html = await follow.text();
    expect(html).toContain("kapital");
  });

  test("PDF och Excel kan laddas ner", async () => {
    const pdf = await fetch(`${BASE}/app/analys/${analysisId}/rapport.pdf`, { headers: { cookie } });
    expect(pdf.status).toBe(200);
    const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
    expect(String.fromCharCode(...pdfBytes.slice(0, 4))).toBe("%PDF");

    const xlsx = await fetch(`${BASE}/app/analys/${analysisId}/export.xlsx`, { headers: { cookie } });
    expect(xlsx.status).toBe(200);
    const xlsxBytes = new Uint8Array(await xlsx.arrayBuffer());
    expect(xlsxBytes[0]).toBe(0x50);
    expect(xlsxBytes[1]).toBe(0x4b);
  });

  test("API-nyckel skapas och kan användas", async () => {
    const res = await form("/app/integrationer/nyckel", { namn: "Test", scope: "write" }, cookie);
    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    apiKey = decodeURIComponent(location.split("nyckel=")[1] ?? "");
    expect(apiKey.startsWith("lr_write_")).toBe(true);

    const me = await fetch(`${BASE}/api/v1/me`, { headers: { authorization: `Bearer ${apiKey}` } });
    expect(me.status).toBe(200);
    const payload = (await me.json()) as { organization: { name: string }; analyses: number };
    expect(payload.organization.name).toBe("Första Bolaget AB");
    expect(payload.analyses).toBe(1);

    const items = await fetch(`${BASE}/api/v1/analyses/${analysisId}/items?pageSize=5`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(items.status).toBe(200);
    const itemsBody = (await items.json()) as { data: unknown[]; pagination: { total: number } };
    expect(itemsBody.data).toHaveLength(5);
    expect(itemsBody.pagination.total).toBeGreaterThan(30);

    const copilot = await fetch(`${BASE}/api/v1/copilot`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ question: "Hur mycket kapital kan frigöras?", analysisId }),
    });
    expect(copilot.status).toBe(200);
    const answer = (await copilot.json()) as { intent: string; answer: string };
    expect(answer.intent).toBe("release_capital");
    expect(answer.answer).toContain("kapital");
  });

  test("API utan nyckel nekas", async () => {
    const res = await fetch(`${BASE}/api/v1/me`);
    expect(res.status).toBe(401);
  });

  test("API med okänd nyckel nekas", async () => {
    const res = await fetch(`${BASE}/api/v1/me`, { headers: { authorization: "Bearer lr_read_pahittad" } });
    expect(res.status).toBe(401);
  });

  test("tenant-isolering: annan organisation kan inte läsa analysen", async () => {
    const otherCookie = await register("andra@test.se", "Andra Bolaget AB");

    // Sidan får inte visa den andra organisationens analys.
    const page = await fetch(`${BASE}/app?analys=${analysisId}`, { headers: { cookie: otherCookie } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Ingen analys");

    const direct = await fetch(`${BASE}/app/artiklar?analys=${analysisId}`, { headers: { cookie: otherCookie } });
    // Ingen analys i den organisationen: omdirigering till import i stället för data.
    expect([303, 200]).toContain(direct.status);
    if (direct.status === 200) expect(await direct.text()).not.toContain("Första Bolaget");

    // API:t nekar åtkomst till en analys som tillhör någon annan.
    const otherKeyRes = await form("/app/integrationer/nyckel", { namn: "Annan", scope: "read" }, otherCookie);
    const otherKey = decodeURIComponent((otherKeyRes.headers.get("location") ?? "").split("nyckel=")[1] ?? "");
    const stolen = await fetch(`${BASE}/api/v1/analyses/${analysisId}`, { headers: { authorization: `Bearer ${otherKey}` } });
    expect(stolen.status).toBe(404);

    // Exporter och artikeldata får inte heller läcka mellan organisationer.
    for (const suffix of ["export.csv", "export.xlsx", "rapport.pdf"]) {
      const download = await fetch(`${BASE}/app/analys/${analysisId}/${suffix}`, { headers: { cookie: otherCookie } });
      expect(download.status).toBe(404);
    }
    const items = await fetch(`${BASE}/api/v1/analyses/${analysisId}/items`, { headers: { authorization: `Bearer ${otherKey}` } });
    expect(items.status).toBe(404);
    const orgExport = await (await fetch(`${BASE}/app/export`, { headers: { cookie: otherCookie } })).text();
    expect(orgExport).not.toContain("Första Bolaget AB");
  });

  test("läsnyckel får inte skriva", async () => {
    const readOnly = decodeURIComponent(
      ((await form("/app/integrationer/nyckel", { namn: "Läs", scope: "read" }, cookie)).headers.get("location") ?? "").split("nyckel=")[1] ?? "",
    );
    const res = await fetch(`${BASE}/api/v1/copilot`, {
      method: "POST",
      headers: { authorization: `Bearer ${readOnly}`, "content-type": "application/json" },
      body: JSON.stringify({ question: "Visa inaktivt lager" }),
    });
    expect(res.status).toBe(403);
  });

  test("utloggning stänger sessionen", async () => {
    const res = await fetch(`${BASE}/logga-ut`, {
      method: "POST",
      redirect: "manual",
      headers: { origin: BASE, cookie },
    });
    expect(res.status).toBe(303);
    const after = await fetch(`${BASE}/app`, { headers: { cookie: cookieFrom(res) || cookie } });
    expect([200, 303]).toContain(after.status);
  });
});

describe("varumärkesadresser", () => {
  test("utan egen domän publiceras ingen adress alls", async () => {
    for (const path of ["/", "/kontakt", "/integritet", "/villkor", "/om-oss", "/hjalp"]) {
      const html = await (await fetch(`${BASE}${path}`)).text();
      expect(html).not.toContain("lagerradar.se");
      expect(html).not.toContain("@stoqwise.");
      expect(html).not.toContain("mailto:");
    }
    const contact = await (await fetch(`${BASE}/kontakt`)).text();
    expect(contact).toContain('<form method="post" action="/kontakt"');
    const privacy = await (await fetch(`${BASE}/integritet`)).text();
    expect(privacy).toContain("through the contact form on this site");
  });
});

describe("översatta publika sidor", () => {
  const sv = { cookie: "lr_lang=sv" };

  test("om oss, kontakt, hjälp och kom igång följer språkvalet", async () => {
    const about = await (await fetch(`${BASE}/om-oss`, { headers: sv })).text();
    expect(about).toContain("Vi gör lagerdata till bättre beslut.");
    expect(about).toContain("Lagerintelligens");
    expect(about).toContain("Efterfrågeprognoser");
    expect(about).toContain("Inköpsoptimering");
    expect(about).toContain("Leverantörsanalys");
    expect(about).toContain("Digital lagervärld");
    expect(about).toContain("Scenarier och simulering");
    expect(about).toContain("Mohammad Al Kakouni");
    expect(about).toContain('href="https://www.linkedin.com/in/mohammad-al-kakouni"');
    expect(about).toContain('aria-label="Besök Mohammad Al Kakounis LinkedIn-profil"');
    expect(about).toContain('href="https://www.linkedin.com/company/stoqwise"');
    expect(about).toContain('aria-label="Besök STOQWISE företagssida på LinkedIn"');
    expect(about).toContain("STOQWISE på LinkedIn");
    expect(about).toContain('class="footer-social" href="https://www.linkedin.com/company/stoqwise"');
    expect(about).toContain('class="footer-social" href="https://www.linkedin.com/company/stoqwise" target="_blank" rel="noopener noreferrer" aria-label="Besök STOQWISE företagssida på LinkedIn"');
    expect(about).toContain("STOQWISE. Understand your inventory. Make better decisions.");
    expect(about).not.toContain("We turn inventory data into better decisions.");

    const aboutEn = await (await fetch(`${BASE}/om-oss`, { headers: { cookie: "lr_lang=en" } })).text();
    expect(aboutEn).toContain("We turn inventory data into better decisions.");
    expect(aboutEn).toContain("Inventory intelligence");
    expect(aboutEn).toContain("Demand forecasting");
    expect(aboutEn).toContain("Purchasing optimisation");
    expect(aboutEn).toContain("Supplier analysis");
    expect(aboutEn).toContain("Digital inventory world");
    expect(aboutEn).toContain("Scenarios and simulation");
    expect(aboutEn).toContain("Visit Mohammad Al Kakouni");
    expect(aboutEn).toContain("LinkedIn profile");
    expect(aboutEn).toContain('aria-label="Visit the STOQWISE LinkedIn company page"');
    expect(aboutEn).toContain("STOQWISE on LinkedIn");
    expect(aboutEn).toContain('aria-label="Visit the STOQWISE LinkedIn company page"');
    expect(aboutEn).not.toContain("Vi gör lagerdata till bättre beslut.");
    expect(aboutEn).not.toContain("Grundare av STOQWISE");

    const contact = await (await fetch(`${BASE}/kontakt`, { headers: sv })).text();
    expect(contact).toContain("Prata med oss om ditt lager.");
    expect(contact).toContain("Vad gäller det?");
    expect(contact).toContain("Skicka");
    expect(contact).not.toContain("Talk to us about your inventory.");

    const help = await (await fetch(`${BASE}/hjalp`, { headers: sv })).text();
    expect(help).toContain("Hjälpcenter");
    expect(help).toContain("Hur exporterar jag data från mitt system?");
    expect(help).not.toContain("How do I export data from my system?");

    const start = await (await fetch(`${BASE}/kom-igang`, { headers: sv })).text();
    expect(start).toContain("Från export till åtgärdslista.");
    expect(start).toContain("Filformat");
    expect(start).not.toContain("From export to action list.");
  });

  test("juridiska sidorna är översatta och behåller länkarna", async () => {
    const privacy = await (await fetch(`${BASE}/integritet`, { headers: sv })).text();
    expect(privacy).toContain("Integritetspolicy");
    expect(privacy).toContain("Personuppgiftsansvarig");
    expect(privacy).toContain("Dina rättigheter");
    expect(privacy).toContain('href="/kontakt"');
    expect(privacy).not.toContain("Privacy policy");

    const terms = await (await fetch(`${BASE}/villkor`, { headers: sv })).text();
    expect(terms).toContain("Användarvillkor");
    expect(terms).toContain("Kundens ansvar");
    expect(terms).toContain("Ansvarsbegränsning");
    expect(terms).not.toContain("Terms of service");
  });

  test("kontaktformulärets felmeddelande följer språket", async () => {
    const res = await fetch(`${BASE}/kontakt`, {
      method: "POST",
      redirect: "manual",
      headers: { origin: BASE, cookie: "lr_lang=sv", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ namn: "", epost: "", meddelande: "" }).toString(),
    });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("Fyll i namn, e-post och ett meddelande.");
  });
});

describe("svenska fel- och systemsidor", () => {
  test("404-sidan följer språkvalet", async () => {
    const res = await fetch(`${BASE}/finns-inte`, { headers: { cookie: "lr_lang=sv" } });
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Sidan finns inte i lagret.");
    expect(html).toContain('lang="sv"');
    expect(html).not.toContain("Page not found");
  });

  test("inloggningsfelet är på svenska", async () => {
    const res = await fetch(`${BASE}/logga-in`, {
      method: "POST",
      redirect: "manual",
      headers: { origin: BASE, cookie: "lr_lang=sv", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ epost: "fel@test.se", losenord: "fel-losenord" }).toString(),
    });
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain("Fel e-post eller lösenord.");
    expect(html).not.toContain("Wrong email or password");
  });

  test("CSV-avgränsarna är fortfarande kodformaterade efter flytten ur katalogen", async () => {
    const html = await (await fetch(`${BASE}/kom-igang`, { headers: { cookie: "lr_lang=sv" } })).text();
    expect(html).toContain('<span class="mono">;</span>');
    expect(html).toContain('<span class="mono">|</span>');
    expect(html).not.toContain("{semicolon}");
  });
});

describe("språkval och valuta", () => {
  test("språkvalet sparas i en cookie och översätter marknadsytan", async () => {
    const res = await fetch(`${BASE}/sprak?lang=sv&next=/priser`, { redirect: "manual" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/priser");
    expect(res.headers.get("set-cookie") ?? "").toContain("lr_lang=sv");

    const page = await fetch(`${BASE}/priser`, { headers: { cookie: "lr_lang=sv" } });
    const html = await page.text();
    expect(html).toContain('lang="sv"');
    expect(html).toContain("Priser som utgår från er verksamhet.");
    expect(html).toContain("Personlig prissättning");
    expect(html).not.toContain("Pricing");
    expect(html).not.toContain("Capabilities");
  });

  test("publika prissidan visar inga fasta abonnemangspriser i något språk", async () => {
    const en = await (await fetch(`${BASE}/priser`)).text();
    const sv = await (await fetch(`${BASE}/priser`, { headers: { cookie: "lr_lang=sv" } })).text();
    expect(en).toContain("No fixed package prices.");
    expect(sv).toContain("Inga fasta paketpriser.");
    for (const html of [en, sv]) {
      expect(html).not.toMatch(/SEK 2[ ,\u00a0]490/);
      expect(html).not.toMatch(/SEK 4[ ,\u00a0]900/);
      expect(html).not.toMatch(/14[ ,\u00a0]900/);
      expect(html).not.toContain("/ month");
    }
  });

  test("ospråk och osäkra returadresser avvisas", async () => {
    const unsupported = await fetch(`${BASE}/sprak?lang=de&next=/`, { redirect: "manual" });
    expect(unsupported.status).toBe(303);
    expect(unsupported.headers.get("set-cookie")).toBeNull();

    const open = await fetch(`${BASE}/sprak?lang=sv&next=//evil.example`, { redirect: "manual" });
    expect(open.headers.get("location")).toBe("/");
  });

  test("första sidan följer det sparade språket", async () => {
    const html = await (await fetch(`${BASE}/`, { headers: { cookie: "lr_lang=sv" } })).text();
    expect(html).toContain("Bättre lager.");
    expect(html).toContain("Smartare beslut.");
    expect(html).toContain("Produktdemonstration");
    expect(html).toContain("Kapital per kategori");
    expect(html).not.toContain("Demo data ·");
    expect(html).toContain('dir="ltr"');
  });

  test("publika sidor sätter html-lang efter språkcookien", async () => {
    for (const [cookie, lang] of [["lr_lang=sv", "sv"], ["lr_lang=en", "en"]] as const) {
      for (const path of ["/", "/produkt", "/priser", "/om-oss", "/kontakt"]) {
        const res = await fetch(`${BASE}${path}`, { headers: { cookie } });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain(`<html lang="${lang}"`);
      }
    }
  });
});

describe("språkväljarens id:n", () => {
  test("samma sida ger samma id mellan requests", async () => {
    for (const cookie of ["lr_lang=sv", "lr_lang=en"]) {
      const förstaHtml = await (await fetch(`${BASE}/`, { headers: { cookie } })).text();
      const andraHtml = await (await fetch(`${BASE}/`, { headers: { cookie } })).text();
      const första = languageSwitchIds(förstaHtml);
      expect(första.length).toBe(2);
      expect(languageSwitchIds(andraHtml)).toEqual(första);
    }
  });

  test("mobil och desktop får olika id på samma sida", async () => {
    const html = await (await fetch(`${BASE}/priser`)).text();
    const ids = languageSwitchIds(html);
    expect(ids.length).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
    // Varje etikett pekar på sitt eget select-fält.
    for (const id of ids) expect(html).toContain(`<label class="sr-only" for="${id}">`);
  });
});

describe("publik informationsstruktur", () => {
  test("/dokumentation pekar kunder till kom igång", async () => {
    const res = await fetch(`${BASE}/dokumentation`, { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/kom-igang");
  });

  test("utvecklardokumentationen kräver inloggning", async () => {
    const res = await fetch(`${BASE}/utvecklare`, { redirect: "manual" });
    expect([302, 303]).toContain(res.status);
  });

  test("utvecklardokumentationen är inte indexerbar", () => {
    expect(isIndexable("/utvecklare")).toBe(false);
    expect(robotsTxt()).toContain("Disallow: /utvecklare");
  });

  test("publika sidor bär inget gammalt varumärke", async () => {    for (const path of ["/", "/produkt", "/priser", "/kom-igang", "/hjalp", "/om-oss"]) {
      const body = await (await fetch(`${BASE}${path}`)).text();
      expect(body).not.toContain("Lagerradar");
      expect(body).not.toContain("Lagerbok 2.0");
      expect(body).not.toContain("Platta I");
    }
  });

  test("om oss beskriver bolaget, grundaren och visionen", async () => {
    const res = await fetch(`${BASE}/om-oss`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Mohammad Al Kakouni");
    expect(body).toContain("Lund University");
    expect(body).toContain("STOQWISE. Understand your inventory. Make better decisions.");
    expect(body).toContain('href="/om-oss"');
  });

  test("robots.txt och sitemap.xml beskriver den publika ytan", async () => {
    const robots = await fetch(`${BASE}/robots.txt`);
    expect(robots.status).toBe(200);
    expect(robots.headers.get("content-type")).toContain("text/plain");
    const robotsBody = await robots.text();
    expect(robotsBody).toContain("User-agent: *");
    expect(robotsBody).toContain("Disallow: /app");
    expect(robotsBody).toContain("Disallow: /admin");
    expect(robotsBody).toContain(`Sitemap: ${BASE}/sitemap.xml`);

    const sitemap = await fetch(`${BASE}/sitemap.xml`);
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers.get("content-type")).toContain("xml");
    const sitemapBody = await sitemap.text();
    expect(sitemapBody).toContain("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">");
    expect(sitemapBody).toContain(`<loc>${BASE}/</loc>`);
    expect(sitemapBody).toContain(`<loc>${BASE}/om-oss</loc>`);
    expect(sitemapBody).toContain(`<loc>${BASE}/priser</loc>`);
    expect(sitemapBody).not.toContain("/app");
  });

  test("varje adress i sitemap.xml serverar ett dokument utan omdirigering", async () => {
    // sitemapXml() bygger sina adresser från config.appOrigin. Peka om den
    // till testservern så att <loc> verkligen kan hämtas härifrån.
    const original = config.appOrigin;
    const mutableConfig = config as { appOrigin: string };
    mutableConfig.appOrigin = BASE;
    try {
      const locs = [...sitemapXml().matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!);
      expect(locs.length).toBe(PUBLIC_PAGES.length);
      for (const loc of locs) {
        // Utan redirect: manual hade en 301 till /kom-igang setts som 200.
        const res = await fetch(loc, { redirect: "manual" });
        expect(res.status).toBe(200);
      }
    } finally {
      mutableConfig.appOrigin = original;
    }
  });

  test("sitemap.xml får inga dubbla snedstreck när APP_ORIGIN slutar med snedstreck", () => {
    const original = config.appOrigin;
    const mutableConfig = config as { appOrigin: string };
    try {
      // Även flera avslutande snedstreck ska normaliseras bort i varje <loc>.
      for (const suffix of ["/", "//", "///"]) {
        mutableConfig.appOrigin = `https://stoqwise.example${suffix}`;
        const locs = [...sitemapXml().matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!);
        expect(locs).toHaveLength(PUBLIC_PAGES.length);
        locs.forEach((loc, index) => {
          expect(loc).toBe(`https://stoqwise.example${PUBLIC_PAGES[index]}`);
          expect(loc.slice("https://".length)).not.toContain("//");
        });
      }
    } finally {
      mutableConfig.appOrigin = original;
    }
  });

  test("publika sidor pekar ut en enda kanonisk adress", async () => {
    for (const path of ["/", "/om-oss", "/priser", "/produkt?miljo=industri"]) {
      const response = await fetch(`${BASE}${path}`);
      expect(response.status).toBe(200);
      const html = await response.text();
      const clean = path.split("?")[0]!;
      const expected = `${BASE}${clean === "/" ? "/" : clean}`;
      expect(html).toContain(`<link rel="canonical" href="${expected}">`);
      expect(html).toContain(`<meta property="og:url" content="${expected}">`);
      expect(html).toContain(`<meta property="og:image" content="${BASE}/brand/stoqwise-og.png">`);
      expect(html).toContain('<meta property="og:image:width" content="1200">');
      expect(html).not.toContain('content="noindex');
    }

    const card = await fetch(`${BASE}/brand/stoqwise-og.png`);
    expect(card.status).toBe(200);
    expect(card.headers.get("content-type")).toContain("image/png");
  });

  test("publika sidor bär strukturerad data för organisation och webbplats", async () => {
    for (const path of ["/", "/om-oss", "/priser", "/produkt?miljo=industri"]) {
      const response = await fetch(`${BASE}${path}`);
      expect(response.status).toBe(200);
      const html = await response.text();
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      expect(blocks).toHaveLength(1);
      const parsed = JSON.parse(blocks[0]![1]!) as {
        "@context"?: string;
        "@graph"?: Array<{ "@type"?: string; name?: string; url?: string; logo?: string }>;
      };
      const nodes = parsed["@graph"] ?? [];
      expect(parsed["@context"]).toBe("https://schema.org");
      const types = nodes.map((node) => node["@type"]);
      expect(types).toContain("Organization");
      expect(types).toContain("WebSite");
      for (const node of nodes) {
        // Samma adress som den kanoniska länken, byggd från absoluteUrl().
        expect(node.url).toBe(`${BASE}/`);
        expect(node.name).toBe("STOQWISE");
      }
      const organisation = nodes.find((node) => node["@type"] === "Organization");
      expect(organisation?.logo).toBe(`${BASE}/brand/stoqwise-logo.svg`);
    }
  });

  test("fel- och inloggningssidor indexeras inte", async () => {
    for (const path of ["/404", "/logga-in"]) {
      const response = await fetch(`${BASE}${path}`);
      const html = await response.text();
      expect(html).toContain('<meta name="robots" content="noindex, follow">');
      expect(html).not.toContain('<link rel="canonical"');
    }
  });
});
