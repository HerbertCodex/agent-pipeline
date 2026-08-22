import { readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, readJsonl, fail } from "./lib.mjs";

/**
 * Lists the handoffs on disk, and removes the ones nothing needs any more.
 *
 * The prompts said to save a handoff « to a temporary JSON file outside the
 * repository ». Nothing could refuse a file written inside it, and one real
 * run left `i-0002-implementer.json` sitting in the tree — where the scope
 * check flags it and a reviewer reads it by mistake. Worse, a file with no
 * home is a file nobody can clean up, so they accumulate.
 *
 * `handoffs_dir` gives them a home, git ignores it, and this removes the ones
 * whose issue has closed: QA reads the implementer's handoff while the issue
 * runs, and nobody reads it afterwards — the store holds what survives.
 *
 * A handoff naming an issue the store does not carry is KEPT and reported.
 * Deleting it would destroy the only trace of work the pipeline never saw,
 * which is the one case where the file matters most.
 *
 * Usage: node handoffs.mjs [--prune]
 */
function main() {
  const prune = process.argv.includes("--prune");
  const config = loadConfig();
  const dir = config.handoffs_dir;
  if (typeof dir !== "string") {
    fail(
      'handoffs_dir missing: name the directory handoffs are written to, git-ignored. `"handoffs_dir": ' +
        '"pipeline/handoffs"`. Without a home they are written anywhere and cleaned up by nobody.',
    );
  }
  if (!existsSync(dir)) {
    console.log(`${dir} does not exist yet: no handoff has been written.`);
    return;
  }

  const records = readJsonl(join(config.store_dir, "issues.jsonl")).map((entry) => entry.record);
  const phase = new Map(records.map((record) => [record.id, record.pipeline_state?.phase]));

  const stale = [];
  const orphans = [];
  const live = [];

  for (const name of readdirSync(dir).filter((file) => file.endsWith(".json")).sort()) {
    let issueId = null;
    try {
      issueId = JSON.parse(readFileSync(join(dir, name), "utf8")).scope?.issue_id ?? null;
    } catch {
      issueId = null;
    }
    if (issueId == null || !phase.has(issueId)) orphans.push({ name, issueId });
    else if (phase.get(issueId) === "closed") stale.push({ name, issueId });
    else live.push({ name, issueId });
  }

  for (const entry of stale) {
    if (prune) rmSync(join(dir, entry.name));
    console.log(`${prune ? "removed" : "stale  "}  ${entry.name}  (${entry.issueId} closed)`);
  }
  for (const entry of live) console.log(`kept     ${entry.name}  (${entry.issueId} still running)`);
  for (const entry of orphans) {
    console.log(`kept     ${entry.name}  (${entry.issueId ?? "no issue named"} — the store does not carry it)`);
  }

  if (stale.length > 0 && !prune) {
    console.log(`\n${stale.length} handoff(s) belong to closed issues. Run with --prune to remove them.`);
  }
  if (orphans.length > 0) {
    console.log(
      `\n${orphans.length} handoff(s) name an issue the store does not carry, and are never removed: ` +
        "they are the only trace of work the pipeline did not see.",
    );
  }
}

main();
