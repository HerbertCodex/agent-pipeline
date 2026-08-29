import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  projectedStatus,
  readIssueTracker,
  trackerBinding,
  trackerMatch,
  updateTrackerStatus,
} from "../scripts/issue-tracker.mjs";
import { applyTrackerProjection, trackerProjection } from "../scripts/tracker-sync.mjs";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project() {
  const root = mkdtempSync(join(tmpdir(), "pipeline-sudocode-"));
  roots.push(root);
  mkdirSync(join(root, ".sudocode"));
  const issues = [
    {
      id: "ISSUE-001",
      uuid: "uuid-1",
      title: "Foundation",
      content: "First contract",
      status: "closed",
      priority: 0,
      updated_at: "2026-08-01T00:00:00.000Z",
      relationships: [{ from: "ISSUE-001", from_type: "issue", to: "ISSUE-002", to_type: "issue", type: "blocks" }],
      tags: ["pipeline"],
    },
    {
      id: "ISSUE-002",
      uuid: "uuid-2",
      title: "Feature",
      content: "Second contract",
      status: "open",
      priority: 1,
      updated_at: "2026-08-02T00:00:00.000Z",
      relationships: [],
      tags: ["pipeline"],
    },
  ];
  writeFileSync(
    join(root, ".sudocode", "issues.jsonl"),
    `${issues.map((issue) => JSON.stringify(issue)).join("\n")}\n`,
  );
  writeFileSync(
    join(root, ".sudocode", "specs.jsonl"),
    `${JSON.stringify({ id: "SPEC-001", uuid: "spec-uuid", title: "Feature spec", content: "Scope", priority: 1, relationships: [], tags: [] })}\n`,
  );
  const config = {
    store_dir: "pipeline/store",
    issue_tracker: {
      provider: "sudocode",
      root: ".sudocode",
      command: "sudocode",
      managed_tag: "pipeline",
      status_map: {
        planned: "open",
        in_progress: "in_progress",
        ready_for_qa: "needs_review",
        qa_in_progress: "needs_review",
        closed: "closed",
        "blocked_*": "blocked",
        operator_escalation: "blocked",
      },
    },
  };
  return { root, config, issues };
}

describe("Sudocode issue tracker adapter", () => {
  test("reads the git source and derives dependency direction", () => {
    const { root, config } = project();
    const snapshot = readIssueTracker(config, root);

    assert.equal(snapshot.issues.length, 2);
    assert.equal(snapshot.specs.length, 1);
    assert.deepEqual(snapshot.dependencies.get("ISSUE-002"), ["ISSUE-001"]);
  });

  test("binds scope while ignoring status-only changes", () => {
    const { root, config, issues } = project();
    const before = readIssueTracker(config, root).issues[1];
    const control = { id: "ISSUE-002", tracker: trackerBinding(before) };
    issues[1].status = "in_progress";
    issues[1].updated_at = "2026-08-03T00:00:00.000Z";
    writeFileSync(
      join(root, ".sudocode", "issues.jsonl"),
      `${issues.map((issue) => JSON.stringify(issue)).join("\n")}\n`,
    );

    assert.equal(trackerMatch(control, readIssueTracker(config, root)).drift, null);
    issues[1].uuid = "replacement-uuid";
    writeFileSync(
      join(root, ".sudocode", "issues.jsonl"),
      `${issues.map((issue) => JSON.stringify(issue)).join("\n")}\n`,
    );
    assert.equal(trackerMatch(control, readIssueTracker(config, root)).drift, "identity");
    issues[1].uuid = "uuid-2";
    issues[1].content = "Changed contract";
    writeFileSync(
      join(root, ".sudocode", "issues.jsonl"),
      `${issues.map((issue) => JSON.stringify(issue)).join("\n")}\n`,
    );
    assert.equal(trackerMatch(control, readIssueTracker(config, root)).drift, "scope");
  });

  test("maps every pipeline family to a valid Sudocode status", () => {
    const { config } = project();

    assert.equal(projectedStatus("planned", config), "open");
    assert.equal(projectedStatus("ready_for_qa", config), "needs_review");
    assert.equal(projectedStatus("blocked_dependency", config), "blocked");
  });

  test("refuses to mix Sudocode exports with pipeline control state", () => {
    const { root, config } = project();
    config.store_dir = ".sudocode";
    assert.throws(
      () => readIssueTracker(config, root),
      /must be separate directories/,
    );
  });

  test("updates through an argument vector with no shell", () => {
    const { root, config } = project();
    let invocation = null;
    const result = updateTrackerStatus("ISSUE-002", "in_progress", config, {
      cwd: root,
      run(command, args, options) {
        invocation = { command, args, options };
        return { status: 0, stdout: "{}", stderr: "" };
      },
    });

    assert.equal(result.status, 0);
    assert.equal(invocation.command, "sudocode");
    assert.deepEqual(invocation.args, ["--json", "issue", "update", "ISSUE-002", "--status", "in_progress"]);
    assert.equal(invocation.options.shell, false);
  });

  test("refuses projection until managed work is bound and then exposes only status drift", () => {
    const { root, config } = project();
    config.issue_tracker.managed_tag = "pipeline";
    const snapshot = readIssueTracker(config, root);
    const first = snapshot.issues[0];
    const control = {
      id: "ISSUE-001",
      tracker: trackerBinding(first),
      pipeline_state: { phase: "closed" },
    };

    const incomplete = trackerProjection([control], snapshot, config);
    assert.deepEqual(incomplete.unmanaged, [{ id: "ISSUE-002", title: "Feature" }]);
    assert.deepEqual(
      applyTrackerProjection(incomplete, config, { cwd: root }),
      [],
      "backlog not yet imported must not freeze status synchronization for active work",
    );

    const second = {
      id: "ISSUE-002",
      tracker: trackerBinding(snapshot.issues[1]),
      pipeline_state: { phase: "in_progress" },
    };
    const complete = trackerProjection([control, second], snapshot, config);
    assert.deepEqual(complete.errors, []);
    assert.deepEqual(complete.unmanaged, []);
    assert.deepEqual(complete.pending, [
      { id: "ISSUE-002", current: "open", desired: "in_progress" },
    ]);
  });
});
