import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createSandbox,
  destroySandbox,
  enableIssueTracker,
  writeJson,
  run,
  readRecord,
  recordHash,
  issue,
  state,
  trackerIssue,
  writeStore,
} from "./harness.mjs";
import { readIssueTracker, trackerBinding } from "../scripts/issue-tracker.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Prepares a sandbox carrying one issue and returns what is needed to write it.
 *
 * @param overrides - fields to replace in the default issue
 * @returns the sandbox, the identifier and the current lock hash
 */
function withIssue(overrides = {}) {
  const record = issue(overrides);
  sandbox = createSandbox({ issues: [record] });
  return { root: sandbox, id: record.id, hash: recordHash(sandbox, "issues", record.id) };
}

describe("store-update: optimistic lock", () => {
  test("refuses a concurrent writer before reading and leaves the store untouched", () => {
    const { root, id, hash } = withIssue();
    const before = readRecord(root, "issues", id);
    const lock = join(root, "pipeline", "store", ".store-update.lock");
    writeFileSync(lock, "another writer\n");
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      set_status: "changed",
    });
    const result = run(root, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /store writer busy/);
    assert.deepEqual(readRecord(root, "issues", id), before);
    assert.equal(existsSync(lock), true, "a process must not remove a lock it did not acquire");
  });

  test("successful replacement is atomic and cleans its lock and temporary siblings", () => {
    const { root, id, hash } = withIssue();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      set_status: "changed",
    });
    assert.equal(run(root, "store-update.mjs", [request]).status, 0);
    const leftovers = readdirSync(join(root, "pipeline", "store")).filter(
      (name) => name.includes(".lock") || name.includes(".tmp-"),
    );
    assert.deepEqual(leftovers, []);
  });

  test("refuses a stale hash without writing anything", () => {
    const { root, id } = withIssue();
    const before = readRecord(root, "issues", id);
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      started_at: "2026-08-20T08:00:00.000Z",
      ended_at: "2026-08-20T08:30:00.000Z",
      expected_record_hash: "0".repeat(64),
      pipeline_state: state({ phase: "in_progress", owner: "implementer", version: 2 }),
    });
    const result = run(root, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /optimistic lock/i);
    assert.deepEqual(readRecord(root, "issues", id), before, "le record ne doit pas avoir bouge");
  });

  test("refuses a non-consecutive version", () => {
    const { root, id, hash } = withIssue();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      started_at: "2026-08-20T08:00:00.000Z",
      ended_at: "2026-08-20T08:30:00.000Z",
      expected_record_hash: hash,
      pipeline_state: state({ phase: "in_progress", owner: "implementer", version: 3 }),
    });
    const result = run(root, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /expected version 2/);
  });
});

describe("store-update: transitions confronted with rules.json", () => {
  test("accepts a declared transition", () => {
    const { root, id, hash } = withIssue();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      started_at: "2026-08-20T08:00:00.000Z",
      ended_at: "2026-08-20T08:30:00.000Z",
      expected_record_hash: hash,
      pipeline_state: state({ phase: "in_progress", owner: "implementer", version: 2 }),
    });
    assert.equal(run(root, "store-update.mjs", [request]).status, 0);
    assert.equal(readRecord(root, "issues", id).pipeline_state.phase, "in_progress");
  });

  test("refuses a transition absent from rules.json despite a coherent owner", () => {
    const { root, id, hash } = withIssue();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      started_at: "2026-08-20T08:00:00.000Z",
      ended_at: "2026-08-20T08:30:00.000Z",
      expected_record_hash: hash,
      pipeline_state: state({ phase: "ready_for_qa", owner: "orchestrator", version: 2 }),
    });
    const result = run(root, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0, "planned->ready_for_qa n'est pas dans rules.transitions");
    assert.match(result.output, /transition planned->ready_for_qa absent/);
    assert.equal(readRecord(root, "issues", id).pipeline_state.version, 1);
  });

  test("an unchanged phase is an amendment: the version advances, the journal records nothing", () => {
    const { root, id, hash } = withIssue();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      pipeline_state: state({ version: 2, file_reservations: ["src/y/**"] }),
    });
    assert.equal(run(root, "store-update.mjs", [request]).status, 0);
    const after = readRecord(root, "issues", id);
    assert.equal(after.pipeline_state.version, 2);
    assert.deepEqual(after.pipeline_state.file_reservations, ["src/y/**"]);
    assert.deepEqual(after.transitions ?? [], [], "un amendement ne fabrique pas de mouvement");
  });

  test("a real transition is journalled", () => {
    const { root, id, hash } = withIssue();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      started_at: "2026-08-20T08:00:00.000Z",
      ended_at: "2026-08-20T08:30:00.000Z",
      expected_record_hash: hash,
      pipeline_state: state({ phase: "in_progress", owner: "implementer", version: 2 }),
    });
    run(root, "store-update.mjs", [request]);
    const journal = readRecord(root, "issues", id).transitions;
    assert.equal(journal.length, 1);
    assert.equal(journal[0].from, "planned");
    assert.equal(journal[0].to, "in_progress");
  });
});

describe("store-update: QA rejection budget", () => {
  function withQaIssue(rejections) {
    return withIssue({
      pipeline_state: state({
        phase: "qa_in_progress",
        owner: "qa",
        version: 4,
        qa_code_rejections: rejections,
      }),
    });
  }

  test("a code fault increments once and returns to implementation below the limit", () => {
    const { root, id, hash } = withQaIssue(0);
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      started_at: "2026-08-20T08:00:00.000Z",
      ended_at: "2026-08-20T08:30:00.000Z",
      transition_reason: { fault: "code" },
      pipeline_state: state({
        phase: "in_progress",
        owner: "implementer",
        version: 5,
        qa_code_rejections: 1,
      }),
    });
    assert.equal(run(root, "store-update.mjs", [request]).status, 0);
  });

  test("the third code rejection must escalate and a fourth cycle is impossible", () => {
    const { root, id, hash } = withQaIssue(2);
    const base = {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      started_at: "2026-08-20T08:00:00.000Z",
      ended_at: "2026-08-20T08:30:00.000Z",
      transition_reason: { fault: "code" },
    };
    const returned = writeJson(root, "returned.json", {
      ...base,
      pipeline_state: state({ phase: "in_progress", owner: "implementer", version: 5, qa_code_rejections: 3 }),
    });
    const refusal = run(root, "store-update.mjs", [returned]);
    assert.notEqual(refusal.status, 0);
    assert.match(refusal.output, /must route to operator_escalation/);

    const escalated = writeJson(root, "escalated.json", {
      ...base,
      pipeline_state: state({ phase: "operator_escalation", owner: "operator", version: 5, qa_code_rejections: 3 }),
    });
    assert.equal(run(root, "store-update.mjs", [escalated]).status, 0);
  });

  test("a test fault returns without consuming the code rejection budget", () => {
    const { root, id, hash } = withQaIssue(1);
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      started_at: "2026-08-20T08:00:00.000Z",
      ended_at: "2026-08-20T08:30:00.000Z",
      transition_reason: { fault: "test" },
      pipeline_state: state({ phase: "in_progress", owner: "implementer", version: 5, qa_code_rejections: 1 }),
    });
    assert.equal(run(root, "store-update.mjs", [request]).status, 0);
  });

  test("the counter cannot be edited during an unrelated transition", () => {
    const { root, id, hash } = withIssue();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      started_at: "2026-08-20T08:00:00.000Z",
      ended_at: "2026-08-20T08:30:00.000Z",
      pipeline_state: state({ phase: "in_progress", owner: "implementer", version: 2, qa_code_rejections: 1 }),
    });
    assert.notEqual(run(root, "store-update.mjs", [request]).status, 0);
  });
});

describe("store-update: rewriting the criteria", () => {
  test("replaces the criteria and clears a ledger rendered on the old ones", () => {
    const { root, id, hash } = withIssue({
      criteria_ledger: [
        { index: 0, status: "verified", evidence: "preuve", at: "hier" },
        { index: 1, status: "verified", evidence: "preuve", at: "hier" },
      ],
    });
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      acceptance_criteria: ["1. neuf", "2. neuf", "3. neuf"],
    });
    assert.equal(run(root, "store-update.mjs", [request]).status, 0);
    const after = readRecord(root, "issues", id);
    assert.equal(after.acceptance_criteria.length, 3);
    assert.equal(after.criteria_ledger, null, "un registre etabli contre d'autres criteres n'est pas une preuve");
    assert.equal(after.pipeline_state.version, 1, "reecrire des criteres n'est pas une transition");
  });

  test("refuses an empty criteria list", () => {
    const { root, id, hash } = withIssue();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      acceptance_criteria: [],
    });
    const result = run(root, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /non-empty list|must be a non-empty/);
  });

  test("refuses a criterion that is not a non-empty string", () => {
    const { root, id, hash } = withIssue();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      acceptance_criteria: ["1. bon", "   "],
    });
    assert.notEqual(run(root, "store-update.mjs", [request]).status, 0);
  });
});

describe("store-update: criteria ledger", () => {
  test("refuses a ledger whose length does not match the criteria", () => {
    const { root, id, hash } = withIssue();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      criteria_ledger: [{ status: "verified", evidence: "preuve" }],
    });
    const result = run(root, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0, "l'issue porte deux criteres, le registre une seule entree");
    assert.match(result.output, /ledger of 1 entry/);
  });

  test("refuses a status requiring evidence when the evidence is missing", () => {
    const { root, id, hash } = withIssue();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      criteria_ledger: [{ status: "verified" }, { status: "verified", evidence: "preuve" }],
    });
    assert.notEqual(run(root, "store-update.mjs", [request]).status, 0);
  });
});

describe("store-update: write isolation", () => {
  test("rewrites only the targeted line, byte for byte for the others", () => {
    const other = issue({ id: "i-t2", title: "voisine" });
    const target = issue();
    sandbox = createSandbox({ issues: [target, other] });
    const before = readRecord(sandbox, "issues", "i-t2");
    const request = writeJson(sandbox, "r.json", {
      target: { kind: "issue", id: "i-t1" },
      started_at: "2026-08-20T08:00:00.000Z",
      ended_at: "2026-08-20T08:30:00.000Z",
      expected_record_hash: recordHash(sandbox, "issues", "i-t1"),
      pipeline_state: state({ phase: "in_progress", owner: "implementer", version: 2 }),
    });
    assert.equal(run(sandbox, "store-update.mjs", [request]).status, 0);
    assert.deepEqual(readRecord(sandbox, "issues", "i-t2"), before, "la voisine ne doit pas bouger");
  });

  test("refuses to create an id that already exists", () => {
    const { root } = withIssue();
    const request = writeJson(root, "r.json", {
      create_record: { kind: "issue", record: issue() },
    });
    const result = run(root, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /already present/);
  });
});

describe("store-update: Sudocode source binding", () => {
  test("creates control only for a managed Sudocode issue and records its projection", () => {
    sandbox = createSandbox();
    enableIssueTracker(sandbox, { issues: [trackerIssue({ title: "Source title" })] });
    const request = writeJson(sandbox, "create.json", {
      create_record: { kind: "issue", record: issue({ title: "Stale local title" }) },
    });

    const result = run(sandbox, "store-update.mjs", [request]);
    assert.equal(result.status, 0, result.output);
    const created = readRecord(sandbox, "issues", "i-t1");
    assert.equal(created.title, "Source title");
    assert.equal(created.tracker.provider, "sudocode");
    assert.equal(created.tracker_sync.desired_status, "open");
    assert.equal(Object.hasOwn(created, "status"), false);
  });

  test("refuses a control record with no corresponding Sudocode issue", () => {
    sandbox = createSandbox();
    enableIssueTracker(sandbox);
    const request = writeJson(sandbox, "create.json", {
      create_record: { kind: "issue", record: issue() },
    });
    const result = run(sandbox, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Create it in Sudocode first/);
  });

  test("refreshes planned scope explicitly but requires operator approval after work starts", () => {
    sandbox = createSandbox();
    enableIssueTracker(sandbox, { issues: [trackerIssue()] });
    const config = JSON.parse(readFileSync(join(sandbox, "pipeline.config.json"), "utf8"));
    let snapshot = readIssueTracker(config, sandbox);
    writeStore(sandbox, "issues", [issue({ tracker: trackerBinding(snapshot.issues[0]) })]);
    enableIssueTracker(sandbox, { issues: [trackerIssue({ content: "Planned scope changed." })] });
    let request = writeJson(sandbox, "refresh-planned.json", {
      target: { kind: "issue", id: "i-t1" },
      expected_record_hash: recordHash(sandbox, "issues", "i-t1"),
      refresh_tracker: true,
    });
    assert.equal(run(sandbox, "store-update.mjs", [request]).status, 0);

    enableIssueTracker(sandbox, { issues: [trackerIssue({ status: "in_progress" })] });
    snapshot = readIssueTracker(config, sandbox);
    writeStore(sandbox, "issues", [
      issue({
        pipeline_state: state({ phase: "in_progress", owner: "implementer", version: 2 }),
        tracker: trackerBinding(snapshot.issues[0]),
      }),
    ]);
    enableIssueTracker(sandbox, {
      issues: [trackerIssue({ status: "in_progress", content: "Active scope changed." })],
    });
    request = writeJson(sandbox, "refresh-active.json", {
      target: { kind: "issue", id: "i-t1" },
      expected_record_hash: recordHash(sandbox, "issues", "i-t1"),
      refresh_tracker: true,
    });
    let result = run(sandbox, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /scope_change/);

    request = writeJson(sandbox, "refresh-approved.json", {
      ...JSON.parse(readFileSync(request, "utf8")),
      scope_change: {
        approved_by: "operator",
        reason: "The operator approved the revised contract.",
        approved_at: "2026-08-29T12:00:00.000Z",
      },
    });
    result = run(sandbox, "store-update.mjs", [request]);
    assert.equal(result.status, 0, result.output);
    const refreshed = readRecord(sandbox, "issues", "i-t1");
    assert.equal(refreshed.title, "issue de test");
    assert.equal(refreshed.tracker_scope_changes.at(-1).approved_by, "operator");
    assert.equal(refreshed.tracker_scope_changes.at(-1).reason, "The operator approved the revised contract.");
  });

  test("never attaches existing history to a recycled Sudocode identity", () => {
    sandbox = createSandbox();
    enableIssueTracker(sandbox, { issues: [trackerIssue()] });
    const config = JSON.parse(readFileSync(join(sandbox, "pipeline.config.json"), "utf8"));
    const snapshot = readIssueTracker(config, sandbox);
    writeStore(sandbox, "issues", [issue({ tracker: trackerBinding(snapshot.issues[0]) })]);
    enableIssueTracker(sandbox, {
      issues: [trackerIssue({ uuid: "99999999-9999-4999-8999-999999999999" })],
    });
    const request = writeJson(sandbox, "identity.json", {
      target: { kind: "issue", id: "i-t1" },
      expected_record_hash: recordHash(sandbox, "issues", "i-t1"),
      refresh_tracker: true,
    });
    const result = run(sandbox, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /cannot inherit its history/);
  });
});
