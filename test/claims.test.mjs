import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, destroySandbox, writeJson, run, readRecord, recordHash, issue } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

const CLAIM = { claim: "verify-scope : 8 fichiers, exit 0", how_to_replay: "verify-scope.mjs <handoff> <base>" };

const IMPL = {
  schema_version: 1,
  agent: "implementer",
  scope: { spec_id: "s-t1", issue_id: "i-t1" },
  basis: { record_hash: "abc", pipeline_version: 1 },
  outcome: "ready_for_qa",
  mode: "issue_handoff",
  requested_transition: { from: "in_progress", to: "ready_for_qa" },
  context: { heading: "## Context for QA", body: "corps" },
  evidence: {
    commands: [],
    files: ["src/x.ts"],
    commit_sha: "abc1234",
    notes: [],
    red_proof: { cmd: "jest", exit: 1, observed_before_implementation: true, test_commit_sha: "def" },
  },
};

const QA_CLOSURE = {
  schema_version: 1,
  agent: "qa",
  scope: { spec_id: "s-t1", issue_id: "i-t1" },
  basis: { record_hash: "abc", pipeline_version: 1 },
  outcome: "closed",
  mode: "issue_handoff",
  requested_transition: { from: "qa_in_progress", to: "closed" },
  evidence: { commands: [], files: [], commit_sha: null, notes: [] },
  criteria_ledger: [
    { status: "verified", evidence: "mesure" },
    { status: "verified", evidence: "mesure" },
  ],
};

/**
 * Ecrit un handoff dans le bac a sable et lance le validateur dessus.
 *
 * @param handoff - contenu du handoff
 * @returns le resultat d'execution du validateur
 */
function validate(handoff) {
  sandbox ??= createSandbox();
  return run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", handoff)]);
}

describe("validate-handoff : un implementer enumere ce qu'il affirme", () => {
  test("refuse un handoff porteur d'un commit sans claims_to_replay", () => {
    const result = validate(IMPL);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /claims_to_replay vide/);
  });

  test("accepte un handoff qui enumere ses affirmations", () => {
    const result = validate({ ...IMPL, claims_to_replay: [CLAIM] });
    assert.equal(result.status, 0, result.output);
  });

  test("refuse une affirmation sans mode de rejeu", () => {
    const result = validate({ ...IMPL, claims_to_replay: [{ claim: "j'ai tout verifie" }] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /how_to_replay manquant/);
  });

  test("n'exige rien d'un handoff sans commit : il n'affirme aucune mesure", () => {
    const result = validate({
      ...IMPL,
      outcome: "blocked_product",
      requested_transition: { from: "in_progress", to: "blocked_product" },
      evidence: { commands: [], files: [], commit_sha: null, notes: [] },
    });
    assert.equal(result.status, 0, result.output);
  });
});

describe("validate-handoff : une cloture confronte au lieu de croire", () => {
  test("refuse une cloture sans verdict sur les affirmations", () => {
    const result = validate(QA_CLOSURE);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /claims_verdict vide/);
  });

  test("refuse une affirmation declaree mais non rejouee", () => {
    const result = validate({
      ...QA_CLOSURE,
      claims_verdict: [{ claim: CLAIM.claim, replayed: false, result: "cru sur parole" }],
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /non rejoue/);
  });

  test("refuse un rejeu sans resultat", () => {
    const result = validate({ ...QA_CLOSURE, claims_verdict: [{ claim: CLAIM.claim, replayed: true }] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /result manquant/);
  });

  test("accepte une cloture dont chaque affirmation est rejouee", () => {
    const result = validate({
      ...QA_CLOSURE,
      claims_verdict: [{ claim: CLAIM.claim, replayed: true, result: "confirme : 8 fichiers, exit 0" }],
    });
    assert.equal(result.status, 0, result.output);
  });
});

describe("store-update : le verdict se compte contre les affirmations", () => {
  /**
   * Prepare une issue portant deja des affirmations a rejouer.
   *
   * @returns le bac a sable, l'identifiant et le hash de verrou courant
   */
  function withClaims() {
    const record = issue({ claims_to_replay: [CLAIM, { claim: "10 mutations", how_to_replay: "les rejouer" }] });
    sandbox = createSandbox({ issues: [record] });
    return { root: sandbox, id: record.id, hash: recordHash(sandbox, "issues", record.id) };
  }

  test("refuse un verdict dont la longueur ne correspond pas", () => {
    const { root, id, hash } = withClaims();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      claims_verdict: [{ claim: CLAIM.claim, replayed: true, result: "ok" }],
    });
    const result = run(root, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /verdict de 1 entree\(s\) pour 2 affirmation\(s\)/);
  });

  test("refuse un verdict portant une affirmation non rejouee", () => {
    const { root, id, hash } = withClaims();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      claims_verdict: [
        { claim: CLAIM.claim, replayed: true, result: "ok" },
        { claim: "10 mutations", replayed: false, result: "cru" },
      ],
    });
    assert.notEqual(run(root, "store-update.mjs", [request]).status, 0);
  });

  test("persiste un verdict complet", () => {
    const { root, id, hash } = withClaims();
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      claims_verdict: [
        { claim: CLAIM.claim, replayed: true, result: "confirme" },
        { claim: "10 mutations", replayed: true, result: "8 tuees, 2 survivantes" },
      ],
    });
    assert.equal(run(root, "store-update.mjs", [request]).status, 0);
    const after = readRecord(root, "issues", id);
    assert.equal(after.claims_verdict.length, 2);
    assert.equal(after.claims_verdict[1].result, "8 tuees, 2 survivantes");
  });

  test("reecrire les affirmations efface un verdict etabli contre les anciennes", () => {
    const { root, id, hash } = withClaims();
    const first = writeJson(root, "r1.json", {
      target: { kind: "issue", id },
      expected_record_hash: hash,
      claims_verdict: [
        { claim: CLAIM.claim, replayed: true, result: "ok" },
        { claim: "10 mutations", replayed: true, result: "ok" },
      ],
    });
    run(root, "store-update.mjs", [first]);
    const second = writeJson(root, "r2.json", {
      target: { kind: "issue", id },
      expected_record_hash: recordHash(root, "issues", id),
      claims_to_replay: [{ claim: "affirmation neuve", how_to_replay: "la rejouer" }],
    });
    assert.equal(run(root, "store-update.mjs", [second]).status, 0);
    const after = readRecord(root, "issues", id);
    assert.equal(after.claims_to_replay.length, 1);
    assert.equal(after.claims_verdict, null, "un verdict rendu sur d'autres affirmations n'en est pas un sur celles-la");
  });
});
