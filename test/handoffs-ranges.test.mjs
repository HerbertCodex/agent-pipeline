import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createSandbox, destroySandbox, writeStore, writeJson, run, issue, state } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

const HANDOFF = {
  schema_version: 1,
  produced_at: "2026-08-21T09:00:00.000Z",
  mode: "issue_handoff",
  agent: "qa",
  scope: { spec_id: "s-t1", issue_id: "i-t1" },
  basis: { record_hash: "abc", pipeline_version: 1 },
  outcome: "closed",
  requested_transition: { from: "qa_in_progress", to: "closed" },
  context: { heading: "## Context for Orchestrator", body: "corps" },
  criteria_ledger: [{ index: 0, status: "verified", evidence: "observe" }],
  claims_verdict: [{ index: 0, claim: "les portes sortent en 0", replayed: true, result: "confirme" }],
  evidence: { commands: [{ key: "check", cmd: "true", exit: 0 }], files: [], commit_sha: null, notes: [] },
};

/**
 * Submits a handoff and returns the validator's result.
 *
 * @param overrides - fields merged into the handoff
 * @returns validate-handoff's result
 */
function submit(overrides) {
  sandbox ??= createSandbox();
  return run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", { ...HANDOFF, ...overrides })]);
}

describe("a handoff says when it was produced", () => {
  test("one without a date is refused", () => {
    // Observed on a real handoff: nothing said when it was written. Several
    // of them sat side by side with no way to order them, and no way to tell
    // a fresh one from a file left over from an earlier attempt.
    sandbox = createSandbox();
    const { produced_at, ...undated } = HANDOFF;
    void produced_at;
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", undated)]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /produced_at/);
  });

  test("a date that is not a date is refused", () => {
    sandbox = createSandbox();
    const result = submit({ produced_at: "hier" });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /produced_at/);
  });

  test("a date in the future is refused", () => {
    sandbox = createSandbox();
    const result = submit({ produced_at: "2099-01-01T00:00:00.000Z" });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /produced_at|future/i);
  });

  test("a dated handoff passes", () => {
    sandbox = createSandbox();
    const result = submit({ produced_at: new Date().toISOString() });
    assert.equal(result.status, 0, result.output);
  });
});

describe("handoffs have a home, and it is not the diff", () => {
  /**
   * Prepares a repository declaring a handoffs directory.
   *
   * @param ignored - whether git ignores that directory
   * @returns the sandbox root
   */
  function withHandoffs(ignored) {
    const root = createSandbox();
    const path = join(root, "pipeline.config.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.handoffs_dir = "pipeline/handoffs";
    config.commands = Object.fromEntries(
      ["check", "lint", "build", "test_unit", "audit", "secrets_scan", "project_map", "design_limits", "duplication", "smoke"]
        .map((key) => [key, "true"]),
    );
    config.architecture = { id: "feature-modules", project_type: "backend" };
    config.project_map = { out: "docs/map.md", roots: ["src"], regenerate: "true" };
    config.file_policy = { ...config.file_policy, orchestrator: { allow: ["pipeline/store/**", "docs/map.md"] } };
    writeFileSync(path, JSON.stringify(config, null, 2));
    mkdirSync(join(root, "pipeline", "handoffs"), { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(join(root, ".gitignore"), ignored ? "pipeline/handoffs/\n" : "node_modules/\n");
    return root;
  }

  test("a directory git would commit is refused", () => {
    // A handoff inside the diff is a file the scope check flags and a
    // reviewer reads by mistake. The prompt said « outside the repository »,
    // which gave it no home at all — and a file with no home is a file
    // nobody can clean up.
    sandbox = withHandoffs(false);
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /handoffs/);
    assert.match(result.output, /ignore|gitignore/i);
  });

  test("an ignored directory is accepted", () => {
    sandbox = withHandoffs(true);
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.doesNotMatch(result.output, /handoffs_dir/, result.output);
  });
});

describe("a handoff whose issue is closed has nothing left to say", () => {
  /**
   * Prepares a project with handoff files on disk.
   *
   * @param files - name to the handoff body
   * @returns the sandbox root
   */
  function withFiles(files) {
    const root = createSandbox();
    const path = join(root, "pipeline.config.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.handoffs_dir = "pipeline/handoffs";
    writeFileSync(path, JSON.stringify(config, null, 2));
    mkdirSync(join(root, "pipeline", "handoffs"), { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(root, "pipeline", "handoffs", name), JSON.stringify(body));
    }
    writeStore(root, "issues", [
      issue({ id: "i-done", pipeline_state: state({ phase: "closed", owner: "none" }) }),
      issue({ id: "i-live", pipeline_state: state({ phase: "in_progress", owner: "implementer" }) }),
    ]);
    return root;
  }

  test("pruning removes what belongs to a closed issue and keeps the rest", () => {
    sandbox = withFiles({
      "i-done-implementer.json": { scope: { issue_id: "i-done" } },
      "i-live-implementer.json": { scope: { issue_id: "i-live" } },
    });
    const result = run(sandbox, "handoffs.mjs", ["--prune"]);
    assert.equal(result.status, 0, result.output);
    assert.ok(!existsSync(join(sandbox, "pipeline", "handoffs", "i-done-implementer.json")));
    assert.ok(existsSync(join(sandbox, "pipeline", "handoffs", "i-live-implementer.json")));
  });

  test("without --prune it only reports, because deleting is not a listing", () => {
    sandbox = withFiles({ "i-done-implementer.json": { scope: { issue_id: "i-done" } } });
    const result = run(sandbox, "handoffs.mjs", []);
    assert.equal(result.status, 0, result.output);
    assert.ok(existsSync(join(sandbox, "pipeline", "handoffs", "i-done-implementer.json")));
    assert.match(result.output, /i-done/);
  });

  test("a handoff naming an issue nobody knows is kept and reported", () => {
    // Deleting it would destroy the only trace of work the store never saw.
    sandbox = withFiles({ "orphan.json": { scope: { issue_id: "i-ghost" } } });
    const result = run(sandbox, "handoffs.mjs", ["--prune"]);
    assert.ok(existsSync(join(sandbox, "pipeline", "handoffs", "orphan.json")));
    assert.match(result.output, /i-ghost|orphan/);
  });
});
