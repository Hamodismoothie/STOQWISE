/**
 * Password reset, invitation mail and contact notifications.
 *
 * Runs against a real server and a throwaway database. No provider key is set,
 * so every message lands in mail_log (outbox mode), which is where the test
 * reads the links from, exactly as a local developer would.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PORT = 3994;
const BASE = `http://localhost:${PORT}`;
const DB = join(ROOT, "data", "test-mail.db");
const SV = "lr_lang=sv";

let proc: ReturnType<typeof Bun.spawn> | null = null;
let db: Database | null = null;

const cookieFrom = (response: Response): string => (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

async function post(path: string, fields: Record<string, string>, cookie = ""): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: BASE, cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

async function register(email: string, password = "original-password-123", lang = SV): Promise<string> {
  const res = await post(
    "/skapa-konto",
    {
      namn: "Reset Test",
      foretag: "Reset Test AB",
      epost: email,
      losenord: password,
      plan: "trial",
    },
    lang,
  );
  expect(res.status).toBe(303);
  return cookieFrom(res);
}

function rows<T>(sql: string): T[] {
  return db!.query(sql).all() as T[];
}

async function waitForMail(kind: string, timeoutMs = 3000): Promise<{ to_email: string; body: string; status: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = rows<{ to_email: string; body: string; status: string }>(
      `SELECT to_email, body, status FROM mail_log WHERE kind = '${kind}' ORDER BY id DESC LIMIT 1`,
    )[0];
    if (found) return found;
    await Bun.sleep(50);
  }
  throw new Error(`Inget ${kind}-mejl inom ${timeoutMs} ms`);
}

function tokenFrom(body: string, path: string): string {
  const match = body.match(new RegExp(`${path}/([A-Za-z0-9_-]+)`));
  expect(match).toBeTruthy();
  return match![1]!;
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

describe("lösenordsåterställning", () => {
  const email = "reset-owner@test.se";
  const password = "original-password-123";
  let cookie = "";
  let token = "";

  test("begäran mejlar en engångslänk och sparar bara hashen", async () => {
    cookie = await register(email, password);
    const res = await post("/glomt-losenord", { epost: email }, SV);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("har vi skickat en länk");

    const mails = rows<{ status: string; body: string }>(
      "SELECT status, body FROM mail_log WHERE kind = 'password_reset'",
    );
    expect(mails.length).toBe(1);
    expect(mails[0]!.status).toBe("outbox");
    token = tokenFrom(mails[0]!.body, "/aterstall-losenord");

    const stored = rows<{ token_hash: string }>("SELECT token_hash FROM password_resets");
    expect(stored.length).toBe(1);
    expect(stored[0]!.token_hash).not.toContain(token);
  });

  test("en okänd adress får samma svar utan att något skickas", async () => {
    const before = rows<{ c: number }>("SELECT COUNT(*) AS c FROM mail_log")[0]!.c;
    const res = await post("/glomt-losenord", { epost: "nobody@test.se" }, SV);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("har vi skickat en länk");
    const after = rows<{ c: number }>("SELECT COUNT(*) AS c FROM mail_log")[0]!.c;
    expect(after).toBe(before);
  });

  test("länken visar formuläret och avvisar olika lösenord", async () => {
    const page = await fetch(`${BASE}/aterstall-losenord/${token}`, { headers: { cookie: SV } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Välj ett nytt lösenord");

    const mismatch = await post(
      `/aterstall-losenord/${token}`,
      { losenord: "new-password-123", losenord2: "other-password-123" },
      SV,
    );
    expect(mismatch.status).toBe(400);
    expect(await mismatch.text()).toContain("Lösenorden stämmer inte överens.");
  });

  test("ett nytt lösenord sparas, loggar ut sessioner och kan inte återanvändas", async () => {
    const res = await post(
      `/aterstall-losenord/${token}`,
      { losenord: "new-password-123", losenord2: "new-password-123" },
      SV,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/logga-in?aterstalld=1");

    const confirmation = await waitForMail("password_change");
    expect(confirmation.to_email).toBe(email);
    expect(confirmation.status).toBe("outbox");
    expect(confirmation.body).toContain("Lösenordet för ditt konto hos STOQWISE ändrades");
    expect(confirmation.body).toMatch(/2026/);
    expect(confirmation.body).toContain("Om du inte ändrade lösenordet själv");
    expect(confirmation.body).toContain(`${BASE}/kontakt`);

    const old = await post("/logga-in", { epost: email, losenord: password });
    expect(old.status).toBe(401);
    const fresh = await post("/logga-in", { epost: email, losenord: "new-password-123" });
    expect(fresh.status).toBe(303);

    // Sessionen som skapades vid registreringen är borta.
    const stale = await fetch(`${BASE}/app`, { redirect: "manual", headers: { cookie } });
    expect(stale.status).toBe(303);
    expect(stale.headers.get("location")).toContain("/logga-in");

    const reuse = await post(
      `/aterstall-losenord/${token}`,
      { losenord: "another-password-123", losenord2: "another-password-123" },
      SV,
    );
    expect(reuse.status).toBe(410);
  });

  test("en utgången länk nekas", async () => {
    await post("/glomt-losenord", { epost: email }, SV);
    const body = rows<{ body: string }>(
      "SELECT body FROM mail_log WHERE kind = 'password_reset' ORDER BY id DESC LIMIT 1",
    )[0]!.body;
    const expired = tokenFrom(body, "/aterstall-losenord");
    db!.query("UPDATE password_resets SET expires_at = $t WHERE used_at IS NULL").run({
      $t: new Date(Date.now() - 60_000).toISOString(),
    });

    const page = await fetch(`${BASE}/aterstall-losenord/${expired}`, { headers: { cookie: SV } });
    expect(page.status).toBe(410);
    expect(await page.text()).toContain("Länken är ogiltig eller har gått ut");
  });
});

describe("inbjudan och kontaktformulär", () => {
  test("en inbjudan mejlas till adressen med en engångslänk", async () => {
    const cookie = await register("invite-owner@test.se");
    const res = await post("/app/team/bjud-in", { email: "new-member@test.se", roll: "analyst" }, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("inbjudan=");

    const mail = rows<{ to_email: string; subject: string; body: string }>(
      "SELECT to_email, subject, body FROM mail_log WHERE kind = 'invitation' ORDER BY id DESC LIMIT 1",
    )[0]!;
    expect(mail.to_email).toBe("new-member@test.se");
    expect(mail.subject).toContain("Reset Test AB");
    expect(mail.body).toContain("/bjud-in/");
    expect(mail.body).toContain("Analytiker");

    // Inbjudans språk följer inbjudaren, inte mottagarens cookie.
    const token = tokenFrom(mail.body, "/bjud-in");
    const page = await fetch(`${BASE}/bjud-in/${token}`, { headers: { cookie: "lr_lang=en" } });
    expect(await page.text()).toContain("Gå med i teamet");
  });

  test("en engelsk inbjudan ger engelskt mejl och engelsk sida", async () => {
    const cookie = await register("invite-en-owner@test.se", undefined, "lr_lang=en");
    const res = await post("/app/team/bjud-in", { email: "new-en-member@test.se", roll: "admin" }, `${cookie}; lr_lang=en`);
    expect(res.status).toBe(303);

    const mail = rows<{ subject: string; body: string }>(
      "SELECT subject, body FROM mail_log WHERE kind = 'invitation' ORDER BY id DESC LIMIT 1",
    )[0]!;
    expect(mail.subject).toContain("You are invited to Reset Test AB");
    expect(mail.body).toContain("Administrator");

    const token = tokenFrom(mail.body, "/bjud-in");
    const page = await fetch(`${BASE}/bjud-in/${token}`, { headers: { cookie: SV } });
    expect(await page.text()).toContain("Join the team");
  });

  test("kontaktformuläret notifierar den interna adressen", async () => {
    const res = await post("/kontakt", {
      namn: "Kund Test",
      epost: "kund@test.se",
      foretag: "Kund AB",
      amne: "General inquiry",
      meddelande: "Vi vill veta mer om lageranalys.",
    });
    expect(res.status).toBe(200);

    const mail = rows<{ to_email: string; status: string; body: string }>(
      "SELECT to_email, status, body FROM mail_log WHERE kind = 'contact' ORDER BY id DESC LIMIT 1",
    )[0]!;
    expect(mail.to_email).toBe("inbox@test.se");
    expect(mail.status).toBe("outbox");
    expect(mail.body).toContain("kund@test.se");
    expect(mail.body).toContain("Vi vill veta mer om lageranalys.");
  });
});
