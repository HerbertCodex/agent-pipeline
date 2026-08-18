import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, destroySandbox, writeJson, run } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

const SCOPE = {
  features: [{ name: "Emprunter", user_value: "un membre repart avec un livre", rules: ["un exemplaire sorti ne se prete pas deux fois"] }],
  out_of_scope: ["reservation"],
};
const DECISION = { question: "combien ?", product_recommendation: "cinq", alternatives: ["trois"] };

/**
 * Construit un tour de proposition et le soumet au validateur.
 *
 * @param overrides - champs a fusionner dans le tour de base
 * @returns le resultat d'execution du validateur
 */
function round(overrides) {
  sandbox ??= createSandbox();
  const handoff = {
    schema_version: 1,
    mode: "spec_proposal",
    agent: "product",
    scope: { spec_id: "s-t1" },
    basis: { record_hash: "abc" },
    outcome: "awaiting_operator_decision",
    round: 2,
    functional_scope: SCOPE,
    decisions_for_operator: [DECISION],
    ...overrides,
  };
  return run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", handoff)]);
}

const ONE = { round_reviewed: 1, summary: "une reponse", decided: [{ id: "N1" }] };
const TWO = { round_reviewed: 1, summary: "deux reponses", decided: [{ id: "N2" }, { id: "N5" }] };

describe("validate-handoff : deux reponses se confrontent l'une a l'autre", () => {
  test("n'exige rien d'un tour qui ne repond qu'a une decision", () => {
    const result = round({ operator_feedback: ONE });
    assert.equal(result.status, 0, result.output);
  });

  test("refuse un tour repondant a deux decisions sans controle de composition", () => {
    const result = round({ operator_feedback: TWO });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /answers_composition_check manquant/);
  });

  test("refuse une affirmation de controle sans paire nommee", () => {
    const result = round({
      operator_feedback: TWO,
      answers_composition_check: { pairs_checked: [], conflicts_found: [] },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /pairs_checked vide/);
  });

  test("accepte un controle qui nomme ses paires", () => {
    const result = round({
      operator_feedback: TWO,
      answers_composition_check: {
        pairs_checked: [{ pair: ["N2", "N5"], composes: true, note: "aucune donnee commune" }],
        conflicts_found: [],
      },
    });
    assert.equal(result.status, 0, result.output);
  });

  test("refuse une paire dont le verdict n'est pas booleen", () => {
    const result = round({
      operator_feedback: TWO,
      answers_composition_check: {
        pairs_checked: [{ pair: ["N2", "N5"], composes: "oui" }],
        conflicts_found: [],
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /composes doit valoir/);
  });

  test("refuse une paire qui ne compose pas sans motif : elle se perdrait", () => {
    const result = round({
      operator_feedback: TWO,
      answers_composition_check: {
        pairs_checked: [{ pair: ["N2", "N5"], composes: false }],
        conflicts_found: ["N2 et N5"],
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /se motive/);
  });

  test("accepte un conflit declare et motive — le cas reel du 2026-08-17", () => {
    const result = round({
      operator_feedback: TWO,
      answers_composition_check: {
        pairs_checked: [
          {
            pair: ["N2", "N5"],
            composes: false,
            note: "les echeances publiees des deux cotes sont la meme donnee a la milliseconde : on rapproche les deux lectures et les ouvrages caches reapparaissent",
          },
        ],
        conflicts_found: ["N2 x N5 : jointure par echeance"],
      },
    });
    assert.equal(result.status, 0, result.output);
  });

  test("refuse un conflicts_found absent : l'absence de conflit se declare", () => {
    const result = round({
      operator_feedback: TWO,
      answers_composition_check: { pairs_checked: [{ pair: ["N2", "N5"], composes: true }] },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /conflicts_found manquant/);
  });
});
