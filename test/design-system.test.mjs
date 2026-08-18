import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, run } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Pose une architecture et, optionnellement, un design system.
 *
 * @param projectType - type de projet declare
 * @param design - bloc design_system, ou null pour l'omettre
 * @returns la racine du bac a sable
 */
function withProject(projectType, design = null) {
  const root = createSandbox();
  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.commands = {
    check: "true",
    lint: "true",
    build: "true",
    test_unit: "true",
    audit: "true",
    secrets_scan: "true",
    project_map: "true",
    design_limits: "true",
    duplication: "true",
  };
  const layout = { backend: "feature-modules", frontend: "feature-sliced", mobile: "mvvm", fullstack: "feature-modules" };
  config.architecture = { id: layout[projectType] ?? "feature-modules", project_type: projectType };
  if (design != null) config.design_system = design;
  writeFileSync(path, JSON.stringify(config, null, 2));
  return root;
}

/**
 * Relit la page produite par le renderer.
 *
 * @param root - racine du bac a sable
 * @param args - arguments passes au script
 * @returns le resultat d'execution et le HTML produit
 */
function render(root, args) {
  const target = join(root, "design.html");
  const result = run(root, "render-design-system.mjs", [target, ...args]);
  let html = "";
  try {
    html = readFileSync(target, "utf8");
  } catch {
    html = "";
  }
  return { ...result, html };
}

describe("render-design-system: what has to be settled before the first screen", () => {
  test("renders the decisions in the order they constrain each other", () => {
    sandbox = withProject("frontend");
    const { status, html } = render(sandbox, ["frontend"]);
    assert.equal(status, 0);
    const page = html.toLowerCase();
    const tokens = page.indexOf("token");
    const primitives = page.indexOf("primitive");
    assert.ok(tokens >= 0 && primitives >= 0, "tokens and primitives are the two layers everything else sits on");
    assert.ok(tokens < primitives, "tokens come first: primitives written before tokens hardcode the values");
  });

  test("says what a mockup drawn too early costs", () => {
    sandbox = withProject("frontend");
    const { html } = render(sandbox, ["frontend"]);
    assert.match(html, /mockup|maquette/i);
  });

  test("offers the honest option of using an existing library", () => {
    sandbox = withProject("frontend");
    const { html } = render(sandbox, ["frontend"]);
    assert.match(html, /existing librar|component librar/i);
    assert.match(html, /accessib/i, "a library that is not accessible is a library to rewrite later");
  });

  test("refuses to render for a project type that has no interface", () => {
    sandbox = withProject("backend");
    const { status, output } = render(sandbox, ["backend"]);
    assert.notEqual(status, 0);
    assert.match(output, /backend/);
  });

  test("refuses an unknown project type instead of rendering everything", () => {
    sandbox = withProject("frontend");
    const { status, output } = render(sandbox, ["embarque"]);
    assert.notEqual(status, 0);
    assert.match(output, /embarque|frontend, mobile/);
  });

  test("escapes what it is given, because an agent may feed it", () => {
    sandbox = withProject("frontend");
    const analysis = join(sandbox, "a.json");
    writeFileSync(analysis, JSON.stringify({ existing_library: "<script>alert(1)</script>" }));
    const { html } = render(sandbox, ["frontend", analysis]);
    assert.doesNotMatch(html, /<script>alert/);
  });
});

describe("apply-profile: an interface project declares its design system", () => {
  test("refuses a frontend project that declares none", () => {
    sandbox = withProject("frontend");
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /design_system/);
    assert.match(
      result.output,
      /first screen|inherit|issue/i,
      "the refusal says what the silence costs, or it reads as one more key to fill",
    );
  });

  test("refuses a mobile project that declares none", () => {
    sandbox = withProject("mobile");
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /design_system/);
  });

  test("asks nothing of a back-end project, which has no screen", () => {
    sandbox = withProject("backend");
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.doesNotMatch(result.output, /design_system/);
  });

  test("accepts a declared system, whatever it names", () => {
    sandbox = withProject("frontend", { tokens: "src/tokens.css", primitives: "own", library: null, decided_at: "2026-08-18" });
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.doesNotMatch(result.output, /design_system/, "the core does not judge the system, only that one is declared");
  });

  test("refuses a declaration that names no source of truth for the tokens", () => {
    sandbox = withProject("frontend", { primitives: "own", decided_at: "2026-08-18" });
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /tokens/);
  });

  test("refuses a declaration that says nothing about the primitives", () => {
    sandbox = withProject("frontend", { tokens: "src/tokens.css", decided_at: "2026-08-18" });
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /primitives/);
  });
});
