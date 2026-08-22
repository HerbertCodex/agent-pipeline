import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, destroySandbox, writeJson, run, readRecord, recordHash, issue } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

const CLAIM = { claim: "verify-scope : 8 fichiers, exit 0", how_to_replay: "verify-scope.mjs <handoff> <base>" };

const IMPL = {
  schema_version: 1,
  untested_surface: "rien : le changement est entierement prouve",
  produced_at: "2026-08-21T09:00:00.000Z",
  agent: "implementer",
  scope: { spec_id: "s-t1", issue_id: "i-t1" },
  basis: { record_hash: "abc", pipeline_version: 1 },
  outcome: "ready_for_qa",
  mode: "issue_handoff",
  requested_transition: { from: "in_progress", to: "ready_for_qa" },
  context: { heading: "## Context for QA", body: "corps" },
  evidence: {
    commands: [{ key: "check", cmd: "true", exit: 0 }],
    files: ["src/x.ts"],
    commit_sha: "abc1234",
    notes: [],
    red_proof: { cmd: "jest", exit: 1, observed_before_implementation: true, test_commit_sha: "def" },
  },
};

const QA_CLOSURE = {
  schema_version: 1,
  produced_at: "2026-08-21T09:00:00.000Z",
  agent: "qa",
  scope: { spec_id: "s-t1", issue_id: "i-t1" },
  basis: { record_hash: "abc", pipeline_version: 1 },
  outcome: "closed",
  mode: "issue_handoff",
  requested_transition: { from: "qa_in_progress", to: "closed" },
  evidence: { commands: [{ key: "check", cmd: "true", exit: 0 }], files: [], commit_sha: null, notes: [] },
  criteria_ledger: [
    { status: "verified", evidence: "mesure" },
    { status: "verified", evidence: "mesure" },
  ],
};

/**
 * Writes a handoff into the sandbox and runs the validator on it.
 *
 * @param handoff - handoff content
 * @returns the validator's execution result
 */
function validate(handoff) {
  sandbox ??= createSandbox();
  return run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", handoff)]);
}

describe("validate-handoff: an implementer enumerates what it asserts", () => {
  test("refuses a handoff carrying a commit with no claims_to_replay", () => {
    const result = validate(IMPL);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /claims_to_replay empty/);
  });

  test("accepts a handoff that enumerates its claims", () => {
    const result = validate({ ...IMPL, claims_to_replay: [CLAIM] });
    assert.equal(result.status, 0, result.output);
  });

  test("refuses a claim with no way to replay it", () => {
    const result = validate({ ...IMPL, claims_to_replay: [{ claim: "j'ai tout verifie" }] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /how_to_replay missing/);
  });

  test("requires nothing of a handoff with no commit: it asserts no measurement", () => {
    const result = validate({
      ...IMPL,
      outcome: "blocked_product",
      requested_transition: { from: "in_progress", to: "blocked_product" },
      evidence: { commands: [{ key: "check", cmd: "true", exit: 0 }], files: [], commit_sha: null, notes: [] },
    });
    assert.equal(result.status, 0, result.output);
  });
});

describe("validate-handoff: a closure confronts instead of believing", () => {
  test("refuses a closure with no verdict on the claims", () => {
    const result = validate(QA_CLOSURE);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /claims_verdict empty/);
  });

  test("refuses a claim declared but never replayed", () => {
    const result = validate({
      ...QA_CLOSURE,
      claims_verdict: [{ claim: CLAIM.claim, replayed: false, result: "cru sur parole" }],
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /not replayed/);
  });

  test("refuses a replay with no result", () => {
    const result = validate({ ...QA_CLOSURE, claims_verdict: [{ claim: CLAIM.claim, replayed: true }] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /result missing/);
  });

  test("accepts a closure where every claim was replayed", () => {
    const result = validate({
      ...QA_CLOSURE,
      claims_verdict: [{ claim: CLAIM.claim, replayed: true, result: "confirme : 8 fichiers, exit 0" }],
    });
    assert.equal(result.status, 0, result.output);
  });
});

describe("store-update: the verdict is counted against the claims", () => {
  /**
   * Prepares an issue already carrying claims to replay.
   *
   * @returns the sandbox, the identifier and the current lock hash
   */
  function withClaims() {
    const record = issue({ claims_to_replay: [CLAIM, { claim: "10 mutations", how_to_replay: "les rejouer" }] });
    sandbox = createSandbox({ issues: [record] });
    return { root: sandbox, id: record.id, hash: recordHash(sandbox, "issues", record.id) };
  }

  test("refuses a verdict whose length does not match", () => {
    const { root, id, hash } = withClaims();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      claims_verdict: [{ claim: CLAIM.claim, replayed: true, result: "ok" }],
    });
    const result = run(root, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /verdict of 1 entry\(ies\) for 2 claim\(s\)/);
  });

  test("refuses a verdict carrying an unreplayed claim", () => {
    const { root, id, hash } = withClaims();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      claims_verdict: [
        { claim: CLAIM.claim, replayed: true, result: "ok" },
        { claim: "10 mutations", replayed: false, result: "cru" },
      ],
    });
    assert.notEqual(run(root, "store-update.mjs", [request]).status, 0);
  });

  test("persists a complete verdict", () => {
    const { root, id, hash } = withClaims();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      claims_verdict: [
        { claim: CLAIM.claim, replayed: true, result: "confirme" },
        { claim: "10 mutations", replayed: true, result: "8 tuees, 2 survivantes" },
      ],
    });
    assert.equal(run(root, "store-update.mjs", [request]).status, 0);
    const after = readRecord(root, "issues", id);
    assert.equal(after.claims_verdict.length, 2);
    assert.equal(after.claims_verdict[1].result, "8 tuees, 2 survivantes");
  });

  test("rewriting the claims clears a verdict rendered on the old ones", () => {
    const { root, id, hash } = withClaims();
    const first = writeJson(root, "r1.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      claims_verdict: [
        { claim: CLAIM.claim, replayed: true, result: "ok" },
        { claim: "10 mutations", replayed: true, result: "ok" },
      ],
    });
    run(root, "store-update.mjs", [first]);
    const second = writeJson(root, "r2.json", {
      target: { kind: "issue", id },
      expected_record_hash: recordHash(root, "issues", id),
      untested_surface: "rien : le changement est entierement prouve",
      claims_to_replay: [{ claim: "affirmation neuve", how_to_replay: "la rejouer" }],
    });
    assert.equal(run(root, "store-update.mjs", [second]).status, 0);
    const after = readRecord(root, "issues", id);
    assert.equal(after.claims_to_replay.length, 1);
    assert.equal(after.claims_verdict, null, "un verdict rendu sur d'autres affirmations n'en est pas un sur celles-la");
  });
});
