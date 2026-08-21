import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, writeJson, run } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Renders the architecture page for a project type, from an analysis.
 *
 * @param type - the declared project type
 * @param analysis - the analysis drawn from the operator's description
 * @returns the rendered page
 */
function render(type, analysis) {
  sandbox = createSandbox();
  const target = join(sandbox, "a.html");
  const result = run(sandbox, "render-architecture.mjs", [
    target,
    type,
    writeJson(sandbox, "analyse.json", analysis),
  ]);
  assert.equal(result.status, 0, result.output);
  return readFileSync(target, "utf8");
}

/**
 * Finds the section reporting what the project type removed.
 *
 * @param html - the rendered page
 * @returns the heading found, or null
 */
function section(html) {
  return html.match(/<h2>[^<]*(?:cart|removed)[^<]*<\/h2>/i);
}

const SWAPPABLE = {
  business_rules: [{ rule: "une depense au-dela du plafond est refusee" }],
  integrations: [
    { name: "base de donnees", replaceable: true },
    { name: "paiement", replaceable: true },
  ],
  concurrent_workers: "few",
  expected_churn: "rules",
};

describe("an option removed by the project type is named, not dropped in silence", () => {
  test("the page says what the type removed and what the analysis said of it", () => {
    // Observed on a real bootstrap: a project declared `frontend` while its
    // analysis carried a database it expected to replace. Hexagonal — the
    // option that exists for exactly that — was filtered out by the project
    // type and never mentioned. The operator could not tell that their own
    // type declaration was what removed it.
    const html = render("frontend", SWAPPABLE);
    assert.match(html, /Hexagonale|Hexagonal/i, "the removed option is never named");
    assert.match(html, /frontend/);
  });

  test("only a recommendation is a contradiction worth reporting", () => {
    // `possible` is not a contradiction between the two declarations, and
    // listing it would offer MVVM to a back-end service — the catalogue
    // review this page exists to replace.
    const html = render("backend", {
      business_rules: [{ rule: "une depense au-dela du plafond est refusee" }],
      integrations: [{ name: "base", replaceable: true }],
      concurrent_workers: "one",
      expected_churn: "rules",
    });
    assert.ok(!section(html), "a merely possible option was reported as a contradiction");
  });

  test("with no analysis nothing is claimed about the removed options", () => {
    sandbox = createSandbox();
    const target = join(sandbox, "a.html");
    run(sandbox, "render-architecture.mjs", [target, "frontend"]);
    assert.ok(!section(readFileSync(target, "utf8")), "a verdict was implied without an analysis to ground it");
  });

  test("a type that removes nothing recommended says nothing", () => {
    const html = render("backend", {
      business_rules: [],
      integrations: [],
      concurrent_workers: "one",
      expected_churn: "rules",
    });
    assert.ok(!section(html), "a section appeared with nothing to report");
  });
});

describe("a half-written configuration is a step, not a breakage", () => {
  test("apply-profile says where the operator is, not which key is missing", () => {
    // The state observed: a configuration carrying the architecture decision
    // and nothing else — exactly what step 3 produces. The tool answered
    // `missing key "profile"`, which reads as a mistake rather than as the
    // next step.
    sandbox = createSandbox();
    const path = join(sandbox, "pipeline.config.json");
    writeFileSync(
      path,
      JSON.stringify({ architecture: { id: "feature-modules", project_type: "frontend" }, language: "fr" }, null, 2),
    );
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /architecture/i);
    assert.match(
      result.output,
      /nouveau-profil|next step|not configured yet/i,
      "the refusal must point at what to do next, or the operator reads it as a fault",
    );
  });

  test("a configuration carrying no decision at all is still a plain missing key", () => {
    sandbox = createSandbox();
    writeFileSync(join(sandbox, "pipeline.config.json"), JSON.stringify({ language: "fr" }, null, 2));
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /missing key/);
  });
});
