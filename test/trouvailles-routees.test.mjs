import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, writeStore, writeJson, run, issue, state } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

const HANDOFF = {
  schema_version: 1,
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
 * Submits a handoff carrying the given findings.
 *
 * @param discoveries - the findings declared
 * @returns validate-handoff's result
 */
function declare(discoveries) {
  sandbox ??= createSandbox();
  return run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", { ...HANDOFF, discoveries })]);
}

describe("a finding says where it lands, or it lands in the backlog by default", () => {
  test("refuses a finding that names no destination", () => {
    sandbox = createSandbox();
    const result = declare([{ title: "bits-ui leaks two attributes", rationale: "they reach the markup" }]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /lands/);
    assert.match(
      result.output,
      /issue|pitfall|framework|spec/,
      "the refusal names the destinations, or the agent guesses one",
    );
  });

  test("refuses a destination nobody implements", () => {
    sandbox = createSandbox();
    const result = declare([{ title: "x", rationale: "y", lands: "somewhere" }]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /somewhere/);
  });

  test("a finding landing as an issue must name what is defective", () => {
    sandbox = createSandbox();
    const result = declare([{ title: "the wiring is proven by nothing", rationale: "no constraint", lands: "issue" }]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /breaks/);
  });

  test("a finding landing on the spec must name the criterion it contradicts", () => {
    sandbox = createSandbox();
    const result = declare([{ title: "criteria 8 and 6 pull apart", rationale: "one refuses the other", lands: "spec" }]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /criterion/);
  });

  test("a pitfall carries the line that will be written down", () => {
    sandbox = createSandbox();
    const result = declare([{ title: "a local style rule beats :global()", rationale: "specificity", lands: "pitfall" }]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /line/);
  });

  test("accepts the four destinations when each carries what it owes", () => {
    sandbox = createSandbox();
    const result = declare([
      { title: "wiring unproven", rationale: "r", lands: "issue", breaks: "AmountField" },
      { title: "criteria pull apart", rationale: "r", lands: "spec", criterion: "8" },
      { title: "local rule beats global", rationale: "r", lands: "pitfall", line: "A local style rule wins (0,2,0)." },
      { title: "the store drops claims_to_replay", rationale: "r", lands: "framework" },
    ]);
    assert.equal(result.status, 0, result.output);
  });
});

describe("closure is verified per destination, not by one count", () => {
  /**
   * Prepares a project with a profile carrying a pitfalls document.
   *
   * @param pitfalls - content of pitfalls.md
   * @returns the sandbox root
   */
  function withProfile(pitfalls = "# Pitfalls\n") {
    const root = createSandbox();
    const path = join(root, "pipeline.config.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.findings_path = "pipeline/findings.md";
    writeFileSync(path, JSON.stringify(config, null, 2));
    mkdirSync(join(root, "agent-pipeline", "profiles", "test"), { recursive: true });
    writeFileSync(join(root, "agent-pipeline", "profiles", "test", "pitfalls.md"), pitfalls);
    mkdirSync(join(root, "pipeline"), { recursive: true });
    return root;
  }

  test("only a finding landing as an issue owes a created issue", () => {
    sandbox = withProfile();
    writeFileSync(join(sandbox, "pipeline", "findings.md"), "# Findings\n\n- the store drops claims_to_replay\n");
    writeFileSync(
      join(sandbox, "agent-pipeline", "profiles", "test", "pitfalls.md"),
      "# Pitfalls\n\n- A local style rule wins (0,2,0).\n",
    );
    writeStore(sandbox, "issues", [
      issue({
        id: "i-t1",
        pipeline_state: state({ phase: "closed", owner: "none" }),
        criteria_ledger: [],
        acceptance_criteria: [],
        discoveries_declared: [
          { title: "local rule beats global", lands: "pitfall", line: "A local style rule wins (0,2,0)." },
          { title: "the store drops claims_to_replay", lands: "framework" },
        ],
      }),
    ]);
    const result = run(sandbox, "store-verify.mjs", []);
    assert.equal(result.status, 0, result.output);
  });

  test("a pitfall nobody wrote down still refuses the closure", () => {
    sandbox = withProfile("# Pitfalls\n");
    writeStore(sandbox, "issues", [
      issue({
        id: "i-t1",
        pipeline_state: state({ phase: "closed", owner: "none" }),
        criteria_ledger: [],
        acceptance_criteria: [],
        discoveries_declared: [
          { title: "local rule beats global", lands: "pitfall", line: "A local style rule wins (0,2,0)." },
        ],
      }),
    ]);
    const result = run(sandbox, "store-verify.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /pitfall/i);
  });

  test("a framework finding absent from the operator's list refuses the closure", () => {
    sandbox = withProfile();
    writeFileSync(join(sandbox, "pipeline", "findings.md"), "# Findings\n");
    writeStore(sandbox, "issues", [
      issue({
        id: "i-t1",
        pipeline_state: state({ phase: "closed", owner: "none" }),
        criteria_ledger: [],
        acceptance_criteria: [],
        discoveries_declared: [{ title: "the store drops claims_to_replay", lands: "framework" }],
      }),
    ]);
    const result = run(sandbox, "store-verify.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /findings/);
  });

  test("a finding landing as an issue still owes its linked issue", () => {
    sandbox = withProfile();
    writeStore(sandbox, "issues", [
      issue({
        id: "i-t1",
        pipeline_state: state({ phase: "closed", owner: "none" }),
        criteria_ledger: [],
        acceptance_criteria: [],
        discoveries_declared: [{ title: "wiring unproven", lands: "issue", breaks: "AmountField" }],
      }),
    ]);
    const result = run(sandbox, "store-verify.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /discovery|created issue/i);
  });

  test("a record written before the destinations existed is read as an issue", () => {
    // The old shape carried no destination and always meant one thing. Reading
    // it as anything else would rewrite history rather than describe it.
    sandbox = withProfile();
    writeStore(sandbox, "issues", [
      issue({
        id: "i-t1",
        pipeline_state: state({ phase: "closed", owner: "none" }),
        criteria_ledger: [],
        acceptance_criteria: [],
        discoveries_declared: [{ title: "an old finding" }],
      }),
    ]);
    const result = run(sandbox, "store-verify.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /discovery|created issue/i);
  });
});
