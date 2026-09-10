import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

/**
 * Loads and minimally validates the project's profile configuration.
 *
 * An incomplete configuration stops the process with a message, never with a
 * stack trace: these scripts address an operator, and a missing path in a
 * config file is not a programming defect.
 *
 * @param path - config file path, project root by default
 * @returns the parsed configuration, or never if it is invalid
 */
/**
 * Minutes granted to the generated CI job when the project states none.
 *
 * Shared rather than repeated: the renderer and the deep-control
 * configuration both reason about this budget, and a second copy let one
 * of them shrink the job the other had already sized.
 */
export const DEFAULT_CI_TIMEOUT_MINUTES = 25;

function validateObjectKeys(value, allowed, label) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label}: unsupported key "${key}"`);
  }
}

/** Refuses operational controls the installed core cannot actually honour. */
function validateOperationalControls(config, path) {
  if (config.agent_runtime != null) {
    validateObjectKeys(
      config.agent_runtime,
      new Set([
        "prompt_adapter", "command", "args", "interactive_input", "runs_dir",
        "progress_interval_seconds", "workspace_paths", "dependency_inputs",
        "prerequisite_commands", "prerequisites_in_agent", "require_handoff", "cwd",
      ]),
      `${path}: agent_runtime`,
    );
  }
  if (config.attempt_isolation != null) {
    const isolation = config.attempt_isolation;
    validateObjectKeys(
      isolation,
      new Set(["strategy", "root", "one_attempt_per_worktree", "restore_before_replay"]),
      `${path}: attempt_isolation`,
    );
    if (isolation.strategy !== "git-worktree") {
      fail(`${path}: attempt_isolation.strategy must be "git-worktree"`);
    }
    if (typeof isolation.root !== "string" || isolation.root.trim().length === 0) {
      fail(`${path}: attempt_isolation.root must be a non-empty project-relative path`);
    }
    if (isolation.one_attempt_per_worktree !== true) {
      fail(`${path}: attempt_isolation.one_attempt_per_worktree must be true`);
    }
    if (isolation.restore_before_replay !== true) {
      fail(`${path}: attempt_isolation.restore_before_replay must be true`);
    }
  }

  if (config.evidence_retention != null) {
    const retention = config.evidence_retention;
    validateObjectKeys(
      retention,
      new Set(["control_store", "run_records", "handoffs"]),
      `${path}: evidence_retention`,
    );
    const expected = {
      control_store: config.store_dir,
      run_records: config.agent_runtime?.runs_dir ?? join(config.store_dir, "runs"),
      handoffs: config.handoffs_dir,
    };
    for (const [key, destination] of Object.entries(expected)) {
      if (retention[key] !== destination) {
        fail(`${path}: evidence_retention.${key} must match the effective destination "${destination}"`);
      }
    }
  }

  if (config.human_review_paths != null && (
    !Array.isArray(config.human_review_paths) ||
    config.human_review_paths.some((item) => typeof item !== "string" || item.trim().length === 0)
  )) {
    fail(`${path}: human_review_paths must be a list of non-empty path patterns`);
  }
}

export function loadConfig(path = "pipeline.config.json") {
  if (!existsSync(path)) fail(`not found: ${path} (run it from the project root)`);
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${path}: invalid JSON (${error.message})`);
  }
  // A configuration carrying the architecture decision and nothing else is
  // not broken: it is exactly what the architecture step produces, and the
  // configuration step has not run yet. Answering `missing key "profile"`
  // there reads as a mistake the operator made, and it was observed doing
  // so on a real bootstrap.
  if (config.profile == null && config.architecture != null) {
    fail(
      `${path} carries the architecture decision and nothing else: this project is not configured yet. ` +
        "That is the next step, not a fault — an agent reads agent-pipeline/docs/nouveau-profil.md and " +
        "writes the rest. The README calls it step 4.",
    );
  }
  for (const key of ["profile", "profiles_dir", "commands", "docs_dirs", "briefs_dir", "prompts_dir", "skills_dir", "rules_path", "project_context", "file_policy", "store_dir", "ci"]) {
    if (config[key] == null) fail(`${path}: missing key "${key}"`);
  }
  validateOperationalControls(config, path);
  return config;
}

/**
 * Loads the machine source of the pipeline rules.
 *
 * With no argument the path comes from `rules_path` in the configuration: the
 * host project therefore decides where this file lives, as it does for every
 * other pipeline directory.
 *
 * @param path - rules file path, config `rules_path` by default
 * @returns the parsed rules, or never if the file is missing
 */
export function loadRules(path) {
  const resolved = path ?? loadConfig().rules_path;
  if (!existsSync(resolved)) fail(`not found: ${resolved}`);
  return JSON.parse(readFileSync(resolved, "utf8"));
}

/**
 * Reads a JSONL file, preserving every raw line.
 *
 * The raw line is the key to the optimistic lock: its hash changes on the
 * slightest byte, including a reformat with no semantic effect.
 *
 * @param path - JSONL file path
 * @returns one entry per non-empty line, with the raw line and the parsed record
 * @throws {SyntaxError} if a line is not valid JSON
 */
export function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((raw, index) => ({ raw, index, record: JSON.parse(raw) }));
}

/**
 * Computes the hexadecimal SHA-256 hash of a string.
 *
 * @param text - content to hash
 * @returns the hash in lowercase hexadecimal
 */
export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Replaces a file atomically through a temporary sibling.
 *
 * A process interruption can leave the temporary file behind, but never a
 * half-written JSONL store: `rename` switches the visible file in one step.
 *
 * @param path - destination path
 * @param content - complete next content
 */
export function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporary, content, { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/**
 * Takes the store-wide single-writer lock.
 *
 * A line-level optimistic hash detects stale work on one record. It cannot
 * prevent two processes updating different lines from each rewriting the
 * whole JSONL snapshot and losing the other's change. This lock closes that
 * gap before either process reads the store.
 *
 * @param storeDir - configured durable store directory
 * @returns idempotent release function
 */
export function acquireStoreLock(storeDir) {
  mkdirSync(storeDir, { recursive: true });
  const path = join(storeDir, ".store-update.lock");
  let descriptor;
  try {
    descriptor = openSync(path, "wx");
    writeFileSync(descriptor, `${process.pid}\n`);
  } catch (error) {
    if (descriptor != null) closeSync(descriptor);
    if (error?.code === "EEXIST") {
      throw new Error(`store writer busy: lock already held at ${path}`);
    }
    throw error;
  }
  closeSync(descriptor);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (existsSync(path)) unlinkSync(path);
  };
  process.once("exit", release);
  return () => {
    process.off("exit", release);
    release();
  };
}

/**
 * Converts a glob pattern into an anchored regular expression.
 *
 * Supports `**` (crosses segments), `*` (within a segment) and `?`.
 *
 * @param glob - path pattern
 * @returns the equivalent regular expression
 */
function globToRegex(glob) {
  const escaped = glob
    .replaceAll(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**/", "\u0000")
    .replaceAll("**", "\u0001")
    .replaceAll("*", "[^/]*")
    .replaceAll("?", "[^/]")
    .replaceAll("\u0000", "(?:.*/)?")
    .replaceAll("\u0001", ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Reads a `skip` setting, which two shapes reach from real configurations.
 *
 * The documented shape is a regular expression string, kept as is. The
 * frontend bundles ship a LIST of glob-ish patterns instead, and handing
 * that list to `new RegExp` stringifies it — a double-star glob then fails
 * to parse with "Nothing to repeat", crashing the walk on 2026-09-10. Each
 * entry converts to a regex: metacharacters are escaped except the glob
 * wildcards, `**` crosses segments, `*` and `?` stay within one. Like the
 * string form, the result is tested unanchored against the path.
 *
 * @param skip - the configured value: regex string, list of patterns, or null
 * @param key - the configuration key the refusal names
 * @returns the rejection regular expression, or null when nothing is skipped
 */
export function skipPattern(skip, key = "project_map.skip") {
  if (skip == null) return null;
  if (typeof skip === "string") return new RegExp(skip);
  if (Array.isArray(skip) && skip.every((entry) => typeof entry === "string")) {
    if (skip.length === 0) return null;
    const parts = skip.map((entry) =>
      entry
        .replaceAll(/[.+^${}()|[\]\\]/g, "\\$&")
        .replaceAll("**", "\u0001")
        .replaceAll("*", "[^/]*")
        .replaceAll("?", "[^/]")
        .replaceAll("\u0001", ".*"),
    );
    return new RegExp(parts.join("|"));
  }
  fail(`${key} must be a regex string or a list of glob patterns`);
}

/**
 * Tests whether a path matches at least one pattern in the list.
 *
 * @param path - file path relative to the repository
 * @param globs - glob patterns
 * @returns true if at least one pattern matches
 */
export function matchAny(path, globs) {
  return globs.some((glob) => globToRegex(glob).test(path));
}

/**
 * Applies a role's file policy to an observed path.
 *
 * `allow` present: only what matches is permitted. `deny` present: what
 * matches is refused. Both present: the path must match `allow` without
 * matching `deny`.
 *
 * @param path - file path relative to the repository
 * @param policy - the role's policy, or no policy at all
 * @returns true if the path is permitted for this role
 */
export function pathAllowed(path, policy) {
  if (policy == null) return true;
  if (policy.deny != null && matchAny(path, policy.deny)) return false;
  if (policy.allow != null) return matchAny(path, policy.allow);
  return true;
}

/**
 * Extracts a glob pattern's literal prefix, up to the first wildcard.
 *
 * @param glob - path pattern
 * @returns the prefix with no wildcard
 */
function literalPrefix(glob) {
  const cut = glob.search(/[*?[]/);
  return cut === -1 ? glob : glob.slice(0, cut);
}

/**
 * Decides whether two reservation patterns can designate the same file.
 *
 * Deliberately conservative: two patterns overlap when the literal prefix of
 * one starts with that of the other. It can over-block, never under-block,
 * which is the right default for a serialisation decision.
 *
 * @param a - first pattern
 * @param b - second pattern
 * @returns true if an overlap is possible
 */
export function patternsMayOverlap(a, b) {
  const pa = literalPrefix(a);
  const pb = literalPrefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

/**
 * Paths a command produces, which no role authors by hand.
 *
 * The project map is the case that forced the notion: it is a function of
 * the whole source tree, so every issue that adds an export changes it. Left
 * as an ordinary path, it lands in every issue's reservations, and since
 * reservations are what makes two issues parallel, the map alone serialises
 * a whole wave. Naming it generated is what lets the framework treat it as
 * what it is — output, with one writer, regenerated after the fact.
 *
 * @param config - the project configuration
 * @returns the declared generated paths, without duplicates
 */
export function generatedPaths(config) {
  const declared = Array.isArray(config?.generated_paths) ? config.generated_paths : [];
  const map = config?.project_map?.out;
  const all = typeof map === "string" ? [map, ...declared] : declared;
  return [...new Set(all.filter((path) => typeof path === "string" && path.length > 0))];
}

/**
 * Gates run once before the pull request rather than on every push.
 *
 * Only the map's gates, and they are not a preference: the map is stale on
 * the branch from the first export added until the orchestrator regenerates
 * it, so running their checks on every push turns the branch red by design,
 * and a job red by design is a job people stop reading. Both are named
 * because both READ the map — deferring the freshness check while leaving the
 * coverage check on every push defers nothing, since the second fails on the
 * same staleness as the first.
 *
 * `closure_gates` is deliberately NOT here. It defers what QA replays by
 * hand, and CI time is not QA time: a machine re-running `audit` on every
 * push costs nothing and reports early, while an agent replaying it per issue
 * costs the run. Conflating the two would have removed a security gate from
 * every push to save an agent a command.
 *
 * @param config - the project configuration
 * @returns the keys of `commands` CI defers to the pull request
 */
export function deferredGates(config) {
  return new Set(
    ["project_map", "map_coverage"].filter((key) => typeof config?.commands?.[key] === "string"),
  );
}

/**
 * Says whether a path is one a command produces.
 *
 * The comparison is exact, not a glob: a generated target is a file someone
 * declared by name, and widening it to a pattern would silently exempt
 * neighbours nobody generates.
 *
 * @param path - the path to classify
 * @param config - the project configuration
 * @returns true if the path is declared generated
 */
export function isGenerated(path, config) {
  return generatedPaths(config).includes(path);
}

/**
 * Ends the process with an error message.
 *
 * @param message - message printed on stderr
 * @returns never
 */
export function fail(message) {
  writeSync(2, `${message}\n`);
  process.exit(1);
}
