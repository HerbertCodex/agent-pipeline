import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  createTrackerIssue,
  createTrackerSpec,
  ensureTrackerLink,
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
  const specs = [{ id: "SPEC-001", uuid: "spec-uuid", title: "Feature spec", content: "Scope", priority: 1, relationships: [], tags: [] }];
  writeFileSync(
    join(root, ".sudocode", "specs.jsonl"),
    `${specs.map((spec) => JSON.stringify(spec)).join("\n")}\n`,
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
  return { root, config, issues, specs };
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
    const { root, config, issues } = project();
    const calls = [];
    const result = updateTrackerStatus("ISSUE-002", "in_progress", config, {
      cwd: root,
      run(command, args, options) {
        calls.push({ command, args, options });
        if (args.includes("update")) {
          issues[1].status = "in_progress";
          writeFileSync(
            join(root, ".sudocode", "issues.jsonl"),
            `${issues.map((issue) => JSON.stringify(issue)).join("\n")}\n`,
          );
        }
        return { status: 0, stdout: "{}", stderr: "" };
      },
    });

    assert.equal(result.status, 0);
    assert.equal(calls[0].command, "sudocode");
    assert.deepEqual(calls[0].args, ["--json", "issue", "update", "ISSUE-002", "--status", "in_progress"]);
    assert.equal(calls[0].options.shell, false);
    assert.deepEqual(calls[1].args, ["export"]);
  });

  test("recovers an aborted status update only after export proves the persisted status", () => {
    const { root, config, issues } = project();
    const calls = [];
    const result = updateTrackerStatus("ISSUE-002", "in_progress", config, {
      cwd: root,
      run(command, args, options) {
        calls.push({ command, args, options });
        if (args.includes("update")) {
          issues[1].status = "in_progress";
          writeFileSync(
            join(root, ".sudocode", "issues.jsonl"),
            `${issues.map((issue) => JSON.stringify(issue)).join("\n")}\n`,
          );
          return { status: 1, stdout: "", stderr: "aborted after write" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    assert.equal(result.recovered_after_write, true);
    assert.deepEqual(calls.map((call) => call.args), [
      ["--json", "issue", "update", "ISSUE-002", "--status", "in_progress"],
      ["export"],
    ]);
  });

  test("does not create a duplicate relationship when an aborted write is confirmed after export", () => {
    const { root, config, issues } = project();
    const calls = [];
    const result = ensureTrackerLink({ from: "ISSUE-002", to: "ISSUE-001", type: "depends-on" }, config, {
      cwd: root,
      run(command, args, options) {
        calls.push({ command, args, options });
        if (args[0] === "link") {
          issues[1].relationships.push({
            from: "ISSUE-002",
            from_type: "issue",
            to: "ISSUE-001",
            to_type: "issue",
            type: "depends-on",
          });
          writeFileSync(
            join(root, ".sudocode", "issues.jsonl"),
            `${issues.map((issue) => JSON.stringify(issue)).join("\n")}\n`,
          );
          return { status: 1, stdout: "", stderr: "aborted after write" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    assert.equal(result.recovered_after_write, true);
    assert.deepEqual(calls.map((call) => call.args), [
      ["export"],
      ["link", "ISSUE-002", "ISSUE-001", "--type", "depends-on"],
      ["export"],
    ]);
  });

  test("reuses the marker-bound issue instead of issuing a second create", () => {
    const { root, config, issues } = project();
    const calls = [];
    const request = {
      idempotency_key: "spec-a-issue-01",
      title: "Persist loans",
      description: "Store the loan record",
      priority: 1,
      tags: ["backend"],
    };
    const run = (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === "issue" && args[1] === "create") {
        issues.push({
          id: "ISSUE-003",
          uuid: "uuid-3",
          title: request.title,
          content: request.description,
          status: "open",
          priority: request.priority,
          updated_at: "2026-08-03T00:00:00.000Z",
          relationships: [],
          tags: ["backend", "pipeline", "pipeline:mutation:spec-a-issue-01"],
        });
        writeFileSync(
          join(root, ".sudocode", "issues.jsonl"),
          `${issues.map((issue) => JSON.stringify(issue)).join("\n")}\n`,
        );
        return { status: 1, stdout: "", stderr: "aborted after write" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const created = createTrackerIssue(request, config, { cwd: root, run });
    const repeated = createTrackerIssue(request, config, { cwd: root, run });

    assert.equal(created.entry.record.id, "ISSUE-003");
    assert.equal(created.recovered_after_write, true);
    assert.equal(repeated.skipped, true);
    assert.equal(calls.filter((call) => call.args[0] === "issue").length, 1);
  });

  test("creates a specification through the same idempotent export boundary", () => {
    const { root, config, specs } = project();
    const request = { idempotency_key: "spec-b-record-01", title: "Circulation", description: "Loan rules", priority: 1 };
    const result = createTrackerSpec(request, config, {
      cwd: root,
      run(command, args) {
        if (args[0] === "spec" && args[1] === "create") {
          specs.push({
            id: "SPEC-002",
            uuid: "spec-uuid-2",
            title: request.title,
            content: request.description,
            priority: request.priority,
            relationships: [],
            tags: ["pipeline:mutation:spec-b-record-01"],
          });
          writeFileSync(
            join(root, ".sudocode", "specs.jsonl"),
            `${specs.map((spec) => JSON.stringify(spec)).join("\n")}\n`,
          );
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    assert.equal(result.entry.record.id, "SPEC-002");
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

test("the operator guide names the missing Sudocode unlink capability without authorizing JSONL edits", () => {
  const guide = readFileSync(new URL("../docs/operateur.md", import.meta.url), "utf8");
  assert.match(guide, /cannot remove a relation/i);
  assert.match(guide, /Do not edit.*JSONL/i);
});
