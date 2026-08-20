import { join } from "node:path";
import { loadConfig, loadRules, readJsonl, patternsMayOverlap, generatedPaths, fail } from "./lib.mjs";

/**
 * Refuses to dispatch an issue whose reservations conflict.
 *
 * An issue holds its paths in every phase listed by
 * reservation_holding_phases, blocked phases included. An issue with no
 * declared reservation is reported as unguarded, never as safe. The overlap
 * is computed by patternsMayOverlap, a conservative rule that can over-block
 * but never under-block.
 *
 * Generated paths are removed on both sides first: they are rewritten from
 * the source tree by a command, so two issues meeting there are not two
 * issues writing the same file.
 *
 * Usage: node check-reservations.mjs <issue-id>
 */
function main() {
  const issueId = process.argv[2];
  if (!issueId) fail("usage : check-reservations.mjs <issue-id>");
  const config = loadConfig();
  const rules = loadRules();
  const path = join(config.store_dir, "issues.jsonl");
  const entries = readJsonl(path);
  const target = entries.find((e) => e.record.id === issueId);
  if (target == null) fail(`issue not found: ${issueId}`);

  const generated = new Set(generatedPaths(config));
  const guarded = (record) =>
    (record.pipeline_state?.file_reservations ?? []).filter((pattern) => !generated.has(pattern));
  const targetReservations = guarded(target.record);
  if (targetReservations.length === 0) {
    fail(`issue ${issueId} unguarded: no reservation declared. Declare a scope before dispatching.`);
  }

  const holding = new Set(rules.reservation_holding_phases);
  const conflicts = [];
  for (const entry of entries) {
    const record = entry.record;
    if (record.id === issueId) continue;
    const state = record.pipeline_state;
    if (state == null || !holding.has(state.phase)) continue;
    for (const theirs of guarded(record)) {
      for (const ours of targetReservations) {
        if (patternsMayOverlap(ours, theirs)) {
          conflicts.push(`${record.id} (${state.phase}) tient ${theirs}, chevauche ${ours}`);
        }
      }
    }
  }

  if (conflicts.length > 0) {
    for (const conflict of conflicts) console.error(`conflict: ${conflict}`);
    fail(`dispatch refused for ${issueId}`);
  }
  console.log(`no collision: ${issueId} can be dispatched (${targetReservations.length} reservation(s))`);
}

main();
