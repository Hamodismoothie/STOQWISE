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
  type Backlog,
  type FailureKind,
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
    // En modell som svarar väljs; en som inte svarar får aldrig ett försök.
    expect(nextModel(current, (model) => model === "upstage/solar-mini4:free")).toBe("upstage/solar-mini4:free");
    expect(nextModel(current, () => false)).toBe(current);
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
