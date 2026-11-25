/**
 * Local owner access provisioning.
 *
 * Run from the server host, never over HTTP. It creates or rotates a separate
 * internal test tenant and a separate platform administrator. Passwords are
 * generated locally and written only to `.secrets/owner-access.json` (0600);
 * they are never embedded in source, printed by this script or served by the app.
 *
 * Usage: bun run owner:access
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { config } from "../src/config.ts";
import { db } from "../src/db.ts";
import { createUser, deleteSessionsForUser, findUserByEmail } from "../src/db.ts";
import { hashPassword } from "../src/auth.ts";
import { createAdmin, deleteAdminSessions, findAdminByEmail, updateAdminPassword, setTotpSecret } from "../src/admin/auth.ts";
import { logAdmin } from "../src/admin/store.ts";
import { getPricingRules, savePricingProfile } from "../src/data/repo.ts";
import { calculateEstimate, MODULE_IDS, type PricingProfile } from "../src/pricing.ts";

const password = (): string => randomBytes(24).toString("base64url");
const now = (): string => new Date().toISOString();

const TEST_EMAIL = (process.env.OWNER_TEST_EMAIL ?? "testagare@stoqwise.test").toLowerCase();
const ADMIN_EMAIL = (process.env.OWNER_ADMIN_EMAIL ?? "admin@stoqwise.test").toLowerCase();
const TEST_NAME = "Produktägare – testkonto";
const ADMIN_NAME = "Produktägare – administratör";
const TEST_ORG = "STOQWISE Intern Test";

const testPassword = password();
const adminPassword = password();

const existingTest = findUserByEmail(TEST_EMAIL);
const testUser = existingTest
  ? (db.query("UPDATE users SET name = $n, company = $c, status = 'active', password_hash = $h WHERE id = $id").run({
      $n: TEST_NAME,
      $c: "STOQWISE Intern",
      $h: hashPassword(testPassword),
      $id: existingTest.id,
    }),
    existingTest)
  : createUser({ email: TEST_EMAIL, passwordHash: hashPassword(testPassword), name: TEST_NAME, company: "STOQWISE Intern" });
deleteSessionsForUser(testUser.id);

const membership = db.query("SELECT org_id FROM members WHERE user_id = $u ORDER BY created_at ASC LIMIT 1").get({ $u: testUser.id }) as { org_id: string } | null;
const orgId = membership?.org_id ?? (() => {
  const id = randomUUID();
  const slug = `stoqwise-intern-test-${id.slice(0, 6)}`;
  db.query(
    `INSERT INTO organizations (id, name, slug, plan, trial_ends_at, settings_json, created_at, kind, status, limits_json)
     VALUES ($id, $n, $s, 'internal_test', NULL, NULL, $c, 'test', 'active', NULL)`,
  ).run({ $id: id, $n: TEST_ORG, $s: slug, $c: now() });
  db.query("INSERT INTO members (org_id, user_id, role, created_at) VALUES ($o, $u, 'owner', $c)").run({ $o: id, $u: testUser.id, $c: now() });
  db.query(
    "INSERT INTO subscriptions (id, org_id, plan, status, seats, created_at, updated_at) VALUES ($id, $o, 'internal_test', 'internal', 1, $t, $t)",
  ).run({ $id: randomUUID(), $o: id, $t: now() });
  return id;
})();

// Idempotent: an existing test organisation is upgraded to the internal
// entitlement, while ordinary customer organisations are never touched.
db.query(
  "UPDATE organizations SET name = $n, plan = 'internal_test', kind = 'test', status = 'active', limits_json = NULL WHERE id = $id",
).run({ $n: TEST_ORG, $id: orgId });
db.query("UPDATE members SET role = 'owner' WHERE org_id = $o AND user_id = $u").run({ $o: orgId, $u: testUser.id });
const existingProfile = db.query("SELECT 1 FROM pricing_profiles WHERE org_id = $o").get({ $o: orgId });
if (!existingProfile) {
  const profile: PricingProfile = {
    industry: "Intern testverksamhet",
    country: "SE",
    businessType: "internal_test",
    employees: 10,
    locations: 1,
    warehouses: 1,
    stores: 0,
    skus: 500_000,
    inventoryValue: 50_000_000,
    monthlyTransactions: 100_000,
    suppliers: 100,
    users: 10,
    modules: [...MODULE_IDS],
    support: "dedicated",
    billingCycle: "monthly",
    integrations: 5,
    erp: "Test-ERP",
    wms: "Test-WMS",
    pos: "",
    ecommerce: "",
    dataFormats: ["CSV", "XLSX"],
    notes: "Internt testkonto – ingen betalning eller kundrelation.",
  };
  savePricingProfile(orgId, profile, calculateEstimate(profile, getPricingRules()));
}
const subscription = db.query("SELECT 1 FROM subscriptions WHERE org_id = $o").get({ $o: orgId });
if (subscription) {
  db.query("UPDATE subscriptions SET plan = 'internal_test', status = 'internal', updated_at = $t WHERE org_id = $o").run({ $t: now(), $o: orgId });
} else {
  db.query(
    "INSERT INTO subscriptions (id, org_id, plan, status, seats, created_at, updated_at) VALUES ($id, $o, 'internal_test', 'internal', 1, $t, $t)",
  ).run({ $id: randomUUID(), $o: orgId, $t: now() });
}

const existingAdmin = findAdminByEmail(ADMIN_EMAIL);
let adminId: string;
if (existingAdmin) {
  db.query("UPDATE admin_users SET name = $n, role = 'owner' WHERE id = $id").run({ $n: ADMIN_NAME, $id: existingAdmin.id });
  updateAdminPassword(existingAdmin.id, adminPassword);
  setTotpSecret(existingAdmin.id, null, false);
  deleteAdminSessions(existingAdmin.id);
  adminId = existingAdmin.id;
} else {
  adminId = createAdmin({ email: ADMIN_EMAIL, password: adminPassword, name: ADMIN_NAME }).id;
}

logAdmin({
  adminId,
  action: existingAdmin ? "admin.recovery" : "admin.bootstrap",
  target: ADMIN_EMAIL,
  ip: "local-cli",
  meta: { testOrgId: orgId, testEmail: TEST_EMAIL },
});

const dir = join(config.root, ".secrets");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = join(dir, "owner-access.json");
const payload = {
  generatedAt: now(),
  warning: "Lokala hemligheter. Dela aldrig filen. Kör om kommandot för att rotera båda lösenorden.",
  testAccount: {
    url: `${config.appOrigin}/logga-in`,
    email: TEST_EMAIL,
    password: testPassword,
    organization: TEST_ORG,
    organizationId: orgId,
    entitlement: "internal_test",
  },
  administrator: {
    url: `${config.appOrigin}/admin/logg-in`,
    email: ADMIN_EMAIL,
    password: adminPassword,
    role: "owner",
  },
};
writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
chmodSync(file, 0o600);

console.log("STOQWISE owner access created/rotated.");
console.log(`Testkonto: ${TEST_EMAIL} · ${config.appOrigin}/logga-in`);
console.log(`Admin: ${ADMIN_EMAIL} · ${config.appOrigin}/admin/logg-in`);
console.log(`Lösenord och fullständig instruktion: ${file} (rättighet 0600)`);
console.log("Kör `bun run owner:access` igen för att rotera båda lösenorden.");
