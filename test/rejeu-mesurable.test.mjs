import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, writeJson, run } from "./harness.mjs";

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
 * @returns the sandbox root
 */
function project() {
  const root = createSandbox();
  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.commands = { ...GATES };
  config.closure_gates = ["build", "audit"];
  writeFileSync(path, JSON.stringify(config, null, 2));
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
    untested_surface: "rien : le changement est entierement prouve",
    claims_to_replay: [{ claim: "les portes sortent en 0", how_to_replay: "node --test" }],
    evidence: {
      commands: ["check", "lint", "test_unit", "secrets_scan", "project_map", "design_limits", "duplication", "smoke"].map(
        (key) => ({ key, cmd: "true", exit: 0 }),
      ),
      files: ["src/x.ts"],
      commit_sha: "abc1234",
      notes: [],
      red_proof: { cmd: "node --test", exit: 1, observed_before_implementation: true, test_commit_sha: "def" },
    },
    ...overrides,
  };
}

/**
 * Submits a handoff.
 *
 * @param body - the handoff
 * @returns validate-handoff's result
 */
function submit(body) {
  return run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
}

describe("a replay whose exit code belongs to something else is refused", () => {
  test("a command ending on a restore measures the restore", () => {
    // Observed twice on a real run, and reported by the agent itself: the
    // replay ran the tests, then restored the file, and the shell returned
    // the restore's status. Both verdicts read « Reproduit : exit 0 » for a
    // claim asserting a failure — a sentence that contradicts itself.
    sandbox = project();
    const body = handover();
    body.claims_to_replay = [
      {
        claim: "retirer alerts.ts fait tomber la suite",
        how_to_replay: "git checkout HEAD~1 -- src/alerts.ts && node --test ; git checkout HEAD -- src/alerts.ts",
      },
    ];
    const result = submit(body);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /how_to_replay/);
    assert.match(result.output, /exit|masqu|belongs/i);
  });

  test("a fallback hides a failure just as well", () => {
    sandbox = project();
    const body = handover();
    body.claims_to_replay = [{ claim: "x", how_to_replay: "node --test || echo done" }];
    const result = submit(body);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /how_to_replay/);
  });

  test("a chain that stops at the first failure is accepted", () => {
    // `&&` propagates the failure: the first command to fail ends the chain
    // and its status is the one returned. Nothing is masked.
    sandbox = project();
    const body = handover();
    body.claims_to_replay = [{ claim: "x", how_to_replay: "node --check src/x.ts && node --test" }];
    assert.equal(submit(body).status, 0, submit(body).output);
  });

  test("a semicolon inside a quoted argument is not a chain", () => {
    sandbox = project();
    const body = handover();
    body.claims_to_replay = [{ claim: "x", how_to_replay: `node -e "a(); b()"` }];
    assert.equal(submit(body).status, 0, submit(body).output);
  });

  test("the red proof is held to the same rule", () => {
    sandbox = project();
    const body = handover();
    body.evidence.red_proof.cmd = "node --test ; git checkout HEAD -- src/x.ts";
    const result = submit(body);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /red_proof/);
  });
});

describe("the implementer runs the battery, so QA replays instead of discovering", () => {
  test("a handover citing part of the battery is refused", () => {
    // Measured on a real run: the implementer cited two gates out of eight,
    // QA replayed the rest, `design_limits` refused a 33-line function, and
    // the issue came back. A whole cycle for something the handover could
    // have been refused for.
    sandbox = project();
    const body = handover();
    body.evidence.commands = [{ key: "check", cmd: "true", exit: 0 }];
    const result = submit(body);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /lint|design_limits/);
    assert.match(result.output, /evidence\.commands/);
  });

  test("a gate exiting non-zero is not a gate that ran clean", () => {
    sandbox = project();
    const body = handover();
    body.evidence.commands = body.evidence.commands.map((entry) =>
      entry.key === "design_limits" ? { ...entry, exit: 1 } : entry,
    );
    const result = submit(body);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /design_limits/);
  });

  test("the deferred gates are not owed", () => {
    sandbox = project();
    assert.equal(submit(handover()).status, 0, submit(handover()).output);
  });
});
