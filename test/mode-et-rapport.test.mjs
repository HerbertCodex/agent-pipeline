import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, writeStore, run, issue, state, seedFramework } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Prepares a project whose spec is finished.
 *
 * @param overrides - configuration fields merged in
 * @returns the sandbox root
 */
function finishedSpec(overrides = {}) {
  const root = createSandbox();
  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.language = "fr";
  config.commands = Object.fromEntries(
    ["check", "lint", "build", "test_unit", "audit", "secrets_scan", "project_map", "design_limits", "duplication", "smoke"]
      .map((key) => [key, "true"]),
  );
  config.architecture = { id: "feature-modules", project_type: "backend" };
  config.project_map = { out: "docs/map.md", roots: ["src"], regenerate: "true" };
  config.file_policy = { ...config.file_policy, orchestrator: { allow: ["pipeline/store/**", "docs/map.md"] } };
  writeFileSync(path, JSON.stringify({ ...config, ...overrides }, null, 2));
  seedFramework(root);

  writeStore(root, "specs", [
    { id: "s-0001", title: "Fondations du suivi de depenses", spec_state: { phase: "ready_for_pr" } },
  ]);
  writeStore(root, "issues", [
    issue({
      id: "i-0001",
      spec_id: "s-0001",
      title: "Le plafond refuse une depense qui le depasse",
      pipeline_state: state({ phase: "closed", owner: "none", version: 5, last_commit_sha: "abc1234" }),
      acceptance_criteria: ["1. [unit] une depense au-dela du plafond est refusee"],
      criteria_ledger: [{ index: 0, status: "verified", evidence: "test refuse-plafond, exit 0 sur abc1234" }],
      transitions: [
        {
          from: "planned",
          to: "in_progress",
          started_at: "2026-08-20T08:00:00Z",
          ended_at: "2026-08-20T10:00:00Z",
          at: "2026-08-20T10:30:00Z",
          version: 2,
        },
      ],
      discoveries_declared: [
        { title: "bits-ui laisse fuir deux attributs", lands: "pitfall", line: "bits-ui fuit forcemount." },
        { title: "le magasin ne persiste pas X", lands: "framework" },
        { title: "le cablage n'est prouve par rien", lands: "issue", breaks: "AmountField" },
      ],
      qa_code_rejections: 1,
    }),
    issue({
      id: "i-0002",
      spec_id: "s-0001",
      title: "Une categorie sans plafond n'existe pas",
      pipeline_state: state({ phase: "closed", owner: "none", version: 5 }),
      acceptance_criteria: ["1. [unit] la creation sans plafond est refusee"],
      criteria_ledger: [{ index: 0, status: "verified", evidence: "test sans-plafond" }],
    }),
    issue({ id: "i-0003", spec_id: "s-0002", pipeline_state: state({ phase: "planned" }) }),
  ]);
  return root;
}

describe("a project says once whether it works through the pipeline", () => {
  test("a declared mode is reported, so nobody asks twice", () => {
    // The operator answered the bootstrap questions, and every later session
    // asked the same thing again. The answer is a fact about the project, not
    // a ritual each session repeats.
    sandbox = finishedSpec({ default_mode: "pipeline" });
    const result = run(sandbox, "next-step.mjs", []);
    assert.equal(result.status, 0, result.output);
    assert.doesNotMatch(result.output, /pipeline or direct|pipeline ou direct/i);
  });

  test("apply-profile refuses a mode nobody implements", () => {
    sandbox = finishedSpec({ default_mode: "peut-etre" });
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /peut-etre/);
    assert.match(result.output, /pipeline|direct/);
  });

  test("the rendered CLAUDE.md carries the answer when it is declared", () => {
    sandbox = finishedSpec({ default_mode: "pipeline" });
    const result = run(sandbox, "apply-profile.mjs", []);
    assert.equal(result.status, 0, result.output);
    const claude = readFileSync(join(sandbox, "CLAUDE.md"), "utf8");
    assert.match(claude, /already answered|deja repondu|déjà répondu/i, claude.slice(0, 400));
  });

  test("a project that declared nothing is still asked", () => {
    sandbox = finishedSpec();
    run(sandbox, "apply-profile.mjs", []);
    const claude = readFileSync(join(sandbox, "CLAUDE.md"), "utf8");
    assert.match(claude, /Pipeline or direct/i);
  });
});

describe("a finished spec renders what it did, computed from the store", () => {
  /**
   * Renders the closure report and returns the page.
   *
   * @param root - the sandbox
   * @returns the rendered HTML
   */
  function report(root) {
    const target = join(root, "rapport.html");
    const result = run(root, "render-spec.mjs", [target, "s-0001"]);
    assert.equal(result.status, 0, result.output);
    return readFileSync(target, "utf8");
  }

  test("it names every issue the spec closed, and no other", () => {
    sandbox = finishedSpec();
    const html = report(sandbox);
    assert.match(html, /i-0001/);
    assert.match(html, /i-0002/);
    assert.ok(!html.includes("i-0003"), "an issue of another spec reached the report");
  });

  test("it carries the evidence QA wrote, not a claim about it", () => {
    sandbox = finishedSpec();
    assert.match(report(sandbox), /refuse-plafond/);
  });

  test("what was found along the way is grouped by where it went", () => {
    sandbox = finishedSpec();
    const html = report(sandbox);
    for (const found of ["bits-ui", "le magasin ne persiste pas X", "le cablage"]) {
      assert.match(html, new RegExp(found.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${found} is missing`);
    }
  });

  test("what it cost is read from the journal, never estimated", () => {
    sandbox = finishedSpec();
    const html = report(sandbox);
    assert.match(html, /2 h 00|2 h/, "the agent's turnaround is not reported");
  });

  test("a rejection is reported rather than smoothed over", () => {
    sandbox = finishedSpec();
    assert.match(report(sandbox), /1/);
  });

  test("it refuses a spec that is not finished", () => {
    sandbox = finishedSpec();
    writeStore(sandbox, "specs", [{ id: "s-0001", title: "x", spec_state: { phase: "active" } }]);
    const result = run(sandbox, "render-spec.mjs", [join(sandbox, "r.html"), "s-0001"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /active|not finished|pas terminee/i);
  });
});
