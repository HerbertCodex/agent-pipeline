import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, writeJson, run } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

const BASE = {
  schema_version: 1,
  produced_at: "2026-08-21T09:00:00.000Z",
  mode: "issue_handoff",
  agent: "qa",
  scope: { spec_id: "s-0001", issue_id: "i-0002" },
  basis: { record_hash: "abc", pipeline_version: 4 },
  outcome: "operator_escalation",
  requested_transition: { from: "qa_in_progress", to: "operator_escalation" },
  context: { heading: "## Context for Operator (ESCALATION)", body: "x" },
  criteria_ledger: [{ status: "blocked", evidence: "e2e run 41, criterion 3 still refused" }],
};

const ATTEMPTS = [
  { approach: "pinned the criterion as a unit test on the service", failed_because: "the service never sees the swapped id, the controller does" },
  { approach: "moved the check into the controller", failed_because: "the DTO had already coerced the value, so the check ran on the coerced one" },
  { approach: "validated before coercion in a pipe", failed_because: "no pipe runs before the framework's own body parsing on this route" },
];

/**
 * Submits an escalation handoff.
 *
 * @param overrides - fields to merge into the handoff
 * @returns validate-handoff's result
 */
function escalate(overrides = {}) {
  sandbox ??= createSandbox();
  const path = writeJson(sandbox, "handoff.json", { ...BASE, ...overrides });
  return run(sandbox, "validate-handoff.mjs", [path]);
}

/**
 * Reads a rendered page.
 *
 * It deliberately does not swallow a read failure. The first version
 * returned an empty string on any error, and hid a missing import for three
 * runs: the assertion failed on the page's content while the real fault was
 * that no page had ever been read.
 *
 * @param path - path of the page
 * @returns the page content
 */
function readPage(path) {
  return readFileSync(path, "utf8");
}

describe("validate-handoff: an escalation reports, it does not merely stop", () => {
  test("refuses an escalation that says nothing of what was tried", () => {
    const result = escalate();
    assert.notEqual(result.status, 0);
    assert.match(result.output, /attempts/);
    assert.match(
      result.output,
      /tried|repeat|same/i,
      "the refusal says what the operator loses, or it reads as one more field",
    );
  });

  test("accepts an escalation that names each approach and why it failed", () => {
    const result = escalate({ attempts: ATTEMPTS });
    assert.equal(result.status, 0, result.output);
  });

  test("refuses an attempt with no reason for the failure", () => {
    const result = escalate({ attempts: [{ approach: "tried the obvious thing" }] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /failed_because/);
  });

  test("refuses an attempt that describes no approach", () => {
    const result = escalate({ attempts: [{ failed_because: "it did not work" }] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /approach/);
  });

  test("refuses an empty list, which is a stop dressed as a report", () => {
    const result = escalate({ attempts: [] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /attempts/);
  });

  test("refuses fewer attempts than the rejections that led here", () => {
    const result = escalate({ attempts: [ATTEMPTS[0]], qa_code_rejections: 3 });
    assert.notEqual(result.status, 0);
    assert.match(
      result.output,
      /3/,
      "three cycles were paid for; reporting one hides two of them from the person who has to decide",
    );
  });

  test("accepts as many attempts as there were rejections", () => {
    const result = escalate({ attempts: ATTEMPTS, qa_code_rejections: 3 });
    assert.equal(result.status, 0, result.output);
  });

  test("asks nothing of a handoff that is not an escalation", () => {
    const result = escalate({
      outcome: "ready_for_qa",
      requested_transition: { from: "qa_in_progress", to: "in_progress" },
      context: { heading: "## Context for Implementer (REGRESSION)", body: "x" },
      fault: "code",
      regression: { required: true, criterion: "3" },
    });
    assert.doesNotMatch(result.output, /attempts/);
  });
});

describe("render-decisions: what was tried reaches the page the operator reads", () => {
  test("shows the attempts of an escalated issue", () => {
    sandbox = createSandbox({
      issues: [
        {
          id: "i-0002",
          spec_id: "s-0001",
          title: "refuser un identifiant echange",
          depends_on: [],
          acceptance_criteria: ["x"],
          attempts: ATTEMPTS,
          pipeline_state: {
            phase: "operator_escalation",
            owner: "operator",
            version: 5,
            qa_code_rejections: 3,
            file_reservations: ["src/catalog/**"],
            last_commit_sha: null,
            last_transition_at: null,
          },
        },
      ],
    });
    const target = join(sandbox, "page.html");
    const result = run(sandbox, "render-decisions.mjs", [target]);
    assert.equal(result.status, 0, result.output);
    const html = readPage(target);
    assert.match(html, /coerced/, "the operator decides on what was tried, not on the fact that it failed");
    assert.match(html, /no pipe runs before/);
  });
});
