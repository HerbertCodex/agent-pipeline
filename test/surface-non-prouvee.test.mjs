import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, writeStore, writeJson, run, issue, state, recordHash } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

const GATES = {
  check: "true", lint: "true", build: "true", test_unit: "true", audit: "true",
  secrets_scan: "true", project_map: "true", design_limits: "true", duplication: "true", smoke: "true",
};

/**
 * Prepares a project declaring the full gate table.
 *
 * @param overrides - configuration fields merged in
 * @returns the sandbox root
 */
function project(overrides = {}) {
  const root = createSandbox();
  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.commands = { ...GATES };
  config.architecture = { id: "feature-modules", project_type: "backend" };
  config.project_map = { out: "docs/map.md", roots: ["src"], regenerate: "true" };
  config.file_policy = { ...config.file_policy, orchestrator: { allow: ["pipeline/store/**", "docs/map.md"] } };
  writeFileSync(path, JSON.stringify({ ...config, ...overrides }, null, 2));
  return root;
}

/**
 * Builds an implementer handoff asking for review.
 *
 * @param overrides - fields merged into the handoff
 * @returns the handoff body
 */
function handover(overrides = {}) {
  return {
    schema_version: 1,
    produced_at: "2026-08-21T09:00:00.000Z",
    mode: "issue_handoff",
    agent: "implementer",
    scope: { spec_id: "s-t1", issue_id: "i-t1" },
    basis: { record_hash: "abc", pipeline_version: 1 },
    outcome: "ready_for_qa",
    requested_transition: { from: "in_progress", to: "ready_for_qa" },
    context: { heading: "## Context for QA", body: "corps" },
    untested_surface: "Les actions de route : aucun test automatise ne les atteint.",
    claims_to_replay: [{ claim: "les portes sortent en 0", how_to_replay: "node --test" }],
    evidence: {
      commands: Object.keys(GATES).map((key) => ({ key, cmd: "true", exit: 0 })),
      files: ["src/x.ts"],
      commit_sha: "abc1234",
      notes: [],
      red_proof: { cmd: "node --test", exit: 1, observed_before_implementation: true, test_commit_sha: "def" },
    },
    ...overrides,
  };
}

describe("what no test reaches is declared, or it is discovered by a user", () => {
  test("a handoff carrying a commit and no declaration is refused", () => {
    // Two issues of one real spec closed with the same hole: no automated
    // test reached the route actions. The field existed in the handoffs and
    // the framework read it nowhere, so nothing accumulated it and nothing
    // said the hole was the same one twice.
    sandbox = project();
    const body = handover();
    delete body.untested_surface;
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /untested_surface/);
  });

  test("saying there is none is an answer, and must be said", () => {
    sandbox = project();
    const body = handover({ untested_surface: "" });
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /untested_surface/);
  });

  test("a declaration passes", () => {
    sandbox = project();
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", handover())]);
    assert.equal(result.status, 0, result.output);
  });

  test("the store keeps it, so the report can add it up", () => {
    sandbox = project();
    writeStore(sandbox, "issues", [issue({ id: "i-t1" })]);
    const request = writeJson(sandbox, "r.json", {
      target: { kind: "issue", id: "i-t1" },
      expected_record_hash: recordHash(sandbox, "issues", "i-t1"),
      started_at: "2026-08-20T08:00:00.000Z",
      ended_at: "2026-08-20T08:30:00.000Z",
      untested_surface: "les actions de route",
      pipeline_state: state({
        phase: "in_progress",
        owner: "implementer",
        version: 2,
        last_transition_at: "2026-08-20T09:00:00.000Z",
      }),
    });
    const result = run(sandbox, "store-update.mjs", [request]);
    assert.equal(result.status, 0, result.output);
    const stored = JSON.parse(
      readFileSync(join(sandbox, "pipeline", "store", "issues.jsonl"), "utf8").split("\n")[0],
    );
    assert.equal(stored.untested_surface, "les actions de route");
  });

  test("the closure report gathers what was left unproved", () => {
    sandbox = project({ language: "fr" });
    writeStore(sandbox, "specs", [{ id: "s-1", title: "x", spec_state: { phase: "ready_for_pr" } }]);
    writeStore(sandbox, "issues", [
      issue({
        id: "i-1",
        spec_id: "s-1",
        pipeline_state: state({ phase: "closed", owner: "none" }),
        acceptance_criteria: ["1. [unit] x"],
        criteria_ledger: [{ index: 0, status: "verified", evidence: "mesure" }],
        untested_surface: "les actions de route ne sont atteintes par aucun test",
      }),
    ]);
    const target = join(sandbox, "r.html");
    const result = run(sandbox, "render-spec.mjs", [target, "s-1"]);
    assert.equal(result.status, 0, result.output);
    assert.match(readFileSync(target, "utf8"), /actions de route/);
  });
});

describe("a gate that runs the application, because no static one can", () => {
  test("apply-profile refuses a project declaring none", () => {
    // Thirteen gates green while every form answered 403: the origin was
    // never configured, and no criterion foresaw it. It was found by starting
    // the server. Nothing in the battery starts anything.
    sandbox = project();
    const path = join(sandbox, "pipeline.config.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    delete config.commands.smoke;
    writeFileSync(path, JSON.stringify(config, null, 2));
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /smoke/);
    assert.match(
      result.output,
      /start|lance|end to end|bout en bout/i,
      "the refusal must say what kind of command counts, or it is answered with another unit test",
    );
  });

  test("a declared one is accepted", () => {
    sandbox = project();
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.doesNotMatch(result.output, /commands\.smoke/, result.output);
  });
});
