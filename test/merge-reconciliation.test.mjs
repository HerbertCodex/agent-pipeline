import { execFileSync } from "node:child_process";
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, destroySandbox, issue, readRecord, run, state, writeStore } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

function repository() {
  sandbox = createSandbox();
  const git = (...args) => execFileSync("git", args, { cwd: sandbox, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Pipeline test");
  git("add", "pipeline.config.json");
  git("commit", "-qm", "initial");
  return git("rev-parse", "HEAD").trim();
}

describe("post-merge reconciliation", () => {
  test("records the verified merge commit and terminal timestamp", () => {
    const sha = repository();
    writeStore(sandbox, "specs", [{
      id: "s-t1",
      title: "delivery",
      issues: ["i-t1"],
      spec_state: { phase: "pr_open", pr_url: "https://example.invalid/pr/1" },
    }]);
    writeStore(sandbox, "issues", [issue({
      pipeline_state: state({ phase: "closed", owner: "none", version: 5 }),
      criteria_ledger: [
        { index: 0, status: "verified", evidence: "first" },
        { index: 1, status: "verified", evidence: "second" },
      ],
    })]);
    const mergedAt = "2026-08-31T06:37:45.000Z";
    const result = run(sandbox, "reconcile-merge.mjs", ["s-t1", "--sha", sha, "--merged-at", mergedAt]);
    assert.equal(result.status, 0, result.output);
    const spec = readRecord(sandbox, "specs", "s-t1");
    assert.equal(spec.spec_state.phase, "merged");
    assert.equal(spec.spec_state.merge_sha, sha);
    assert.equal(spec.spec_state.merged_at, mergedAt);
    assert.match(spec.contexts.at(-1).body, new RegExp(sha));
  });

  test("refuses a commit that is not present locally", () => {
    repository();
    writeStore(sandbox, "specs", [{
      id: "s-t1",
      spec_state: { phase: "pr_open", pr_url: "https://example.invalid/pr/1" },
    }]);
    const result = run(sandbox, "reconcile-merge.mjs", [
      "s-t1",
      "--sha",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "--merged-at",
      "2026-08-31T06:37:45.000Z",
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /not present|fetch/i);
  });

  test("store verification rejects a legacy merged record with no proof", () => {
    sandbox = createSandbox();
    writeStore(sandbox, "specs", [{ id: "s-t1", issues: [], spec_state: { phase: "merged" } }]);
    const result = run(sandbox, "store-verify.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /merge_sha/);
    assert.match(result.output, /merged_at/);
    assert.match(result.output, /pr_url/);
  });
});
