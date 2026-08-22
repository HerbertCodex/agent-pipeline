import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, destroySandbox, writeStore, run, issue, state } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

describe("what a role must declare is carried, or the next role cannot conclude", () => {
  /**
   * Writes one issue into a fresh sandbox and verifies the store.
   *
   * @param overrides - fields merged into the issue record
   * @returns store-verify's result
   */
  function verify(overrides) {
    sandbox = createSandbox();
    writeStore(sandbox, "issues", [issue({ id: "i-t1", criteria_ledger: [], acceptance_criteria: [], ...overrides })]);
    return run(sandbox, "store-verify.mjs", []);
  }

  test("an issue under review carries the claims its handoff had to declare", () => {
    // The deadlock this prevents was measured. The implementer declared its
    // claims — the validator makes that mandatory as soon as it carries a
    // commit — but nothing carried them into the record, and nothing said so.
    // QA then finished a complete, favourable review and could not request
    // closure: the closure confronts every claim, and the record held none.
    // The issue sat blocked while nothing was wrong with it.
    const result = verify({
      pipeline_state: state({ phase: "qa_in_progress", owner: "qa", last_commit_sha: "abc1234" }),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /claims_to_replay/);
    assert.match(result.output, /conclude|confront|closure/i);
  });

  test("the same issue with its claims carried is accepted", () => {
    const result = verify({
      pipeline_state: state({ phase: "qa_in_progress", owner: "qa", last_commit_sha: "abc1234" }),
      untested_surface: "rien : le changement est entierement prouve",
      claims_to_replay: [{ claim: "les portes sortent en 0", how_to_replay: "node --test" }],
    });
    assert.equal(result.status, 0, result.output);
  });

  test("an issue that has authored nothing yet owes no claim", () => {
    const result = verify({ pipeline_state: state({ phase: "in_progress", owner: "implementer" }) });
    assert.equal(result.status, 0, result.output);
  });

  test("a closed issue is history, and history is described rather than rewritten", () => {
    // The rule refuses a review that cannot conclude. A closed issue
    // concluded. Holding closed records to it condemns every issue finished
    // before the claims mechanism existed — this repository's own first one
    // among them, which is how the gate was caught overreaching.
    const result = verify({
      pipeline_state: state({ phase: "closed", owner: "none", last_commit_sha: "abc1234" }),
    });
    assert.equal(result.status, 0, result.output);
  });
});
