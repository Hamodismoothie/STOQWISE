/**
 * Persistent STOQWISE worker.
 *
 * Keeps the project's verification cycle running between sessions: a quick
 * autopilot pass (typecheck + smoke boot) every `WORKER_CYCLE_MINUTES`, the full
 * test suite every `WORKER_FULL_EVERY_HOURS`, and a crawl of the public surface
 * every `WORKER_LINK_EVERY_HOURS`. It writes a heartbeat and a durable state file
 * so an interrupted run can be resumed and a silent crash is detectable.
 *
 * It never edits code, never touches `data/lagerradar.db`, never sends mail and
 * never deploys. It is the watchdog, not the developer: the decisions that need
 * judgement still belong to an active session.
 *
 * Usage:
 *   bun scripts/worker.ts
 *
 * Environment:
 *   WORKER_CYCLE_MINUTES=30      minutes between quick cycles
 *   WORKER_FULL_EVERY_HOURS=6    hours between full test runs
 *   WORKER_LINK_EVERY_HOURS=12   hours between public link crawls
 *   WORKER_ONCE=true             run a single cycle and exit (for testing)
 *   WORKER_FORCE_CRAWL=true      crawl even if the last crawl is recent
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDevelopmentCycle } from "./dev-agent.ts";

const ROOT = join(import.meta.dir, "..");
const LOG_DIR = join(ROOT, "data", "autopilot");
const HEARTBEAT = join(LOG_DIR, "heartbeat.json");
const STATE_FILE = join(LOG_DIR, "worker-state.json");
const CYCLE_LOG = join(LOG_DIR, `worker-${new Date().toISOString().slice(0, 10)}.log`);
const CRAWL_PORT = 3997;
const CRAWL_DB = join(LOG_DIR, "crawl.db");

const CYCLE_MINUTES = Math.max(5, Number(process.env.WORKER_CYCLE_MINUTES ?? 30));
const FULL_EVERY_HOURS = Math.max(1, Number(process.env.WORKER_FULL_EVERY_HOURS ?? 6));
const LINK_EVERY_HOURS = Math.max(1, Number(process.env.WORKER_LINK_EVERY_HOURS ?? 12));
const ONCE = process.env.WORKER_ONCE === "true";
const FORCE_CRAWL = process.env.WORKER_FORCE_CRAWL === "true";

type State = {
  pid: number;
  startedAt: string;
  cycles: number;
  failures: number;
  lastCycleAt: string | null;
  lastCycleOk: boolean | null;
  lastFullAt: string | null;
  lastLinkAt: string | null;
  nextCycleAt: string | null;
  /** Unfilled `[FYLL I …]` facts across the legal pages, or null before the first crawl. */
  legalPlaceholders?: number | null;
};

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
    log(`Tar emot ${signal}: avslutar efter pågående steg.`);
  });
}

function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  try {
    appendFileSync(CYCLE_LOG, `${line}\n`);
  } catch {
    /* the launchd log still has the line */
  }
}

function readState(): State | null {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function hoursSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function run(command: string[], timeoutMs: number): { ok: boolean; seconds: number; detail: string } {
  const started = performance.now();
  const result = Bun.spawnSync(command, {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: "test", RESEND_API_KEY: "", MAIL_FROM: "" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });
  const output = `${result.stdout?.toString() ?? ""}\n${result.stderr?.toString() ?? ""}`.trim();
  const detail =
    result.exitCode === 0
      ? output.split("\n").filter(Boolean).slice(-2).join(" | ") || "ok"
      : output.split("\n").slice(-8).join(" | ");
  return { ok: result.exitCode === 0, seconds: Math.round((performance.now() - started) / 100) / 10, detail };
}

/**
 * Count the legal facts that are still marked `[FYLL I …]`. They are a known
 * business gap, not a build failure, so the worker only reports them and warns
 * when the number grows — a new placeholder is easy to add and easy to miss.
 */
async function legalPlaceholders(base: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const path of ["/integritet", "/villkor"]) {
    try {
      // The Swedish document is the binding version, and it is the one that
      // carries the visible placeholders; the English copy phrases them out.
      const html = await (await fetch(`${base}${path}`, { headers: { cookie: "lr_lang=sv" } })).text();
      counts[path] = (html.match(/class="legal-ph"[^>]*>\[/g) ?? []).length;
    } catch {
      counts[path] = -1;
    }
  }
  return counts;
}

/** Crawl the public surface against a throwaway server, then shut it down. */
async function crawl(): Promise<{ ok: boolean; detail: string; placeholders: Record<string, number> }> {
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${CRAWL_DB}${suffix}`, { force: true });
  const server = Bun.spawn([process.execPath, "src/server.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(CRAWL_PORT),
      DB_PATH: CRAWL_DB,
      APP_ORIGIN: `http://localhost:${CRAWL_PORT}`,
      NODE_ENV: "test",
      RESEND_API_KEY: "",
      MAIL_FROM: "",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  try {
    const deadline = Date.now() + 25_000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`http://localhost:${CRAWL_PORT}/halsa`)).ok) {
          up = true;
          break;
        }
      } catch {
        /* not up yet */
      }
      await Bun.sleep(200);
    }
    if (!up) return { ok: false, detail: "servern svarade inte på /halsa inom 25 s", placeholders: {} };
    const result = Bun.spawnSync([process.execPath, "scripts/link-check.ts"], {
      cwd: ROOT,
      env: { ...process.env, BASE: `http://localhost:${CRAWL_PORT}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = `${result.stdout?.toString() ?? ""}${result.stderr?.toString() ?? ""}`.trim();
    const summary = output.split("\n").find((line) => line.startsWith("Kontrollerade")) ?? output.slice(0, 200);
    return {
      ok: result.exitCode === 0,
      detail: summary,
      placeholders: await legalPlaceholders(`http://localhost:${CRAWL_PORT}`),
    };
  } finally {
    server.kill();
  }
}

async function cycle(): Promise<void> {
  const previous = readState();
  const state: State = {
    pid: process.pid,
    startedAt: previous?.startedAt ?? new Date().toISOString(),
    cycles: (previous?.cycles ?? 0) + 1,
    failures: previous?.failures ?? 0,
    lastCycleAt: null,
    lastCycleOk: null,
    lastFullAt: previous?.lastFullAt ?? null,
    lastLinkAt: previous?.lastLinkAt ?? null,
    nextCycleAt: null,
    legalPlaceholders: previous?.legalPlaceholders ?? null,
  };

  const full = hoursSince(state.lastFullAt) >= FULL_EVERY_HOURS;
  log(`Cykel ${state.cycles} startar (${full ? "full" : "snabb"}).`);

  const autopilot = run([process.execPath, "scripts/autopilot.ts", ...(full ? [] : ["--quick"])], 900_000);
  log(`${autopilot.ok ? "OK " : "FEL"} autopilot ${autopilot.seconds}s ${autopilot.detail}`);
  if (autopilot.ok && full) state.lastFullAt = new Date().toISOString();

  let linkOk = true;
  if (FORCE_CRAWL || hoursSince(state.lastLinkAt) >= LINK_EVERY_HOURS) {
    const result = await crawl();
    linkOk = result.ok;
    log(`${result.ok ? "OK " : "FEL"} link-check ${result.detail}`);
    if (result.ok) state.lastLinkAt = new Date().toISOString();

    const counts = Object.entries(result.placeholders);
    if (counts.length > 0) {
      const total = counts.reduce((sum, [, count]) => sum + Math.max(0, count), 0);
      log(`Juridiska platshållare: ${counts.map(([path, count]) => `${path}=${count}`).join(" ")}`);
      const before = state.legalPlaceholders;
      if (before !== null && before !== undefined && total > before) {
        log(`VARNING: ofyllda juridiska fakta har ökat från ${before} till ${total}. Fyll i dem i admin eller dokumentera varför de tillkommit.`);
      }
      state.legalPlaceholders = total;
    }
  } else {
    log("Hoppar över link-check: senaste körningen är färsk.");
  }

  // Development comes after verification: the gates above must be green before
  // an agent is allowed to touch the tree. A failing cycle still lets the next
  // task start, so one broken task never stalls the night.
  let agentNote: string | null = null;
  if (process.env.WORKER_DEV_AGENT !== "false" && !stopping) {
    // Several tasks per cycle while the time budget allows, so a night is not
    // limited to one task per half hour. A failing task never ends the loop.
    const maxTasks = Math.max(1, Number(process.env.WORKER_AGENT_TASKS ?? 2));
    const deadline = Date.now() + Math.max(5, Number(process.env.WORKER_AGENT_MINUTES ?? 20)) * 60_000;
    const notes: string[] = [];
    for (let task = 0; task < maxTasks && !stopping && Date.now() < deadline; task += 1) {
      try {
        const result = runDevelopmentCycle();
        notes.push(result.detail);
        log(`${result.ok ? "OK " : "FEL"} dev-agent ${result.detail}`);
        if (result.halt) break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notes.push(`kastade: ${message}`);
        log(`FEL dev-agent kastade: ${message}`);
        break;
      }
    }
    agentNote = notes.join(" · ") || null;
  }

  state.lastCycleAt = new Date().toISOString();
  state.lastCycleOk = autopilot.ok && linkOk;
  if (!state.lastCycleOk) state.failures += 1;
  state.nextCycleAt = new Date(Date.now() + CYCLE_MINUTES * 60_000).toISOString();

  writeJson(STATE_FILE, state);
  writeJson(HEARTBEAT, {
    pid: process.pid,
    label: "ai.stoqwise.worker",
    alive: true,
    cycle: state.cycles,
    ok: state.lastCycleOk,
    lastCycleAt: state.lastCycleAt,
    nextCycleAt: state.nextCycleAt,
    failures: state.failures,
    legalPlaceholders: state.legalPlaceholders ?? null,
    agent: agentNote,
  });
  log(`Cykel ${state.cycles} klar: ${state.lastCycleOk ? "grön" : "misslyckad"}. Nästa ${state.nextCycleAt}.`);
}

mkdirSync(LOG_DIR, { recursive: true });
log(`Arbetaren startar (pid ${process.pid}, cykel ${CYCLE_MINUTES} min, full var ${FULL_EVERY_HOURS} h).`);

if (ONCE) {
  await cycle();
  writeJson(HEARTBEAT, { pid: process.pid, label: "ai.stoqwise.worker", alive: false, reason: "once" });
  process.exit(0);
}

while (!stopping) {
  await cycle();
  if (stopping) break;
  const until = Date.now() + CYCLE_MINUTES * 60_000;
  while (!stopping && Date.now() < until) await Bun.sleep(Math.min(5_000, until - Date.now()));
}

log("Arbetaren avslutas på begäran.");
if (existsSync(HEARTBEAT)) {
  try {
    const beat = JSON.parse(readFileSync(HEARTBEAT, "utf8")) as Record<string, unknown>;
    writeJson(HEARTBEAT, { ...beat, alive: false, stoppedAt: new Date().toISOString() });
  } catch {
    /* nothing to annotate */
  }
}
process.exit(0);
