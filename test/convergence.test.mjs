import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, destroySandbox, writeJson, run, readRecord, recordHash, issue } from "./harness.mjs";
import { collectFindings } from "../scripts/findings.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

function activeSpec(overrides = {}) {
  return {
    id: "s-t1",
    title: "frozen scope",
    issues: ["i-t1"],
    spec_state: { phase: "active" },
    ...overrides,
  };
}

describe("an active spec converges instead of absorbing every finding", () => {
  test("an issue planned before activation can still be materialised", () => {
    sandbox = createSandbox({ specs: [activeSpec()] });
    const request = writeJson(sandbox, "create.json", {
      create_record: { kind: "issue", record: issue({ id: "i-t1" }) },
    });
    assert.equal(run(sandbox, "store-update.mjs", [request]).status, 0);
  });

  test("a discovered issue cannot mechanically expand active scope", () => {
    sandbox = createSandbox({ specs: [activeSpec()] });
    const request = writeJson(sandbox, "create.json", {
      create_record: {
        kind: "issue",
        discovered_from: "i-t1",
        record: issue({ id: "i-new" }),
      },
    });
    const result = run(sandbox, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /active|parked|scope_change/i);
  });

  test("only an explicit operator scope change can add the issue", () => {
    sandbox = createSandbox({ specs: [activeSpec()] });
    const request = writeJson(sandbox, "create.json", {
      create_record: {
        kind: "issue",
        record: issue({ id: "i-new" }),
        scope_change: {
          approved_by: "operator",
          reason: "critical data-loss fix must ship in this increment",
          approved_at: "2026-08-28T12:00:00.000Z",
        },
      },
    });
    assert.equal(run(sandbox, "store-update.mjs", [request]).status, 0);
  });

  test("the planned issue list itself is frozen", () => {
    sandbox = createSandbox({ specs: [activeSpec()] });
    const request = writeJson(sandbox, "update.json", {
      target: { kind: "spec", id: "s-t1" },
      expected_record_hash: recordHash(sandbox, "specs", "s-t1"),
      spec_fields: { issues: ["i-t1", "i-new"] },
    });
    const result = run(sandbox, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /frozen|scope_change/i);
    assert.deepEqual(readRecord(sandbox, "specs", "s-t1").issues, ["i-t1"]);
  });

  test("an ordinary operator request cannot expand a spec already ready for review", () => {
    sandbox = createSandbox({ specs: [activeSpec({ spec_state: { phase: "ready_for_pr" } })] });
    const request = writeJson(sandbox, "update.json", {
      target: { kind: "spec", id: "s-t1" },
      expected_record_hash: recordHash(sandbox, "specs", "s-t1"),
      spec_fields: { issues: ["i-t1", "i-nice-to-have"] },
      scope_change: {
        approved_by: "operator",
        reason: "one more useful feature",
        approved_at: "2026-08-28T12:00:00.000Z",
      },
    });
    const result = run(sandbox, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /delivery_blocker|follow-up spec/i);
  });

  test("an approved delivery blocker may join an unmerged delivery", () => {
    sandbox = createSandbox({ specs: [activeSpec({ spec_state: { phase: "pr_open" } })] });
    const request = writeJson(sandbox, "update.json", {
      target: { kind: "spec", id: "s-t1" },
      expected_record_hash: recordHash(sandbox, "specs", "s-t1"),
      spec_fields: { issues: ["i-t1", "i-blocker"] },
      scope_change: {
        kind: "delivery_blocker",
        approved_by: "operator",
        reason: "the current build loses accepted data",
        approved_at: "2026-08-28T12:00:00.000Z",
      },
    });
    assert.equal(run(sandbox, "store-update.mjs", [request]).status, 0);
    assert.deepEqual(readRecord(sandbox, "specs", "s-t1").issues, ["i-t1", "i-blocker"]);
  });

  test("a merged spec is immutable even for a delivery blocker", () => {
    sandbox = createSandbox({ specs: [activeSpec({ spec_state: { phase: "merged" } })] });
    const request = writeJson(sandbox, "update.json", {
      target: { kind: "spec", id: "s-t1" },
      expected_record_hash: recordHash(sandbox, "specs", "s-t1"),
      spec_fields: { issues: ["i-t1", "i-blocker"] },
      scope_change: {
        kind: "delivery_blocker",
        approved_by: "operator",
        reason: "found after merge",
        approved_at: "2026-08-28T12:00:00.000Z",
      },
    });
    const result = run(sandbox, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /immutable|follow-up spec/i);
  });
});

describe("findings remain queryable data rather than scheduled work", () => {
  test("store-update preserves classification and parks an unclassified finding", () => {
    const source = issue();
    sandbox = createSandbox({ issues: [source] });
    const request = writeJson(sandbox, "update.json", {
      target: { kind: "issue", id: source.id },
      expected_record_hash: recordHash(sandbox, "issues", source.id),
      discoveries_declared: [
        { title: "later cleanup", rationale: "not required by the approved criteria" },
        { title: "driver concern", rationale: "belongs to the runtime", lands: "framework", severity: "medium" },
      ],
    });
    assert.equal(run(sandbox, "store-update.mjs", [request]).status, 0);
    const findings = readRecord(sandbox, "issues", source.id).discoveries_declared;
    assert.deepEqual(
      findings.map(({ title, lands, status, severity }) => ({ title, lands, status, severity })),
      [
        { title: "later cleanup", lands: "parking", status: "parked", severity: undefined },
        { title: "driver concern", lands: "framework", status: "parked", severity: "medium" },
      ],
    );
  });

  test("the inbox is a view and excludes triaged entries by default", () => {
    const records = [
      issue({
        id: "i-source",
        discoveries_declared: [
          { title: "park me", rationale: "later", lands: "parking", status: "parked" },
          { title: "already rejected", rationale: "no value", lands: "parking", status: "dismissed" },
        ],
      }),
    ];
    assert.deepEqual(collectFindings(records).map((item) => item.title), ["park me"]);
    assert.equal(collectFindings(records, null, true).length, 2);
  });
});
