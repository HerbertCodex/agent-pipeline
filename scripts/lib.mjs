import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  renameSync,
  unlinkSync,
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
  console.error(message);
  process.exit(1);
}
