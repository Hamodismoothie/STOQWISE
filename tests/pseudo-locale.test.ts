/**
 * Pseudo-locale gate.
 *
 * `en-XA` renders every translated app string inside visible brackets and turns
 * every missing English key into a `⟦missing:...⟧` marker. The HTTP test then
 * strips those markers and looks for Swedish leftovers, which is exactly the
 * copy that never went through the app catalog.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  PSEUDO_CLOSE,
  PSEUDO_LOCALE,
  PSEUDO_MISSING,
  PSEUDO_OPEN,
  appText,
  hasAppTranslation,
} from "../src/i18n-app.ts";

const ROOT = join(import.meta.dir, "..");
const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const DB = join(ROOT, "data", "test-pseudo-locale.db");

let proc: ReturnType<typeof Bun.spawn> | null = null;
let cookie = "";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : [];
  });
}

function decodeLiteral(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

/** Literal source strings passed through the app catalog. Public pages use a
 * different `(sv, en)` translator and are deliberately outside this gate. */
function appSourceLiterals(): Array<{ source: string; file: string }> {
  const found: Array<{ source: string; file: string }> = [];
  for (const file of walk(join(ROOT, "src"))) {
    if (file.endsWith("pages/public.ts")) continue;
    const text = readFileSync(file, "utf8");
    if (!text.includes("appText") && !text.includes("appTranslator")) continue;
    for (const pattern of [
      /appText\(\s*[^,]+,\s*"((?:\\.|[^"\\])*)"/g,
      /(?<![A-Za-z0-9_.])t\(\s*"((?:\\.|[^"\\])*)"/g,
    ]) {
      for (const match of text.matchAll(pattern)) {
        found.push({ source: decodeLiteral(match[1]!), file: file.slice(ROOT.length + 1) });
      }
    }
  }
  return found;
}

function stripPseudo(html: string): string {
  return html.replace(new RegExp(`${PSEUDO_OPEN}[^${PSEUDO_CLOSE}]*${PSEUDO_CLOSE}`, "g"), " ");
}

function swedishLeftovers(html: string): string[] {
  const text = stripPseudo(html);
  const hits: string[] = [];
  const charAt = text.search(/[åäöÅÄÖ]/);
  if (charAt >= 0) hits.push(`Swedish characters outside the catalog: ${text.slice(Math.max(0, charAt - 60), charAt + 60)}`);
  const words =
    /\b(och|för|med|inte|som|eller|från|till|kan|ska|vid|det|den|Radera|Avbryt|Spara|Tillbaka|Sök|Stäng|Öppna|Ladda|Importera|Inställningar|Abonnemang|Bekräfta|Välj|Skicka|Laddar|Ingen|Inga|Alla)\b/;
  const match = text.match(words);
  if (match) {
    const at = match.index ?? 0;
    hits.push(`Swedish word "${match[0]}" outside the catalog: ${text.slice(Math.max(0, at - 60), at + 60)}`);
  }
  return hits;
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/halsa`)).ok) return;
    } catch {
      /* starting */
    }
    await Bun.sleep(100);
  }
  throw new Error("Servern startade inte");
}

async function register(): Promise<string> {
  const response = await fetch(`${BASE}/skapa-konto`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: BASE, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      namn: "Pseudo Tester",
      foretag: "Pseudo Test AB",
      epost: "pseudo@test.se",
      losenord: "pseudo-password-2026",
      plan: "trial",
    }).toString(),
  });
  expect(response.status).toBe(303);
  const session = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  expect(session).toContain("lr_session=");
  return session;
}

beforeAll(async () => {
  for (const suffix of ["", "-shm", "-wal"]) {
    const file = `${DB}${suffix}`;
    if (existsSync(file)) rmSync(file);
  }
  proc = Bun.spawn([process.execPath, "src/server.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: DB,
      NODE_ENV: "test",
      APP_LOCALE_OVERRIDE: PSEUDO_LOCALE,
      RESEND_API_KEY: "",
      MAIL_FROM: "",
      BRAND_EMAIL_DOMAIN: "",
    },
    stdout: "ignore",
    stderr: "pipe",
  });
  await waitForServer();
  cookie = await register();
});

afterAll(async () => {
  proc?.kill();
  await proc?.exited;
  for (const suffix of ["", "-shm", "-wal"]) {
    const file = `${DB}${suffix}`;
    if (existsSync(file)) rmSync(file);
  }
});

describe("pseudo-locale", () => {
  test("markerar översatta och saknade strängar", () => {
    expect(appText(PSEUDO_LOCALE, "Översikt")).toBe(`${PSEUDO_OPEN}Overview${PSEUDO_CLOSE}`);
    expect(appText(PSEUDO_LOCALE, "En sträng som inte finns i katalogen")).toBe(
      `${PSEUDO_MISSING}En sträng som inte finns i katalogen${PSEUDO_CLOSE}`,
    );
    expect(appText("en", "En sträng som inte finns i katalogen")).toBe("En sträng som inte finns i katalogen");
  });

  test("alla statiska appsträngar har en engelsk översättning", () => {
    const missing = appSourceLiterals()
      .filter(({ source }) => !hasAppTranslation(source))
      .map(({ source, file }) => `${file}: ${source}`);
    expect(missing).toEqual([]);
  });

  test("appens centrala sidor renderas utan svenska utanför katalogen", async () => {
    const pages = [
      "/app",
      "/app/importera",
      "/app/team",
      "/app/abonnemang",
      "/app/installningar",
      "/app/integrationer",
      "/app/sandbox",
      "/app/logg",
      "/app/export",
      "/app/radera/konto",
      "/app/radera/organisation",
    ];
    const failures: string[] = [];
    for (const path of pages) {
      const response = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
      if (response.status !== 200) {
        failures.push(`${path} svarade ${response.status}`);
        continue;
      }
      const html = await response.text();
      if (html.includes(PSEUDO_MISSING)) {
        const at = html.indexOf(PSEUDO_MISSING);
        failures.push(`${path} innehåller en saknad översättning: ${html.slice(at, at + 140)}`);
      }
      for (const hit of swedishLeftovers(html)) failures.push(`${path}: ${hit}`);
    }
    expect(failures).toEqual([]);
  });
});
