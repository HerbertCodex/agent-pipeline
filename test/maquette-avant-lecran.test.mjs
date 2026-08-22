import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { createSandbox, destroySandbox, writeJson, run } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Prepares a project with screens and a token sheet.
 *
 * @returns the sandbox root
 */
function withScreens() {
  const root = createSandbox();
  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.architecture = { id: "feature-sliced", project_type: "frontend" };
  config.design_system = { tokens: "src/tokens.css", primitives: "own", decided_at: "2026-08-22" };
  config.commands = Object.fromEntries(
    ["check", "lint", "build", "test_unit", "audit", "secrets_scan", "project_map", "design_limits", "duplication", "smoke"]
      .map((key) => [key, "true"]),
  );
  writeFileSync(path, JSON.stringify(config, null, 2));
  const sheet = join(root, "src", "tokens.css");
  mkdirSync(dirname(sheet), { recursive: true });
  writeFileSync(sheet, ":root {\n  --ink: #16161a;\n  --step-2: 8px;\n}\n");
  return root;
}

/**
 * Builds an implementer handoff touching the given files.
 *
 * @param files - what the diff carries
 * @param mockup - the mockup block declared
 * @returns the handoff body
 */
function handover(files, mockup) {
  return {
    schema_version: 1,
    produced_at: "2026-08-21T09:00:00.000Z",
    mode: "issue_handoff",
    agent: "implementer",
    scope: { spec_id: "s-t1", issue_id: "i-t1" },
    basis: { record_hash: "abc", pipeline_version: 1 },
    outcome: "ready_for_qa",
    requested_transition: { from: "in_progress", to: "ready_for_qa" },
    context: { heading: "## Context for QA", body: "corps" },
    untested_surface: "rien",
    mockup,
    claims_to_replay: [{ claim: "les portes sortent en 0", how_to_replay: "node --test" }],
    evidence: {
      commands: ["check", "lint", "build", "test_unit", "audit", "secrets_scan", "project_map", "design_limits", "duplication", "smoke"]
        .map((key) => ({ key, cmd: "true", exit: 0 })),
      files,
      commit_sha: "abc1234",
      notes: [],
      red_proof: { cmd: "node --test", exit: 1, observed_before_implementation: true, test_commit_sha: "def" },
    },
  };
}

describe("an exemption is a claim about the diff, and the diff can be read", () => {
  test("an issue shipping a screen cannot exempt itself from the mockup", () => {
    // Observed on a real run: no mockup was ever produced, and the screens
    // were built anyway. The requirement lands on the implementer, at the last
    // possible moment, where the only affordable answer is the escape — and
    // nothing confronted the escape with what the diff actually carried.
    sandbox = withScreens();
    const body = handover(
      ["src/pages/depenses/+page.svelte"],
      { not_applicable: "Aucun ecran : l'issue porte sur une fonction du domaine." },
    );
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /\+page\.svelte/);
    assert.match(result.output, /not_applicable/);
  });

  test("an issue touching no screen keeps the exemption", () => {
    sandbox = withScreens();
    const body = handover(
      ["src/lib/depenses/alerts.ts"],
      { not_applicable: "Aucun ecran : l'issue porte sur une fonction du domaine." },
    );
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
    assert.equal(result.status, 0, result.output);
  });

  test("a screen with a mockup behind it passes", () => {
    sandbox = withScreens();
    writeFileSync(join(sandbox, "maquette.html"), '<div style="color: var(--ink); padding: var(--step-2)">x</div>');
    const body = handover(["src/pages/depenses/+page.svelte"], { path: "maquette.html" });
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
    assert.equal(result.status, 0, result.output);
  });

  test("the screen shapes of several ecosystems are recognised", () => {
    sandbox = withScreens();
    for (const file of ["src/ui/Card.tsx", "src/views/Home.vue", "src/pages/index.jsx"]) {
      const body = handover([file], { not_applicable: "aucun ecran" });
      const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
      assert.notEqual(result.status, 0, `${file} passed as if it were not a screen`);
    }
  });
});

describe("the mockup is asked for when the spec is planned, not when the screen is written", () => {
  /**
   * Submits a plan whose issues reserve the given files.
   *
   * @param reservations - what the single issue reserves
   * @param mockup - the mockup block the plan declares
   * @returns validate-handoff's result
   */
  function plan(reservations, mockup) {
    const approved = join(sandbox, "approved.md");
    const body = "# scope\n";
    writeFileSync(approved, body);
    return run(sandbox, "validate-handoff.mjs", [
      writeJson(sandbox, "h.json", {
        schema_version: 1,
        produced_at: "2026-08-21T09:00:00.000Z",
        mode: "spec_plan",
        agent: "product",
        scope: { spec_id: "s-0001" },
        basis: { record_hash: "abc", pipeline_version: 1 },
        outcome: "plan_ready",
        context: { heading: "## Context for orchestrator", body: "x" },
        approved_proposal: {
          digest_sha256: createHash("sha256").update(body).digest("hex"),
          approved_at: "2026-08-21",
          round: 1,
          path: "approved.md",
        },
        ...(mockup === undefined ? {} : { mockup }),
        issues: [
          {
            id: "i-0001",
            title: "une issue",
            acceptance_criteria: ["1. [unit] l ecran affiche le total"],
            file_reservations: reservations,
          },
        ],
      }),
    ]);
  }

  test("a plan carrying a screen issue and no mockup is refused", () => {
    // Asking the implementer is asking too late: at that point the only cheap
    // answer is the escape. Product is the one who can still have a mockup
    // drawn, and the operator is the one who should see it before the screens
    // exist.
    sandbox = withScreens();
    const result = plan(["src/pages/depenses/+page.svelte"], undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /mockup/);
    assert.match(result.output, /i-0001/);
  });

  test("a plan touching no screen owes none", () => {
    sandbox = withScreens();
    const result = plan(["src/lib/alerts.ts"], undefined);
    assert.equal(result.status, 0, result.output);
  });

  test("a plan that names its mockup passes", () => {
    sandbox = withScreens();
    writeFileSync(join(sandbox, "maquette.html"), '<div style="color: var(--ink)">x</div>');
    const result = plan(["src/pages/depenses/+page.svelte"], { path: "maquette.html" });
    assert.equal(result.status, 0, result.output);
  });

  test("a plan naming a mockup that does not exist is refused", () => {
    sandbox = withScreens();
    const result = plan(["src/pages/depenses/+page.svelte"], { path: "absente.html" });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /absente\.html/);
  });
});

describe("a mockup that is the code is not a mockup", () => {
  test("pointing the field at a file the diff created is refused", () => {
    // Reported by a real agent about its own run: it declared the mockup
    // path pointing at the component it had just written. The check passed,
    // because the component does reference the tokens — and it became
    // circular, the code verified against itself. In its own words, it went
    // straight to the screens.
    sandbox = withScreens();
    writeFileSync(join(sandbox, "src", "ExpenseRow.svelte"), '<div style="color: var(--ink)">x</div>');
    const body = handover(["src/ExpenseRow.svelte"], { path: "src/ExpenseRow.svelte" });
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /ExpenseRow/);
    assert.match(result.output, /circular|itself|elle-meme|its own/i);
  });

  test("a mockup the diff does not carry is accepted", () => {
    sandbox = withScreens();
    writeFileSync(join(sandbox, "maquette.html"), '<div style="color: var(--ink)">x</div>');
    const body = handover(["src/pages/x/+page.svelte"], { path: "maquette.html" });
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
    assert.equal(result.status, 0, result.output);
  });
});
