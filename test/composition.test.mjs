import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
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
 * Builds a proposal round, renders it, then submits it to the validator.
 *
 * The rendering is not a setup detail: every proposal must present the page
 * the operator read. Declaring a fake path would make this suite pass by
 * switching off the gate it goes through.
 *
 * @param overrides - fields to merge into the base round
 * @returns the validator's execution result
 */
function round(overrides) {
  sandbox ??= createSandbox();
  const handoff = {
    schema_version: 1,
    produced_at: "2026-08-21T09:00:00.000Z",
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
  const source = writeJson(sandbox, "source.json", handoff);
  const page = join(sandbox, "page.html");
  const rendered = run(sandbox, "render-proposal.mjs", [source, page]);
  assert.equal(rendered.status, 0, rendered.output);
  const submitted = { ...handoff, review_page: { path: page } };
  return run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", submitted)]);
}

const ONE = { round_reviewed: 1, summary: "une reponse", decided: [{ id: "N1" }] };
const TWO = { round_reviewed: 1, summary: "deux reponses", decided: [{ id: "N2" }, { id: "N5" }] };

describe("validate-handoff: two answers are confronted with each other", () => {
  test("requires nothing of a round answering a single decision", () => {
    const result = round({ operator_feedback: ONE });
    assert.equal(result.status, 0, result.output);
  });

  test("refuses a round answering two decisions with no composition check", () => {
    const result = round({ operator_feedback: TWO });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /answers_composition_check missing/);
  });

  test("refuses a check claim with no named pair", () => {
    const result = round({
      operator_feedback: TWO,
      answers_composition_check: { pairs_checked: [], conflicts_found: [] },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /pairs_checked empty/);
  });

  test("accepts a check that names its pairs", () => {
    const result = round({
      operator_feedback: TWO,
      answers_composition_check: {
        pairs_checked: [{ pair: ["N2", "N5"], composes: true, note: "aucune donnee commune" }],
        conflicts_found: [],
      },
    });
    assert.equal(result.status, 0, result.output);
  });

  test("refuses a pair whose verdict is not a boolean", () => {
    const result = round({
      operator_feedback: TWO,
      answers_composition_check: {
        pairs_checked: [{ pair: ["N2", "N5"], composes: "oui" }],
        conflicts_found: [],
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /composes must be/);
  });

  test("refuses a non-composing pair with no note: it would be lost", () => {
    const result = round({
      operator_feedback: TWO,
      answers_composition_check: {
        pairs_checked: [{ pair: ["N2", "N5"], composes: false }],
        conflicts_found: ["N2 et N5"],
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /carries its reason/);
  });

  test("accepts a declared conflict with its reason: the real 2026-08-17 case", () => {
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

  test("refuses a missing conflicts_found: an absence of conflict is declared", () => {
    const result = round({
      operator_feedback: TWO,
      answers_composition_check: { pairs_checked: [{ pair: ["N2", "N5"], composes: true }] },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /conflicts_found missing/);
  });
});
