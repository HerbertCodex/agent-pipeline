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

describe("store-update : verrou optimiste", () => {
  test("refuse un hash perime sans rien ecrire", () => {
    const { root, id } = withIssue();
    const before = readRecord(root, "issues", id);
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: "0".repeat(64),
      pipeline_state: state({ phase: "in_progress", owner: "implementer", version: 2 }),
    });
    const result = run(root, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /verrou optimiste/);
    assert.deepEqual(readRecord(root, "issues", id), before, "le record ne doit pas avoir bouge");
  });

  test("refuse une version non consecutive", () => {
    const { root, id, hash } = withIssue();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      pipeline_state: state({ phase: "in_progress", owner: "implementer", version: 3 }),
    });
    const result = run(root, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /version attendue 2/);
  });
});

describe("store-update : transitions confrontees a rules.json", () => {
  test("accepte une transition declaree", () => {
    const { root, id, hash } = withIssue();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      pipeline_state: state({ phase: "in_progress", owner: "implementer", version: 2 }),
    });
    assert.equal(run(root, "store-update.mjs", [request]).status, 0);
    assert.equal(readRecord(root, "issues", id).pipeline_state.phase, "in_progress");
  });

  test("refuse une transition absente de rules.json malgre un proprietaire coherent", () => {
    const { root, id, hash } = withIssue();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      pipeline_state: state({ phase: "ready_for_qa", owner: "orchestrator", version: 2 }),
    });
    const result = run(root, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0, "planned->ready_for_qa n'est pas dans rules.transitions");
    assert.match(result.output, /transition planned->ready_for_qa absente/);
    assert.equal(readRecord(root, "issues", id).pipeline_state.version, 1);
  });

  test("une phase inchangee est un amendement : la version avance, le journal n'enregistre rien", () => {
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

  test("une vraie transition est journalisee", () => {
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

describe("store-update : reecriture des criteres", () => {
  test("remplace les criteres et efface un registre etabli contre les anciens", () => {
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

  test("refuse une liste de criteres vide", () => {
    const { root, id, hash } = withIssue();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      acceptance_criteria: [],
    });
    const result = run(root, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /liste non vide/);
  });

  test("refuse un critere qui n'est pas une chaine non vide", () => {
    const { root, id, hash } = withIssue();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      acceptance_criteria: ["1. bon", "   "],
    });
    assert.notEqual(run(root, "store-update.mjs", [request]).status, 0);
  });
});

describe("store-update : registre de criteres", () => {
  test("refuse un registre dont la longueur ne correspond pas aux criteres", () => {
    const { root, id, hash } = withIssue();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      criteria_ledger: [{ status: "verified", evidence: "preuve" }],
    });
    const result = run(root, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0, "l'issue porte deux criteres, le registre une seule entree");
    assert.match(result.output, /registre de 1 entree/);
  });

  test("refuse un statut exigeant une preuve quand la preuve manque", () => {
    const { root, id, hash } = withIssue();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      criteria_ledger: [{ status: "verified" }, { status: "verified", evidence: "preuve" }],
    });
    assert.notEqual(run(root, "store-update.mjs", [request]).status, 0);
  });
});

describe("store-update : isolement des ecritures", () => {
  test("ne reecrit que la ligne visee, octet pour octet pour les autres", () => {
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

  test("refuse de creer un identifiant deja present", () => {
    const { root } = withIssue();
    const request = writeJson(root, "r.json", {
      create_record: { kind: "issue", record: issue() },
    });
    const result = run(root, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /deja present/);
  });
});
