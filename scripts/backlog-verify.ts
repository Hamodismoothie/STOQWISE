/**
 * One-time (re-runnable) migration: turn the machine-runnable part of a task's
 * prose `accept` text into a separate `verify` command.
 *
 * Why: the loop used to execute the whole prose sentence as a command, which is
 * what threw `Executable not found: "GET"` and killed an already finished task.
 * The prose stays where it is (`accept` is never rewritten), so no history is
 * lost; `verify` is added only when a leading command can be isolated exactly.
 *
 * Rule: take the text before the first sentence separator, require it to start
 * with a known runner and to contain no Swedish prose characters. Anything else
 * is left alone and reported by `scripts/backlog-lint.ts`.
 *
 * Usage:
 *   bun scripts/backlog-verify.ts            # visa vad som skulle ändras
 *   bun scripts/backlog-verify.ts --write    # skriv ändringen
 */
import { join } from "node:path";

const RUNNERS = /^(bun|bunx|npx|node|curl|bash|sh)\b/;
const SEPARATORS = [":", ";", " och ", " för ", " när ", " där ", " som ", " svarar ", " ger ", " med ", " utan "];

/** The leading shell command in a prose acceptance text, or null. */
export function extractCommand(text: string): string | null {
  const trimmed = text.trim();
  if (!RUNNERS.test(trimmed)) return null;
  let cut = trimmed.length;
  for (const separator of SEPARATORS) {
    const at = trimmed.indexOf(separator);
    if (at > 0 && at < cut) cut = at;
  }
  const candidate = trimmed
    .slice(0, cut)
    .trim()
    .replace(/[,.]$/, "");
  if (!candidate || !RUNNERS.test(candidate)) return null;
  if (/[åäöÅÄÖ]/.test(candidate)) return null;
  if (candidate.split(/\s+/).length > 14) return null;
  return candidate;
}

type Task = {
  id: string;
  status: string;
  accept?: string;
  acceptance?: string;
  verify?: string;
  manual?: boolean;
  note?: string;
};

async function main(): Promise<void> {
  const ROOT = join(import.meta.dir, "..");
  const BACKLOG = join(ROOT, "docs", "backlog.json");
  const write = process.argv.includes("--write");

  const backlog = JSON.parse(await Bun.file(BACKLOG).text()) as { tasks: Task[] };
  const added: string[] = [];
  const manual: string[] = [];
  const already: string[] = [];

  for (const task of backlog.tasks) {
    if (task.status !== "pending") continue;
    if (task.verify) {
      already.push(task.id);
      continue;
    }
    const prose = task.accept ?? task.acceptance ?? "";
    const command = extractCommand(prose);
    if (command) {
      task.verify = command;
      added.push(`${task.id} → ${command}`);
      continue;
    }
    // No runnable criterion exists. The loop must not spend a model call on a
    // task it cannot judge, so it is parked for a human instead of being
    // "verified" by the test suite alone.
    task.manual = true;
    task.note = `${task.note ?? ""} Manuell: acceptanskriteriet går inte att köra som ett kommando. Skriv ett \`verify\`-kommando för att släppa den till slingan.`.trim();
    manual.push(`${task.id} (${prose.slice(0, 60)}…)`);
  }

  console.log(`Redan med verify: ${already.length}`);
  console.log(`Fick verify: ${added.length}`);
  for (const line of added) console.log(`  + ${line}`);
  console.log(`Parkerade som manuella: ${manual.length}`);
  for (const line of manual) console.log(`  ! ${line}`);

  if (!write) {
    console.log("\nTorrkörning. Kör med --write för att spara.");
    return;
  }
  await Bun.write(BACKLOG, `${JSON.stringify(backlog, null, 2)}\n`);
  console.log(`\nSkrev ${BACKLOG}.`);
}

if (import.meta.main) await main();
