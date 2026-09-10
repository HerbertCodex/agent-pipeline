import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dispatchPreflight, dispatchTransition } from "./dispatch-preflight.mjs";
import { prepareWorkspace } from "./agent-workspace.mjs";
import { loadConfig, fail, readJsonl, sha256 } from "./lib.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeTaskPackage } from "./task-package.mjs";
import { runAgent } from "./agent-driver.mjs";

const [issueId, role] = process.argv.slice(2).filter((arg) => arg !== "--json");
const json = process.argv.includes("--json");
if (!issueId || !role) fail("usage: dispatch.mjs <issue-id> <role> [--json]");


/**
 * Writes the transition the orchestrator owes before the agent is packaged.
 *
 * The order is the whole point. A task package built on a phase the
 * orchestrator still holds carries that record's hash, the agent computes its
 * basis on it, and the transition that must follow changes the hash: the
 * handoff is then refused as stale, and every later dispatch for the issue is
 * refused for the unconsumed one. Moving first costs one write and closes the
 * chain.
 *
 * @param record - the issue record the preflight returned
 * @param issueId - the issue being dispatched
 * @param role - the role about to run
 * @param config - the project configuration
 */
function moveIntoPhase(record, issueId, role, config) {
  const owed = dispatchTransition(record, role);
  if (owed == null) return;
  const storePath = join(config.store_dir, "issues.jsonl");
  const entry = readJsonl(storePath).find((candidate) => candidate.record.id === issueId);
  const previous = entry.record.pipeline_state;
  const at = new Date().toISOString();
  const request = {
    target: { kind: "issue", id: issueId },
    expected_record_hash: sha256(entry.raw),
    pipeline_state: { ...previous, ...owed, version: previous.version + 1, last_transition_at: at },
    started_at: at, ended_at: at,
    transition_reason: `Dispatching ${role}: phase ${previous.phase} belongs to the orchestrator, which transitions then dispatches.`,
  };
  const requestPath = join(config.handoffs_dir, `dispatch-${issueId}-${owed.phase}.json`);
  writeFileSync(requestPath, JSON.stringify(request, null, 2) + "\n");
  execFileSync(process.execPath, [fileURLToPath(new URL("./store-update.mjs", import.meta.url)), requestPath], { encoding: "utf8" });
  // The package refuses a tracker whose status no longer matches the phase,
  // so the write and its projection are one step. Splitting them moves the
  // refusal from the store, which explains it, to the package, which reports
  // a drift the caller has just been told to create.
  execFileSync(process.execPath, [fileURLToPath(new URL("./tracker-sync.mjs", import.meta.url)), "--apply"], { encoding: "utf8" });
}

let lock;
try {
  const config = loadConfig();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(issueId)) throw new Error("Invalid issue id");
  if (typeof config.handoffs_dir !== "string" || !config.handoffs_dir) throw new Error("Configure handoffs_dir before dispatch");
  const locks = join(config.handoffs_dir, "dispatch-locks");
  mkdirSync(locks, { recursive: true });
  const candidate = join(locks, issueId);
  try { mkdirSync(candidate); } catch { throw new Error("Issue dispatch lock exists; inspect the active process before recovering a stale lock"); }
  lock = candidate;
  const record = dispatchPreflight(issueId, role, config);
  moveIntoPhase(record, issueId, role, config);
  const packagePath = writeTaskPackage(issueId, role, config);
  const task = JSON.parse(readFileSync(packagePath, "utf8"));
  const workspace = prepareWorkspace(task, config);
  writeFileSync(workspace.packagePath, JSON.stringify(task, null, 2) + "\n");
  process.exitCode = await runAgent(role, workspace.packagePath, {
    ...config, agent_runtime: { ...config.agent_runtime, cwd: workspace.path, require_handoff: true },
  }, json);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (lock) rmSync(lock, { recursive: true, force: true });
}
