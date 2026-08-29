import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, run } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Prepares a sandbox carrying a complete profile and its tools.
 *
 * @param overrides - fields to merge into the configuration
 * @returns the sandbox root
 */
function withProfile(overrides = {}) {
  const root = createSandbox();
  const config = JSON.parse(readFileSync(join(root, "pipeline.config.json"), "utf8"));
  config.profile = "api-demo";
  config.commands = {
    check: "true",
    lint: "true",
    build: "true",
    test_unit: "true",
    audit: "true",
    secrets_scan: "true",
    project_map: "true",
    design_limits: "eslint --config eslint.design.config.mjs .",
    smoke: "true",
  };
  config.project_map = { out: "docs/map.md", roots: ["src"], skip: ["dist"] };
  config.doc_policy = { roots: ["src"] };
  config.comment_policy = { roots: ["src"] };
  config.architecture = { id: "feature-modules", project_type: "backend" };
  writeFileSync(join(root, "pipeline.config.json"), JSON.stringify({ ...config, ...overrides }, null, 2));

  const profile = join(root, "agent-pipeline", "profiles", "api-demo");
  mkdirSync(join(profile, "skills", "demo-module"), { recursive: true });
  writeFileSync(join(profile, "invariants.md"), "- The clock is injected.\n");
  writeFileSync(join(profile, "skills", "demo-module", "SKILL.md"), "# demo\n");
  writeFileSync(join(root, "eslint.design.config.mjs"), "export default [];\n");
  return root;
}

/**
 * Reads back an exported bundle's manifest.
 *
 * @param bundle - the bundle's directory
 * @returns the parsed manifest
 */
function manifest(bundle) {
  return JSON.parse(readFileSync(join(bundle, "profile.json"), "utf8"));
}

describe("export-profile: what a profile has to carry to be reusable", () => {
  test("carries the stack half of the configuration, not the project half", () => {
    sandbox = withProfile();
    const bundle = join(sandbox, "bundle");
    const result = run(sandbox, "export-profile.mjs", [bundle]);
    assert.equal(result.status, 0, result.output);

    const carried = manifest(bundle);
    assert.equal(carried.commands.design_limits, "eslint --config eslint.design.config.mjs .");
    assert.deepEqual(carried.project_map.roots, ["src"]);
    assert.ok(carried.doc_policy, "doc_policy is stack-shaped: it names the roots a generator walks");
    assert.ok(carried.file_policy.implementer, "the paths a role may write follow the stack layout");

    assert.equal(carried.store_dir, undefined, "the store is where this project keeps its state, not a stack trait");
    assert.equal(carried.ci, undefined, "the forge belongs to the repository, not to the stack");
    assert.equal(carried.architecture?.id, undefined, "the layout is decided per project, and render-architecture exists for that");
  });

  test("carries the invariants and the profile skills", () => {
    sandbox = withProfile();
    const bundle = join(sandbox, "bundle");
    run(sandbox, "export-profile.mjs", [bundle]);
    assert.match(readFileSync(join(bundle, "invariants.md"), "utf8"), /clock is injected/);
    assert.ok(existsSync(join(bundle, "skills", "demo-module", "SKILL.md")));
  });

  test("carries the tool files a command names, because a command without them does not run", () => {
    sandbox = withProfile();
    const bundle = join(sandbox, "bundle");
    const result = run(sandbox, "export-profile.mjs", [bundle]);
    assert.ok(
      existsSync(join(bundle, "tooling", "eslint.design.config.mjs")),
      "design_limits names this file: exporting the command without it exports a command that fails",
    );
    assert.match(result.output, /eslint\.design\.config\.mjs/);
  });

  test("declares the thresholds it carries as calibrated elsewhere", () => {
    sandbox = withProfile();
    const bundle = join(sandbox, "bundle");
    run(sandbox, "export-profile.mjs", [bundle]);
    assert.equal(
      manifest(bundle).calibration_required,
      true,
      "thresholds were measured on another codebase; importing them as if they were measured here is the whole trap",
    );
  });

  test("refuses to export a profile that does not exist", () => {
    sandbox = withProfile({ profile: "ghost" });
    const result = run(sandbox, "export-profile.mjs", [join(sandbox, "bundle")]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /ghost/);
  });
});

describe("import-profile: installing a profile without silently overwriting", () => {
  /**
   * Exports a bundle then returns a blank root ready to import it.
   *
   * @returns the exported bundle and the host root
   */
  function exported() {
    sandbox = withProfile();
    const bundle = join(sandbox, "bundle");
    const result = run(sandbox, "export-profile.mjs", [bundle]);
    assert.equal(result.status, 0, result.output);
    const host = join(sandbox, "host");
    mkdirSync(join(host, "agent-pipeline"), { recursive: true });
    return { bundle, host };
  }

  test("seeds the profile directory in a project that has none", () => {
    const { bundle, host } = exported();
    const result = run(sandbox, "import-profile.mjs", [bundle, host]);
    assert.equal(result.status, 0, result.output);
    assert.ok(existsSync(join(host, "pipeline", "profiles", "api-demo", "invariants.md")));
    assert.ok(existsSync(join(host, "pipeline", "profiles", "api-demo", "skills", "demo-module", "SKILL.md")));
  });

  test("writes the configuration only when the project has none", () => {
    const { bundle, host } = exported();
    run(sandbox, "import-profile.mjs", [bundle, host]);
    const written = JSON.parse(readFileSync(join(host, "pipeline.config.json"), "utf8"));
    assert.equal(written.commands.design_limits, "eslint --config eslint.design.config.mjs .");
    assert.equal(written.profile, "api-demo");
  });

  test("the framework's own gates survive the bundle's, and the reverse", () => {
    // The template carries the gates the core provides, the bundle the ones
    // the stack provides. Merging object against object dropped one of the
    // two without a word — the imported project came out with no dead_code.
    const { bundle, host } = exported();
    run(sandbox, "import-profile.mjs", [bundle, host]);
    const written = JSON.parse(readFileSync(join(host, "pipeline.config.json"), "utf8"));
    assert.match(written.commands.dead_code ?? "", /dead-code/, "the gate the framework ships was lost");
    assert.equal(written.commands.design_limits, "eslint --config eslint.design.config.mjs .");
  });

  test("refuses to touch a configuration that already exists, and prints what to merge", () => {
    const { bundle, host } = exported();
    writeFileSync(join(host, "pipeline.config.json"), JSON.stringify({ profile: "mine", commands: { check: "mine" } }));
    const result = run(sandbox, "import-profile.mjs", [bundle, host]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /pipeline\.config\.json/);
    assert.match(result.output, /"design_limits"/, "refusing without showing what to merge leaves the operator to guess");
    const kept = JSON.parse(readFileSync(join(host, "pipeline.config.json"), "utf8"));
    assert.equal(kept.commands.check, "mine", "the operator owns this file: it is never rewritten");
  });

  test("never overwrites a tool file the project already has", () => {
    const { bundle, host } = exported();
    writeFileSync(join(host, "eslint.design.config.mjs"), "// tuned here\n");
    run(sandbox, "import-profile.mjs", [bundle, host]);
    assert.match(readFileSync(join(host, "eslint.design.config.mjs"), "utf8"), /tuned here/);
  });

  test("says out loud that the thresholds are not calibrated for this project", () => {
    const { bundle, host } = exported();
    const result = run(sandbox, "import-profile.mjs", [bundle, host]);
    assert.match(result.output, /calibrat/i);
  });
});

describe("apply-profile: an imported profile is not usable until it is calibrated", () => {
  test("refuses to run while calibration_required is still set", () => {
    sandbox = withProfile();
    const dir = join(sandbox, "agent-pipeline", "profiles", "api-demo");
    writeFileSync(join(dir, "profile.json"), JSON.stringify({ calibration_required: true }));
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /calibration_required/);
    assert.match(
      result.output,
      /another codebase|measured here|elsewhere/i,
      "the refusal says why, or it reads as a formality to switch off",
    );
  });

  test("runs once the calibration has been claimed", () => {
    sandbox = withProfile();
    const dir = join(sandbox, "agent-pipeline", "profiles", "api-demo");
    writeFileSync(join(dir, "profile.json"), JSON.stringify({ calibration_required: false }));
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.doesNotMatch(result.output, /calibration_required/, "the gate must be satisfiable, or it gets deleted");
  });

  test("says nothing about calibration for a profile written in place", () => {
    sandbox = withProfile();
    rmSync(join(sandbox, "agent-pipeline", "profiles", "api-demo", "profile.json"), { force: true });
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.doesNotMatch(result.output, /calibration/, "a profile nobody imported has nothing to recalibrate");
  });
});
