import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, writeJson, run, seedFramework } from "./harness.mjs";
import { perIssueGates, gatesForIssue, closureGates, laneOf } from "../scripts/gates.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

const GATES = {
  check: "true", lint: "true", build: "true", test_unit: "true", audit: "true",
  secrets_scan: "true", project_map: "true", design_limits: "true", duplication: "true", smoke: "true",
  coverage: "true", mutation: "true",
};

/**
 * Prepares a project able to render its prompts.
 *
 * @param overrides - configuration fields merged in
 * @returns the sandbox root
 */
function project(overrides = {}) {
  const root = createSandbox();
  seedFramework(root);
  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.commands = { ...GATES };
  config.closure_gates = ["coverage", "mutation", "build"];
  config.architecture = { id: "feature-modules", project_type: "backend" };
  config.project_map = { out: "docs/map.md", roots: ["src"], regenerate: "true" };
  config.file_policy = { ...config.file_policy, orchestrator: { allow: ["pipeline/store/**", "docs/map.md"] } };
  writeFileSync(path, JSON.stringify({ ...config, ...overrides }, null, 2));
  return root;
}

describe("what QA replays per issue is computed, not recited", () => {
  test("the per-issue battery is every declared gate the closure does not defer", () => {
    const config = { commands: GATES, closure_gates: ["coverage", "mutation", "build"] };
    const battery = perIssueGates(config);
    assert.ok(battery.includes("check") && battery.includes("lint"), battery.join(", "));
    for (const deferred of ["coverage", "mutation", "build", "project_map"]) {
      assert.ok(!battery.includes(deferred), `${deferred} is deferred and must not be replayed per issue`);
    }
  });

  test("the rendered prompt carries the project's own list, not a fixed one", () => {
    sandbox = project();
    const result = run(sandbox, "apply-profile.mjs", []);
    assert.equal(result.status, 0, result.output);
    const qa = readFileSync(join(sandbox, ".claude", "agents", "qa.md"), "utf8");
    assert.match(qa, /`check`/);
    assert.ok(!qa.includes("{{gates"), "the variable reached the reader unrendered");
    const perIssue = qa.slice(qa.indexOf("Per-issue battery"), qa.indexOf("Per-issue battery") + 400);
    assert.ok(!perIssue.includes("`mutation`"), "a deferred gate was prescribed per issue anyway");
  });

  test("a closure states it ran the per-issue battery", () => {
    sandbox = project();
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", closure([]))]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /check|lint/);
    assert.match(result.output, /evidence\.commands/);
  });

  test("a closure citing the battery is accepted, deferred gates absent", () => {
    sandbox = project();
    const ran = perIssueGates({ commands: GATES, closure_gates: ["coverage", "mutation", "build"] })
      .map((key) => ({ key, cmd: "true", exit: 0 }));
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", closure(ran))]);
    assert.equal(result.status, 0, result.output);
  });

  test("a gate cited with a non-zero exit does not count as run", () => {
    sandbox = project();
    const ran = perIssueGates({ commands: GATES, closure_gates: ["coverage", "mutation", "build"] })
      .map((key) => ({ key, cmd: "true", exit: key === "lint" ? 1 : 0 }));
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", closure(ran))]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /lint/);
  });
});

describe("the cost is proportionate to what the issue touches", () => {
  const RISK = { high: ["src/auth/**", "src/payments/**"], low: ["src/**/*.css", "docs/**"] };

  test("a stylesheet is low, an authentication path is high, the rest is normal", () => {
    assert.equal(laneOf(["src/styles/tokens.css"], RISK), "low");
    assert.equal(laneOf(["src/auth/session.ts"], RISK), "high");
    assert.equal(laneOf(["src/catalog/service.ts"], RISK), "normal");
  });

  test("one high path raises the whole issue", () => {
    // The lane is the highest of what the issue touches. An issue mixing a
    // stylesheet and an authentication path is an authentication issue.
    assert.equal(laneOf(["src/styles/tokens.css", "src/auth/session.ts"], RISK), "high");
  });

  test("an issue with no declared risk map stays normal, whatever it touches", () => {
    assert.equal(laneOf(["src/auth/session.ts"], undefined), "normal");
  });

  test("configured normal and low lanes run a bounded battery while high risk keeps all gates", () => {
    const config = {
      commands: GATES,
      closure_gates: ["coverage", "mutation", "build"],
      risk: RISK,
      workflow: { gates: { low: ["check", "lint"], normal: ["check", "lint", "test_unit"], high: "all" } },
    };
    assert.deepEqual(gatesForIssue(["src/styles/tokens.css"], config), ["check", "lint"]);
    assert.deepEqual(gatesForIssue(["src/catalog/service.ts"], config), ["check", "lint", "test_unit"]);
    assert.deepEqual(gatesForIssue(["src/auth/session.ts"], config), perIssueGates(config));
    assert.ok(closureGates(config).includes("duplication"), "normal-lane omissions move to final closure");
  });

  test("a low-lane closure owes no replayed claim", () => {
    sandbox = project({ risk: RISK });
    const body = closure(battery(), { files: ["src/styles/tokens.css"] });
    delete body.claims_verdict;
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
    assert.equal(result.status, 0, result.output);
  });

  test("a normal closure still owes them", () => {
    sandbox = project({ risk: RISK });
    const body = closure(battery(), { files: ["src/catalog/service.ts"] });
    delete body.claims_verdict;
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /claims_verdict/);
  });

  test("an implementer cannot buy the cheap lane by declaring a narrow scope", () => {
    // The lane follows the files actually touched, and verify-scope confronts
    // those with the real diff. Reserving a stylesheet and editing the
    // authentication path therefore buys nothing.
    sandbox = project({ risk: RISK });
    const body = closure(battery(), { files: ["src/styles/tokens.css", "src/auth/session.ts"] });
    delete body.claims_verdict;
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /claims_verdict/);
  });
});

/**
 * Builds the per-issue battery as evidence entries.
 *
 * @returns one entry per gate the closure does not defer
 */
function battery() {
  return perIssueGates({ commands: GATES, closure_gates: ["coverage", "mutation", "build"] })
    .map((key) => ({ key, cmd: "true", exit: 0 }));
}

/**
 * Builds a QA closure handoff.
 *
 * @param commands - the commands the closure states it ran
 * @param options - files the issue touched
 * @returns the handoff body
 */
function closure(commands, { files = ["src/catalog/service.ts"] } = {}) {
  return {
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
    reviewed_files: files,
    evidence: { commands, files: [], commit_sha: null, notes: [] },
  };
}
