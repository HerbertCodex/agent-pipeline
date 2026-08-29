import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, readJsonl, fail } from "./lib.mjs";
import {
  projectedStatus,
  readIssueTracker,
  trackerMatch,
  updateTrackerStatus,
} from "./issue-tracker.mjs";

function managedIssues(snapshot, config) {
  const tag = config.issue_tracker?.managed_tag;
  if (typeof tag !== "string" || tag.length === 0) return [];
  return snapshot.issues.filter((entry) => entry.record.tags?.includes(tag));
}

/**
 * Compares pipeline control records with their Sudocode projection.
 *
 * @param {Array<object>} records - Pipeline issue control records.
 * @param {object} snapshot - Current Sudocode snapshot.
 * @param {object} config - Pipeline configuration.
 * @returns {object} Structural errors, pending status changes and unmanaged work.
 */
export function trackerProjection(records, snapshot, config) {
  const errors = [];
  const pending = [];
  const known = new Set(records.map((record) => record.id));
  for (const record of records) {
    const match = trackerMatch(record, snapshot);
    if (match.drift != null) {
      errors.push({ id: record.id, reason: `tracker binding ${match.drift}` });
      continue;
    }
    const desired = projectedStatus(record.pipeline_state?.phase ?? "unknown", config);
    if (match.entry.record.status !== desired) {
      pending.push({ id: record.id, current: match.entry.record.status, desired });
    }
  }
  const unmanaged = managedIssues(snapshot, config)
    .filter((entry) => !known.has(entry.record.id))
    .map((entry) => ({ id: entry.record.id, title: entry.record.title }));
  return { errors, pending, unmanaged };
}

/**
 * Applies pending status projections through the configured tracker CLI.
 *
 * @param {object} projection - Result of `trackerProjection`.
 * @param {object} config - Pipeline configuration.
 * @param {object} [options] - Host cwd and injectable command runner.
 * @returns {Array<object>} Applied transitions.
 */
export function applyTrackerProjection(projection, config, options = {}) {
  if (projection.errors.length > 0) {
    throw new Error("tracker projection has structural errors; no status was changed");
  }
  return projection.pending.map((item) => {
    updateTrackerStatus(item.id, item.desired, config, options);
    return item;
  });
}

function report(projection, json) {
  if (json) {
    console.log(JSON.stringify(projection, null, 2));
    return;
  }
  for (const item of projection.errors) console.log(`ERROR ${item.id}: ${item.reason}`);
  for (const item of projection.unmanaged) console.log(`READY ${item.id}: ${item.title} (not imported)`);
  for (const item of projection.pending) {
    console.log(`SYNC ${item.id}: ${item.current} -> ${item.desired}`);
  }
  if (projection.errors.length + projection.pending.length === 0) {
    console.log("Sudocode and pipeline control state are synchronized.");
  }
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const json = args.includes("--json");
  const config = loadConfig();
  const snapshot = readIssueTracker(config);
  if (snapshot == null) fail("issue tracker is disabled");
  const records = readJsonl(join(config.store_dir, "issues.jsonl")).map((entry) => entry.record);
  let projection = trackerProjection(records, snapshot, config);
  if (apply) {
    try {
      applyTrackerProjection(projection, config);
      projection = trackerProjection(records, readIssueTracker(config), config);
    } catch (error) {
      fail(error.message);
    }
  }
  report(projection, json);
  if (projection.errors.length + projection.pending.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) main();
