#!/usr/bin/env node
/**
 * Writes the transition a phase held by the orchestrator owes, and projects it.
 *
 * A phase the orchestrator holds is a phase where nothing has started: the
 * work begins when the agent does. Dispatching without moving it first leaves
 * the task package built on the held phase, so the agent computes its handoff
 * basis on that record; the transition owed afterwards changes the hash, and
 * `store-update` then refuses the handoff as stale while `dispatch-preflight`
 * refuses every later dispatch for the unconsumed one. The issue is stranded,
 * and the only visible cause is two rules that are each right.
 *
 * This is a step of its own rather than something dispatch does, because the
 * store is versioned and a worktree starts from a reviewed commit: a dispatch
 * that wrote the store would dirty the tree it is about to require clean, and
 * refuse itself. Move, commit, then dispatch.
 *
 * Usage: node scripts/transition.mjs <issue-id> <role>
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatchTransition } from "./dispatch-preflight.mjs";
import { loadConfig, readJsonl, sha256, fail } from "./lib.mjs";

const [issueId, role] = process.argv.slice(2);
if (!issueId || !role) fail("usage: transition.mjs <issue-id> <role>");

const config = loadConfig();
const storePath = join(config.store_dir, "issues.jsonl");
const entry = readJsonl(storePath).find((candidate) => candidate.record.id === issueId);
if (entry == null) fail(`record not found: ${issueId}`);

const previous = entry.record.pipeline_state;
const owed = dispatchTransition(entry.record, role);
if (owed == null) {
  fail(
    `${issueId} owes no transition for ${role}: phase ${previous?.phase} is not one the orchestrator holds for it. ` +
      "A redispatch after a crash or a block resumes the same phase, and recording a transition there would say " +
      "the work changed hands when it did not.",
  );
}

const at = new Date().toISOString();
const request = {
  target: { kind: "issue", id: issueId },
  expected_record_hash: sha256(entry.raw),
  pipeline_state: { ...previous, ...owed, version: previous.version + 1, last_transition_at: at },
  started_at: at,
  ended_at: at,
  transition_reason: `Before dispatching ${role}: phase ${previous.phase} belongs to the orchestrator, which transitions then dispatches.`,
};
const requestPath = join(config.handoffs_dir ?? ".", `transition-${issueId}-${owed.phase}.json`);
writeFileSync(requestPath, JSON.stringify(request, null, 2) + "\n");
const script = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));
execFileSync(process.execPath, [script("store-update.mjs"), requestPath], { encoding: "utf8", stdio: "inherit" });
// The task package refuses a tracker whose status no longer matches the phase,
// so the write and its projection are one step. Splitting them moves the
// refusal from the store, which explains it, to the package, which reports a
// drift the caller has just been told to create. A project with no tracker has
// nothing to project, and asking for one would refuse a move that is complete.
if (config.issue_tracker?.enabled === true) {
  execFileSync(process.execPath, [script("tracker-sync.mjs"), "--apply"], { encoding: "utf8", stdio: "inherit" });
}
console.log(`${issueId}: ${previous.phase} -> ${owed.phase}. Commit the store, then dispatch ${role}.`);
