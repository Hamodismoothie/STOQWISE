/**
 * Backlog lint: the queue is the loop's input, so a broken queue must be caught
 * before a model call is spent on it.
 *
 * Errors (exit 1) are structural: duplicate ids, unknown status, missing title
 * or priority, an empty `verify`. Warnings (exit 0) are quality signals: a
 * pending task whose acceptance criterion cannot be machine-checked.
 *
 * Usage:
 *   bun scripts/backlog-lint.ts            # report
 *   bun scripts/backlog-lint.ts --strict   # warnings are errors too
 */
import { join } from "node:path";
import { lintBacklog, type Backlog } from "./dev-agent.ts";

const ROOT = join(import.meta.dir, "..");
const strict = process.argv.includes("--strict");

const backlog = JSON.parse(await Bun.file(join(ROOT, "docs", "backlog.json")).text()) as Backlog;
const lint = lintBacklog(backlog);
const pending = backlog.tasks.filter((task) => task.status === "pending" && !task.manual);
const manual = backlog.tasks.filter((task) => task.status === "pending" && task.manual);

console.log(`Uppgifter: ${backlog.tasks.length} · väntande: ${pending.length} · manuella: ${manual.length}`);
console.log(`Maskinellt verifierbara: ${pending.length - lint.unverifiable.length} av ${pending.length}`);

if (lint.unverifiable.length > 0) {
  console.log(`Utan körbart kriterium: ${lint.unverifiable.join(", ")}`);
}
for (const warning of lint.warnings) console.log(`VARNING ${warning}`);
for (const error of lint.errors) console.log(`FEL ${error}`);

if (lint.errors.length > 0 || (strict && lint.warnings.length > 0)) {
  console.log(`\nBackloggen är inte giltig (${lint.errors.length} fel, ${lint.warnings.length} varningar).`);
  process.exit(1);
}

console.log("\nBackloggen är giltig.");
