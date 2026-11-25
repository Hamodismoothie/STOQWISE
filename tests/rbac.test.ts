import { describe, expect, test } from "bun:test";
import { can, canDeleteOrgData, limitsFor, planLimits, roleRank, type Permission, type Role } from "../src/data/repo.ts";

const roles: Role[] = ["owner", "admin", "analyst", "viewer"];
const permissions: Permission[] = [
  "org.manage",
  "members.manage",
  "billing.manage",
  "data.write",
  "data.read",
  "data.delete",
  "api.manage",
  "copilot.use",
];

describe("behörighetsmodell", () => {
  test("ägaren har allt", () => {
    for (const p of permissions) expect(can("owner", p)).toBe(true);
  });

  test("läsaren kan bara läsa", () => {
    expect(can("viewer", "data.read")).toBe(true);
    for (const p of permissions.filter((x) => x !== "data.read")) {
      expect(can("viewer", p)).toBe(false);
    }
  });

  test("analytikern får skriva data men inte hantera team eller api", () => {
    expect(can("analyst", "data.write")).toBe(true);
    expect(can("analyst", "data.read")).toBe(true);
    expect(can("analyst", "members.manage")).toBe(false);
    expect(can("analyst", "api.manage")).toBe(false);
    expect(can("analyst", "billing.manage")).toBe(false);
  });

  test("administratören får allt utom fakturering", () => {
    expect(can("admin", "members.manage")).toBe(true);
    expect(can("admin", "api.manage")).toBe(true);
    expect(can("admin", "billing.manage")).toBe(false);
  });

  test("rangordningen är strikt", () => {
    expect(roleRank.owner).toBeGreaterThan(roleRank.admin);
    expect(roleRank.admin).toBeGreaterThan(roleRank.analyst);
    expect(roleRank.analyst).toBeGreaterThan(roleRank.viewer);
  });

  test("okänd roll nekas allt", () => {
    expect(can("hacker" as Role, "data.read")).toBe(false);
  });
});

describe("planbegränsningar", () => {
  test("planerna är ordnade i stigande kapacitet", () => {
    const order = ["trial", "basic", "multi", "enterprise"];
    for (let i = 1; i < order.length; i++) {
      expect(planLimits[order[i]!]!.maxSkus).toBeGreaterThan(planLimits[order[i - 1]!]!.maxSkus);
      expect(planLimits[order[i]!]!.maxAnalysesPerMonth).toBeGreaterThan(planLimits[order[i - 1]!]!.maxAnalysesPerMonth);
    }
  });

  test("okänd plan faller tillbaka på trial", () => {
    expect(limitsFor("finns-inte").id).toBe("trial");
  });

  test("radering kräver både roll och plan", () => {
    expect(canDeleteOrgData("owner", { deleteData: true })).toBe(true);
    expect(canDeleteOrgData("admin", { deleteData: true })).toBe(true);
    expect(canDeleteOrgData("analyst", { deleteData: true })).toBe(false);
    expect(canDeleteOrgData("viewer", { deleteData: true })).toBe(false);
    // A plan can withdraw the capability without changing roles.
    expect(canDeleteOrgData("owner", { deleteData: false })).toBe(false);
    for (const plan of Object.values(planLimits)) expect(plan.deleteData).toBe(true);
  });

  test("endast betalplaner har API i praktiken", () => {
    expect(planLimits.trial!.apiAccess).toBe(false);
    expect(planLimits.basic!.apiAccess).toBe(true);
    expect(planLimits.enterprise!.apiAccess).toBe(true);
  });
});
