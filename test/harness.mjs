import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(here, "..", "scripts");
const PROJECT_ROOT = join(here, "..", "..");

/**
 * Resolves the rules file to copy into a sandbox.
 *
 * Inside a host project it is THAT project's file: `rules_path` is
 * configurable, and a harness assuming `pipeline/rules.json` would only run
 * on projects that kept the default.
 *
 * Outside a project, when the framework is cloned on its own, it is the
 * seeding source `schemas/rules.json`, which every project descends from. So
 * this is not a test rule set that would drift in silence: it is the
 * original. Without this fallback, a reader who clones and runs the tests
 * sees a hundred failures and concludes the framework is broken.
 *
 * @returns the absolute path of the rules file to use
 */
function resolveRules() {
  const hosted = join(PROJECT_ROOT, "pipeline.config.json");
  if (existsSync(hosted)) {
    const config = JSON.parse(readFileSync(hosted, "utf8"));
    const path = join(PROJECT_ROOT, config.rules_path);
    if (existsSync(path)) return path;
  }
  return join(here, "..", "schemas", "rules.json");
}

/**
 * Creates a throwaway repository carrying a minimal pipeline configuration.
 *
 * Core scripts resolve `pipeline.config.json` from the current directory: one
 * sandbox per test therefore isolates state completely, and no test can write
 * into the real project's store.
 *
 * The rules are copied from the host project's `rules_path` file rather than
 * reinvented. A test rule set drifts from production with nothing to report
 * it, and the tests end up proving the copy instead of the system. The rest
 * of the sandbox configuration is fabricated, however: its paths and its file
 * policy belong to the test alone, and assume nothing of the host project.
 *
 * @param options - initial content: `issues` and `specs`, lists of records
 * @returns the sandbox path, to be removed with `destroySandbox`
 */
export function createSandbox({ issues = [], specs = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pipeline-core-"));
  mkdirSync(join(root, "pipeline", "store"), { recursive: true });
  mkdirSync(join(root, "docs", "decisions"), { recursive: true });

  const policy = {
    implementer: { allow: ["src/**", "test/**"], deny: ["package.json"] },
    product: { allow: [] },
    qa: { allow: [] },
    orchestrator: { allow: ["pipeline/store/**"] },
  };
  // `file_policy` is INJECTED into the rules by apply-profile, from the
  // configuration: the seeding source does not carry it. The sandbox
  // therefore reproduces that injection rather than depending on a file
  // already rendered by a host project, without which the tests would only
  // pass where the pipeline already runs.
  const rules = JSON.parse(readFileSync(resolveRules(), "utf8"));
  writeFileSync(join(root, "pipeline", "rules.json"), JSON.stringify({ ...rules, file_policy: policy }, null, 2));

  writeFileSync(
    join(root, "pipeline.config.json"),
    JSON.stringify({
      profile: "test",
      profiles_dir: "agent-pipeline/profiles",
      commands: { check: "true" },
      docs_dirs: ["agent-pipeline/docs"],
      briefs_dir: "pipeline/briefs",
      prompts_dir: ".claude/agents",
      skills_dir: ".claude/skills",
      rules_path: "pipeline/rules.json",
      project_context: "pipeline/project-context.md",
      store_dir: "pipeline/store",
      decisions_dir: "docs/decisions",
      ci: { provider: "none" },
      file_policy: policy,
    }),
  );

  writeStore(root, "issues", issues);
  writeStore(root, "specs", specs);
  return root;
}

/**
 * Removes a sandbox and everything it contains.
 *
 * @param root - path returned by `createSandbox`
 */
export function destroySandbox(root) {
  rmSync(root, { recursive: true, force: true });
}

/**
 * Rewrites a store file from a list of records.
 *
 * @param root - sandbox path
 * @param kind - `issues` or `specs`
 * @param records - records to serialise, one line each
 */
export function writeStore(root, kind, records) {
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  writeFileSync(join(root, "pipeline", "store", `${kind}.jsonl`), records.length > 0 ? `${body}\n` : "");
}

/**
 * Reads a store record back by its identifier.
 *
 * @param root - sandbox path
 * @param kind - `issues` or `specs`
 * @param id - record identifier
 * @returns the record, or `undefined` if absent
 */
export function readRecord(root, kind, id) {
  const path = join(root, "pipeline", "store", `${kind}.jsonl`);
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line))
    .find((record) => record.id === id);
}

/**
 * Returns a record's optimistic-lock hash, exactly as the core computes it.
 *
 * The hash covers the raw line, not the reserialised record: a reformat with
 * no semantic effect changes the hash, and that is deliberate.
 *
 * @param root - sandbox path
 * @param kind - `issues` or `specs`
 * @param id - record identifier
 * @returns the hexadecimal hash `store-update` expects
 */
export function recordHash(root, kind, id) {
  const path = join(root, "pipeline", "store", `${kind}.jsonl`);
  const line = readFileSync(path, "utf8")
    .split("\n")
    .find((candidate) => candidate.trim().length > 0 && JSON.parse(candidate).id === id);
  return createHash("sha256").update(line, "utf8").digest("hex");
}

/**
 * Writes a JSON file into the sandbox and returns its absolute path.
 *
 * @param root - sandbox path
 * @param name - file name
 * @param value - serialisable content
 * @returns the absolute path of the written file
 */
export function writeJson(root, name, value) {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

/**
 * Runs a core script inside the sandbox.
 *
 * @param root - sandbox path, used as the working directory
 * @param script - script file name, for example `store-update.mjs`
 * @param args - command-line arguments
 * @returns the exit code and both output streams
 */
export function run(root, script, args = []) {
  const result = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/**
 * Builds a valid `pipeline_state` block.
 *
 * @param overrides - fields to replace in the default state
 * @returns a state block accepted by the core validation
 */
export function state(overrides = {}) {
  return {
    schema_version: 1,
    phase: "planned",
    owner: "orchestrator",
    version: 1,
    qa_code_rejections: 0,
    file_reservations: ["src/x/**"],
    last_commit_sha: null,
    last_transition_at: null,
    ...overrides,
  };
}

/**
 * Builds a complete test issue.
 *
 * @param overrides - fields to replace in the default record
 * @returns an issue record accepted by the store
 */
export function issue(overrides = {}) {
  return {
    id: "i-t1",
    spec_id: "s-t1",
    title: "issue de test",
    depends_on: [],
    acceptance_criteria: ["1. [unit] premier critere", "2. [unit] second critere"],
    pipeline_state: state(),
    ...overrides,
  };
}

/**
 * Root of the framework, resolved from this file.
 */
const FRAMEWORK = join(here, "..");

/**
 * Copies into a sandbox the framework pieces apply-profile needs to run.
 *
 * Without them the script stops on a missing template long before it reaches
 * the part under test, and a test written against its output would be
 * measuring the absence of a template rather than the behaviour it targets.
 *
 * @param root - sandbox root
 */
export function seedFramework(root) {
  const into = join(root, "agent-pipeline");
  for (const directory of ["templates", "prompts", "schemas"]) {
    cpSync(join(FRAMEWORK, directory), join(into, directory), { recursive: true });
  }
  mkdirSync(join(into, "profiles", "test"), { recursive: true });
  writeFileSync(join(into, "profiles", "test", "invariants.md"), "- The clock is injected.\n");
  writeFileSync(join(into, "profiles", "test", "pitfalls.md"), "- Nothing paid for yet.\n");
  mkdirSync(join(root, "pipeline"), { recursive: true });
  writeFileSync(
    join(root, "pipeline", "project-context.md"),
    ["summary", "commands", "context"].map((name) => `<!-- claude:${name} -->\nx\n<!-- /claude -->\n`).join(""),
  );
}
