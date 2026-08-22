import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, writeJson, run } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

const CANDIDATE = {
  name: "zod",
  version: "3.23.8",
  does: "valide une charge utile entrante contre un schema declare",
  license: "MIT",
  weight: { transitive_dependencies: 0, install_size_kb: 720 },
  maintenance: { last_release: "2026-05-02", open_issues: 84, maintainers: 3 },
  security: { advisories_open: 0, runtime_privileges: ["none"], audited_on: "2026-08-18" },
};

const ASSESSMENT = {
  schema_version: 1,
  produced_at: "2026-08-21T09:00:00.000Z",
  mode: "dependency_assessment",
  agent: "implementer",
  scope: { spec_id: "s-0001", issue_id: "i-0004" },
  basis: { record_hash: "abc", pipeline_version: 2 },
  outcome: "blocked_dependency",
  requested_transition: { from: "in_progress", to: "blocked_dependency" },
  context: { heading: "## Context for Product (DEPENDENCY)", body: "x" },
  need: "refuser une charge utile HTTP mal formee avant qu'elle atteigne le domaine",
  hand_rolled_cost: "environ 180 lignes de verification de types, sur une surface d'entree publique",
  candidates: [CANDIDATE],
  recommendation: { choice: "zod", why: "surface d'entree publique : une validation ecrite a la main est un risque de securite" },
  alternatives_rejected: [{ name: "ecrire a la main", why: "surface de securite, et 180 lignes a maintenir" }],
};

/**
 * Renders an assessment as a review page inside the sandbox.
 *
 * @param handoff - assessment to render
 * @param name - base name of the files produced
 * @returns the path of the page produced
 */
function renderPage(handoff, name = "page") {
  const source = writeJson(sandbox, `${name}.json`, handoff);
  const target = join(sandbox, `${name}.html`);
  const result = run(sandbox, "render-dependency.mjs", [source, target]);
  assert.equal(result.status, 0, result.output);
  return target;
}

/**
 * Submits an assessment to the validator.
 *
 * @param overrides - fields to merge
 * @param page - path of the page to declare, or null
 * @returns validate-handoff's result
 */
function validate(overrides = {}, page = undefined) {
  sandbox ??= createSandbox();
  const handoff = { ...ASSESSMENT, ...overrides };
  const submitted = page === undefined ? handoff : { ...handoff, review_page: { path: page } };
  return run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "handoff.json", submitted)]);
}

describe("render-dependency: the page an operator decides on", () => {
  test("renders the need, the cost of writing it, and the candidate", () => {
    sandbox = createSandbox();
    const html = readFileSync(renderPage(ASSESSMENT), "utf8");
    assert.match(html, /charge utile HTTP mal formee/);
    assert.match(html, /180 lignes/);
    assert.match(html, /zod/);
    assert.match(html, /3\.23\.8/);
  });

  test("shows the security assessment, not only the feature list", () => {
    sandbox = createSandbox();
    const html = readFileSync(renderPage(ASSESSMENT), "utf8");
    assert.match(html, /MIT/, "a license is a legal decision the operator takes, not the agent");
    assert.match(html, /advisor/i);
    assert.match(html, /privilege|runtime/i);
  });

  test("shows what was rejected, because a silent rejection is the whole problem", () => {
    sandbox = createSandbox();
    const html = readFileSync(renderPage(ASSESSMENT), "utf8");
    assert.match(html, /ecrire a la main/);
    assert.match(html, /180 lignes a maintenir/);
  });

  test("escapes the content, because an agent writes it", () => {
    sandbox = createSandbox();
    const hostile = { ...ASSESSMENT, need: "<script>alert('x')</script>" };
    const html = readFileSync(renderPage(hostile, "hostile"), "utf8");
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;/);
  });

  test("carries the digest of what it displays", () => {
    sandbox = createSandbox();
    const html = readFileSync(renderPage(ASSESSMENT), "utf8");
    assert.match(html, /<meta name="dependency-review-digest" content="[0-9a-f]{64}">/);
  });

  test("refuses any mode that is not an assessment", () => {
    sandbox = createSandbox();
    const source = writeJson(sandbox, "other.json", { mode: "issue_handoff" });
    const result = run(sandbox, "render-dependency.mjs", [source, join(sandbox, "o.html")]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /dependency_assessment/);
  });
});

describe("validate-handoff: a dependency is not requested, it is argued", () => {
  test("refuses a request that carries no candidate", () => {
    const result = validate({ candidates: [] }, null);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /candidates/);
  });

  test("refuses a candidate with no license", () => {
    const { license, ...noLicense } = CANDIDATE;
    void license;
    const result = validate({ candidates: [noLicense] }, null);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /license/);
  });

  test("refuses a candidate with no security assessment", () => {
    const { security, ...noSecurity } = CANDIDATE;
    void security;
    const result = validate({ candidates: [noSecurity] }, null);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /security/);
  });

  test("refuses a candidate with no maintenance signal", () => {
    const { maintenance, ...stale } = CANDIDATE;
    void maintenance;
    const result = validate({ candidates: [stale] }, null);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /maintenance/);
  });

  test("refuses a request that never says what writing it would cost", () => {
    // The field is cleared explicitly: spreading it from an amputated copy
    // would restore it, the original being spread first.
    const result = validate({ hand_rolled_cost: undefined }, null);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /hand_rolled_cost/);
  });

  test("refuses a request with nothing rejected, because something always was", () => {
    const result = validate({ alternatives_rejected: [] }, null);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /alternatives_rejected/);
  });

  test("refuses a request nobody rendered for the operator", () => {
    const result = validate({}, null);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /review_page/);
  });

  test("refuses a page rendered before the assessment changed", () => {
    sandbox ??= createSandbox();
    const stale = renderPage(ASSESSMENT, "stale");
    const result = validate({ recommendation: { choice: "valibot", why: "plus leger" } }, stale);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /review_page/);
  });

  test("accepts a complete assessment rendered from itself", () => {
    sandbox ??= createSandbox();
    const page = renderPage(ASSESSMENT, "fresh");
    const result = validate({}, page);
    assert.equal(result.status, 0, result.output);
  });

  test("says nothing about dependencies for a handoff that requests none", () => {
    sandbox ??= createSandbox();
    const result = run(
      sandbox,
      "validate-handoff.mjs",
      [
        writeJson(sandbox, "plain.json", {
          schema_version: 1,
          produced_at: "2026-08-21T09:00:00.000Z",
          mode: "issue_handoff",
          agent: "implementer",
          scope: { spec_id: "s-1", issue_id: "i-1" },
          basis: { record_hash: "a", pipeline_version: 1 },
          outcome: "ready_for_qa",
          requested_transition: { from: "in_progress", to: "ready_for_qa" },
          context: { heading: "## Context for QA", body: "x" },
          evidence: { commands: [], files: [], commit_sha: null, notes: [] },
        }),
      ],
    );
    assert.doesNotMatch(result.output, /candidates|hand_rolled_cost/);
  });
});
