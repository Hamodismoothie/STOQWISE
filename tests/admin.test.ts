/**
 * End-to-end tests for /admin against a real server process and a throwaway
 * database: first-admin initialisation, login, rate limiting, CSRF, drafts,
 * publishing, version history, restore, XSS escaping and two-factor login.
 *
 * The point is the separation: a customer account (lr_session) must not reach a
 * single administrative page or API, no matter which URL it guesses.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { createHmac } from "node:crypto";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PORT = 3991;
const BASE = `http://localhost:${PORT}`;
const DB = join(ROOT, "data", "test-admin.db");
const SETUP_TOKEN = "test-setup-token-0123456789";
// The marketing site defaults to English; the CMS publishes Swedish copy.
const LANG_SV = "lr_lang=sv";
const ADMIN_EMAIL = "agare@stoqwise.test";
const ADMIN_PASSWORD = "mycket-langt-losenord-2026";

let proc: ReturnType<typeof Bun.spawn> | null = null;
let adminCookie = "";
let customerCookie = "";

const cookieFrom = (response: Response): string => (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

async function get(path: string, cookie = ""): Promise<Response> {
  return fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
}

async function post(path: string, fields: Record<string, string>, cookie = "", origin = BASE): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

/** RFC 6238 code, so the test never has to guess. */
function totp(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Math.floor(Date.now() / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter % 2 ** 32, 4);
  const digest = createHmac("sha1", Buffer.from(bytes)).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    ((digest[offset]! & 0x7f) << 24) | ((digest[offset + 1]! & 0xff) << 16) | ((digest[offset + 2]! & 0xff) << 8) | (digest[offset + 3]! & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

beforeAll(async () => {
  for (const suffix of ["", "-shm", "-wal"]) {
    const file = `${DB}${suffix}`;
    if (existsSync(file)) rmSync(file);
  }

  proc = Bun.spawn([process.execPath, "src/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, NODE_ENV: "test", ADMIN_SETUP_TOKEN: SETUP_TOKEN },
    stdout: "ignore",
    stderr: "pipe",
  });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/halsa`);
      if (res.ok) return;
    } catch {
      // still starting
    }
    await Bun.sleep(150);
  }
  throw new Error("Servern startade inte");
});

afterAll(() => {
  proc?.kill();
  for (const suffix of ["", "-shm", "-wal"]) {
    const file = `${DB}${suffix}`;
    if (existsSync(file)) rmSync(file);
  }
});

describe("administration – initialisering och inloggning", () => {
  test("utloggad besökare skickas till initiering när inget konto finns", async () => {
    const res = await get("/admin");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin/init");

    const page = await get("/admin/init");
    expect(page.status).toBe(200);
    const body = await page.text();
    expect(body).toContain("Skapa första administratören");
    expect(body).toContain("ADMIN_SETUP_TOKEN");
  });

  test("fel engångstoken avvisas", async () => {
    const res = await post("/admin/init", {
      token: "fel-token-som-inte-stammer",
      namn: "Ägare",
      epost: ADMIN_EMAIL,
      losenord: ADMIN_PASSWORD,
      losenord2: ADMIN_PASSWORD,
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Engångstoken stämmer inte");
  });

  test("svagt lösenord avvisas", async () => {
    const res = await post("/admin/init", {
      token: SETUP_TOKEN,
      namn: "Ägare",
      epost: ADMIN_EMAIL,
      losenord: "kort",
      losenord2: "kort",
    });
    expect(res.status).toBe(400);
  });

  test("korrekt engångstoken skapar ägarkontot och en session", async () => {
    const res = await post("/admin/init", {
      token: SETUP_TOKEN,
      namn: "Ägare",
      epost: ADMIN_EMAIL,
      losenord: ADMIN_PASSWORD,
      losenord2: ADMIN_PASSWORD,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin");
    adminCookie = cookieFrom(res);
    expect(adminCookie).toContain("sq_admin=");

    const dashboard = await get("/admin", adminCookie);
    expect(dashboard.status).toBe(200);
    const body = await dashboard.text();
    expect(body).toContain("Översikt");
    expect(body).toContain("Juridiska dokument");
    expect(body).toContain("Saknade uppgifter");

    const platform = await get("/admin/plattform", adminCookie);
    expect(platform.status).toBe(200);
    const platformBody = await platform.text();
    expect(platformBody).toContain("Provperioder");
    expect(platformBody).toContain("Trialmejl");
    expect(platformBody).toContain("Kör trial-sweep");
  });

  test("initieringen stängs när ett ägarkonto finns", async () => {
    const res = await post("/admin/init", {
      token: SETUP_TOKEN,
      namn: "Inkräktare",
      epost: "inkraktare@example.com",
      losenord: "annat-langt-losenord-1",
      losenord2: "annat-langt-losenord-1",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin/logg-in");

    const page = await get("/admin/init");
    expect(page.status).toBe(303);
  });

  test("fel lösenord avvisas med 401", async () => {
    const res = await post("/admin/logg-in", { epost: ADMIN_EMAIL, losenord: "fel-losenord-har", nasta: "/admin" });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("Fel e-post eller lösenord");
  });
});

describe("administration – åtkomstkontroll", () => {
  test("utloggad besökare kan inte läsa dashboarden", async () => {
    const res = await get("/admin");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/admin/logg-in");
  });

  test("vanlig kund kan inte öppna adminpanel eller API", async () => {
    const register = await post("/skapa-konto", {
      namn: "Kund Kundsson",
      foretag: "Kundbolaget AB",
      epost: "kund@example.com",
      losenord: "kundlosenord123",
      plan: "trial",
    });
    expect(register.status).toBe(303);
    customerCookie = cookieFrom(register);
    expect(customerCookie).toContain("lr_session=");

    for (const path of ["/admin", "/admin/innehall", "/admin/juridik", "/admin/versioner", "/admin/logg", "/admin/konto"]) {
      const res = await get(path, customerCookie);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toContain("/admin/logg-in");
    }

    const api = await get("/admin/api/status", customerCookie);
    expect(api.status).toBe(401);

    const sweep = await post("/admin/plattform/trial-sweep", {}, customerCookie);
    expect(sweep.status).toBe(303);
    expect(sweep.headers.get("location")).toContain("/admin/logg-in");

    const preview = await get("/admin/forhandsgranska/juridik", customerCookie);
    expect(preview.status).toBe(303);
  });

  test("trial-sweep kan köras från plattformsöversikten", async () => {
    const res = await post("/admin/plattform/trial-sweep", {}, adminCookie);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin/plattform?sweep=1");

    const page = await get("/admin/plattform?sweep=1", adminCookie);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Trial-sweep körd");
  });

  test("kund kan inte publicera eller ändra innehåll", async () => {
    const publish = await post("/admin/publicera", { omrade: "legal", notering: "kund", bekrafta: "1" }, customerCookie);
    expect(publish.status).toBe(303);
    expect(publish.headers.get("location")).toContain("/admin/logg-in");

    const edit = await post("/admin/juridik", { "legal.company.name": "Kundens bolag" }, customerCookie);
    expect(edit.status).toBe(303);

    const legal = await get("/integritet", LANG_SV);
    expect(await legal.text()).not.toContain("Kundens bolag");
  });

  test("POST från annan domän stoppas av CSRF-skyddet", async () => {
    const res = await post("/admin/juridik", { "legal.company.name": "Annat bolag" }, adminCookie, "https://evil.example");
    expect(res.status).toBe(403);
  });
});

describe("administration – utkast, publicering och versioner", () => {
  test("utkast syns i admin och förhandsgranskning men inte publikt", async () => {
    const save = await post("/admin/juridik", { "legal.company.name": "TESTBOLAG AB", "legal.company.orgNumber": "556000-0000" }, adminCookie);
    expect(save.status).toBe(303);
    expect(save.headers.get("location")).toContain("/admin/juridik?sparat=1");

    const admin = await get("/admin/juridik", adminCookie);
    const adminBody = await admin.text();
    expect(adminBody).toContain("opublicerade ändringar");
    expect(adminBody).toContain("TESTBOLAG AB");

    const preview = await get("/admin/forhandsgranska/juridik", adminCookie);
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain("TESTBOLAG AB");

    const publicPage = await get("/integritet", LANG_SV);
    const publicBody = await publicPage.text();
    expect(publicBody).not.toContain("TESTBOLAG AB");
    expect(publicBody).toContain("[FYLL I REGISTRERAT FÖRETAGSNAMN]");
  });

  test("publicering kräver bekräftelse och skapar version 1", async () => {
    const withoutConfirm = await post("/admin/publicera", { omrade: "legal", notering: "utan bekräftelse" }, adminCookie);
    expect(withoutConfirm.status).toBe(303);
    expect(await (await get("/integritet", LANG_SV)).text()).not.toContain("TESTBOLAG AB");

    const res = await post("/admin/publicera", { omrade: "legal", notering: "Företagsuppgifter ifyllda", bekrafta: "1" }, adminCookie);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("publicerat=1");

    const publicBody = await (await get("/integritet", LANG_SV)).text();
    expect(publicBody).toContain("TESTBOLAG AB");
    expect(publicBody).not.toContain("[FYLL I REGISTRERAT FÖRETAGSNAMN]");

    const versions = await (await get("/admin/versioner?omrade=juridik", adminCookie)).text();
    expect(versions).toContain("v1");
    expect(versions).toContain("Företagsuppgifter ifyllda");
  });

  test("ny publicering blir version 2 och historiken behålls", async () => {
    await post("/admin/juridik", { "legal.company.name": "ANDRA NAMNET AB" }, adminCookie);
    const res = await post("/admin/publicera", { omrade: "legal", notering: "Namnändring", bekrafta: "1" }, adminCookie);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("publicerat=2");

    const publicBody = await (await get("/integritet", LANG_SV)).text();
    expect(publicBody).toContain("ANDRA NAMNET AB");
    expect(publicBody).not.toContain("TESTBOLAG AB");

    const versions = await (await get("/admin/versioner?omrade=juridik", adminCookie)).text();
    expect(versions).toContain("v2");
    expect(versions).toContain("v1");
  });

  test("återställning skriver tillbaka som utkast utan att publicera", async () => {
    const list = await (await get("/admin/versioner?omrade=juridik", adminCookie)).text();
    // Newest first: the last link is version 1, which still has TESTBOLAG AB.
    const ids = [...list.matchAll(/\/admin\/versioner\/([a-f0-9-]{36})/g)].map((match) => match[1]!);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const id = ids[ids.length - 1]!;

    const res = await post(`/admin/versioner/${id}/aterstall`, { bekrafta: "1" }, adminCookie);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("aterstalld=1");

    expect(await (await get("/integritet", LANG_SV)).text()).toContain("ANDRA NAMNET AB");

    const editor = await (await get("/admin/juridik", adminCookie)).text();
    expect(editor).toContain("TESTBOLAG AB");
  });

  test("avsnittsredigering bevarar struktur och escapar HTML", async () => {
    const payload = 'Första stycket.\n\n<script>alert("xss")</script>\n\n- Punkt ett\n- Punkt två';
    const res = await post("/admin/juridik/avsnitt/integritet/ansvarig", { rubrik: "2. Personuppgiftsansvarig", brodtext: payload }, adminCookie);
    expect(res.status).toBe(303);

    const preview = await (await get("/admin/forhandsgranska/juridik", adminCookie)).text();
    expect(preview).not.toContain('<script>alert("xss")</script>');
    expect(preview).toContain("&lt;script&gt;");

    await post("/admin/publicera", { omrade: "legal", notering: "Avsnitt uppdaterat", bekrafta: "1" }, adminCookie);
    const publicBody = await (await get("/integritet", LANG_SV)).text();
    expect(publicBody).toContain("Första stycket.");
    expect(publicBody).toContain("<li>Punkt ett</li>");
    expect(publicBody).not.toContain('<script>alert("xss")</script>');
  });

  test("webbplatsinnehåll publiceras och escapas", async () => {
    const save = await post(
      "/admin/innehall",
      {
        "site.home.title1": 'Bättre lager.<img src=x onerror=alert(1)>',
        "site.home.title2": "Smartare beslut.",
        "site.home.lead": "Ny ingress från CMS.",
      },
      adminCookie,
    );
    expect(save.status).toBe(303);

    expect(await (await get("/", LANG_SV)).text()).not.toContain("Ny ingress från CMS.");

    const res = await post("/admin/publicera", { omrade: "site", notering: "Ny hero", bekrafta: "1" }, adminCookie);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("publicerat=1");

    const home = await (await get("/", LANG_SV)).text();
    expect(home).toContain("Ny ingress från CMS.");
    expect(home).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(home).not.toContain("<img src=x onerror=alert(1)>");
  });

  test("förhandsgranskning av webbplatsen visar utkast", async () => {
    await post("/admin/innehall", { "site.home.lead": "Endast utkast." }, adminCookie);
    const preview = await (await get("/admin/forhandsgranska/webbplats", adminCookie)).text();
    expect(preview).toContain("Endast utkast.");
    expect(await (await get("/", LANG_SV)).text()).not.toContain("Endast utkast.");
  });
});

describe("administration – kontosäkerhet", () => {
  test("upprepade inloggningsförsök begränsas", async () => {
    let limited = false;
    for (let i = 0; i < 7; i++) {
      const res = await post("/admin/logg-in", { epost: "okand@example.com", losenord: "fel-fel-fel-fel", nasta: "/admin" });
      if (res.status === 429) limited = true;
    }
    expect(limited).toBe(true);
  });

  test("tvåfaktorsautentisering kan aktiveras och krävs sedan vid inloggning", async () => {
    const start = await post("/admin/konto/totp/start", {}, adminCookie);
    expect(start.status).toBe(303);

    const page = await (await get("/admin/konto", adminCookie)).text();
    const secret = /<code>([A-Z2-7]{16,})<\/code>/.exec(page)?.[1];
    expect(secret).toBeTruthy();

    const wrong = await post("/admin/konto/totp/aktivera", { kod: "000000" }, adminCookie);
    expect(wrong.status).toBe(400);

    const ok = await post("/admin/konto/totp/aktivera", { kod: totp(secret!) }, adminCookie);
    expect(ok.status).toBe(303);

    const logout = await post("/admin/logg-ut", {}, adminCookie);
    expect(logout.status).toBe(303);
    expect(await (await get("/admin", adminCookie)).status).toBe(303);

    const withoutCode = await post("/admin/logg-in", { epost: ADMIN_EMAIL, losenord: ADMIN_PASSWORD, nasta: "/admin" });
    expect(withoutCode.status).toBe(401);
    expect(await withoutCode.text()).toContain("Engångskoden stämmer inte");

    const withCode = await post("/admin/logg-in", { epost: ADMIN_EMAIL, losenord: ADMIN_PASSWORD, nasta: "/admin", kod: totp(secret!) });
    expect(withCode.status).toBe(303);
    adminCookie = cookieFrom(withCode);
    expect(adminCookie).toContain("sq_admin=");
    expect((await get("/admin", adminCookie)).status).toBe(200);
  });

  test("skyddat API svarar med status för inloggad administratör", async () => {
    const res = await get("/admin/api/status", adminCookie);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { admin: { email: string; totp: boolean }; legal: { version: number | null } };
    expect(data.admin.email).toBe(ADMIN_EMAIL);
    expect(data.admin.totp).toBe(true);
    expect(data.legal.version).toBeGreaterThanOrEqual(3);
  });

  test("utloggning avslutar sessionen på servern", async () => {
    const res = await post("/admin/logg-ut", {}, adminCookie);
    expect(res.status).toBe(303);
    expect((await get("/admin", adminCookie)).status).toBe(303);
    expect((await get("/admin/api/status", adminCookie)).status).toBe(401);
  });
});
