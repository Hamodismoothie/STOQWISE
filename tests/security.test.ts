/**
 * Negative security regression tests.
 *
 * These tests try to do the things an attacker would try: grant a paid plan,
 * take over an invitation, promote themselves, redirect off-site, skip CSRF,
 * upload an executable, inject spreadsheet formulas, exhaust the xlsx parser and
 * make the server fetch an internal address. They run against a throwaway
 * database and a real HTTP server, never customer data.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { csvCell, parseCsv } from "../src/csv.ts";
import { readXlsx } from "../src/xlsx.ts";
import { assertSafeWebhookUrl } from "../src/webhooks.ts";

const ROOT = join(import.meta.dir, "..");
const PORT = 3992;
const BASE = `http://localhost:${PORT}`;
const DB = join(ROOT, "data", "test-security.db");

const OWNER_EMAIL = "security-owner@test.se";
const OWNER2_EMAIL = "security-owner2@test.se";
const OWNER_PASSWORD = "owner-password-12345";
const EXISTING_EMAIL = "security-existing@test.se";
const EXISTING_PASSWORD = "existing-password-12345";
const VIEWER_EMAIL = "security-viewer@test.se";
const VIEWER_PASSWORD = "viewer-password-12345";

let proc: ReturnType<typeof Bun.spawn> | null = null;

const cookieFrom = (response: Response): string => (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

async function post(path: string, fields: Record<string, string>, cookie = "", origin: string | null = BASE): Promise<Response> {
  const headers: Record<string, string> = { cookie, "content-type": "application/x-www-form-urlencoded" };
  if (origin) headers.origin = origin;
  return fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers,
    body: new URLSearchParams(fields).toString(),
  });
}

async function register(email: string, company: string, password: string, plan = "trial"): Promise<string> {
  const res = await post("/skapa-konto", { namn: "Security Test", foretag: company, epost: email, losenord: password, plan }, "lr_lang=sv");
  expect(res.status).toBe(303);
  const cookie = cookieFrom(res);
  expect(cookie).toContain("lr_session=");
  return cookie;
}

function inviteToken(response: Response): string {
  const location = response.headers.get("location") ?? "";
  const link = new URL(location, BASE).searchParams.get("inbjudan");
  expect(link).toBeTruthy();
  return new URL(link!).pathname.split("/").filter(Boolean).pop()!;
}

/** Builds a syntactically valid ZIP envelope with an arbitrary entry count. */
function zipWithEntries(count: number): Uint8Array {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const name = Buffer.from(`f${i}`);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local);

    const record = Buffer.alloc(46 + name.length);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    name.copy(record, 46);
    central.push(record);
    offset += local.length;
  }
  const centralOffset = offset;
  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return new Uint8Array(Buffer.concat([...locals, ...central, end]));
}

beforeAll(async () => {
  for (const suffix of ["", "-shm", "-wal"]) {
    const file = `${DB}${suffix}`;
    if (existsSync(file)) rmSync(file);
  }
  proc = Bun.spawn([process.execPath, "src/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, NODE_ENV: "test" },
    stdout: "ignore",
    stderr: "pipe",
  });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/halsa`)).ok) return;
    } catch {
      /* still starting */
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
        /* process may still hold the handle */
      }
    }
  }
});

describe("planer och betalning", () => {
  let ownerCookie = "";

  test("registrering med betald plan ger ändå endast trial", async () => {
    ownerCookie = await register(OWNER_EMAIL, "Security Owner AB", OWNER_PASSWORD, "enterprise");
    const billing = await fetch(`${BASE}/app/abonnemang`, { headers: { cookie: ownerCookie } });
    expect(billing.status).toBe(200);
    const body = await billing.text();
    expect(body).toContain(">Prova på<");
    expect(body).not.toContain(">Enterprise<");
  });

  test("egen planuppgradering nekas och kräver offert", async () => {
    const res = await post("/app/abonnemang/byt", { plan: "enterprise" }, ownerCookie);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("fel=");

    const billing = await fetch(`${BASE}/app/abonnemang`, { headers: { cookie: ownerCookie } });
    expect(await billing.text()).toContain(">Prova på<");
  });

  test("inloggning kan inte styras till en extern adress", async () => {
    const res = await post("/logga-in", { epost: OWNER_EMAIL, losenord: OWNER_PASSWORD, nasta: "//evil.example" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/app");

    const encoded = await post("/logga-in", { epost: OWNER_EMAIL, losenord: OWNER_PASSWORD, nasta: "/%5C%5Cevil.example" });
    expect(encoded.status).toBe(303);
    expect(encoded.headers.get("location")).toBe("/app");
  });

  test("uppladdning av en körbar fil avvisas", async () => {
    const data = new FormData();
    data.set("file", new File(["MZ not a spreadsheet"], "payload.exe", { type: "application/octet-stream" }));
    const res = await fetch(`${BASE}/app/importera`, {
      method: "POST",
      redirect: "manual",
      headers: { origin: BASE, cookie: ownerCookie },
      body: data,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("fel=");
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("CSV, TSV, TXT eller XLSX");
  });

  test("utloggning utan same-origin nekas", async () => {
    const blocked = await post("/logga-ut", {}, ownerCookie, null);
    expect(blocked.status).toBe(403);
    const allowed = await post("/logga-ut", {}, ownerCookie);
    expect(allowed.status).toBe(303);
  });
});

describe("inbjudningar och roller", () => {
  let ownerCookie = "";
  let existingCookie = "";
  let viewerCookie = "";

  test("en befintlig användare kan inte ta över en inbjudan utan lösenord", async () => {
    ownerCookie = await register(OWNER2_EMAIL, "Security Owner Two AB", OWNER_PASSWORD);
    existingCookie = await register(EXISTING_EMAIL, "Security Existing AB", EXISTING_PASSWORD);

    const invite = await post("/app/team/bjud-in", { email: EXISTING_EMAIL, roll: "admin" }, ownerCookie);
    expect(invite.status).toBe(303);
    const token = inviteToken(invite);

    const wrong = await post(`/bjud-in/${token}`, { namn: "Intruder", losenord: "wrong-password-12345" });
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toContain("Lösenordet stämmer inte");

    const ok = await post(`/bjud-in/${token}`, { namn: "Existing User", losenord: EXISTING_PASSWORD });
    expect(ok.status).toBe(303);
    expect(existingCookie).toContain("lr_session=");
  });

  test("en ägare kan inte bjuda in en ny ägare", async () => {
    const res = await post("/app/team/bjud-in", { email: "second-owner@test.se", roll: "owner" }, ownerCookie);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("fel=");
    expect(res.headers.get("location")).not.toContain("inbjudan=");
  });

  test("en läsare ser inte teamet och kan inte befordra sig", async () => {
    const invite = await post("/app/team/bjud-in", { email: VIEWER_EMAIL, roll: "viewer" }, ownerCookie);
    expect(invite.status).toBe(303);
    const token = inviteToken(invite);

    const accepted = await post(`/bjud-in/${token}`, { namn: "Viewer User", losenord: VIEWER_PASSWORD });
    expect(accepted.status).toBe(303);
    viewerCookie = cookieFrom(accepted);

    const denied = await fetch(`${BASE}/app/team`, { headers: { cookie: viewerCookie } });
    expect(denied.status).toBe(403);

    const team = await (await fetch(`${BASE}/app/team`, { headers: { cookie: ownerCookie } })).text();
    const ids = [...new Set([...team.matchAll(/name="user" value="([^"]+)"/g)].map((match) => match[1]!))];
    expect(ids.length).toBe(2); // existing admin + viewer; the owner has no controls
    const viewerId = ids[ids.length - 1]!;

    const promote = await post("/app/team/roll", { user: viewerId, roll: "admin" }, ownerCookie);
    expect(promote.status).toBe(303);

    const elevated = await fetch(`${BASE}/app/team`, { headers: { cookie: viewerCookie } });
    expect(elevated.status).toBe(200);

    // Admin får inte ändra abonnemanget; det är owner-only (billing.manage).
    const billingAttempt = await post("/app/abonnemang/byt", { plan: "trial" }, viewerCookie);
    expect(billingAttempt.status).toBe(403);

    const escalated = await post("/app/team/roll", { user: ids[0]!, roll: "owner" }, viewerCookie);
    expect(escalated.status).toBe(303);
    expect(escalated.headers.get("location")).toContain("fel=");

    const inviteAdmin = await post("/app/team/bjud-in", { email: "new-admin@test.se", roll: "admin" }, viewerCookie);
    expect(inviteAdmin.status).toBe(303);
    expect(inviteAdmin.headers.get("location")).toContain("fel=");

    const ownerEscalation = await post("/app/team/roll", { user: viewerId, roll: "owner" }, ownerCookie);
    expect(ownerEscalation.status).toBe(303);
    expect(ownerEscalation.headers.get("location")).toContain("fel=");
  });

  test("borttagning kräver same-origin", async () => {
    const team = await (await fetch(`${BASE}/app/team`, { headers: { cookie: ownerCookie } })).text();
    const ids = [...new Set([...team.matchAll(/name="user" value="([^"]+)"/g)].map((match) => match[1]!))];
    const res = await post("/app/team/ta-bort", { user: ids[0]! }, ownerCookie, null);
    expect(res.status).toBe(403);
  });
});

describe("parser och exportskydd", () => {
  test("CSV-celler som börjar med formeltecken neutraliseras", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+SUM(A1:A2)")).toBe("'+SUM(A1:A2)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("\t=1+1")).toBe("'\t=1+1");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("vanlig;text")).toBe('"vanlig;text"');
  });

  test("CSV-parsern stoppar innan en orimlig radmängd", () => {
    expect(() => parseCsv("a;b\n1;2\n3;4\n5;6", undefined, 2)).toThrow(/fler än 2 rader/);
  });

  test("xlsx med för många ZIP-delar avvisas före uppackning", () => {
    expect(() => readXlsx(zipWithEntries(257))).toThrow(/för många delar/);
  });
});

describe("webhook-SSRF", () => {
  test("loopback, link-local och privata adresser avvisas", async () => {
    await expect(assertSafeWebhookUrl("http://127.0.0.1/hook")).rejects.toThrow();
    await expect(assertSafeWebhookUrl("https://169.254.169.254/latest/meta-data")).rejects.toThrow();
    await expect(assertSafeWebhookUrl("https://[::1]/hook")).rejects.toThrow();
    await expect(assertSafeWebhookUrl("https://10.0.0.5/hook")).rejects.toThrow();
    await expect(assertSafeWebhookUrl("https://user:pass@example.com/hook")).rejects.toThrow();
  });
});
