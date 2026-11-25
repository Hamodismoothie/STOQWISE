/**
 * One supervised autonomous check cycle for STOQWISE.
 *
 * Runs the checks that must always hold — typecheck, the test suite, and a smoke
 * boot of the real server against a throwaway database — and writes a durable
 * record of the outcome. It never touches `data/lagerradar.db`, never changes
 * code and never deploys: it is the watchdog an unattended session can rely on,
 * not a replacement for a developer.
 *
 * Usage:
 *   bun scripts/autopilot.ts            # full cycle (typecheck + tests + smoke)
 *   bun scripts/autopilot.ts --quick    # skip the test suite
 *
 * Exit code 0 only when every step passed. Logs: data/autopilot/.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const LOG_DIR = join(ROOT, "data", "autopilot");
const LOCK = join(LOG_DIR, "run.lock");
const SMOKE_PORT = 3996;
const SMOKE_DB = join(LOG_DIR, "smoke.db");
const LOCK_TTL_MS = 2 * 60 * 60 * 1000;

type StepResult = { step: string; ok: boolean; seconds: number; detail: string };

const quick = process.argv.includes("--quick");

function tail(value: string, lines = 12): string {
  const parts = value.trim().split("\n");
  return parts.slice(Math.max(0, parts.length - lines)).join("\n");
}

function run(step: string, command: string[], timeoutMs = 300_000): StepResult {
  const started = performance.now();
  const result = Bun.spawnSync(command, {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: "test", RESEND_API_KEY: "", MAIL_FROM: "" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });
  const seconds = Math.round((performance.now() - started) / 100) / 10;
  const output = `${result.stdout?.toString() ?? ""}\n${result.stderr?.toString() ?? ""}`.trim();
  const summary = output.split("\n").filter((line) => /pass|fail|error|TS\d+|exit/i.test(line)).slice(-6).join(" | ");
  return {
    step,
    ok: result.exitCode === 0,
    seconds,
    detail: result.exitCode === 0 ? summary || "ok" : tail(output, 15),
  };
}

async function smoke(): Promise<StepResult> {
  const started = performance.now();
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${SMOKE_DB}${suffix}`, { force: true });

  const server = Bun.spawn([process.execPath, "src/server.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(SMOKE_PORT),
      DB_PATH: SMOKE_DB,
      APP_ORIGIN: `http://localhost:${SMOKE_PORT}`,
      NODE_ENV: "test",
      RESEND_API_KEY: "",
      MAIL_FROM: "",
    },
    stdout: "ignore",
    stderr: "pipe",
  });

  const base = `http://localhost:${SMOKE_PORT}`;
  const checks: string[] = [];
  let ok = true;
  try {
    const deadline = Date.now() + 25_000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${base}/halsa`);
        if (res.ok) {
          up = true;
          break;
        }
      } catch {
        /* not up yet */
      }
      await Bun.sleep(200);
    }
    if (!up) {
      ok = false;
      checks.push("servern svarade inte på /halsa inom 25 s");
    }

    for (const path of up ? ["/halsa", "/api/v1/health", "/", "/om-oss", "/priser", "/produkt", "/kontakt", "/robots.txt", "/sitemap.xml"] : []) {
      const res = await fetch(`${base}${path}`);
      checks.push(`${path}=${res.status}`);
      if (res.status !== 200) {
        ok = false;
        break;
      }
    }

    // En medvetet okänd sökväg ska ge 404 — fångar en trasig felhanterare.
    const missingPath = "/finns-inte";
    const missing = await fetch(`${base}${missingPath}`);
    checks.push(`${missingPath}=${missing.status} (väntar 404)`);
    if (missing.status !== 404) {
      ok = false;
      checks.push("felhanteraren returnerade inte 404 för okänd sökväg");
    }
  } catch (error) {
    ok = false;
    checks.push(`fel: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    server.kill();
  }

  const seconds = Math.round((performance.now() - started) / 100) / 10;
  return { step: "smoke", ok, seconds, detail: checks.join(" ") };
}

function acquireLock(): boolean {
  if (existsSync(LOCK)) {
    try {
      const lock = JSON.parse(readFileSync(LOCK, "utf8")) as { pid: number; startedAt: number };
      const age = Date.now() - lock.startedAt;
      if (age < LOCK_TTL_MS && isAlive(lock.pid)) return false;
    } catch {
      /* corrupt lock: replace it */
    }
  }
  writeFileSync(LOCK, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
  return true;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  mkdirSync(LOG_DIR, { recursive: true });
  if (!acquireLock()) {
    console.error("Ett autopilot-pass kör redan. Avbryter.");
    process.exit(2);
  }

  const startedAt = new Date().toISOString();
  const steps: StepResult[] = [];
  try {
    steps.push(run("typecheck", ["bun", "run", "typecheck"], 180_000));
    if (!quick) steps.push(run("test", ["bun", "test"], 600_000));
    steps.push(await smoke());
  } finally {
    rmSync(LOCK, { force: true });
  }

  const failed = steps.filter((step) => !step.ok);
  const record = { startedAt, finishedAt: new Date().toISOString(), quick, ok: failed.length === 0, steps };

  appendFileSync(join(LOG_DIR, `${startedAt.slice(0, 10)}.jsonl`), `${JSON.stringify(record)}\n`);
  writeFileSync(join(LOG_DIR, "last-run.json"), `${JSON.stringify(record, null, 2)}\n`);

  for (const step of steps) {
    console.log(`${step.ok ? "OK  " : "FEL "} ${step.step.padEnd(10)} ${String(step.seconds).padStart(6)}s  ${step.detail}`);
  }
  console.log(failed.length === 0 ? "\nAutopilot: alla steg gröna." : `\nAutopilot: ${failed.length} steg misslyckades. Se data/autopilot/.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
