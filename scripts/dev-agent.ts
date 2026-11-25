/**
 * Autonomous development loop for STOQWISE.
 *
 * The verification worker (`scripts/worker.ts`) already proves that the app
 * builds and boots. This module adds the part that writes code: it takes the
 * next task from `docs/backlog.json`, hands it to a real coding agent (Hermes,
 * already installed on the machine), and only keeps the result when the
 * project's own gates pass.
 *
 * Safety model — every attempt is reversible:
 *   1. A snapshot of the source tree is written to `data/agent/snapshots/`.
 *      Two snapshot strategies exist, so a failing `tar` cannot stop the loop.
 *   2. The agent may only touch `src/`, `public/`, `tests/`, `docs/`, `scripts/`
 *      and `e2e/`. Anything else, or a forbidden file, reverts the attempt.
 *   3. `bun run typecheck`, `bun test` and the task's own acceptance command must
 *      pass. A failure reverts the attempt and records the reason.
 *   4. A passing task is committed with only the files the agent changed, so the
 *      change can be rolled back with `git revert`.
 *   5. `data/agent/STOP` stops the loop; `data/agent/state.json` makes an
 *      interrupted run resumable.
 *
 * Self-healing model — a failure never ends the loop by itself:
 *   - Every step names its failure (`snapshot`, `agent`, `guard`, `typecheck`,
 *     `tests`, `accept`, `blocked-task`). A failure after a green preflight is
 *     additionally recorded as a regression.
 *   - Each failure type has an ordered ladder of remedies. Strategy 1 is used
 *     first, then 2, then 3; an id that already failed is never reused.
 *   - A remedy is a *different* next action: a repair prompt carrying the real
 *     error text, a different model, more turns, a narrower scope, or a fresh
 *     start from the snapshot. "Try the same thing again" is not a strategy.
 *   - Attempts are bounded by `AGENT_MAX_ATTEMPTS` and by a wall clock, so a
 *     task can never loop forever. When the ladder is exhausted the task becomes
 *     `blocked` with a description of the error, the strategies and the checks,
 *     and the loop continues with the next independent task.
 *   - A task is only `done` when typecheck, tests and its acceptance command all
 *     pass. Verification results and changed files are written per attempt to
 *     `data/agent/reports/`.
 *
 * It never pushes, never deploys, never touches production data and never
 * changes pricing, plans, permissions or security logic — tasks that would
 * require that are refused by the prompt and by the backlog review.
 *
 * Usage:
 *   bun scripts/dev-agent.ts --dry-run     # show the next task, change nothing
 *   bun scripts/dev-agent.ts --once        # one task, then exit
 *   bun scripts/dev-agent.ts               # keep working through the backlog
 *   bun scripts/dev-agent.ts --propose     # suggest new tasks, change nothing else
 *   bun scripts/dev-agent.ts --repair      # quarantine iCloud duplicates, then exit
 */
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const STATE_DIR = join(ROOT, "data", "agent");
const LOG_DIR = join(STATE_DIR, "logs");
const SNAPSHOT_DIR = join(STATE_DIR, "snapshots");
const REPORT_DIR = join(STATE_DIR, "reports");
const QUARANTINE_DIR = join(STATE_DIR, "quarantine");
const STOP_FILE = join(STATE_DIR, "STOP");
const LOCK_FILE = join(STATE_DIR, "run.lock");
const STATE_FILE = join(STATE_DIR, "state.json");
const HISTORY_FILE = join(STATE_DIR, "history.jsonl");
const RECOVERY_LOG = join(STATE_DIR, "recovery.jsonl");
const BACKLOG_FILE = join(ROOT, "docs", "backlog.json");
const PROGRESS_FILE = join(ROOT, "docs", "agent-progress.md");
const PROPOSALS_FILE = join(ROOT, "docs", "backlog-proposals.md");
const HERMES = process.env.HERMES_BIN ?? join(homedir(), ".local", "bin", "hermes");

/** Free models on the already-configured provider, tried in order. */
const DEFAULT_MODELS = ["tencent/hy4-flash:free", "upstage/solar-mini4:free", "stepfun/step-3.7-flash:free"];

const ALLOWED_PREFIXES = ["src/", "public/", "tests/", "docs/", "scripts/", "e2e/"];
const DENIED_PATHS = [
  "package.json",
  "bun.lock",
  "bunfig.toml",
  ".env",
  ".env.local",
  "docs/backlog.json",
  "docs/backlog-proposals.md",
  "docs/agent-progress.md",
  "scripts/dev-agent.ts",
  "scripts/worker.ts",
];

const IGNORED_PREFIXES = [".git/", "node_modules/", "data/", "reports/", "test-results/", ".tools/", "samples/"];
const IGNORED_NAMES = new Set([".DS_Store"]);

/**
 * iCloud Drive writes "file 2.ext" copies while syncing. They are not source
 * code, but they *are* picked up by tsc and by the test suite — a duplicate
 * `tests/arcade.d 2.ts` broke the typecheck for every cycle, which meant no task
 * could ever pass its gates. Only true duplicates inside the code tree are moved
 * (never deleted), and only when the original file sits next to them.
 */
const DUPLICATE_NAME = / \d+(?=\.[^.]+$|$)/;
const QUARANTINE_PREFIXES = ["src/", "tests/", "e2e/", "public/", "scripts/"];

const TASK_BUDGET_SECONDS = Number(process.env.AGENT_TASK_BUDGET_SECONDS ?? 600);
const MAX_ATTEMPTS = Math.max(1, Number(process.env.AGENT_MAX_ATTEMPTS ?? 4));
const WALL_BUDGET_SECONDS = Math.max(180, Number(process.env.AGENT_TASK_WALL_SECONDS ?? 900));
const MODEL_TTL_HOURS = 6;
/** A green preflight is reused for ten minutes, a red one for three. */
const PREFLIGHT_OK_MS = 10 * 60_000;
const PREFLIGHT_RED_MS = 3 * 60_000;

export type Task = {
  id: string;
  title: string;
  brief: string;
  priority: number;
  status: "pending" | "done" | "blocked";
  /** Files or directories the task is expected to touch, as a hint. */
  files?: string[];
  /** Human-readable acceptance criterion. Prose: it is read, never executed. */
  acceptance?: string;
  /** Legacy name for the same prose; kept so existing rows are not rewritten. */
  accept?: string;
  /** Machine-checkable gate: a shell command run from the repository root. */
  verify?: string;
  /** A human must do this task; the loop never picks it up. */
  manual?: boolean;
  /** Blast radius hint; a paid model is not spent on `high` by default. */
  risk?: "low" | "medium" | "high";
  note?: string;
  doneAt?: string;
  commit?: string;
  /** Set when the recovery ladder was exhausted; kept for the human review. */
  blockedAt?: string;
  blockedKind?: FailureKind;
  blockedStrategies?: string[];
};

export type Backlog = { tasks: Task[] };

/**
 * How a task can be judged. `command` is run as a shell line; `prose` is shown
 * to a human and never executed; `none` means the task has no criterion at all.
 */
export function planAcceptance(task: Task):
  | { kind: "command"; command: string }
  | { kind: "prose"; text: string }
  | { kind: "none" } {
  const command = task.verify?.trim();
  if (command) return { kind: "command", command };
  const text = (task.acceptance ?? task.accept ?? "").trim();
  if (text) return { kind: "prose", text };
  return { kind: "none" };
}

/** A `manual` task is a human's job; the loop must never spend a model call on it. */
export function nextPending(backlog: Backlog): Task | undefined {
  return backlog.tasks
    .filter((task) => task.status === "pending" && !task.manual)
    .sort((a, b) => a.priority - b.priority)[0];
}

export type BacklogLint = { errors: string[]; warnings: string[]; unverifiable: string[] };

/**
 * Structural checks the loop runs before it spends anything. An error stops the
 * cycle (the queue itself is broken); a warning is reported and the cycle runs.
 */
export function lintBacklog(backlog: Backlog): BacklogLint {
  const errors: string[] = [];
  const warnings: string[] = [];
  const unverifiable: string[] = [];
  if (!backlog || !Array.isArray(backlog.tasks)) {
    return { errors: ["backloggen saknar en tasks-lista"], warnings, unverifiable };
  }
  const seen = new Set<string>();
  for (const task of backlog.tasks) {
    if (!task.id || typeof task.id !== "string") {
      errors.push("uppgift utan id");
      continue;
    }
    if (seen.has(task.id)) errors.push(`dublett-id ${task.id}`);
    seen.add(task.id);
    if (!task.title || !task.title.trim()) errors.push(`${task.id}: saknar title`);
    if (!["pending", "done", "blocked"].includes(task.status)) errors.push(`${task.id}: okänd status ${String(task.status)}`);
    if (typeof task.priority !== "number" || !Number.isFinite(task.priority)) errors.push(`${task.id}: saknar prioritet`);
    if (task.verify !== undefined && !task.verify.trim()) errors.push(`${task.id}: verify är tom`);
    if (task.manual && task.verify) warnings.push(`${task.id}: manual och verify samtidigt; verify körs aldrig`);
    if (task.status === "pending" && !task.manual && planAcceptance(task).kind !== "command") {
      unverifiable.push(task.id);
      warnings.push(`${task.id}: acceptanskriteriet är inte maskinellt verifierbart`);
    }
  }
  return { errors, warnings, unverifiable };
}

export type SnapshotKind = "tar" | "tree";

export type Snapshot = {
  kind: SnapshotKind;
  path: string;
  at: string;
  files?: number;
};

export type FailureKind = "snapshot" | "blocked-task" | "guard" | "agent" | "typecheck" | "tests" | "accept";

export type Failure = { kind: FailureKind; detail: string; output: string };

type Recovery = {
  kind: FailureKind;
  attempts: number;
  /** Strategy ids that already failed for this task; never reused. */
  tried: string[];
  /** True when the task ended up blocked, so a human re-queue can reset it. */
  blocked?: boolean;
  updatedAt: string;
};

type Preflight = { at: string; ok: boolean; detail: string };

type State = {
  updatedAt: string;
  model: string | null;
  modelCheckedAt: string | null;
  modelError: string | null;
  currentTaskId: string | null;
  inFlight: { taskId: string; snapshot: string | Snapshot; changed: string[]; created: string[] } | null;
  attempts: Record<string, number>;
  tasksDone: number;
  tasksBlocked: number;
  /** Last time the agent proposed new work; used to tell unreviewed proposals from reviewed ones. */
  lastProposalAt?: string | null;
  /** Per-task recovery bookkeeping, so a later cycle continues the ladder instead of repeating it. */
  recoveries?: Record<string, Recovery>;
  /** Cached preflight, so a 30-minute cycle does not run the suite twice. */
  preflight?: Preflight | null;
  /** Last environment problem that stopped development before a task could start. */
  environment?: { at: string; detail: string } | null;
};

export type CycleResult = { ok: boolean; detail: string; /** Nothing more to do this round. */ halt?: boolean };

const nowIso = (): string => new Date().toISOString();
const stamp = (): string => nowIso().replace(/[:.]/g, "-");

function log(message: string): void {
  const line = `${nowIso()} ${message}`;
  console.log(line);
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, `agent-${nowIso().slice(0, 10)}.log`), `${line}\n`);
  } catch {
    /* the worker log still has the line */
  }
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

const readState = (): State =>
  readJson<State>(STATE_FILE, {
    updatedAt: nowIso(),
    model: null,
    modelCheckedAt: null,
    modelError: null,
    currentTaskId: null,
    inFlight: null,
    attempts: {},
    tasksDone: 0,
    tasksBlocked: 0,
    lastProposalAt: null,
    recoveries: {},
    preflight: null,
    environment: null,
  });

const writeState = (state: State): void => {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify({ ...state, updatedAt: nowIso() }, null, 2)}\n`);
};

const readBacklog = (): Backlog => readJson<Backlog>(BACKLOG_FILE, { tasks: [] });
const writeBacklog = (backlog: Backlog): void => writeFileSync(BACKLOG_FILE, `${JSON.stringify(backlog, null, 2)}\n`);

function git(args: string[]): { ok: boolean; out: string } {
  const result = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  return {
    ok: result.exitCode === 0,
    out: `${result.stdout?.toString() ?? ""}${result.stderr?.toString() ?? ""}`.trim(),
  };
}

/**
 * One development run at a time. The launchd worker and a manual run must not
 * edit the tree simultaneously; a lock older than two hours, or held by a dead
 * process, is taken over so a crash cannot freeze development.
 */
function acquireLock(): boolean {
  if (existsSync(LOCK_FILE)) {
    try {
      const lock = JSON.parse(readFileSync(LOCK_FILE, "utf8")) as { pid: number; startedAt: number };
      const age = Date.now() - lock.startedAt;
      if (age < 2 * 3_600_000 && isAlive(lock.pid)) return false;
    } catch {
      /* corrupt lock: replace it */
    }
  }
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
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

const releaseLock = (): void => rmSync(LOCK_FILE, { force: true });

function run(command: string[], timeoutMs: number): { ok: boolean; seconds: number; out: string } {
  const started = performance.now();
  const seconds = (): number => Math.round((performance.now() - started) / 100) / 10;
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync(command, {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "test", RESEND_API_KEY: "", MAIL_FROM: "" },
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
    });
  } catch (error) {
    // A missing executable or a bad working directory must be a failed check,
    // never an exception: a throw here used to abort the whole task after the
    // agent had already done the work (cycle 61-62, `Executable not found: GET`).
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, seconds: seconds(), out: `kunde inte starta \`${command.join(" ")}\`: ${message}` };
  }
  return {
    ok: result.exitCode === 0,
    seconds: seconds(),
    out: `${result.stdout?.toString() ?? ""}\n${result.stderr?.toString() ?? ""}`.trim(),
  };
}

function walk(dir: string, files: string[], root = ROOT, options: { includeDuplicates?: boolean } = {}): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_NAMES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    const rel = relative(root, full).split("\\").join("/");
    if (IGNORED_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
    if (entry.isDirectory()) {
      walk(full, files, root, options);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!options.includeDuplicates && DUPLICATE_NAME.test(entry.name)) continue;
    files.push(rel);
  }
}

/**
 * Content hashes of the whole tree. A plain `git status` is not enough: the
 * repository already carries unrelated uncommitted work, so an agent edit to an
 * already-modified file would look unchanged. Hashes cannot miss it.
 */
function manifest(): Map<string, string> {
  const files: string[] = [];
  walk(ROOT, files);
  const hashes = new Map<string, string>();
  for (const rel of files) {
    try {
      hashes.set(rel, createHash("sha256").update(readFileSync(join(ROOT, rel))).digest("hex"));
    } catch {
      /* an unreadable file is reported as changed on the next run */
    }
  }
  return hashes;
}

function diffManifests(before: Map<string, string>): { changed: string[]; deleted: string[] } {
  const after = manifest();
  const changed: string[] = [];
  for (const [path, hash] of after) if (before.get(path) !== hash) changed.push(path);
  const deleted = [...before.keys()].filter((path) => !after.has(path));
  return { changed, deleted };
}

export function allowed(path: string): boolean {
  if (DENIED_PATHS.some((denied) => path === denied || path.startsWith(`${denied}/`))) return false;
  return ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/* ------------------------------------------------------------------ *
 * Felklassificering
 * ------------------------------------------------------------------ */

const KIND_LABELS: Record<FailureKind, string> = {
  snapshot: "ögonblicksbild",
  "blocked-task": "kräver ett produktbeslut",
  guard: "fil utanför uppdraget",
  agent: "agenten",
  typecheck: "typkontroll",
  tests: "tester",
  accept: "acceptanskontroll",
};

export const kindLabel = (kind: FailureKind): string => KIND_LABELS[kind];

/**
 * Turn a step plus its output into a named failure. The stage is known by the
 * caller; the agent's own `BLOCKED` answer is the one case where the output
 * overrides the stage, because it means the task must not be retried at all.
 */
export function classifyFailure(input: { stage: FailureKind; detail: string; output?: string }): Failure {
  const output = input.output ?? input.detail;
  const kind: FailureKind = input.stage === "agent" && /^BLOCKED\b/m.test(output) ? "blocked-task" : input.stage;
  return { kind, detail: (input.detail || kindLabel(kind)).slice(0, 600), output };
}

/** Classify free text, for a thrown error or an unexpected command failure. */
export function classifyErrorText(text: string): FailureKind {
  if (/^BLOCKED\b/m.test(text)) return "blocked-task";
  if (/error TS\d+/.test(text)) return "typecheck";
  if (/^\s*\(fail\)|tests failed|✗/m.test(text)) return "tests";
  if (/acceptanskontroll|accept \(/i.test(text)) return "accept";
  if (/förbjudna filer/i.test(text)) return "guard";
  if (/lseek|SEEK_HOLE|kunde inte skapa ögonblicksbild|återställningsmöjlighet saknas|tar:/i.test(text)) return "snapshot";
  return "agent";
}

/**
 * Keep the lines that carry the actual error. A repair prompt with 400 lines of
 * scrollback is worse than one with the twelve failing assertions.
 */
export function excerptFailure(output: string, maxChars = 2500): string {
  const lines = output.split("\n").filter((line) => line.trim().length > 0);
  const key = lines.filter((line) =>
    /error TS\d+|^\s*\(fail\)|error:|ERR_|panic|expected|Received|not ok|failed|kunde inte|förbjudna|exit \d/i.test(line),
  );
  const chosen = (key.length > 0 ? key : lines).slice(-60).join("\n");
  return chosen.length > maxChars ? chosen.slice(-maxChars) : chosen;
}

/* ------------------------------------------------------------------ *
 * Reservstrategier
 * ------------------------------------------------------------------ */

export type Strategy = {
  id: string;
  label: string;
  /** Start again from the snapshot instead of building on the failed attempt. */
  freshStart?: boolean;
  /** "next" asks for a different model than the one that just failed. */
  model?: "same" | "next";
  extraTurns?: number;
  extraBudgetSeconds?: number;
  /** Extra instruction for the retry; the real error text is added separately. */
  prompt: (input: { failure: Failure; task: Task }) => string;
};

const filesHint = (task: Task): string =>
  task.files?.length ? `Uppgiften gäller ${task.files.join(", ")}.` : "Håll dig till de filer uppgiften faktiskt kräver.";

/**
 * The ladder per failure type. Order matters: the first id that has not failed
 * yet is used. Every entry changes the next action — model, scope, turns or
 * starting point — so the same failed move is never repeated.
 */
const STRATEGIES: Record<FailureKind, Strategy[]> = {
  snapshot: [
    { id: "snapshot-plain-tar", label: "ögonblicksbild med tar utan sparse-flaggor", prompt: () => "" },
    { id: "snapshot-tree-copy", label: "ögonblicksbild som filkopia", prompt: () => "" },
  ],
  "blocked-task": [],
  guard: [
    {
      id: "guard-scope",
      label: "upprepa med uttrycklig filräckvidd",
      prompt: ({ task }) =>
        `Förra försöket rörde filer utanför uppdraget. ${filesHint(task)} Ändra INGEN annan fil, inte ens för att städa. Rapportér i stället om uppgiften inte kan lösas inom den räckvidden.`,
    },
  ],
  agent: [
    {
      id: "agent-tighter",
      label: "snävare instruktion till samma modell",
      prompt: ({ task }) =>
        `Förra försöket gav ingen användbar ändring. ${filesHint(task)} Gör nu den minsta möjliga ändringen, en fil i taget, och avsluta med en kort lista över ändrade filer. Läs inte in dig på stora delar av kodbasen.`,
    },
    {
      id: "agent-alt-model",
      label: "annan modell med större tur- och tidsbudget",
      model: "next",
      extraTurns: 10,
      extraBudgetSeconds: 120,
      prompt: ({ task }) =>
        `Byt angreppssätt. ${filesHint(task)} Börja med den första filen, gör en liten ändring, kör typkontroll och tester direkt och bygg vidare därifrån.`,
    },
    {
      id: "agent-single-file",
      label: "börja om från ögonblicksbilden med en enda fil",
      freshStart: true,
      prompt: ({ task }) =>
        `Trädet är återställt till läget före förra försöket. Lös uppgiften med en ändring i ${task.files?.[0] ?? "en enda fil"} och inget mer; om uppgiften kräver fler filer, gör den minsta möjliga keten och kör typkontroll efter varje steg.`,
    },
  ],
  typecheck: [
    {
      id: "typecheck-repair",
      label: "reparera typkontrollen med de exakta felen",
      prompt: () =>
        `Rätta exakt de typkontrollsfel som listas ovan och inget annat. Ändra inte tsconfig eller package.json. Om ett fel kommer från en iCloud-dubblett ("fil 2.ts") ska du inte röra den filen — rapportera det i stället. Kör \`bun run typecheck\` innan du svarar.`,
    },
    {
      id: "typecheck-alt-model",
      label: "annan modell reparerar typkontrollen",
      model: "next",
      extraTurns: 6,
      prompt: () =>
        `Typkontrollen fallerar fortfarande. Läs felmeddelandena rad för rad, rätta orsaken (inte symptomet) och kör \`bun run typecheck\` tills den är grön. Ändra inget utanför de filer som felen pekar på.`,
    },
    {
      id: "typecheck-fresh",
      label: "återställ försöket och gör en enklare lösning",
      freshStart: true,
      prompt: ({ task }) =>
        `Trädet är återställt. Gör om uppgiften med en enklare, mer typad lösning: ${task.brief.slice(0, 600)} Kör \`bun run typecheck\` efter varje ändrad fil.`,
    },
  ],
  tests: [
    {
      id: "tests-repair",
      label: "reparera de fallerande testerna",
      prompt: () =>
        `Ett eller flera tester fallerar. Läs det fallerande testet och rätta orsaken i koden. Ändra bara ett test om testet bevisligen är fel — aldrig för att göra det grönt. Kör först \`bun test <den fallerande filen>\` och sedan hela \`bun test\`.`,
    },
    {
      id: "tests-alt-model",
      label: "annan modell löser testfelet",
      model: "next",
      extraTurns: 8,
      prompt: () =>
        `Testfelet kvarstår. Reproducera det med det enskilda testkommandot, läs den testfilen och rätta den underliggande logiken. Kör om hela sviten innan du svarar.`,
    },
    {
      id: "tests-fresh",
      label: "återställ försöket och lös uppgiften utan att röra beteendet",
      freshStart: true,
      prompt: ({ task }) =>
        `Trädet är återställt. Gör om uppgiften så att den rör så lite befintligt beteende som möjligt: ${task.brief.slice(0, 600)} Kör \`bun run typecheck\` och \`bun test\` innan du svarar.`,
    },
  ],
  accept: [
    {
      id: "accept-repair",
      label: "reparera mot uppgiftens acceptanskontroll",
      prompt: ({ task }) =>
        `Uppgiftens acceptanskontroll (\`${task.verify ?? task.accept ?? ""}\`) misslyckades. Kör kommandot själv, läs felet och rätta tills det är grönt. Ändra inte acceptanskontrollen.`,
    },
    {
      id: "accept-alt-model",
      label: "annan modell mot acceptanskontrollen",
      model: "next",
      extraTurns: 6,
      prompt: ({ task }) =>
        `Acceptanskontrollen \`${task.verify ?? task.accept ?? ""}\` fallerar fortfarande. Kör den, läs utdata och rätta orsaken. Kör även \`bun test\` innan du svarar.`,
    },
  ],
};

export const strategiesFor = (kind: FailureKind): Strategy[] => STRATEGIES[kind] ?? [];

/** The first remedy for this failure type that has not already failed. */
export function nextStrategy(kind: FailureKind, tried: string[]): Strategy | null {
  return strategiesFor(kind).find((strategy) => !tried.includes(strategy.id)) ?? null;
}

/**
 * A blocked task carries everything a human needs to decide what to do next:
 * the failure type, the attempts, the remedies that were already tried, the
 * verification results and the last real error.
 */
export function blockedNote(input: {
  failure: Failure;
  attempts: number;
  tried: string[];
  checks: string[];
  regression: boolean;
}): string {
  const regression = input.regression ? ", regression" : "";
  return [
    `BLOCKED efter ${input.attempts} försök (${kindLabel(input.failure.kind)}${regression}).`,
    `Strategier: ${input.tried.length > 0 ? input.tried.join(" → ") : "inga"}.`,
    `Verifiering: ${input.checks.length > 0 ? input.checks.join("; ") : "ingen"}.`,
    `Fel: ${input.failure.detail}`,
  ]
    .join(" ")
    .slice(0, 900);
}

/* ------------------------------------------------------------------ *
 * Ögonblicksbilder och återställning
 * ------------------------------------------------------------------ */

const normalizeSnapshot = (value: string | Snapshot): Snapshot =>
  typeof value === "string" ? { kind: "tar", path: value, at: nowIso() } : value;

function pruneSnapshots(dir: string, keep = 5): void {
  try {
    const entries = readdirSync(dir)
      .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    for (const old of entries.slice(keep)) rmSync(join(dir, old.name), { force: true, recursive: true });
  } catch {
    /* pruning is best effort */
  }
}

/**
 * Strategy 1: a plain tar archive. The earlier `--no-read-sparse` flag made tar
 * fail with "lseek(SEEK_HOLE) failed: Resource deadlock avoided" on this iCloud
 * volume, which stopped the loop before every single task; without it the same
 * archive is written without touching sparse metadata.
 */
export function takeTarSnapshot(root = ROOT, targetDir = join(root, "data", "agent", "snapshots")): Snapshot {
  mkdirSync(targetDir, { recursive: true });
  const target = join(targetDir, `snapshot-${stamp()}.tar.gz`);
  const result = Bun.spawnSync(
    [
      "tar",
      "-czf",
      target,
      // Anchored excludes: an unanchored "data" also dropped src/data/**, which
      // left those modules unrecoverable from the snapshot.
      "--exclude=./node_modules",
      "--exclude=./data",
      "--exclude=./.git",
      "--exclude=./reports",
      "--exclude=./test-results",
      "--exclude=./.tools",
      "--exclude=./playwright-report",
      ".",
    ],
    { cwd: root, stdout: "ignore", stderr: "pipe" },
  );
  const error = result.stderr?.toString() ?? "";
  if (result.exitCode !== 0) throw new Error(`tar: ${error.trim().slice(0, 300) || `exit ${result.exitCode}`}`);
  const listing = Bun.spawnSync(["tar", "-tzf", target], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (listing.exitCode !== 0) throw new Error(`arkivet gick inte att läsa tillbaka: ${(listing.stderr?.toString() ?? "").slice(0, 200)}`);
  const files = listing.stdout?.toString().split("\n").filter(Boolean).length ?? 0;
  if (files === 0) throw new Error("arkivet är tomt");
  pruneSnapshots(targetDir);
  return { kind: "tar", path: target, at: nowIso(), files };
}

/** Strategy 2: a file copy. No external tool, no sparse handling, no archive. */
export function takeTreeSnapshot(root = ROOT, targetDir = join(root, "data", "agent", "snapshots")): Snapshot {
  const files: string[] = [];
  walk(root, files, root);
  const target = join(targetDir, `snapshot-${stamp()}-tree`);
  mkdirSync(join(target, "files"), { recursive: true });
  for (const rel of files) {
    const dest = join(target, "files", rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(root, rel), dest);
  }
  writeFileSync(join(target, "manifest.json"), `${JSON.stringify({ at: nowIso(), root, files }, null, 2)}\n`);
  const copied = readJson<{ files: string[] }>(join(target, "manifest.json"), { files: [] }).files.length;
  if (copied !== files.length) throw new Error(`kopian är ofullständig (${copied} av ${files.length} filer)`);
  pruneSnapshots(targetDir);
  return { kind: "tree", path: target, at: nowIso(), files: copied };
}

/** Try the requested snapshot kinds in order and return the first that works. */
export function takeSnapshot(root = ROOT, kinds: SnapshotKind[] = ["tar", "tree"]): Snapshot {
  const failures: string[] = [];
  for (const kind of kinds) {
    try {
      return kind === "tar" ? takeTarSnapshot(root) : takeTreeSnapshot(root);
    } catch (error) {
      failures.push(`${kind}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(failures.join(" | "));
}

export function snapshotAvailable(snapshot: string | Snapshot): boolean {
  const snap = normalizeSnapshot(snapshot);
  try {
    if (snap.kind === "tree") return existsSync(join(snap.path, "manifest.json"));
    return existsSync(snap.path) && statSync(snap.path).size > 0;
  } catch {
    return false;
  }
}

/**
 * Roll back exactly what this attempt changed, and nothing else: only the
 * touched paths are read back from the archive, and only files the attempt
 * created are removed. A concurrent human edit to some other file survives.
 *
 * Throws when the snapshot is unusable — a task may never continue without a
 * way back.
 */
export function restoreAttempt(snapshot: string | Snapshot, paths: string[], created: string[], root = ROOT): void {
  const snap = normalizeSnapshot(snapshot);
  if (!snapshotAvailable(snap)) throw new Error(`återställningsmöjlighet saknas: ${snap.path}`);
  const restore = paths.filter((path) => !created.includes(path));

  if (snap.kind === "tar") {
    if (restore.length > 0) {
      // Arkivet skrevs med "." som rot, så medlemmarna heter "./src/…";
      // mönstret måste ha samma prefix för att bara de filerna packas upp.
      const members = restore.map((path) => `./${path}`);
      const result = Bun.spawnSync(["tar", "-xzf", snap.path, "-C", root, "--", ...members], {
        cwd: root,
        stdout: "ignore",
        stderr: "pipe",
      });
      if (result.exitCode !== 0) {
        log(`VARNING: selektiv återställning misslyckades (${(result.stderr?.toString() ?? "").slice(0, 200)}); packar upp hela arkivet.`);
        const full = Bun.spawnSync(["tar", "-xzf", snap.path, "-C", root], { cwd: root, stdout: "ignore", stderr: "pipe" });
        if (full.exitCode !== 0) {
          throw new Error(`återställning från ögonblicksbild misslyckades: ${(full.stderr?.toString() ?? "").slice(0, 300)}`);
        }
      }
    }
  } else {
    for (const path of restore) {
      const source = join(snap.path, "files", path);
      const destination = join(root, path);
      try {
        if (existsSync(source)) {
          mkdirSync(dirname(destination), { recursive: true });
          copyFileSync(source, destination);
        } else {
          rmSync(destination, { force: true });
        }
      } catch (error) {
        throw new Error(`återställning av ${path} misslyckades: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  for (const path of created) rmSync(join(root, path), { force: true });
}

/* ------------------------------------------------------------------ *
 * iCloud-dubbletter
 * ------------------------------------------------------------------ */

/**
 * Move true iCloud duplicates ("tests/arcade.d 2.ts", "newsreader 2.ttf") out of
 * the code tree into `data/agent/quarantine/`. They are never deleted, the move
 * is recorded in a manifest, and only files whose original still exists next to
 * them are touched. Nothing under `docs/` or `data/` is moved, so backups and
 * notes stay where the user put them.
 */
export function quarantineDuplicates(root = ROOT, targetDir?: string): string[] {
  const files: string[] = [];
  walk(root, files, root, { includeDuplicates: true });
  const duplicates = files.filter((rel) => {
    if (!QUARANTINE_PREFIXES.some((prefix) => rel.startsWith(prefix))) return false;
    const name = rel.split("/").pop() ?? "";
    if (!DUPLICATE_NAME.test(name)) return false;
    const twin = name.replace(DUPLICATE_NAME, "");
    return twin !== name && existsSync(join(root, dirname(rel), twin));
  });
  if (duplicates.length === 0) return [];

  const target = targetDir ?? join(QUARANTINE_DIR, stamp());
  const moved: string[] = [];
  for (const rel of duplicates) {
    const destination = join(target, "files", rel);
    try {
      mkdirSync(dirname(destination), { recursive: true });
      renameSync(join(root, rel), destination);
      moved.push(rel);
    } catch {
      try {
        copyFileSync(join(root, rel), destination);
        rmSync(join(root, rel), { force: true });
        moved.push(rel);
      } catch (error) {
        log(`Kunde inte flytta dubbletten ${rel}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  try {
    writeFileSync(join(target, "manifest.json"), `${JSON.stringify({ at: nowIso(), root, moved }, null, 2)}\n`);
  } catch {
    /* the log line still says what moved */
  }
  return moved;
}

/* ------------------------------------------------------------------ *
 * Modell
 * ------------------------------------------------------------------ */

function resolveModel(state: State): string | null {
  const fresh = state.model && state.modelCheckedAt &&
    (Date.now() - new Date(state.modelCheckedAt).getTime()) / 3_600_000 < MODEL_TTL_HOURS;
  if (fresh) return state.model;

  if (!existsSync(HERMES)) {
    state.model = null;
    state.modelCheckedAt = nowIso();
    state.modelError = `Hermes saknas på ${HERMES}`;
    writeState(state);
    return null;
  }

  const candidates = process.env.AGENT_MODEL ? [process.env.AGENT_MODEL] : DEFAULT_MODELS;
  for (const model of candidates) {
    const probe = run(
      [HERMES, "chat", "--oneshot", "-Q", "--max-turns", "1", "--run-budget", "45", "--in", ROOT, "-m", model, "--query", "Svara endast: OK"],
      90_000,
    );
    if (probe.ok) {
      state.model = model;
      state.modelError = null;
      state.modelCheckedAt = nowIso();
      writeState(state);
      log(`Modell klar: ${model}`);
      return model;
    }
    const reason = probe.out.split("\n").find((line) => /credits|auth|login|error|Error/i.test(line)) ?? probe.out.slice(0, 200);
    state.modelError = `${model}: ${reason}`;
    log(`Modell ${model} svarade inte: ${reason.slice(0, 160)}`);
  }
  state.model = null;
  state.modelCheckedAt = nowIso();
  writeState(state);
  return null;
}

/**
 * Verdicts from earlier probes, so a dead model costs one probe per worker
 * lifetime instead of one wasted attempt per task.
 */
const modelVerdicts = new Map<string, { ok: boolean; at: number }>();
const VERDICT_TTL_MS = 6 * 3_600_000;

function probeModel(model: string): boolean {
  const cached = modelVerdicts.get(model);
  if (cached && Date.now() - cached.at < VERDICT_TTL_MS) return cached.ok;
  if (!existsSync(HERMES)) return false;
  const probe = run(
    [HERMES, "chat", "--oneshot", "-Q", "--max-turns", "1", "--run-budget", "45", "--in", ROOT, "-m", model, "--query", "Svara endast: OK"],
    90_000,
  );
  modelVerdicts.set(model, { ok: probe.ok, at: Date.now() });
  return probe.ok;
}

/**
 * A different model than the one that just failed — but only one that has
 * actually answered. Switching blind to a free model burned a whole attempt on
 * an empty answer, so the alternative is probed first; when nothing else
 * responds the current model is kept and the other strategies do the work.
 */
export function nextModel(current: string, probe: (model: string) => boolean = probeModel): string {
  const candidates = process.env.AGENT_MODEL ? [process.env.AGENT_MODEL] : DEFAULT_MODELS;
  for (const model of candidates) {
    if (model === current) continue;
    if (probe(model)) {
      log(`Reservmodell verifierad: ${model}`);
      return model;
    }
    log(`Reservmodellen ${model} svarade inte; hoppar över den.`);
  }
  log("Ingen annan modell svarade; reservstrategin körs med samma modell.");
  return current;
}

/* ------------------------------------------------------------------ *
 * Förslag (oförändrat beteende, bara flyttat)
 * ------------------------------------------------------------------ */

/**
 * True when the newest proposals are newer than the backlog file, i.e. nobody
 * has promoted or dismissed them yet. This is what replaced the 24-hour wall: a
 * fresh batch is written on the first empty cycle, and the next one as soon as
 * docs/backlog.json is touched again (promotion or dismissal).
 */
function proposalsAwaitReview(state: State): boolean {
  if (!state.lastProposalAt) return false;
  try {
    return new Date(state.lastProposalAt).getTime() > statSync(BACKLOG_FILE).mtimeMs;
  } catch {
    return false;
  }
}

/**
 * The body of the newest block in docs/backlog-proposals.md, without its
 * timestamp/model header. Used to avoid appending the same three suggestions
 * over and over when nobody has reacted to them yet.
 */
function previousProposalBody(): string {
  if (!existsSync(PROPOSALS_FILE)) return "";
  const blocks = readFileSync(PROPOSALS_FILE, "utf8").split(/\n## /);
  const last = blocks.length > 1 ? blocks[blocks.length - 1] ?? "" : "";
  return last.split("\n").slice(1).join("\n");
}

/**
 * Ask the agent to read the project and suggest the next small improvements.
 * Proposals are written to `docs/backlog-proposals.md` and never inserted into
 * the backlog automatically: scope stays a human decision, the agent only does
 * the analysis and the ordering.
 */
function proposeTasks(model: string, state: State): { ok: boolean; detail: string } {
  mkdirSync(LOG_DIR, { recursive: true });
  // Without the old 24-hour wall the model is asked far more often, so it has to
  // be told what already exists. Done titles are the cheapest reliable context:
  // they come from the backlog the proposals are eventually promoted into.
  const recentDone = readBacklog()
    .tasks.filter((task) => task.status === "done")
    .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""))
    .slice(0, 12)
    .map((task) => `- ${task.title}`)
    .join("\n");
  const prompt = `Du arbetar i STOQWISE-projektet. Läs AGENTS.md, docs/arbetsstatus.md och docs/backlog.json.

REDAN GENOMFÖRT — föreslå inte dessa igen och inga varianter av dem:
${recentDone || "- (ingenting ännu)"}

Analysera den publika ytan och den inbyggda appen och föreslå tre små, konkreta förbättringar som kan göras och verifieras i en enda session. Varje förslag ska ha: en rad titel, varför det spelar roll, vilka filer som berörs och hur man ser att det är klart.

Begränsningar: inga nya beroenden, inga ändringar av prissättning, abonnemang, behörigheter eller produktionsdata, inte heller något som kräver produktbeslut. Föreslå bara sådant som typkontroll och testsvit kan verifiera. Varje förslag måste vara nytt i förhållande till listan ovan.

Svara med en numrerad markdown-lista och inget annat.`;
  const promptPath = join(LOG_DIR, "proposal.prompt.txt");
  writeFileSync(promptPath, prompt);
  const result = Bun.spawnSync(
    [
      HERMES,
      "chat",
      "--oneshot",
      "-Q",
      "--in",
      ROOT,
      "--max-turns",
      "16",
      "--run-budget",
      "300",
      "-m",
      model,
      "--query-file",
      promptPath,
    ],
    {
      cwd: ROOT,
      env: { ...process.env, PATH: `${join(homedir(), ".local", "bin")}:${process.env.PATH ?? ""}` },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 420_000,
    },
  );
  const output = `${result.stdout?.toString() ?? ""}${result.stderr?.toString() ?? ""}`
    .split("\n")
    .filter((line) => !line.startsWith("session_id:"))
    .join("\n")
    .trim();
  // Keep the whole answer, not the 200-character excerpt in the cycle log: a
  // failed proposal run is otherwise impossible to diagnose afterwards.
  const proposalLog = join(LOG_DIR, `proposal-${stamp()}.log`);
  writeFileSync(proposalLog, output);
  // Hermes exits 1 when it runs out of turns or budget even after a complete
  // answer, so the exit code alone discarded good proposals. Judge the shape
  // instead: at least two numbered, bold-titled items.
  const proposalCount = output.split("\n").filter((line) => /^\d+\.\s+\*\*/.test(line.trim())).length;
  if (proposalCount < 2 || output.length < 40) {
    log(`Förslagssteget svarade inte (exit ${result.exitCode}, ${proposalCount} förslag): ${output.slice(-200)} — se ${proposalLog}`);
    return { ok: false, detail: `förslagssteget misslyckades (exit ${result.exitCode}, ${proposalCount} förslag): ${output.slice(-200)}` };
  }
  if (result.exitCode !== 0) log(`Förslagssteget avslutade med exit ${result.exitCode} men gav ${proposalCount} kompletta förslag; används.`);
  const fingerprint = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();
  const previous = previousProposalBody();
  if (previous && fingerprint(previous) === fingerprint(output)) {
    log("Förslagssteget gav samma förslag som förra gången; inget nytt skrevs.");
    return { ok: true, detail: "backloggen är tom: modellen gav samma förslag som förra gången, inget nytt skrevs." };
  }
  try {
    appendFileSync(PROPOSALS_FILE, `\n## ${nowIso().slice(0, 16).replace("T", " ")} (${model})\n\n${output}\n`);
  } catch (error) {
    return { ok: false, detail: `kunde inte skriva förslag: ${error instanceof Error ? error.message : String(error)}` };
  }
  log(`Skrev tre förslag till docs/backlog-proposals.md (${state.model}).`);
  return { ok: true, detail: "backloggen är tom: tre nya förslag skrevs till docs/backlog-proposals.md för granskning." };
}

/* ------------------------------------------------------------------ *
 * Uppgiftskörning
 * ------------------------------------------------------------------ */

type Plan = {
  strategyId: string | null;
  model: string;
  turns: number;
  budgetSeconds: number;
  prompt: string;
};

function taskPrompt(task: Task, input: { attempt: number; maxAttempts: number; strategy: Strategy | null; failure: Failure | null }): string {
  const acceptance = planAcceptance(task);
  const gate =
    acceptance.kind === "command"
      ? `- Uppgiften är godkänd först när detta kommando är grönt. Kör det själv innan du svarar: \`${acceptance.command}\`\n`
      : acceptance.kind === "prose"
        ? `- Uppgiftens kriterium är beskrivet i text och granskas av en människa: ${acceptance.text.split("\n").join(" ")}\n`
        : "";
  const base = `Du arbetar autonomt i STOQWISE-projektet. Läs AGENTS.md i projektroten först och följ den.

UPPGIFT: ${task.title}

${task.brief}
${task.files?.length ? `\nTroliga filer: ${task.files.join(", ")}` : ""}

REGLER
- Gör en liten, kirurgisk ändring i befintlig stil. Ingen refaktorering utanför uppgiften, inga nya beroenden.
- Du får bara ändra filer under src/, public/, tests/, docs/, scripts/ och e2e/.
- Ändra aldrig: package.json, bun.lock, .env*, data/, docs/backlog.json, docs/agent-progress.md, scripts/dev-agent.ts, scripts/worker.ts.
- Ändra aldrig prissättning, abonnemang, behörigheter, säkerhetslogik eller produktionsdata. Om uppgiften kräver det: skriv BLOCKED överst i svaret, förklara varför och ändra ingenting.
- Kör \`bun run typecheck\` innan du svarar och åtgärda fel du själv infört. Kör \`bun test\` om du ändrat kod som testerna täcker.
${gate}- Avsluta med en kort lista över ändrade filer och varför.
- Skriv på svenska i kodkommentarer och dokumentation.`;

  if (!input.failure) return base;

  const strategy = input.strategy;
  const repair = strategy?.prompt({ failure: input.failure, task }) ?? "";
  return `${base}

FÖRSÖK ${input.attempt} AV ${input.maxAttempts}${strategy ? ` — strategi: ${strategy.label} (${strategy.id})` : ""}

FÖREGÅENDE FÖRSÖK MISSLYCKADES (${kindLabel(input.failure.kind)}):
\`\`\`
${excerptFailure(input.failure.output || input.failure.detail)}
\`\`\`

${strategy?.freshStart ? "Trädet är återställt till läget före föregående försök.\n\n" : "Trädet innehåller ändringarna från föregående försök. Bygg vidare på dem i stället för att börja om, om inte instruktionen säger annat.\n\n"}ÅTGÄRD: ${repair}`;
}

function buildPlan(input: {
  task: Task;
  failure: Failure | null;
  strategy: Strategy | null;
  attempt: number;
  maxAttempts: number;
  model: string;
  remainingSeconds: number;
}): Plan {
  const baseTurns = Number(process.env.AGENT_MAX_TURNS ?? 30);
  const strategy = input.strategy;
  const requested = TASK_BUDGET_SECONDS + (strategy?.extraBudgetSeconds ?? 0);
  // Never let the last attempt run past the task's wall clock; a killed agent
  // is just a wasted attempt.
  const budgetSeconds = Math.max(90, Math.min(requested, Math.floor(input.remainingSeconds) - 30));
  const model = strategy?.model === "next" ? nextModel(input.model) : input.model;
  return {
    strategyId: strategy?.id ?? null,
    model,
    turns: baseTurns + (strategy?.extraTurns ?? 0),
    budgetSeconds,
    prompt: taskPrompt(input.task, {
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
      strategy,
      failure: input.failure,
    }),
  };
}

function agentRun(task: Task, plan: Plan): { ok: boolean; detail: string; output: string; seconds: number; logPath: string } {
  mkdirSync(LOG_DIR, { recursive: true });
  const logPath = join(LOG_DIR, `task-${task.id}-${stamp()}.log`);
  const promptPath = join(LOG_DIR, `task-${task.id}.prompt.txt`);
  writeFileSync(promptPath, plan.prompt);

  const started = performance.now();
  const result = Bun.spawnSync(
    [
      HERMES,
      "chat",
      "--oneshot",
      "-Q",
      "--toolsets",
      "terminal,file,code_execution",

      "--in",
      ROOT,
      "--max-turns",
      String(plan.turns),
      "--run-budget",
      String(plan.budgetSeconds),
      "-m",
      plan.model,
      "--query-file",
      promptPath,
    ],
    {
      cwd: ROOT,
      env: { ...process.env, PATH: `${join(homedir(), ".local", "bin")}:${process.env.PATH ?? ""}` },
      stdout: "pipe",
      stderr: "pipe",
      timeout: (plan.budgetSeconds + 120) * 1000,
    },
  );
  const output = `${result.stdout?.toString() ?? ""}\n${result.stderr?.toString() ?? ""}`.trim();
  writeFileSync(logPath, output);
  const blocked = /^BLOCKED\b/m.test(output);
  const ranOut = /ran out of steps|run out of turns|max_iterations|run budget/i.test(output);
  const tail = output.split("\n").filter(Boolean).slice(-6).join(" | ").slice(0, 900);
  return {
    ok: result.exitCode === 0 && !blocked && !ranOut,
    detail: blocked ? `BLOCKED: ${tail}` : ranOut ? `slut på turer eller tidsbudget: ${tail}` : tail || "(inget svar)",
    output,
    seconds: Math.round((performance.now() - started) / 100) / 10,
    logPath,
  };
}

type Check = { name: string; ok: boolean; seconds: number; detail: string; output: string };

function check(name: string, command: string[], timeoutMs: number): Check {
  const result = run(command, timeoutMs);
  return {
    name,
    ok: result.ok,
    seconds: result.seconds,
    detail: result.out.split("\n").filter(Boolean).slice(-4).join(" | ").slice(0, 600),
    output: result.out,
  };
}

/** Run a task's own gate, written as one shell line exactly as a human would. */
function checkShell(name: string, command: string, timeoutMs: number): Check {
  return check(name, ["bash", "-lc", command], timeoutMs);
}

/**
 * The project's own gates. Typecheck decides whether tests are worth running, so
 * a broken build does not spend a minute on the suite.
 */
function verifyTask(task: Task, baselineGreen: boolean): { ok: boolean; checks: Check[]; failure: Failure | null; regression: boolean } {
  const checks: Check[] = [check("typkontroll", ["bun", "run", "typecheck"], 180_000)];
  if (checks[0]!.ok) checks.push(check("tester", ["bun", "test"], 600_000));
  if (checks.every((item) => item.ok)) {
    const acceptance = planAcceptance(task);
    if (acceptance.kind === "command") {
      checks.push(checkShell(`accept (${acceptance.command})`, acceptance.command, 300_000));
    } else if (acceptance.kind === "prose") {
      // Prose cannot be executed. It is reported as an explicit, visible note so
      // nobody mistakes "tests passed" for "the acceptance criterion was met" —
      // running it as a command is what crashed the loop for two cycles.
      checks.push({
        name: "accept (prosa, ej maskinellt verifierad)",
        ok: true,
        seconds: 0,
        detail: acceptance.text.split("\n").join(" ").slice(0, 300),
        output: "",
      });
    }
  }
  const failed = checks.find((item) => !item.ok);
  if (!failed) return { ok: true, checks, failure: null, regression: false };
  const kind: FailureKind = failed.name === "typkontroll" ? "typecheck" : failed.name.startsWith("accept") ? "accept" : "tests";
  return {
    ok: false,
    checks,
    failure: classifyFailure({ stage: kind, detail: `${failed.name}: ${failed.detail}`, output: failed.output }),
    regression: baselineGreen,
  };
}

/**
 * A red tree before the task starts can never become green by an agent edit, and
 * every attempt would be wasted. Run the gates once per cycle, cache the verdict,
 * and stop development with a precise reason instead of burning model calls.
 * iCloud duplicates are already moved away before this runs, which is what makes
 * the check self-healing rather than a permanent stop.
 */
function preflight(state: State): { ok: boolean; detail: string } {
  const cached = state.preflight;
  if (cached) {
    const age = Date.now() - new Date(cached.at).getTime();
    if (cached.ok ? age < PREFLIGHT_OK_MS : age < PREFLIGHT_RED_MS) return { ok: cached.ok, detail: cached.detail };
  }
  const typecheck = run(["bun", "run", "typecheck"], 180_000);
  if (!typecheck.ok) {
    const failure = classifyFailure({ stage: "typecheck", detail: typecheck.out.split("\n").slice(-4).join(" | "), output: typecheck.out });
    const detail = `typkontrollen är röd innan uppgiften börjar: ${failure.detail.slice(0, 300)}`;
    state.preflight = { at: nowIso(), ok: false, detail };
    writeState(state);
    return { ok: false, detail };
  }
  const tests = run(["bun", "test"], 600_000);
  if (!tests.ok) {
    const failure = classifyFailure({ stage: "tests", detail: tests.out.split("\n").slice(-6).join(" | "), output: tests.out });
    const detail = `testsviten är röd innan uppgiften börjar: ${failure.detail.slice(0, 300)}`;
    state.preflight = { at: nowIso(), ok: false, detail };
    writeState(state);
    return { ok: false, detail };
  }
  const passed = tests.out.match(/(\d+) pass/)?.[0] ?? "tester gröna";
  const detail = `typkontroll och ${passed} före uppgiften`;
  state.preflight = { at: nowIso(), ok: true, detail };
  writeState(state);
  return { ok: true, detail };
}

/** Snapshot strategies, tried in order; the loop never runs an agent without one. */
function createSnapshot(): { snapshot: Snapshot; strategy: string; failures: string[] } {
  const failures: string[] = [];
  for (const strategy of strategiesFor("snapshot")) {
    const kinds: SnapshotKind[] = strategy.id === "snapshot-tree-copy" ? ["tree"] : ["tar"];
    try {
      const snapshot = takeSnapshot(ROOT, kinds);
      log(`Ögonblicksbild klar: ${strategy.id} (${snapshot.kind}, ${snapshot.files ?? "?"} filer).`);
      return { snapshot, strategy: strategy.id, failures };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${strategy.id}: ${message}`);
      log(`Ögonblicksbild misslyckades med ${strategy.id}: ${message.slice(0, 200)}`);
    }
  }
  throw new Error(`ingen ögonblicksbild kunde skapas (${failures.join(" | ")})`);
}

function commit(task: Task, changed: string[], deleted: string[], created: string[]): string | null {
  const paths = [...changed, ...deleted];
  if (paths.length === 0) return null;
  // Commit files git already tracks, plus files the agent itself created. A file
  // that existed before the run but is not tracked yet cannot be committed
  // without dragging unrelated work in; the snapshot is its rollback.
  const tracked = paths.filter((path) => git(["ls-files", "--error-unmatch", path]).ok || created.includes(path));
  if (tracked.length < paths.length) {
    log(`${paths.length - tracked.length} fil(er) som redan fanns men inte spåras lämnas ocommittade, skyddade av ögonblicksbilden.`);
  }
  if (tracked.length === 0) return null;
  const add = git(["add", "-A", "--", ...tracked]);
  if (!add.ok) {
    log(`git add misslyckades: ${add.out.slice(0, 200)}`);
    return null;
  }
  const message = [
    `agent: ${task.title}`,
    "",
    `Uppgift ${task.id} från docs/backlog.json, körd av scripts/dev-agent.ts.`,
    "Verifierad med typkontroll och testsvit innan commit.",
    "",
    "Generated with Codebuff 🤖",
    "Co-Authored-By: Codebuff <noreply@codebuff.com>",
  ].join("\n");
  const result = Bun.spawnSync(["git", "commit", "-m", message, "--", ...tracked], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    log(`git commit misslyckades: ${(result.stderr?.toString() ?? "").slice(0, 300)}`);
    return null;
  }
  return git(["rev-parse", "--short", "HEAD"]).out.trim() || null;
}

function appendProgress(line: string): void {
  try {
    if (!existsSync(PROGRESS_FILE)) {
      writeFileSync(
        PROGRESS_FILE,
        "# Agentens framsteg\n\nLogg över uppgifter som den autonoma utvecklingsslingan utfört. Skrivs av `scripts/dev-agent.ts`; committade ändringar kan rullas tillbaka med `git revert <sha>`.\n\n",
      );
    }
    appendFileSync(PROGRESS_FILE, `${line}\n`);
  } catch {
    /* progress is best effort */
  }
}

type AttemptRecord = {
  attempt: number;
  strategy: string | null;
  strategyLabel: string;
  model: string;
  agentSeconds: number;
  failure: { kind: FailureKind; detail: string } | null;
  checks: string[];
  files: string[];
};

type TaskReport = {
  taskId: string;
  title: string;
  startedAt: string;
  finishedAt: string;
  status: "done" | "blocked" | "pending" | "environment";
  attempts: AttemptRecord[];
  strategies: string[];
  checks: string[];
  files: string[];
  commit: string | null;
  detail: string;
};

/**
 * Requirement 8: per task, keep the id, the error, the strategy that was used,
 * the number of attempts, the verification result and the final status — both as
 * JSON for machines and as one line in `recovery.jsonl` for a quick history.
 */
function writeReport(report: TaskReport): void {
  try {
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(join(REPORT_DIR, `${report.taskId}-${stamp()}.json`), `${JSON.stringify(report, null, 2)}\n`);
    appendFileSync(
      RECOVERY_LOG,
      `${JSON.stringify({
        at: report.finishedAt,
        task: report.taskId,
        status: report.status,
        attempts: report.attempts.length,
        kinds: report.attempts.map((attempt) => attempt.failure?.kind ?? "ok"),
        strategies: report.strategies,
        checks: report.checks,
        files: report.files,
        commit: report.commit,
        detail: report.detail.slice(0, 400),
      })}\n`,
    );
  } catch (error) {
    log(`Kunde inte skriva rapporten: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Finish an attempt that was interrupted mid-run (crash, reboot, kill). */
function recover(state: State): void {
  if (!state.inFlight) return;
  const { taskId, snapshot, created } = state.inFlight;
  try {
    restoreAttempt(snapshot, state.inFlight.changed ?? [], created ?? []);
    log(`Återupptog avbruten uppgift ${taskId}: trädet återställt.`);
  } catch (error) {
    // The loop must not freeze forever because one snapshot is gone; say so loudly.
    log(`VARNING: avbruten uppgift ${taskId} kunde inte återställas: ${error instanceof Error ? error.message : String(error)}`);
  }
  state.inFlight = null;
  state.currentTaskId = null;
  writeState(state);
}

function readRecovery(state: State, taskId: string): Recovery {
  return state.recoveries?.[taskId] ?? { kind: "agent", attempts: 0, tried: [], updatedAt: nowIso() };
}

/**
 * A task that a human put back to `pending` after it was blocked starts with a
 * clean ladder instead of inheriting the attempts that blocked it.
 */
function resetIfRequeued(state: State, task: Task): void {
  const recovery = state.recoveries?.[task.id];
  if (recovery?.blocked && task.status === "pending") {
    delete state.recoveries![task.id];
    log(`${task.id}: återköad efter blockering; återhämtningshistoriken nollställs.`);
  }
}

function cycleWork(options: { dryRun?: boolean } = {}): CycleResult {
  mkdirSync(STATE_DIR, { recursive: true });
  if (existsSync(STOP_FILE)) return { ok: true, halt: true, detail: "STOP-filen finns: ingen utveckling körs." };

  const state = readState();
  recover(state);

  // iCloud duplicates break tsc and the suite; they are moved aside (never
  // deleted) before anything is measured, otherwise no task could be verified.
  const moved = quarantineDuplicates();
  if (moved.length > 0) {
    const shown = moved.slice(0, 6).join(", ");
    log(`Flyttade ${moved.length} iCloud-dubblett(er) till data/agent/quarantine: ${shown}${moved.length > 6 ? " …" : ""}`);
  }

  const backlog = readBacklog();
  const lint = lintBacklog(backlog);
  if (lint.errors.length > 0) {
    // A broken queue is a human's fix, not a model's: stop before spending.
    return { ok: false, halt: true, detail: `backloggen har strukturella fel: ${lint.errors.slice(0, 3).join(" · ")}` };
  }
  if (lint.warnings.length > 0) {
    log(`${lint.warnings.length} varning(ar) i backloggen: ${lint.warnings.slice(0, 3).join(" · ")}${lint.warnings.length > 3 ? " …" : ""}`);
  }
  const next = nextPending(backlog);
  if (!next) {
    // Nothing to implement: use the cycle to suggest what should come next. The
    // only wait left is human review — once docs/backlog.json is touched again,
    // the next empty cycle writes a fresh batch.
    if (proposalsAwaitReview(state)) {
      return {
        ok: true,
        halt: true,
        detail: `Backloggen är tom; förslagen från ${(state.lastProposalAt ?? "").slice(0, 16).replace("T", " ")} väntar på granskning i docs/backlog-proposals.md.`,
      };
    }
    const model = resolveModel(state);
    if (!model) return { ok: true, halt: true, detail: "Backloggen är tom och ingen modell är tillgänglig för att föreslå nya uppgifter." };
    const proposal = proposeTasks(model, state);
    // Only a written batch counts as "awaiting review". A failed model run must
    // not start the review clock, or the loop would sit idle until the backlog
    // is touched by hand — the same freeze the 24-hour wall caused.
    if (proposal.ok) state.lastProposalAt = nowIso();
    writeState(state);
    return { ok: proposal.ok, halt: true, detail: proposal.detail };
  }

  resetIfRequeued(state, next);
  const known = readRecovery(state, next.id);
  const upcoming = known.tried.length > 0 ? nextStrategy(known.kind, known.tried) : null;
  if (options.dryRun) {
    return {
      ok: true,
      halt: true,
      detail: `Nästa uppgift: ${next.id} — ${next.title}${upcoming ? ` (nästa strategi: ${upcoming.id})` : ""}`,
    };
  }

  const model = resolveModel(state);
  if (!model) {
    return {
      ok: true,
      halt: true,
      detail: `Ingen modell tillgänglig (${state.modelError ?? "okänt fel"}). Verifieringscykeln fortsätter; utvecklingen väntar på en fungerande modell.`,
    };
  }

  // En röd baslinje kan aldrig bli grön av agentens ändring; stoppa hellre här.
  const gate = preflight(state);
  if (!gate.ok) {
    state.environment = { at: nowIso(), detail: gate.detail };
    writeState(state);
    log(`Utvecklingen pausad: ${gate.detail}`);
    return { ok: false, halt: true, detail: `Utvecklingen pausad: ${gate.detail}` };
  }

  let snapshot: Snapshot;
  let snapshotStrategy: string;
  try {
    const created = createSnapshot();
    snapshot = created.snapshot;
    snapshotStrategy = created.strategy;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    state.environment = { at: nowIso(), detail };
    writeState(state);
    // No revertible start means no attempt: the task stays pending and untouched.
    writeReport({
      taskId: next.id,
      title: next.title,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      status: "environment",
      attempts: [],
      strategies: strategiesFor("snapshot").map((strategy) => strategy.id),
      checks: [],
      files: [],
      commit: null,
      detail,
    });
    log(`Ingen uppgift startad: ${detail}`);
    return { ok: false, halt: true, detail: `Ingen uppgift startad, ögonblicksbild saknas: ${detail}` };
  }

  const before = manifest();
  state.currentTaskId = next.id;
  state.inFlight = { taskId: next.id, snapshot, changed: [], created: [] };
  writeState(state);

  const startedAt = nowIso();
  const startedMs = Date.now();
  const recovery = readRecovery(state, next.id);
  const attempts: AttemptRecord[] = [];
  let failure: Failure | null = null;
  let checks: string[] = [];
  let status: TaskReport["status"] = "pending";
  let detail = "";
  let sha: string | null = null;
  let files: string[] = [];

  log(`Startar ${next.id}: ${next.title} (ögonblicksbild: ${snapshotStrategy}, upp till ${MAX_ATTEMPTS} försök)`);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const elapsed = (Date.now() - startedMs) / 1000;
    const remaining = WALL_BUDGET_SECONDS - elapsed;
    if (attempt > 1 && remaining < 120) {
      status = "pending";
      detail = `tidsbudgeten (${WALL_BUDGET_SECONDS} s) tog slut efter ${attempt - 1} försök`;
      log(`${next.id}: ${detail}; uppgiften ligger kvar som pending.`);
      break;
    }

    let strategy: Strategy | null = null;
    if (failure) {
      if (failure.kind === "blocked-task") {
        status = "blocked";
        detail = failure.detail;
        break;
      }
      strategy = nextStrategy(failure.kind, recovery.tried);
      if (!strategy) {
        status = "blocked";
        detail = `inga fler strategier för ${kindLabel(failure.kind)}`;
        log(`${next.id}: ${detail}.`);
        break;
      }
      recovery.tried.push(strategy.id);
      recovery.kind = failure.kind;
      recovery.attempts = attempt;
      recovery.updatedAt = nowIso();
      state.recoveries ??= {};
      state.recoveries[next.id] = recovery;
      writeState(state);
      log(`${next.id}: strategi ${strategy.id} (${strategy.label}) för ${kindLabel(failure.kind)}, försök ${attempt}/${MAX_ATTEMPTS}.`);
      if (strategy.freshStart) {
        const current = diffManifests(before);
        try {
          restoreAttempt(snapshot, [...current.changed, ...current.deleted], current.changed.filter((path) => !before.has(path)));
          log(`${next.id}: försökets ändringar återställda före ny strategi.`);
        } catch (error) {
          // Without a way back the attempt must not continue.
          status = "pending";
          detail = `återställning misslyckades: ${error instanceof Error ? error.message : String(error)}`;
          log(`${next.id}: ${detail}; avbryter uppgiften.`);
          break;
        }
      }
    }

    const plan = buildPlan({ task: next, failure, strategy, attempt, maxAttempts: MAX_ATTEMPTS, model, remainingSeconds: remaining });
    const agent = agentRun(next, plan);
    const diff = diffManifests(before);
    const created = diff.changed.filter((path) => !before.has(path));
    files = [...diff.changed, ...diff.deleted];
    state.inFlight = { taskId: next.id, snapshot, changed: files, created };
    writeState(state);

    let attemptFailure: Failure | null = null;
    let attemptChecks: string[] = [];
    let regression = false;
    if (!agent.ok) {
      attemptFailure = classifyFailure({ stage: "agent", detail: agent.detail, output: agent.output });
    } else if (files.length === 0) {
      attemptFailure = classifyFailure({ stage: "agent", detail: "agenten ändrade inga filer", output: agent.output });
    } else {
      const forbidden = files.filter((path) => !allowed(path));
      if (forbidden.length > 0) {
        attemptFailure = classifyFailure({ stage: "guard", detail: `förbjudna filer: ${forbidden.join(", ")}`, output: forbidden.join("\n") });
      } else {
        const verification = verifyTask(next, gate.ok);
        attemptChecks = verification.checks.map((item) => `${item.name} ${item.ok ? "ok" : "FEL"} ${item.seconds}s`);
        checks = attemptChecks;
        regression = verification.regression && !verification.ok;
        if (!verification.ok) attemptFailure = verification.failure;
      }
    }

    attempts.push({
      attempt,
      strategy: plan.strategyId,
      strategyLabel: strategy?.label ?? "första försöket",
      model: plan.model,
      agentSeconds: agent.seconds,
      failure: attemptFailure ? { kind: attemptFailure.kind, detail: attemptFailure.detail.slice(0, 400) } : null,
      checks: attemptChecks,
      files,
    });

    if (!attemptFailure) {
      sha = commit(next, diff.changed, diff.deleted, created);
      status = "done";
      detail = `typkontroll + ${checks.join(" · ") || "grönt"}${regression ? "" : ""} · ${agent.seconds}s agent${strategy ? ` · strategi ${strategy.id}` : ""}`;
      next.status = "done";
      next.doneAt = nowIso();
      delete next.blockedAt;
      delete next.blockedKind;
      delete next.blockedStrategies;
      next.note = detail.slice(0, 400);
      if (sha) next.commit = sha;
      writeBacklog(backlog);
      state.currentTaskId = null;
      state.inFlight = null;
      state.tasksDone += 1;
      state.attempts[next.id] = attempt;
      delete state.recoveries?.[next.id];
      state.preflight = null;
      writeState(state);
      appendProgress(
        `- ${nowIso().slice(0, 16).replace("T", " ")} · **${next.id}** ${next.title} — klar efter ${attempt} försök${sha ? ` (commit ${sha})` : " (ocommittad)"}. ${detail}`,
      );
      log(`Klar ${next.id}: ${detail}`);
      writeReport({ taskId: next.id, title: next.title, startedAt, finishedAt: nowIso(), status, attempts, strategies: recovery.tried, checks, files, commit: sha, detail });
      return { ok: true, detail: `${next.id} klar: ${detail}` };
    }

    failure = attemptFailure;
    recovery.attempts = attempt;
    recovery.updatedAt = nowIso();
    recovery.kind = failure.kind;
    state.recoveries ??= {};
    state.recoveries[next.id] = recovery;
    state.attempts[next.id] = attempt;
    writeState(state);
    log(`${next.id}: försök ${attempt} misslyckades (${kindLabel(failure.kind)}${regression ? ", regression" : ""}): ${failure.detail.slice(0, 300)}`);
  }

  // Every path out of the loop that is not "done" restores the attempt.
  try {
    const current = diffManifests(before);
    restoreAttempt(snapshot, [...current.changed, ...current.deleted], current.changed.filter((path) => !before.has(path)));
  } catch (error) {
    log(`VARNING: kunde inte återställa ${next.id}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (status === "blocked") {
    const exhausted = nextStrategy(failure?.kind ?? "agent", recovery.tried) === null;
    if (!failure) {
      failure = { kind: "agent", detail: detail || "okänt fel", output: detail };
    }
    const note = blockedNote({
      failure: exhausted && detail.startsWith("inga fler strategier") ? { ...failure, detail: `${failure.detail} (${detail})` } : failure,
      attempts: recovery.tried.length + 1,
      tried: recovery.tried,
      checks,
      regression: false,
    });
    next.status = "blocked";
    next.note = note;
    next.blockedAt = nowIso();
    next.blockedKind = failure.kind;
    next.blockedStrategies = [...recovery.tried];
    recovery.blocked = true;
    state.recoveries ??= {};
    state.recoveries[next.id] = recovery;
    state.tasksBlocked += 1;
    writeBacklog(backlog);
    writeState(state);
    appendProgress(`- ${nowIso().slice(0, 16).replace("T", " ")} · **${next.id}** ${next.title} — blockerad. ${note}`);
    log(`Blockerar ${next.id}: ${note}`);
  } else {
    next.note = `återhämtning pågår (${recovery.kind}): ${detail || (failure?.detail ?? "")}`.slice(0, 400);
    writeBacklog(backlog);
    writeState(state);
    appendProgress(
      `- ${nowIso().slice(0, 16).replace("T", " ")} · **${next.id}** ${next.title} — väntar (${detail || failure?.detail || "okänt"}), ändringarna återställda.`,
    );
    log(`${next.id}: ${detail || failure?.detail || "avbruten"}; ändringarna återställda, uppgiften ligger kvar.`);
  }

  state.currentTaskId = null;
  state.inFlight = null;
  writeState(state);
  appendFileSync(
    HISTORY_FILE,
    `${JSON.stringify({
      at: nowIso(),
      task: next.id,
      ok: false,
      status,
      attempts: attempts.length,
      strategies: recovery.tried,
      detail: detail || failure?.detail || null,
      files,
    })}\n`,
  );
  writeReport({
    taskId: next.id,
    title: next.title,
    startedAt,
    finishedAt: nowIso(),
    status,
    attempts,
    strategies: recovery.tried,
    checks,
    files,
    commit: sha,
    detail: next.note ?? detail,
  });
  return {
    ok: false,
    detail: `${next.id} ${status === "blocked" ? "blockerad" : "väntar"}: ${next.note ?? detail}`,
  };
}

/** Public entry point: takes the lock, runs one task, always releases. */
export function runDevelopmentCycle(options: { dryRun?: boolean } = {}): CycleResult {
  if (!acquireLock()) return { ok: true, halt: true, detail: "En annan utvecklingskörning pågår." };
  try {
    return cycleWork(options);
  } finally {
    releaseLock();
  }
}

if (import.meta.main) {
  const dryRun = process.argv.includes("--dry-run");
  const once = process.argv.includes("--once");
  if (process.argv.includes("--repair")) {
    const moved = quarantineDuplicates();
    console.log(moved.length === 0 ? "Inga iCloud-dubbletter hittades." : `Flyttade ${moved.length} dubblett(er) till data/agent/quarantine: ${moved.join(", ")}`);
    process.exit(0);
  }
  if (process.argv.includes("--propose")) {
    const state = readState();
    const model = resolveModel(state);
    if (!model) {
      console.log(`Ingen modell tillgänglig: ${state.modelError ?? "okänt fel"}`);
      process.exit(1);
    }
    const result = proposeTasks(model, state);
    if (result.ok) state.lastProposalAt = nowIso();
    writeState(state);
    console.log(result.detail);
    process.exit(result.ok ? 0 : 1);
  }
  const limit = Number(process.env.AGENT_LOOP_LIMIT ?? 20);
  let done = 0;
  while (done < limit) {
    const result = runDevelopmentCycle({ dryRun });
    console.log(result.detail);
    if (dryRun || result.halt) break;
    done += 1;
    if (once) break;
    if (existsSync(STOP_FILE)) break;
  }
}
