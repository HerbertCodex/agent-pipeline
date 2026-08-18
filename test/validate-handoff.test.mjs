import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createSandbox, destroySandbox, writeJson, run } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

const BASE = {
  schema_version: 1,
  agent: "product",
  scope: { spec_id: "s-t1" },
  basis: { record_hash: "abc" },
  outcome: "awaiting_operator_decision",
};

const SCOPE = {
  features: [{ name: "Emprunter", user_value: "un membre repart avec un livre", rules: ["un exemplaire sorti ne se prete pas deux fois"] }],
  out_of_scope: ["reservation"],
};

const DECISION = { question: "duree de pret ?", product_recommendation: "14 jours", alternatives: ["21 jours"] };

/**
 * Ecrit un handoff dans le bac a sable et lance le validateur dessus.
 *
 * @param overrides - champs a fusionner dans le handoff de base
 * @returns le resultat d'execution du validateur
 */
function validate(overrides) {
  sandbox ??= createSandbox();
  const path = writeJson(sandbox, "handoff.json", { ...BASE, ...overrides });
  return run(sandbox, "validate-handoff.mjs", [path]);
}

describe("validate-handoff : une proposition soumet des choix", () => {
  test("accepte une proposition complete", () => {
    const result = validate({ mode: "spec_proposal", round: 1, functional_scope: SCOPE, decisions_for_operator: [DECISION] });
    assert.equal(result.status, 0, result.output);
  });

  test("refuse une proposition sans functional_scope", () => {
    const result = validate({ mode: "spec_proposal", round: 1, decisions_for_operator: [DECISION] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /functional_scope manquant/);
  });

  test("refuse une fonctionnalite sans regle metier", () => {
    const scope = { features: [{ name: "X", user_value: "y", rules: [] }], out_of_scope: [] };
    const result = validate({ mode: "spec_proposal", round: 1, functional_scope: scope, decisions_for_operator: [DECISION] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /rules vide/);
  });

  test("refuse un out_of_scope absent : ce qu'on ne fait pas se dit", () => {
    const scope = { features: SCOPE.features };
    const result = validate({ mode: "spec_proposal", round: 1, functional_scope: scope, decisions_for_operator: [DECISION] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /out_of_scope manquant/);
  });

  test("refuse une decision sans alternative", () => {
    const decision = { ...DECISION, alternatives: [] };
    const result = validate({ mode: "spec_proposal", round: 1, functional_scope: SCOPE, decisions_for_operator: [decision] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /alternatives vide/);
  });

  test("refuse une proposition qui porte deja des issues", () => {
    const result = validate({
      mode: "spec_proposal",
      round: 1,
      functional_scope: SCOPE,
      decisions_for_operator: [DECISION],
      issues: [{ id: "i-1" }],
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /ne porte pas d'issues/);
  });
});

describe("validate-handoff : un tour dit ce qu'on lui a demande", () => {
  test("refuse un round absent", () => {
    const result = validate({ mode: "spec_proposal", functional_scope: SCOPE, decisions_for_operator: [DECISION] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /round manquant/);
  });

  test("refuse un tour 2 sans operator_feedback", () => {
    const result = validate({ mode: "spec_proposal", round: 2, functional_scope: SCOPE, decisions_for_operator: [DECISION] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /sans operator_feedback/);
  });

  test("accepte un tour 2 qui dit ce qui a change", () => {
    const result = validate({
      mode: "spec_proposal",
      round: 2,
      functional_scope: SCOPE,
      decisions_for_operator: [DECISION],
      operator_feedback: { round_reviewed: 1, summary: "duree portee a 21 jours" },
    });
    assert.equal(result.status, 0, result.output);
  });
});

describe("validate-handoff : un tour sans question se declare", () => {
  test("refuse une liste vide non declaree", () => {
    const result = validate({ mode: "spec_proposal", round: 1, functional_scope: SCOPE, decisions_for_operator: [] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /scope_final/);
  });

  test("accepte une liste vide accompagnee de scope_final", () => {
    const result = validate({
      mode: "spec_proposal",
      round: 1,
      functional_scope: SCOPE,
      decisions_for_operator: [],
      scope_final: true,
    });
    assert.equal(result.status, 0, result.output);
  });

  test("refuse le champ absent meme avec scope_final : le silence se dit", () => {
    const result = validate({ mode: "spec_proposal", round: 1, functional_scope: SCOPE, scope_final: true });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /decisions_for_operator manquant/);
  });
});

describe("validate-handoff : un plan derive d'une proposition approuvee", () => {
  /**
   * Ecrit une proposition sur disque et rend son chemin avec son empreinte.
   *
   * @param body - contenu du fichier de proposition
   * @returns le chemin absolu et le sha256 de son contenu exact
   */
  function approved(body = { perimetre: "approuve" }) {
    sandbox ??= createSandbox();
    const path = join(sandbox, "proposition.json");
    writeFileSync(path, JSON.stringify(body));
    return { path, digest: createHash("sha256").update(readFileSync(path, "utf8"), "utf8").digest("hex") };
  }

  test("refuse un plan sans approved_proposal", () => {
    const result = validate({ mode: "spec_plan" });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /approved_proposal manquant/);
  });

  test("accepte un plan dont l'empreinte correspond au fichier", () => {
    const { path, digest } = approved();
    const result = validate({
      mode: "spec_plan",
      approved_proposal: { path, digest_sha256: digest, approved_at: "2026-08-17", round: 5 },
    });
    assert.equal(result.status, 0, result.output);
  });

  test("refuse une empreinte inventee", () => {
    const { path } = approved();
    const result = validate({
      mode: "spec_plan",
      approved_proposal: { path, digest_sha256: "0".repeat(64), approved_at: "2026-08-17", round: 5 },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /ne correspond pas au contenu/);
  });

  test("refuse une proposition introuvable", () => {
    const result = validate({
      mode: "spec_plan",
      approved_proposal: { path: "/absent.json", digest_sha256: "0".repeat(64), approved_at: "x", round: 1 },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /introuvable/);
  });

  test("refuse un plan derive d'une proposition modifiee APRES l'approbation", () => {
    const { path, digest } = approved({ duree: "14 jours" });
    writeFileSync(path, JSON.stringify({ duree: "30 jours" }));
    const result = validate({
      mode: "spec_plan",
      approved_proposal: { path, digest_sha256: digest, approved_at: "2026-08-17", round: 5 },
    });
    assert.notEqual(result.status, 0, "on ne fait pas approuver 14 jours pour en planifier 30");
    assert.match(result.output, /ne correspond pas au contenu/);
  });

  test("refuse un plan sans le tour approuve", () => {
    const { path, digest } = approved();
    const result = validate({
      mode: "spec_plan",
      approved_proposal: { path, digest_sha256: digest, approved_at: "2026-08-17" },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /round manquant/);
  });
});

describe("validate-handoff : transitions et preuve de rouge", () => {
  const ISSUE_BASE = {
    schema_version: 1,
    agent: "implementer",
    scope: { spec_id: "s-t1", issue_id: "i-t1" },
    basis: { record_hash: "abc", pipeline_version: 1 },
    outcome: "ready_for_qa",
    mode: "issue_handoff",
    context: { heading: "## Context for QA", body: "corps" },
    evidence: { commands: [], files: [], commit_sha: null, notes: [] },
  };

  test("refuse une transition interdite", () => {
    sandbox ??= createSandbox();
    const path = writeJson(sandbox, "h.json", {
      ...ISSUE_BASE,
      requested_transition: { from: "planned", to: "closed" },
    });
    const result = run(sandbox, "validate-handoff.mjs", [path]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /transition interdite/);
  });

  test("refuse une preuve de rouge sortie a zero", () => {
    sandbox ??= createSandbox();
    const path = writeJson(sandbox, "h.json", {
      ...ISSUE_BASE,
      requested_transition: { from: "in_progress", to: "ready_for_qa" },
      evidence: {
        ...ISSUE_BASE.evidence,
        red_proof: { cmd: "jest", exit: 0, observed_before_implementation: true, test_commit_sha: "abc" },
      },
    });
    const result = run(sandbox, "validate-handoff.mjs", [path]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /n'a jamais ete rouge/);
  });

  test("refuse un chemin hors de la politique du role", () => {
    sandbox ??= createSandbox();
    const path = writeJson(sandbox, "h.json", {
      ...ISSUE_BASE,
      requested_transition: { from: "in_progress", to: "ready_for_qa" },
      evidence: {
        commands: [],
        files: ["package.json"],
        commit_sha: "abc1234",
        notes: [],
        red_proof: { cmd: "jest", exit: 1, observed_before_implementation: true, test_commit_sha: "abc" },
      },
    });
    const result = run(sandbox, "validate-handoff.mjs", [path]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /hors role/);
  });

  test("refuse une decouverte sans motif", () => {
    sandbox ??= createSandbox();
    const path = writeJson(sandbox, "h.json", {
      ...ISSUE_BASE,
      requested_transition: { from: "in_progress", to: "ready_for_qa" },
      evidence: {
        ...ISSUE_BASE.evidence,
        red_proof: { cmd: "jest", exit: 1, observed_before_implementation: true, test_commit_sha: "abc" },
      },
      discoveries: [{ title: "une trouvaille" }],
    });
    const result = run(sandbox, "validate-handoff.mjs", [path]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /rationale manquant/);
  });
});
