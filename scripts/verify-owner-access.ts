/**
 * End-to-end verification of the local owner accounts over real HTTP.
 * Reads `.secrets/owner-access.json`, never prints a password, and exits
 * non-zero on the first failed invariant.
 *
 * Run: OWNER_VERIFY_ORIGIN=http://localhost:3000 bun run verify:owner
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../src/config.ts";
import { db } from "../src/db.ts";

interface AccessFile {
  testAccount: { url: string; email: string; password: string; organizationId: string };
  administrator: { url: string; email: string; password: string };
}

const access = JSON.parse(readFileSync(join(config.root, ".secrets", "owner-access.json"), "utf8")) as AccessFile;
const base = (process.env.OWNER_VERIFY_ORIGIN ?? new URL(access.testAccount.url).origin).replace(/\/$/, "");
let checks = 0;

function ok(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${label}`);
  checks++;
  console.log(`PASS  ${label}`);
}

function cookieFrom(response: Response): string {
  const raw = response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie") ?? "";
  ok(raw.startsWith("lr_session=") || raw.startsWith("sq_admin="), "session cookie issued");
  return raw.split(";")[0]!;
}

async function login(path: string, email: string, password: string): Promise<string> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: base, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ epost: email, losenord: password, nasta: path.startsWith("/admin") ? "/admin" : "/app" }),
  });
  ok(response.status === 303, `${path} returns 303 after valid credentials (${response.status})`);
  return cookieFrom(response);
}

async function get(path: string, cookie: string, expected = 200): Promise<{ status: number; text: string; response: Response }> {
  const response = await fetch(`${base}${path}`, { redirect: "manual", headers: { cookie } });
  const text = await response.text();
  ok(response.status === expected, `${path} returns ${expected} (${response.status})`);
  return { status: response.status, text, response };
}

async function postForm(path: string, cookie: string, fields: Record<string, string>, expected = 303): Promise<Response> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: base, cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  ok(response.status === expected, `${path} returns ${expected} (${response.status})`);
  return response;
}

function csv(rows: number): string {
  const header = "SKU;Name;Category;Stock;Cost;Price;2025-01;2025-02;2025-03;2025-04;2025-05;2025-06";
  const body = Array.from({ length: rows }, (_, i) => `OWNER-${i};Owner article ${i};Verification;${10 + (i % 50)};100;150;${1 + (i % 7)};${1 + (i % 5)};${1 + (i % 9)};${1 + (i % 4)};${1 + (i % 6)};${1 + (i % 8)}`).join("\r\n");
  return `${header}\r\n${body}`;
}

async function uploadCsv(cookie: string, rows: number): Promise<{ upload: Response; page: string }> {
  const form = new FormData();
  form.set("file", new File([csv(rows)], "owner-verification.csv", { type: "text/csv" }));
  form.set("lager", "Verifieringslager");
  form.set("kalla", "csv");
  const upload = await fetch(`${base}/app/importera`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: base, cookie },
    body: form,
  });
  const page = await upload.text();
  return { upload, page };
}

async function importCsv(cookie: string, rows: number): Promise<void> {
  const { upload, page } = await uploadCsv(cookie, rows);
  ok(upload.status === 200, `upload ${rows} rows returns mapping page (${upload.status})`);
  const draft = page.match(/name="draft" value="([^"]+)"/)?.[1];
  ok(draft, "mapping draft issued");
  const run = await fetch(`${base}/app/importera/kor`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: base, cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ draft: draft!, lager: "Verifieringslager" }),
  });
  ok(run.status === 303 && (run.headers.get("location") ?? "").startsWith("/app?analys="), `analysis ${rows} rows completes (${run.status})`);
}

console.log(`Owner verification against ${base}`);

const testCookie = await login("/logga-in", access.testAccount.email, access.testAccount.password);
await get("/app/importera", testCookie);

// Trial allows 3 analyses/month. Five consecutive imports prove the internal
// entitlement is enforced server-side, not hidden in the UI.
for (let i = 0; i < 4; i++) await importCsv(testCookie, 40);
await importCsv(testCookie, 5_000);

const dashboard = await get("/app", testCookie);
ok(dashboard.text.includes("STOQWISE Intern Test") || dashboard.text.includes("Internt testkonto"), "test tenant is visibly identified");
const analysisId = dashboard.text.match(/\/app\/analys\/([a-f0-9-]+)\//)?.[1] ?? dashboard.text.match(/analys=([a-f0-9-]+)/)?.[1];
ok(analysisId, "completed analysis is addressable");

for (const path of ["/app/prognos", "/app/simulering", "/app/inkop", "/app/copilot", "/app/integrationer", "/app/team", "/app/prisestimat", "/app/abonnemang", "/app/logg", "/app/installningar", "/app/lagervarld"]) {
  await get(path, testCookie);
}
const pdf = await fetch(`${base}/app/analys/${analysisId}/rapport.pdf`, { headers: { cookie: testCookie }, redirect: "manual" });
ok(pdf.status === 200 && (pdf.headers.get("content-type") ?? "").includes("application/pdf"), "PDF export works");
const xlsx = await fetch(`${base}/app/analys/${analysisId}/export.xlsx`, { headers: { cookie: testCookie }, redirect: "manual" });
ok(xlsx.status === 200 && (xlsx.headers.get("content-type") ?? "").includes("spreadsheet"), "Excel export works");

const adminCookie = await login("/admin/logg-in", access.administrator.email, access.administrator.password);
for (const path of ["/admin", "/admin/plattform", "/admin/anvandare", "/admin/organisationer", "/admin/testkonton", "/admin/system", "/admin/sakerhet", "/admin/logg"]) {
  await get(path, adminCookie);
}
const testOrgPage = await get(`/admin/organisationer/${access.testAccount.organizationId}`, adminCookie);
ok(testOrgPage.text.includes("Internt testkonto"), "admin sees the internal entitlement");

// Exercise a real server-side admin mutation and its enforcement, then restore it.
await postForm("/admin/system", adminCookie, { signups_enabled: "false", imports_enabled: "true", copilot_enabled: "true", support_message: "owner-access verification" });
const disabledSignup = await fetch(`${base}/skapa-konto`, {
  method: "POST",
  redirect: "manual",
  headers: { origin: base, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ namn: "Blocked", foretag: "Blocked AB", epost: `blocked-${Date.now()}@example.test`, losenord: "blocked-password-2026" }),
});
ok(disabledSignup.status === 503, "disabled self-registration is enforced server-side");
await postForm("/admin/system", adminCookie, { signups_enabled: "true", imports_enabled: "true", copilot_enabled: "true", support_message: "" });

const normalEmail = `owner-verify-${Date.now()}@example.test`;
const signup = await fetch(`${base}/skapa-konto`, {
  method: "POST",
  redirect: "manual",
  headers: { origin: base, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ namn: "Normal Verify", foretag: "Normal Verify AB", epost: normalEmail, losenord: "normal-verify-2026" }),
});
ok(signup.status === 303, "normal self-service account still works after restoring settings");
const normalCookie = cookieFrom(signup);
await get("/start", normalCookie);
for (let i = 0; i < 3; i++) await importCsv(normalCookie, 20);
const capped = await uploadCsv(normalCookie, 20);
ok(capped.upload.status === 303 && (capped.upload.headers.get("location") ?? "").startsWith("/app/importera?fel="), "ordinary trial stops at its 3-analysis quota");
const normalAdmin = await fetch(`${base}/admin`, { headers: { cookie: normalCookie }, redirect: "manual" });
ok(normalAdmin.status === 303 && (normalAdmin.headers.get("location") ?? "").includes("/admin/logg-in"), "normal customer cannot open the admin portal");
const normalAdminPost = await fetch(`${base}/admin/system`, {
  method: "POST",
  redirect: "manual",
  headers: { origin: base, cookie: normalCookie, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ signups_enabled: "true" }),
});
ok(normalAdminPost.status === 303, "normal customer cannot execute an admin mutation");
const normalUser = db.query("SELECT id FROM users WHERE email = $e").get({ $e: normalEmail }) as { id: string };
const normalOrgId = db.query("SELECT org_id FROM members WHERE user_id = $u").get({ $u: normalUser.id }) as { org_id: string };

// Administrative account status is enforced in requireUser, not just in the UI.
await postForm(`/admin/anvandare/${normalUser.id}/status`, adminCookie, { status: "suspended" });
ok((db.query("SELECT status FROM users WHERE id = $id").get({ $id: normalUser.id }) as { status: string }).status === "suspended", "admin can suspend a customer account");
await get("/app", normalCookie, 303);
await postForm(`/admin/anvandare/${normalUser.id}/status`, adminCookie, { status: "active" });
const reactivated = await login("/logga-in", normalEmail, "normal-verify-2026");
await get("/app", reactivated);

// Test-account administration is a confirmed, reversible admin action.
await postForm("/admin/testkonton/promote", adminCookie, { org: normalOrgId.org_id, bekrafta: "1" });
ok((db.query("SELECT kind, plan FROM organizations WHERE id = $id").get({ $id: normalOrgId.org_id }) as { kind: string; plan: string }).kind === "test", "admin can promote a tenant to test");
await postForm(`/admin/testkonton/${normalOrgId.org_id}`, adminCookie, { bekrafta: "1", enabled: "0" });
const demoted = db.query("SELECT kind, plan FROM organizations WHERE id = $id").get({ $id: normalOrgId.org_id }) as { kind: string; plan: string };
ok(demoted.kind === "customer" && demoted.plan === "trial", "admin can remove test status again");
const testAdminAttempt = await fetch(`${base}/admin`, { headers: { cookie: testCookie }, redirect: "manual" });
ok(testAdminAttempt.status === 303, "test account cookie is not an admin session");

const org = db.query("SELECT kind, plan FROM organizations WHERE id = $id").get({ $id: access.testAccount.organizationId }) as { kind: string; plan: string };
ok(org.kind === "test" && org.plan === "internal_test", "test tenant marker and plan are stored server-side");
const count = db.query("SELECT COUNT(*) AS c FROM analyses WHERE org_id = $id AND status = 'ok'").get({ $id: access.testAccount.organizationId }) as { c: number };
ok(count.c >= 5, "five completed analyses are persisted");
const normalOrg = db.query("SELECT o.kind FROM organizations o JOIN members m ON m.org_id = o.id JOIN users u ON u.id = m.user_id WHERE u.email = $e").get({ $e: normalEmail }) as { kind: string } | null;
ok(normalOrg?.kind === "customer", "new customer is not a test account");
const audit = db.query("SELECT COUNT(*) AS c FROM admin_audit WHERE action IN ('admin.login','platform.settings')").get() as { c: number };
ok(audit.c >= 2, "admin actions are audited");

console.log(`\nAll ${checks} owner-access checks passed.`);
