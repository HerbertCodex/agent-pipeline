import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, enableIssueTracker, run } from "./harness.mjs";
import { missingTrackerStore } from "../scripts/tracker-sync.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

describe("tracker-sync: a vanished provider cannot report green", () => {
  test("refuses when the Sudocode directory was deleted", () => {
    // Observed on 2026-09-10 during an installation: the provider directory
    // moved away, and tracker-sync answered rc=0, "synchronized".
    sandbox = createSandbox();
    enableIssueTracker(sandbox);
    rmSync(join(sandbox, ".sudocode"), { recursive: true, force: true });
    const result = run(sandbox, "tracker-sync.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /\.sudocode/);
    assert.doesNotMatch(result.output, /synchronized/);
  });

  test("refuses when the issues file is gone but the directory remains", () => {
    sandbox = createSandbox();
    enableIssueTracker(sandbox);
    rmSync(join(sandbox, ".sudocode", "issues.jsonl"));
    const result = run(sandbox, "tracker-sync.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /issues\.jsonl/);
  });

  test("an initialised tracker with zero issues still reports green", () => {
    sandbox = createSandbox();
    enableIssueTracker(sandbox);
    const result = run(sandbox, "tracker-sync.mjs");
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /synchronized/);
  });
});

describe("tracker-sync: what the guard demands of each provider", () => {
  test("a project without a tracker asks for nothing", () => {
    assert.equal(missingTrackerStore({}), null);
  });

  test("an explicitly disabled tracker asks for nothing", () => {
    assert.equal(missingTrackerStore({ issue_tracker: { enabled: false, provider: "sudocode", root: ".sudocode" } }), null);
  });

  test("the github provider has no local root to demand", () => {
    assert.equal(missingTrackerStore({ issue_tracker: { enabled: true, provider: "github" } }), null);
  });
});
