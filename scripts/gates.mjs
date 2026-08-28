import { deferredGates, matchAny } from "./lib.mjs";

/**
 * The gate names the framework's own documents teach.
 *
 * Curated on purpose. A backticked snake_case token is not enough to tell a
 * gate from a field — `pipeline_state` and `red_proof` are written the same
 * way — so the vocabulary is declared rather than guessed. If the framework
 * teaches a gate, it knows its name; if a project invents one, no document
 * here names it, and nothing needs to.
 */
const KNOWN_GATES = [
  "check", "lint", "build", "test_unit", "test_e2e", "coverage", "mutation",
  "audit", "secrets_scan", "dead_code", "sast", "doc_lint", "comment_policy",
  "project_map", "map_coverage", "design_limits", "duplication", "accessibility",
];

/**
 * Verbs by which a document turns a name into an obligation.
 *
 * Widening the sweep beyond the declared vocabulary: a project may name a
 * gate this framework never heard of, and a sentence saying it refuses
 * something is a rule all the same.
 */
const PRESCRIBES = "refuses|requires|sweeps|enforces|bounds|rejects|checks|compares|counts|fails|forbids|regenerates";

/**
 * Says whether this project can actually run the rule a name designates.
 *
 * Declaring the command is the only thing that counts, and the framework
 * shipping a script of that name is not enough. QA invokes a gate by its
 * key, CI renders a step per key: an undeclared gate is one nobody runs,
 * whatever file sits in the core. The first version accepted a shipped
 * script and silenced the check for exactly the rules it was written to
 * catch.
 *
 * @param name - gate name, in snake case
 * @param config - the project configuration
 * @returns true when the configuration declares a command for it
 */
export function answered(name, config) {
  return typeof config?.commands?.[name] === "string";
}

/**
 * Removes the passages conditioned on a gate this project does not have.
 *
 * A document written for every project describes gates a given project may
 * not declare, and cutting the paragraph is better than either lying to the
 * reader or deleting the teaching for everyone. The marked block is dropped
 * whole; anything outside a marker is kept, and then has to survive
 * `orphanGates`.
 *
 * @param text - the document, with its markers
 * @param config - the project configuration
 * @returns the text, its unanswered blocks removed and its markers gone
 */
export function stripUndeclaredGates(text, config) {
  return text
    .replace(/<!--\s*gate:([a-z0-9_]+)\s*-->([\s\S]*?)<!--\s*\/gate\s*-->\n?/g, (_, name, body) =>
      answered(name, config) ? body : "",
    )
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Collects the gate names a rendered document prescribes for nobody.
 *
 * This is the failure the framework says it paid most for, printed in the
 * page that teaches the rules: an obligation naming a command that does not
 * exist here. The reader cannot tell it from one that binds them, so they
 * either invent the gate, skip it in silence, or stop trusting the document
 * — and the third is the expensive one.
 *
 * @param text - a rendered brief or prompt
 * @param config - the project configuration
 * @returns the unanswered gate names, in the order first seen
 */
export function orphanGates(text, config) {
  const named = new Set();
  for (const match of text.matchAll(/`([a-z][a-z0-9_]{2,24})`/g)) {
    if (KNOWN_GATES.includes(match[1])) named.add(match[1]);
  }
  // A configuration key is not a gate, and prose says `file_policy` forbids
  // things exactly as it says `dead_code` refuses them. The verb alone
  // cannot tell them apart; being a key of the configuration can.
  const configKeys = new Set(Object.keys(config ?? {}));
  for (const match of text.matchAll(new RegExp("`([a-z][a-z0-9_]{2,24})`\\s+(?:" + PRESCRIBES + ")\\b", "g"))) {
    if (configKeys.has(match[1]) && !KNOWN_GATES.includes(match[1])) continue;
    named.add(match[1]);
  }
  return [...named].filter((name) => !answered(name, config));
}

/**
 * The gates QA replays on every issue.
 *
 * Everything declared, minus what the closure defers. The split existed in
 * prose long before anything computed it: the prompt listed gate names by
 * hand, so a project declaring other ones was told to run gates it did not
 * have, and a project deferring gates was told to replay them anyway.
 *
 * Replaying the whole table on every issue of a spec buys nothing after the
 * first — it re-proves the same untouched surface — and it was measured as
 * one of the two largest costs of a spec's wall time.
 *
 * @param config - the project configuration
 * @returns the keys of `commands` a single issue must replay
 */
export function perIssueGates(config) {
  const closure = new Set(Array.isArray(config?.closure_gates) ? config.closure_gates : []);
  const mapGates = deferredGates(config);
  return Object.keys(config?.commands ?? {}).filter((key) => !closure.has(key) && !mapGates.has(key));
}

/**
 * Returns the battery owed by one concrete issue.
 *
 * Projects may choose a smaller declared subset for low and normal lanes;
 * high risk defaults to the complete per-issue battery. Anything omitted is
 * part of the final closure battery, never silently discarded.
 *
 * @param paths - observed files for the issue
 * @param config - project configuration
 * @returns gate keys required before this issue moves on
 */
export function gatesForIssue(paths, config) {
  const baseline = perIssueGates(config);
  const lane = laneOf(paths, config?.risk);
  const configured = config?.workflow?.gates?.[lane];
  if (configured == null || configured === "all") return baseline;
  if (!Array.isArray(configured)) return baseline;
  const allowed = new Set(baseline);
  return configured.filter((key) => allowed.has(key));
}

/**
 * The risk lane of what an issue touches.
 *
 * The lane is COMPUTED, never declared. A lane an agent chooses is a lane
 * every agent chooses, and the cheap one would empty itself of meaning within
 * a day. It follows the files, and `verify-scope` confronts those with the
 * real git diff — so reserving a stylesheet while editing the authentication
 * path buys nothing.
 *
 * The highest lane wins: an issue mixing a stylesheet and an authentication
 * path is an authentication issue.
 *
 * @param paths - the files the issue touches
 * @param risk - the configuration's `risk` block, or nothing
 * @returns "high", "normal" or "low"
 */
export function laneOf(paths, risk) {
  if (risk == null) return "normal";
  const files = Array.isArray(paths) ? paths : [];
  if (files.some((file) => matchAny(file, risk.high ?? []))) return "high";
  if (files.length > 0 && files.every((file) => matchAny(file, risk.low ?? []))) return "low";
  return "normal";
}

/**
 * The gates proved once per spec rather than on every issue.
 *
 * The complement of `perIssueGates` over the declared table: what the
 * operator defers plus the map's own gates, which are stale on the branch by
 * construction.
 *
 * @param config - the project configuration
 * @returns the keys of `commands` replayed at closure only
 */
export function closureGates(config) {
  const normal = config?.workflow?.gates?.normal;
  const perIssue = new Set(
    Array.isArray(normal) ? normal.filter((key) => typeof config?.commands?.[key] === "string") : perIssueGates(config),
  );
  return Object.keys(config?.commands ?? {}).filter((key) => !perIssue.has(key));
}
