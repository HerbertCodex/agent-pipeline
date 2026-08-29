import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createSandbox,
  destroySandbox,
  enableIssueTracker,
  issue,
  run,
  trackerIssue,
  writeStore,
} from "./harness.mjs";
import { readIssueTracker, trackerBinding } from "../scripts/issue-tracker.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

describe("portable task packages", () => {
  test("carry only context addressed to the selected role", () => {
    sandbox = createSandbox({
      issues: [issue({
        contexts: [
          { heading: "## Context for Implementer", body: "live" },
          { heading: "## Context for QA", body: "not for implementer" },
          { heading: "## measurement", body: "audit only" },
        ],
      })],
    });
    const configPath = `${sandbox}/pipeline.config.json`;
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.handoffs_dir = "pipeline/handoffs";
    writeFileSync(configPath, JSON.stringify(config));

    const result = run(sandbox, "task-package.mjs", ["i-t1", "implementer"]);
    assert.equal(result.status, 0, result.output);
    const body = JSON.parse(readFileSync(join(sandbox, result.stdout.trim()), "utf8"));
    assert.equal(body.role, "implementer");
    assert.equal(body.record.contexts.length, 1);
    assert.equal(body.record.contexts[0].body, "live");
    assert.match(body.prompt, /implementer\.md$/);
    assert.ok(body.record_hash);
  });

  test("carry the authoritative Sudocode record when the binding is current", () => {
    sandbox = createSandbox();
    enableIssueTracker(sandbox, { issues: [trackerIssue()] });
    const configPath = `${sandbox}/pipeline.config.json`;
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.handoffs_dir = "pipeline/handoffs";
    writeFileSync(configPath, JSON.stringify(config));
    const snapshot = readIssueTracker(config, sandbox);
    writeStore(sandbox, "issues", [issue({ tracker: trackerBinding(snapshot.issues[0]) })]);

    const result = run(sandbox, "task-package.mjs", ["i-t1", "implementer"]);
    assert.equal(result.status, 0, result.output);
    const body = JSON.parse(readFileSync(join(sandbox, result.stdout.trim()), "utf8"));
    assert.equal(body.tracker_record.id, "i-t1");
    assert.equal(body.tracker_record.content, "Implement the bounded issue.");
  });

  test("refuses stale Sudocode scope and unsynchronized status", () => {
    sandbox = createSandbox();
    enableIssueTracker(sandbox, { issues: [trackerIssue()] });
    const configPath = `${sandbox}/pipeline.config.json`;
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.handoffs_dir = "pipeline/handoffs";
    writeFileSync(configPath, JSON.stringify(config));
    const snapshot = readIssueTracker(config, sandbox);
    writeStore(sandbox, "issues", [issue({ tracker: trackerBinding(snapshot.issues[0]) })]);

    enableIssueTracker(sandbox, { issues: [trackerIssue({ content: "Changed scope." })] });
    let result = run(sandbox, "task-package.mjs", ["i-t1", "implementer"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /tracker binding scope/);

    enableIssueTracker(sandbox, { issues: [trackerIssue({ status: "blocked" })] });
    const refreshed = readIssueTracker(config, sandbox);
    writeStore(sandbox, "issues", [issue({ tracker: trackerBinding(refreshed.issues[0]) })]);
    result = run(sandbox, "task-package.mjs", ["i-t1", "implementer"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /run tracker-sync --apply/);
  });
});
