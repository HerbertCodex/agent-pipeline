import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, destroySandbox, writeJson, run, readRecord, recordHash, issue, state } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Prepare un bac a sable portant une seule issue et rend de quoi l'ecrire.
 *
 * @param overrides - champs a remplacer dans l'issue par defaut
 * @returns le bac a sable, l'identifiant et le hash de verrou courant
 */
function withIssue(overrides = {}) {
  const record = issue(overrides);
  sandbox = createSandbox({ issues: [record] });
  return { root: sandbox, id: record.id, hash: recordHash(sandbox, "issues", record.id) };
}

describe("store-update: optimistic lock", () => {
  test("refuses a stale hash without writing anything", () => {
    const { root, id } = withIssue();
    const before = readRecord(root, "issues", id);
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
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
    assert.match(result.output, /deja present/);
  });
});
