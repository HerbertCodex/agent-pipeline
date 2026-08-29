import { spawnSync } from "node:child_process";
import { resolve, sep } from "node:path";
import { readJsonl, sha256 } from "./lib.mjs";

const PROVIDER = "sudocode";
const STATUSES = new Set(["open", "in_progress", "blocked", "needs_review", "closed"]);

function configuredTracker(config) {
  const tracker = config.issue_tracker;
  if (tracker == null || tracker.enabled === false) return null;
  if (tracker.provider !== PROVIDER) {
    throw new Error(`unsupported issue_tracker.provider: ${tracker.provider ?? "missing"}`);
  }
  if (typeof tracker.root !== "string" || tracker.root.length === 0) {
    throw new Error("issue_tracker.root must name the Sudocode directory");
  }
  if (typeof tracker.managed_tag !== "string" || tracker.managed_tag.length === 0) {
    throw new Error("issue_tracker.managed_tag must be a non-empty string");
  }
  return tracker;
}

function trackerFile(root, tracker, kind) {
  const key = kind === "issue" ? "issues_file" : "specs_file";
  const fallback = kind === "issue" ? "issues.jsonl" : "specs.jsonl";
  const file = resolve(root, tracker[key] ?? fallback);
  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    throw new Error(`issue_tracker.${key} must stay inside issue_tracker.root`);
  }
  return file;
}

function scopeShape(record) {
  const relationships = (record.relationships ?? [])
    .map((relationship) => ({
      from: relationship.from ?? null,
      from_type: relationship.from_type ?? null,
      to: relationship.to ?? null,
      to_type: relationship.to_type ?? null,
      type: relationship.type ?? null,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return {
    uuid: record.uuid ?? null,
    title: record.title ?? null,
    content: record.content ?? "",
    priority: record.priority ?? null,
    parent_id: record.parent_id ?? null,
    relationships,
    tags: [...(record.tags ?? [])].sort(),
  };
}

function validateEntity(record, kind) {
  if (typeof record.id !== "string" || record.id.length === 0) {
    throw new Error(`Sudocode ${kind} has no id`);
  }
  if (typeof record.title !== "string" || record.title.length === 0) {
    throw new Error(`Sudocode ${kind} ${record.id} has no title`);
  }
  if (typeof record.uuid !== "string" || record.uuid.length === 0) {
    throw new Error(`Sudocode ${kind} ${record.id} has no uuid`);
  }
  if (!Array.isArray(record.relationships) || !Array.isArray(record.tags)) {
    throw new Error(`Sudocode ${kind} ${record.id} must carry relationship and tag lists`);
  }
  if (kind === "issue" && !STATUSES.has(record.status)) {
    throw new Error(`Sudocode issue ${record.id} has unsupported status ${record.status}`);
  }
}

function entriesFor(path, kind) {
  const seen = new Set();
  return readJsonl(path).map((entry) => {
    validateEntity(entry.record, kind);
    if (seen.has(entry.record.id)) throw new Error(`duplicate Sudocode ${kind} id: ${entry.record.id}`);
    seen.add(entry.record.id);
    return {
      ...entry,
      revision: sha256(JSON.stringify(scopeShape(entry.record))),
    };
  });
}

function issueDependencies(issues) {
  const dependencies = new Map(issues.map((entry) => [entry.record.id, new Set()]));
  for (const entry of issues) {
    for (const relationship of entry.record.relationships ?? []) {
      if (relationship.to_type !== "issue") continue;
      if (relationship.type === "depends-on" && dependencies.has(relationship.from)) {
        dependencies.get(relationship.from).add(relationship.to);
      }
      if (relationship.type === "blocks" && dependencies.has(relationship.to)) {
        dependencies.get(relationship.to).add(relationship.from);
      }
    }
  }
  return new Map([...dependencies].map(([id, values]) => [id, [...values].sort()]));
}

/**
 * Reads Sudocode's git-tracked issue and spec snapshots without touching its cache.
 *
 * @param {object} config - Pipeline configuration carrying `issue_tracker`.
 * @param {string} [cwd] - Host project root.
 * @returns {object|null} Validated tracker snapshot, or null when disabled.
 */
export function readIssueTracker(config, cwd = ".") {
  const tracker = configuredTracker(config);
  if (tracker == null) return null;
  const root = resolve(cwd, tracker.root);
  const store = resolve(cwd, config.store_dir);
  if (root === store || root.startsWith(`${store}${sep}`) || store.startsWith(`${root}${sep}`)) {
    throw new Error("issue_tracker.root and store_dir must be separate directories");
  }
  const issues = entriesFor(trackerFile(root, tracker, "issue"), "issue");
  const specs = entriesFor(trackerFile(root, tracker, "spec"), "spec");
  return {
    provider: PROVIDER,
    root,
    issues,
    specs,
    dependencies: issueDependencies(issues),
  };
}

/**
 * Returns the coarse tracker status projected from a pipeline phase.
 *
 * @param {string} phase - Fine-grained pipeline phase.
 * @param {object} config - Pipeline configuration.
 * @returns {string|null} Sudocode status, or null when the tracker is disabled.
 */
export function projectedStatus(phase, config) {
  const tracker = configuredTracker(config);
  if (tracker == null) return null;
  const map = tracker.status_map ?? {};
  const status = map[phase] ?? (phase.startsWith("blocked_") ? map["blocked_*"] : null) ?? map["*"];
  if (!STATUSES.has(status)) {
    throw new Error(`issue_tracker.status_map has no valid Sudocode status for phase ${phase}`);
  }
  return status;
}

/**
 * Creates the immutable binding stored beside pipeline control state.
 *
 * @param {object} entry - Entry returned by `readIssueTracker`.
 * @returns {object} Provider identity and scope revision.
 */
export function trackerBinding(entry) {
  return {
    provider: PROVIDER,
    id: entry.record.id,
    uuid: entry.record.uuid ?? null,
    revision: entry.revision,
    updated_at: entry.record.updated_at ?? null,
  };
}

/**
 * Finds the matching source entity and reports binding drift.
 *
 * @param {object} record - Pipeline control record.
 * @param {object} snapshot - Snapshot returned by `readIssueTracker`.
 * @param {"issue"|"spec"} kind - Entity kind.
 * @returns {object} Source entry and drift state.
 */
export function trackerMatch(record, snapshot, kind = "issue") {
  const entries = kind === "issue" ? snapshot.issues : snapshot.specs;
  const entry = entries.find((candidate) => candidate.record.id === record.id) ?? null;
  if (entry == null) return { entry: null, drift: "missing" };
  if (record.tracker == null) return { entry, drift: "unbound" };
  if (
    record.tracker.provider !== snapshot.provider ||
    record.tracker.id !== record.id ||
    record.tracker.uuid !== entry.record.uuid
  ) {
    return { entry, drift: "identity" };
  }
  return { entry, drift: record.tracker.revision === entry.revision ? null : "scope" };
}

function adapterCommand(config) {
  const tracker = configuredTracker(config);
  if (tracker == null) throw new Error("issue tracker is disabled");
  const command = tracker.command ?? "sudocode";
  const args = Array.isArray(tracker.args) ? tracker.args : [];
  if (typeof command !== "string" || command.length === 0 || !args.every((arg) => typeof arg === "string")) {
    throw new Error("issue_tracker command and args must be strings");
  }
  return { command, args };
}

/**
 * Updates one issue through Sudocode's CLI, never by rewriting its JSONL.
 *
 * @param {string} id - Sudocode issue id.
 * @param {string} status - Valid Sudocode status.
 * @param {object} config - Pipeline configuration.
 * @param {object} [options] - Host cwd and injectable process runner.
 * @returns {object} Child-process result.
 */
export function updateTrackerStatus(id, status, config, { cwd = ".", run = spawnSync } = {}) {
  if (!STATUSES.has(status)) throw new Error(`unsupported Sudocode status: ${status}`);
  const adapter = adapterCommand(config);
  const result = run(
    adapter.command,
    [...adapter.args, "--json", "issue", "update", id, "--status", status],
    { cwd, shell: false, encoding: "utf8" },
  );
  if (result.error != null || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`;
    throw new Error(`Sudocode status update failed for ${id}: ${detail}`);
  }
  return result;
}
