import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { createSandbox, destroySandbox, writeStore, writeJson, run } from "./harness.mjs";

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

describe("the mockup is asked for when the spec is planned, not when the screen is written", () => {
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

describe("the issue that draws the mockup carries it, and that is not circular", () => {
  test("a mockup page the diff creates is accepted", () => {
    // Read off a real run: the issue whose whole job was to draw the mockup
    // carried it in its diff, alongside a route to display it. An earlier rule
    // refused any mockup the diff carried, on the grounds that the code would
    // be verified against itself — and it refused exactly the behaviour the
    // framework asks for. What it was really catching is a SOURCE FILE used as
    // a mockup, which the form check catches without the false positive.
    sandbox = withScreens();
    mkdirSync(join(sandbox, "src", "mockups"), { recursive: true });
    writeFileSync(join(sandbox, "src", "mockups", "mois.html"), '<div style="color: var(--ink)">x</div>');
    const body = handover(["src/mockups/mois.html", "src/routes/maquettes/+page.svelte"], {
      path: "src/mockups/mois.html",
    });
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
    assert.equal(result.status, 0, result.output);
  });

  test("a component used as a mockup is still refused, diff or no diff", () => {
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
    assert.match(result.output, /html|page/i);
  });

  test("a mockup the diff does not carry is accepted", () => {
    sandbox = withScreens();
    writeFileSync(join(sandbox, "maquette.html"), '<div style="color: var(--ink)">x</div>');
    const body = handover(["src/pages/x/+page.svelte"], { path: "maquette.html" });
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
    assert.equal(result.status, 0, result.output);
  });
});

describe("a mockup is a page you open, not a component you compile", () => {
  test("a source file is refused as a mockup, whatever it contains", () => {
    // The framework never renders a mockup — a drawing has no source, and a
    // script producing one would be inventing it. But it said nothing about
    // the form, so a real run pointed the field at a `.svelte` component and
    // the check read it happily. Every other decision reaches the operator as
    // a page that opens on its own; the one artefact they most need to LOOK at
    // had no such convention.
    sandbox = withScreens();
    writeFileSync(join(sandbox, "src", "Row.svelte"), '<div style="color: var(--ink)">x</div>');
    const body = handover(["src/pages/x/+page.svelte"], { path: "src/Row.svelte" });
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Row\.svelte/);
    assert.match(result.output, /html|page/i);
  });

  test("an HTML page is what the field is for", () => {
    sandbox = withScreens();
    writeFileSync(join(sandbox, "maquette.html"), '<div style="color: var(--ink)">x</div>');
    const body = handover(["src/pages/x/+page.svelte"], { path: "maquette.html" });
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
    assert.equal(result.status, 0, result.output);
  });

  test("the plan is held to the same form", () => {
    sandbox = withScreens();
    writeFileSync(join(sandbox, "src", "Row.svelte"), "<div>x</div>");
    const result = plan(["src/pages/x/+page.svelte"], { path: "src/Row.svelte" });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /html|page/i);
  });
});

describe("the mockup belongs to the spec, and an issue points at it", () => {
  /**
   * Records a spec carrying the given mockups.
   *
   * @param mockups - the paths the spec declared
   */
  function specDeclares(mockups) {
    writeStore(sandbox, "specs", [
      { id: "s-t1", title: "une spec", spec_state: { phase: "active" }, mockups },
    ]);
  }

  test("an issue may not invent a mockup of its own", () => {
    // The risk of asking each handoff: issues cut by component get one drawing
    // each, and five drawings that never compose are not a design. The whole
    // belongs to the spec — the operator sees it once, before the first screen
    // exists, and the issues run against it.
    sandbox = withScreens();
    specDeclares(["src/mockups/mois.html"]);
    mkdirSync(join(sandbox, "src", "mockups"), { recursive: true });
    writeFileSync(join(sandbox, "src", "mockups", "mois.html"), '<div style="color: var(--ink)">x</div>');
    writeFileSync(join(sandbox, "src", "mockups", "bouton.html"), '<div style="color: var(--ink)">y</div>');
    const body = handover(["src/pages/x/+page.svelte"], { path: "src/mockups/bouton.html" });
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /bouton\.html/);
    assert.match(result.output, /s-t1|spec/);
  });

  test("two issues pointing at the same declared mockup both pass", () => {
    // What a real run did on its own: one screen, five states, two issues
    // referring to it. The rule makes that the only shape available.
    sandbox = withScreens();
    specDeclares(["src/mockups/mois.html"]);
    mkdirSync(join(sandbox, "src", "mockups"), { recursive: true });
    writeFileSync(join(sandbox, "src", "mockups", "mois.html"), '<div style="color: var(--ink)">x</div>');
    for (const screen of ["src/pages/a/+page.svelte", "src/pages/b/+page.svelte"]) {
      const body = handover([screen], { path: "src/mockups/mois.html" });
      const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
      assert.equal(result.status, 0, result.output);
    }
  });

  test("a spec with several screens declares several", () => {
    sandbox = withScreens();
    specDeclares(["src/mockups/mois.html", "src/mockups/reglages.html"]);
    mkdirSync(join(sandbox, "src", "mockups"), { recursive: true });
    for (const name of ["mois.html", "reglages.html"]) {
      writeFileSync(join(sandbox, "src", "mockups", name), '<div style="color: var(--ink)">x</div>');
    }
    const body = handover(["src/pages/x/+page.svelte"], { path: "src/mockups/reglages.html" });
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
    assert.equal(result.status, 0, result.output);
  });

  test("a spec that declared none is not held to a list it never made", () => {
    // Specs planned before the rule carry nothing. Refusing them would rewrite
    // history rather than describe it, which this repository refuses elsewhere.
    sandbox = withScreens();
    writeStore(sandbox, "specs", [{ id: "s-t1", title: "une spec", spec_state: { phase: "active" } }]);
    writeFileSync(join(sandbox, "maquette.html"), '<div style="color: var(--ink)">x</div>');
    const body = handover(["src/pages/x/+page.svelte"], { path: "maquette.html" });
    const result = run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", body)]);
    assert.equal(result.status, 0, result.output);
  });

  test("a plan may declare several mockups at once", () => {
    sandbox = withScreens();
    mkdirSync(join(sandbox, "src", "mockups"), { recursive: true });
    for (const name of ["mois.html", "reglages.html"]) {
      writeFileSync(join(sandbox, "src", "mockups", name), '<div style="color: var(--ink)">x</div>');
    }
    const result = plan(["src/pages/x/+page.svelte"], {
      paths: ["src/mockups/mois.html", "src/mockups/reglages.html"],
    });
    assert.equal(result.status, 0, result.output);
  });

  test("a plan naming several, one of which is a component, is refused", () => {
    sandbox = withScreens();
    mkdirSync(join(sandbox, "src", "mockups"), { recursive: true });
    writeFileSync(join(sandbox, "src", "mockups", "mois.html"), "<div>x</div>");
    writeFileSync(join(sandbox, "src", "Row.svelte"), "<div>y</div>");
    const result = plan(["src/pages/x/+page.svelte"], {
      paths: ["src/mockups/mois.html", "src/Row.svelte"],
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Row\.svelte/);
  });
});
