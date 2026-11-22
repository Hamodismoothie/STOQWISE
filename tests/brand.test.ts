import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { brandEmail, resolveBrandDomain } from "../src/brand.ts";

describe("varumärkesdomän", () => {
  test("giltig domän normaliseras", () => {
    expect(resolveBrandDomain("stoqwise.se")).toBe("stoqwise.se");
    expect(resolveBrandDomain("  STOQWISE.COM ")).toBe("stoqwise.com");
    expect(resolveBrandDomain("mail.example.co.uk")).toBe("mail.example.co.uk");
  });

  test("ogiltig eller tom domän ger ingen adress", () => {
    for (const raw of ["", "   ", "stoqwise", "https://stoqwise.se", "stoqwise..se", "-stoqwise.se", "stoqwise.se/", null, undefined]) {
      expect(resolveBrandDomain(raw)).toBeNull();
    }
  });

  test("adresser byggs bara när domänen finns", () => {
    expect(brandEmail("hello", "stoqwise.se")).toBe("hello@stoqwise.se");
    expect(brandEmail("privacy", "stoqwise.se")).toBe("privacy@stoqwise.se");
    expect(brandEmail("hello", null)).toBeNull();
  });
});

const ROOT = join(import.meta.dir, "..");

test(
  "med egen domän blir adresserna klickbara och inga null läcker ut",
  async () => {
    const port = 3989;
    const base = `http://localhost:${port}`;
    const db = join(ROOT, "data", "test-brand-mail.db");
    for (const suffix of ["", "-wal", "-shm"]) rmSync(db + suffix, { force: true });
    const proc = Bun.spawn([process.execPath, "src/server.ts"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        APP_ORIGIN: base,
        BRAND_EMAIL_DOMAIN: "example.se",
        DB_PATH: db,
        SESSION_SECRET: "test-secret-test-secret-test-secret",
      },
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      let ready = false;
      for (let i = 0; i < 60 && !ready; i++) {
        try {
          ready = (await fetch(`${base}/halsa`)).ok;
        } catch {
          await Bun.sleep(100);
        }
      }
      expect(ready).toBe(true);
      const contact = await (await fetch(`${base}/kontakt`)).text();
      expect(contact).toContain('href="mailto:hello@example.se"');
      expect(contact).not.toContain(">null<");
      const privacy = await (await fetch(`${base}/integritet`)).text();
      expect(privacy).toContain('href="mailto:privacy@example.se"');
    } finally {
      proc.kill();
      for (const suffix of ["", "-wal", "-shm"]) rmSync(db + suffix, { force: true });
    }
  },
  15000,
);
