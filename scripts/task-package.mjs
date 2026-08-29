import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { atomicWrite, loadConfig, loadRules, readJsonl, sha256, fail } from "./lib.mjs";
import { contextsFor } from "./store-read.mjs";
import { projectedStatus, readIssueTracker, trackerMatch } from "./issue-tracker.mjs";

/**
 * Writes the bounded input handed to one role.
 *
 * The package format is portable JSON. Harness-specific flags stay in
 * `agent_runtime.args`; the core gives every CLI the same file path.
 *
 * @param issueId - issue to work on
 * @param role - target pipeline role
 * @param config - project configuration
 * @returns written package path
 */
export function writeTaskPackage(issueId, role, config = loadConfig()) {
  const rules = loadRules();
  const knownRoles = new Set(Object.values(rules.phases ?? {}).map((phase) => phase.owner));
  if (!knownRoles.has(role) || ["none", "operator"].includes(role)) throw new Error(`unknown agent role: ${role}`);

  const storePath = join(config.store_dir, "issues.jsonl");
  const entry = readJsonl(storePath).find((candidate) => candidate.record.id === issueId);
  if (entry == null) throw new Error(`record not found: ${issueId}`);
  if (typeof config.handoffs_dir !== "string" || config.handoffs_dir.length === 0) {
    throw new Error("handoffs_dir missing: no bounded task package destination is configured");
  }

  const prompt = join(config.prompts_dir, `${role}.md`);
  const brief = join(config.briefs_dir, `${role}.md`);
  const record = { ...entry.record, contexts: contextsFor(entry.record.contexts, role) };
  const tracker = readIssueTracker(config);
  let trackerRecord = null;
  if (tracker != null) {
    const match = trackerMatch(entry.record, tracker);
    if (match.drift != null) {
      throw new Error(
        `tracker binding ${match.drift} for ${issueId}; refresh the pipeline control record before dispatch`,
      );
    }
    const desired = projectedStatus(entry.record.pipeline_state?.phase ?? "unknown", config);
    if (match.entry.record.status !== desired) {
      throw new Error(
        `tracker status ${match.entry.record.status} for ${issueId} must be ${desired}; run tracker-sync --apply`,
      );
    }
    trackerRecord = match.entry.record;
  }
  const body = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    role,
    prompt,
    brief,
    record_hash: sha256(entry.raw),
    state_version: entry.record.pipeline_state?.version ?? null,
    record,
    tracker_record: trackerRecord,
  };
  const out = join(config.handoffs_dir, `${issueId}-${role}-package.json`);
  atomicWrite(out, `${JSON.stringify(body, null, 2)}\n`);
  return out;
}

function main() {
  const [issueId, role] = process.argv.slice(2);
  if (!issueId || !role) fail("usage: task-package.mjs <issue-id> <role>");
  try {
    const out = writeTaskPackage(issueId, role);
    console.log(out);
  } catch (error) {
    fail(error.message);
  }
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) main();
