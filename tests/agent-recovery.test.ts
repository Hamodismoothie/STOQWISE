/**
 * Controlled failure scenarios for the self-healing development loop.
 *
 * These tests never call the model and never touch the real tree: they exercise
 * the parts of `scripts/dev-agent.ts` that decide *what went wrong* and *what to
 * do differently next*, plus snapshot/restore in a throwaway directory. That is
 * exactly the logic that used to fail silently — a tar flag broke every cycle
 * and nothing distinguished "the snapshot failed" from "the code is wrong".
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  allowed,
  applyFault,
  applySuccess,
  billingFor,
  buildReceipt,
  ranOutOfTime,
  summarizeUsage,
  classifyBackendOutput,
  describeCooling,
  nextCooldownMinutes,
  parseAgentOutput,
  selectBackend,
  blockedNote,
  classifyErrorText,
  classifyFailure,
  excerptFailure,
  lintBacklog,
  nextModel,
  nextPending,
  nextStrategy,
  planAcceptance,
  quarantineDuplicates,
  restoreAttempt,
  snapshotAvailable,
  strategiesFor,
  takeSnapshot,
  type BackendSpec,
  type Backlog,
  type FailureKind,
  type HealthMap,
  type Task,
} from "../scripts/dev-agent.ts";
import { extractCommand } from "../scripts/backlog-verify.ts";

describe("acceptanskriterier", () => {
  const task = (patch: Partial<Task>): Task => ({ id: "t-1", title: "t", brief: "", priority: 1, status: "pending", ...patch });

  test("en uppgift med enbart prosa körs aldrig som kommando", () => {
    // Regression: this exact shape ("GET /perf.js …") was executed as a program
    // and killed an already finished task in cycles 61-62.
    expect(planAcceptance(task({ accept: "GET /perf.js svarar 200 med text/javascript" }))).toEqual({
      kind: "prose",
      text: "GET /perf.js svarar 200 med text/javascript",
    });
  });

  test("verify går före prosan och körs som kommando", () => {
    expect(planAcceptance(task({ accept: "prosan", verify: "bun test tests/motion.test.ts" }))).toEqual({
      kind: "command",
      command: "bun test tests/motion.test.ts",
    });
  });

  test("utan kriterium blir utfallet none", () => {
    expect(planAcceptance(task({})).kind).toBe("none");
  });

  test("kommandot extraheras ur prosan utan att ta med meningen", () => {
    expect(extractCommand("bunx playwright test e2e/perf.spec.ts --workers=1: inga frames")).toBe(
      "bunx playwright test e2e/perf.spec.ts --workers=1",
    );
    expect(extractCommand("bun test tests/app-world.test.ts för 1999, 2000 och 2001 artiklar")).toBe(
      "bun test tests/app-world.test.ts",
    );
    expect(extractCommand("GET /perf.js svarar 200")).toBeNull();
    expect(extractCommand("En injicerad serie om 126 frames à 30 ms")).toBeNull();
  });
});

describe("urval, grindar och backlogg", () => {
  test("manuella uppgifter väljs aldrig", () => {
    const backlog: Backlog = {
      tasks: [
        { id: "a", title: "a", brief: "", priority: 1, status: "pending", manual: true },
        { id: "b", title: "b", brief: "", priority: 5, status: "pending" },
        { id: "c", title: "c", brief: "", priority: 9, status: "done" },
      ],
    };
    expect(nextPending(backlog)?.id).toBe("b");
  });

  test("motorn, backloggen och data kan inte skrivas av agenten", () => {
    expect(allowed("scripts/dev-agent.ts")).toBe(false);
    expect(allowed("docs/backlog.json")).toBe(false);
    expect(allowed("data/lagerradar.db")).toBe(false);
    expect(allowed("src/server.ts")).toBe(true);
  });

  test("linten fäller strukturella fel", () => {
    const backlog: Backlog = {
      tasks: [
        { id: "d", title: "d", brief: "", priority: 1, status: "pending" },
        { id: "d", title: "", brief: "", priority: 2, status: "pending" },
      ],
    };
    const lint = lintBacklog(backlog);
    expect(lint.errors.some((error) => error.includes("dublett-id d"))).toBe(true);
    expect(lint.errors.some((error) => error.includes("saknar title"))).toBe(true);
  });

  test("prosa är en varning, inte ett fel", () => {
    const lint = lintBacklog({
      tasks: [{ id: "e", title: "e", brief: "", priority: 1, status: "pending", accept: "text" }],
    });
    expect(lint.errors).toEqual([]);
    expect(lint.unverifiable).toEqual(["e"]);
  });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "stoqwise-agent-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), "export const a = 0;\n");
  writeFileSync(join(root, "src", "b.ts"), "export const b = 0;\n");
  writeFileSync(join(root, "src", "c.ts"), "export const c = 0;\n");
  return root;
}

describe("feldetektering", () => {
  test("varje steg får en egen feltyp", () => {
    expect(classifyFailure({ stage: "snapshot", detail: "tar: lseek(SEEK_HOLE) failed" }).kind).toBe("snapshot");
    expect(classifyFailure({ stage: "guard", detail: "förbjudna filer: package.json" }).kind).toBe("guard");
    expect(classifyFailure({ stage: "typecheck", detail: "typkontroll: 2 fel" }).kind).toBe("typecheck");
    expect(classifyFailure({ stage: "tests", detail: "tester: 1 fail" }).kind).toBe("tests");
    expect(classifyFailure({ stage: "accept", detail: "accept (cmd): exit 1" }).kind).toBe("accept");
    expect(classifyFailure({ stage: "agent", detail: "slut på turer", output: "ran out of steps" }).kind).toBe("agent");
  });

  test("agentens BLOCKED-svar är inte ett vanligt fel utan ett beslut", () => {
    const failure = classifyFailure({ stage: "agent", detail: "BLOCKED: kräver produktbeslut", output: "BLOCKED: kräver produktbeslut" });
    expect(failure.kind).toBe("blocked-task");
    expect(strategiesFor(failure.kind)).toHaveLength(0);
  });

  test("okänt fel klassas från texten", () => {
    expect(classifyErrorText("src/a.ts(1,1): error TS2322: Type 'string' is not assignable")).toBe("typecheck");
    expect(classifyErrorText("1 tests failed:\n(fail) sidfot > länkar")).toBe("tests");
    expect(classifyErrorText("tar: lseek(SEEK_HOLE) failed: Resource deadlock avoided")).toBe("snapshot");
    expect(classifyErrorText("återställningsmöjlighet saknas: /tmp/x.tar.gz")).toBe("snapshot");
    expect(classifyErrorText("BLOCKED: kräver beslut")).toBe("blocked-task");
    expect(classifyErrorText("något oväntat hände")).toBe("agent");
  });

  test("felutdraget behåller felraderna och kastar scrollback", () => {
    const typecheck = [
      "$ tsc --noEmit",
      "src/ui/a.ts(12,3): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/ui/b.ts(4,1): error TS1005: ';' expected.",
    ].join("\n");
    const excerpt = excerptFailure(typecheck);
    expect(excerpt).toContain("error TS2322");
    expect(excerpt).toContain("error TS1005");
    expect(excerpt).not.toContain("$ tsc --noEmit");

    const tests = "ett gäng godkända rader\n1 tests failed:\n(fail) sidfot > länkar finns\n 472 pass";
    expect(excerptFailure(tests)).toContain("(fail) sidfot > länkar finns");
  });
});

describe("reservstrategier", () => {
  test("stegen är ordnade och upprepas aldrig", () => {
    const kinds: FailureKind[] = ["snapshot", "guard", "agent", "typecheck", "tests", "accept"];
    for (const kind of kinds) {
      const ladder = strategiesFor(kind);
      expect(ladder.length).toBeGreaterThan(0);
      const ids = ladder.map((strategy) => strategy.id);
      expect(new Set(ids).size).toBe(ids.length);

      const tried: string[] = [];
      for (const strategy of ladder) {
        expect(nextStrategy(kind, tried)?.id).toBe(strategy.id);
        tried.push(strategy.id);
      }
      expect(nextStrategy(kind, tried)).toBeNull();
    }
  });

  test("strategi 2 ändrar modell och strategi 3 börjar om från ögonblicksbilden", () => {
    const ladder = strategiesFor("tests");
    expect(ladder[0]?.model).not.toBe("next");
    expect(ladder[1]?.model).toBe("next");
    expect(ladder[1]?.extraTurns).toBeGreaterThan(0);
    expect(ladder[2]?.freshStart).toBe(true);

    const agentLadder = strategiesFor("agent");
    expect(agentLadder.every((strategy) => strategy.id.startsWith("agent-"))).toBe(true);
    expect(new Set(agentLadder.map((strategy) => strategy.id)).size).toBe(agentLadder.length);
  });

  test("reservmodellen används först när den har svarat", () => {
    const current = "tencent/hy4-flash:free";
    // AGENT_CLI läses vid import och ärvs från den agent som kör sviten. Med
    // Claude-backend finns ingen modellstege: samma modell behålls och ingen
    // modell provas.
    const saved = process.env.AGENT_CLI;
    try {
      // Modellstegen finns bara på Hermes; poolen väljer annars Claude eller Codex,
      // som har en fast modell och ingen stege att prova.
      process.env.AGENT_CLI = "hermes";
      // En modell som svarar väljs; en som inte svarar får aldrig ett försök.
      expect(nextModel(current, (model) => model === "upstage/solar-mini4:free")).toBe("upstage/solar-mini4:free");
      expect(nextModel(current, () => false)).toBe(current);
      process.env.AGENT_CLI = "claude";
      let probed = 0;
      expect(nextModel(current, () => (probed++, true))).toBe(current);
      expect(probed).toBe(0);
    } finally {
      if (saved === undefined) delete process.env.AGENT_CLI;
      else process.env.AGENT_CLI = saved;
    }
  });

  test("blockeringsnoten dokumenterar fel, strategier och verifiering", () => {
    const note = blockedNote({
      failure: { kind: "tests", detail: "tester: (fail) sidfot > länkar | 1 fail", output: "" },
      attempts: 3,
      tried: ["tests-repair", "tests-alt-model"],
      checks: ["typkontroll ok 9.1s", "tester FEL 15.2s"],
      regression: true,
    });
    expect(note).toContain("BLOCKED efter 3 försök");
    expect(note).toContain("tester");
    expect(note).toContain("regression");
    expect(note).toContain("tests-repair → tests-alt-model");
    expect(note).toContain("tester FEL");
    expect(note).toContain("sidfot");
    expect(note.length).toBeLessThanOrEqual(900);
  });
});

describe("iCloud-dubbletter", () => {
  test("äkta dubbletter flyttas till karantän, allt annat ligger kvar", () => {
    const root = mkdtempSync(join(tmpdir(), "stoqwise-dupes-"));
    try {
      mkdirSync(join(root, "tests"), { recursive: true });
      mkdirSync(join(root, "docs"), { recursive: true });
      writeFileSync(join(root, "tests", "arcade.d.ts"), "original");
      writeFileSync(join(root, "tests", "arcade.d 2.ts"), "dubblett 2");
      writeFileSync(join(root, "tests", "arcade.d 3.ts"), "dubblett 3");
      writeFileSync(join(root, "tests", "unika 2.ts"), "ingen tvilling");
      writeFileSync(join(root, "docs", "backlog.json 2.backup"), "användarens backup");

      const target = join(root, "data", "agent", "quarantine");
      const moved = quarantineDuplicates(root, target);

      expect(moved.sort()).toEqual(["tests/arcade.d 2.ts", "tests/arcade.d 3.ts"]);
      expect(existsSync(join(root, "tests", "arcade.d.ts"))).toBe(true);
      expect(existsSync(join(root, "tests", "arcade.d 2.ts"))).toBe(false);
      expect(existsSync(join(root, "tests", "unika 2.ts"))).toBe(true);
      expect(existsSync(join(root, "docs", "backlog.json 2.backup"))).toBe(true);
      // Ingenting raderas: innehållet finns kvar i karantänen med ett manifest.
      expect(readFileSync(join(target, "files", "tests", "arcade.d 2.ts"), "utf8")).toBe("dubblett 2");
      const manifest = JSON.parse(readFileSync(join(target, "manifest.json"), "utf8")) as { moved: string[] };
      expect(manifest.moved.sort()).toEqual(["tests/arcade.d 2.ts", "tests/arcade.d 3.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("ögonblicksbild och återställning", () => {
  test("tar-ögonblicksbilden återställer bara försökets filer", () => {
    const root = makeRoot();
    try {
      const snapshot = takeSnapshot(root, ["tar"]);
      expect(snapshot.kind).toBe("tar");
      expect(snapshotAvailable(snapshot)).toBe(true);

      writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
      writeFileSync(join(root, "src", "new.ts"), "export const n = 1;\n");
      rmSync(join(root, "src", "b.ts"));
      // En mänsklig ändring utanför försöket får aldrig rullas tillbaka.
      writeFileSync(join(root, "src", "c.ts"), "// människa\n");

      restoreAttempt(snapshot, ["src/a.ts", "src/b.ts"], ["src/new.ts"], root);

      expect(readFileSync(join(root, "src", "a.ts"), "utf8")).toBe("export const a = 0;\n");
      expect(existsSync(join(root, "src", "b.ts"))).toBe(true);
      expect(existsSync(join(root, "src", "new.ts"))).toBe(false);
      expect(readFileSync(join(root, "src", "c.ts"), "utf8")).toBe("// människa\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reservstrategin är en filkopia och återställer på samma sätt", () => {
    const root = makeRoot();
    try {
      const snapshot = takeSnapshot(root, ["tree"]);
      expect(snapshot.kind).toBe("tree");
      expect(snapshot.files).toBe(3);

      writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
      writeFileSync(join(root, "src", "new.ts"), "export const n = 1;\n");
      rmSync(join(root, "src", "b.ts"));

      restoreAttempt(snapshot, ["src/a.ts", "src/b.ts"], ["src/new.ts"], root);

      expect(readFileSync(join(root, "src", "a.ts"), "utf8")).toBe("export const a = 0;\n");
      expect(readFileSync(join(root, "src", "b.ts"), "utf8")).toBe("export const b = 0;\n");
      expect(existsSync(join(root, "src", "new.ts"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("utan ögonblicksbild vägras återställning", () => {
    const root = makeRoot();
    try {
      expect(snapshotAvailable(join(root, "finns-inte.tar.gz"))).toBe(false);
      expect(() => restoreAttempt(join(root, "finns-inte.tar.gz"), ["src/a.ts"], [], root)).toThrow(/återställningsmöjlighet saknas/);
      expect(readFileSync(join(root, "src", "a.ts"), "utf8")).toBe("export const a = 0;\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Z0: kvotmedvetenhet", () => {
  const pool: BackendSpec[] = [
    { id: "claude", bin: "claude", label: "Claude Code" },
    { id: "codex", bin: "codex", label: "Codex" },
  ];
  const healthy = (over: Partial<HealthMap[string]> = {}): HealthMap[string] => ({
    state: "available",
    until: null,
    strikes: 0,
    lastError: null,
    lastFault: null,
    updatedAt: "2026-11-25T00:00:00.000Z",
    ...over,
  });

  test("kvotsvar, inloggningsfel och saknad binär klassas olika", () => {
    expect(classifyBackendOutput("Claude AI usage limit reached. Resets at 15:40")).toBe("quota");
    expect(classifyBackendOutput("Error 429: too many requests")).toBe("quota");
    expect(classifyBackendOutput("API error: quota exceeded for this billing period")).toBe("quota");
    expect(classifyBackendOutput("401 Unauthorized: invalid api key")).toBe("auth");
    expect(classifyBackendOutput("Please log in again to continue")).toBe("auth");
    expect(classifyBackendOutput("spawn claude ENOENT")).toBe("unavailable");
    expect(classifyBackendOutput("Alla tester gröna, typkontroll 0 fel")).toBeNull();
  });

  test("cooldown trappas upp och taket är sex timmar", () => {
    expect([0, 1, 2, 3, 4, 9].map(nextCooldownMinutes)).toEqual([15, 45, 120, 360, 360, 360]);
  });

  test("en kylande backend hoppas över tills tiden gått ut", () => {
    const now = Date.parse("2026-11-25T12:00:00.000Z");
    const health = { claude: healthy({ state: "cooling", until: now + 60_000 }) };
    expect(selectBackend(pool, health, now)?.id).toBe("codex");
    expect(selectBackend(pool, health, now + 60_000)?.id).toBe("claude");
  });

  test("när alla är i cooldown väljs ingen backend alls", () => {
    const now = Date.parse("2026-11-25T12:00:00.000Z");
    const health = {
      claude: healthy({ state: "cooling", until: now + 900_000 }),
      codex: healthy({ state: "cooling", until: now + 2_700_000 }),
    };
    expect(selectBackend(pool, health, now)).toBeNull();
    expect(describeCooling(health, now)).toContain("claude 15 min");
    expect(describeCooling(health, now)).toContain("codex 45 min");
  });

  test("ett kvotfel sätter cooldown med växande straff", () => {
    const now = Date.parse("2026-11-25T12:00:00.000Z");
    const first = applyFault({}, "claude", "quota", "usage limit reached", now);
    expect(first.claude?.state).toBe("cooling");
    expect(first.claude?.until).toBe(now + 15 * 60_000);
    expect(first.claude?.strikes).toBe(1);
    const second = applyFault(first, "claude", "quota", "usage limit reached", now);
    expect(second.claude?.strikes).toBe(2);
    expect(second.claude?.until).toBe(now + 45 * 60_000);
  });

  test("inloggningsfel ger ingen cooldown — det läker inte av sig självt", () => {
    const now = Date.parse("2026-11-25T12:00:00.000Z");
    const health = applyFault({}, "codex", "auth", "not logged in", now);
    expect(health.codex?.state).toBe("available");
    expect(health.codex?.until).toBeNull();
    expect(health.codex?.lastFault).toBe("auth");
  });

  test("en lyckad körning nollställer straffet", () => {
    const now = Date.parse("2026-11-25T12:00:00.000Z");
    const cooling = applyFault({}, "claude", "quota", "usage limit reached", now);
    expect(applySuccess(cooling, "claude", now).claude).toMatchObject({ state: "available", strikes: 0, lastError: null });
  });

  test("Claude Codes JSON läses som kvitto, vanlig text som text", () => {
    const envelope = [
      "Warning: no stdin data received in 3s",
      JSON.stringify({
        result: "Klart: 2 filer ändrade",
        total_cost_usd: 0.2039,
        usage: {
          input_tokens: 2,
          output_tokens: 4,
          cache_read_input_tokens: 9444,
          cache_creation_input_tokens: 25245,
        },
      }),
    ].join("\n");
    expect(parseAgentOutput(envelope)).toEqual({
      text: "Klart: 2 filer ändrade",
      usage: { input: 2, output: 4, cacheRead: 9444, cacheWrite: 25245, costUsd: 0.2039 },
    });
    expect(parseAgentOutput("vanligt svar utan kvitto")).toEqual({ text: "vanligt svar utan kvitto", usage: null });
    expect(parseAgentOutput("{ trasig json")).toEqual({ text: "{ trasig json", usage: null });
  });
});

describe("Z0: kvittot skiljer kostnad, förbrukning och API-motsvarighet", () => {
  const usage = { input: 10, output: 1_000, cacheRead: 5_000, cacheWrite: 200, costUsd: 0.5 };
  const base = { at: "2026-11-25T19:00:00.000Z", task: "d3-06", seconds: 12, exit: 0, fault: null };

  test("prenumeration kostar 0 kr men redovisar API-motsvarigheten", () => {
    const receipt = buildReceipt({ ...base, backend: "claude", usage, env: {} });
    expect(receipt.billing).toBe("subscription");
    expect(receipt.actualCostUsd).toBe(0);
    expect(receipt.apiEquivalentUsd).toBe(0.5);
    expect(receipt.tokens).toEqual({ input: 10, output: 1_000, cacheRead: 5_000, cacheWrite: 200 });
  });

  test("en API-nyckel gör samma tokens till en faktisk kostnad", () => {
    const receipt = buildReceipt({ ...base, backend: "claude", usage, env: { ANTHROPIC_API_KEY: "satt" } });
    expect(receipt.billing).toBe("api");
    expect(receipt.actualCostUsd).toBe(0.5);
    expect(receipt.apiEquivalentUsd).toBe(0.5);
  });

  test("Codex utan prisuppgift lämnar API-motsvarigheten okänd i stället för noll", () => {
    const receipt = buildReceipt({ ...base, backend: "codex", usage: null, env: {} });
    expect(receipt.billing).toBe("subscription");
    expect(receipt.actualCostUsd).toBe(0);
    expect(receipt.apiEquivalentUsd).toBeNull();
    expect(receipt.tokens).toBeNull();
  });

  test("billingFor gissar aldrig: okänd backend ger unknown", () => {
    expect(billingFor(null, {})).toBe("unknown");
    expect(billingFor("codex", { OPENAI_API_KEY: "satt" })).toBe("api");
    expect(billingFor("codex", {})).toBe("subscription");
  });

  test("summan håller isär pengar, tokens och saknade prisuppgifter", () => {
    const paid = buildReceipt({ ...base, backend: "claude", usage, env: { ANTHROPIC_API_KEY: "satt" } });
    const free = buildReceipt({ ...base, backend: "claude", usage, env: {} });
    const unknown = buildReceipt({ ...base, backend: "codex", usage: null, env: {} });
    const summary = summarizeUsage([paid, free, unknown]);
    expect(summary.claude).toMatchObject({ runs: 2, actualCostUsd: 0.5, apiEquivalentUsd: 1, unknownEquivalentRuns: 0 });
    expect(summary.claude?.tokens.output).toBe(2_000);
    expect(summary.codex).toMatchObject({ runs: 1, actualCostUsd: 0, apiEquivalentUsd: 0, unknownEquivalentRuns: 1 });
  });
});

describe("Z0: tidsgräns är ett misslyckat försök, inte en extern signal", () => {
  test("720 s mot en 720 s gräns räknas som tidsgräns", () => {
    expect(ranOutOfTime(143, 720_500, 720_000)).toBe(true);
  });

  test("143 efter 124 s är fortfarande en extern signal", () => {
    expect(ranOutOfTime(143, 124_500, 720_000)).toBe(false);
  });

  test("exit 0 och saknad utdata räknas aldrig som tidsgräns utan tid", () => {
    expect(ranOutOfTime(0, 720_500, 720_000)).toBe(false);
    expect(ranOutOfTime(null, 12_000, 720_000)).toBe(false);
  });
});
