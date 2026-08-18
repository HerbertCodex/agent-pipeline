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

describe("validate-handoff: a proposal submits choices", () => {
  test("accepts a complete proposal", () => {
    const result = validate({ mode: "spec_proposal", round: 1, functional_scope: SCOPE, decisions_for_operator: [DECISION] });
    assert.equal(result.status, 0, result.output);
  });

  test("refuses a proposal with no functional_scope", () => {
    const result = validate({ mode: "spec_proposal", round: 1, decisions_for_operator: [DECISION] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /functional_scope missing/);
  });

  test("refuses a feature with no business rule", () => {
    const scope = { features: [{ name: "X", user_value: "y", rules: [] }], out_of_scope: [] };
    const result = validate({ mode: "spec_proposal", round: 1, functional_scope: scope, decisions_for_operator: [DECISION] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /rules empty/);
  });

  test("refuses a missing out_of_scope: what is not built is stated", () => {
    const scope = { features: SCOPE.features };
    const result = validate({ mode: "spec_proposal", round: 1, functional_scope: scope, decisions_for_operator: [DECISION] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /out_of_scope missing/);
  });

  test("refuses a decision with no alternative", () => {
    const decision = { ...DECISION, alternatives: [] };
    const result = validate({ mode: "spec_proposal", round: 1, functional_scope: SCOPE, decisions_for_operator: [decision] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /alternatives empty/);
  });

  test("refuses a proposal already carrying issues", () => {
    const result = validate({
      mode: "spec_proposal",
      round: 1,
      functional_scope: SCOPE,
      decisions_for_operator: [DECISION],
      issues: [{ id: "i-1" }],
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /carries no issues/);
  });
});

describe("validate-handoff: a round says what it was asked", () => {
  test("refuses a missing round", () => {
    const result = validate({ mode: "spec_proposal", functional_scope: SCOPE, decisions_for_operator: [DECISION] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /round missing/);
  });

  test("refuses a round 2 with no operator_feedback", () => {
    const result = validate({ mode: "spec_proposal", round: 2, functional_scope: SCOPE, decisions_for_operator: [DECISION] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /with no operator_feedback/);
  });

  test("accepts a round 2 that says what changed", () => {
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

describe("validate-handoff: a round with no question declares it", () => {
  test("refuses an undeclared empty list", () => {
    const result = validate({ mode: "spec_proposal", round: 1, functional_scope: SCOPE, decisions_for_operator: [] });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /scope_final/);
  });

  test("accepts an empty list when scope_final is declared", () => {
    const result = validate({
      mode: "spec_proposal",
      round: 1,
      functional_scope: SCOPE,
      decisions_for_operator: [],
      scope_final: true,
    });
    assert.equal(result.status, 0, result.output);
  });

  test("refuses the missing field even with scope_final: silence is stated", () => {
    const result = validate({ mode: "spec_proposal", round: 1, functional_scope: SCOPE, scope_final: true });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /decisions_for_operator missing/);
  });
});

describe("validate-handoff: a plan derived from an approved proposal", () => {
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

  test("refuses a plan with no approved_proposal", () => {
    const result = validate({ mode: "spec_plan" });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /approved_proposal missing/);
  });

  test("accepts a plan whose digest matches the file", () => {
    const { path, digest } = approved();
    const result = validate({
      mode: "spec_plan",
      approved_proposal: { path, digest_sha256: digest, approved_at: "2026-08-17", round: 5 },
    });
    assert.equal(result.status, 0, result.output);
  });

  test("refuses an invented digest", () => {
    const { path } = approved();
    const result = validate({
      mode: "spec_plan",
      approved_proposal: { path, digest_sha256: "0".repeat(64), approved_at: "2026-08-17", round: 5 },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /does not match the content/);
  });

  test("refuses a proposal that does not exist", () => {
    const result = validate({
      mode: "spec_plan",
      approved_proposal: { path: "/absent.json", digest_sha256: "0".repeat(64), approved_at: "x", round: 1 },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /not found/);
  });

  test("refuses a plan derived from a proposal modified AFTER approval", () => {
    const { path, digest } = approved({ duree: "14 jours" });
    writeFileSync(path, JSON.stringify({ duree: "30 jours" }));
    const result = validate({
      mode: "spec_plan",
      approved_proposal: { path, digest_sha256: digest, approved_at: "2026-08-17", round: 5 },
    });
    assert.notEqual(result.status, 0, "on ne fait pas approuver 14 jours pour en planifier 30");
    assert.match(result.output, /does not match the content/);
  });

  test("refuses a plan without the approved round", () => {
    const { path, digest } = approved();
    const result = validate({
      mode: "spec_plan",
      approved_proposal: { path, digest_sha256: digest, approved_at: "2026-08-17" },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /round missing/);
  });
});

describe("validate-handoff: transitions and red proof", () => {
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

  test("refuses a forbidden transition", () => {
    sandbox ??= createSandbox();
    const path = writeJson(sandbox, "h.json", {
      ...ISSUE_BASE,
      requested_transition: { from: "planned", to: "closed" },
    });
    const result = run(sandbox, "validate-handoff.mjs", [path]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /transition interdite/);
  });

  test("refuses a red proof that exited zero", () => {
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
    assert.match(result.output, /was never red/);
  });

  test("refuses a path outside the role policy", () => {
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
    assert.match(result.output, /outside role/);
  });

  test("refuses a discovery with no rationale", () => {
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
    assert.match(result.output, /rationale missing/);
  });
});
