import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, run, seedFramework } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Sets an architecture and, optionally, a design system.
 *
 * @param projectType - declared project type
 * @param design - design_system block, or null to omit it
 * @returns the sandbox root
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
    smoke: "true",
  };
  const layout = { backend: "feature-modules", frontend: "feature-sliced", mobile: "mvvm", fullstack: "feature-modules" };
  config.architecture = { id: layout[projectType] ?? "feature-modules", project_type: projectType };
  if (design != null) config.design_system = design;
  writeFileSync(path, JSON.stringify(config, null, 2));
  return root;
}

/**
 * Reads back the page produced by the renderer.
 *
 * @param root - sandbox root
 * @param args - arguments passed to the script
 * @returns the execution result and the HTML produced
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
    sandbox = withProject("frontend", { tokens: "src/tokens.css", primitives: "own", library: null, decided_at: "2026-08-18", direction: { genre: "editorial", because: "long-form reading, the type does the work" } });
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

/**
 * Declares the accessibility command a project with screens must carry.
 *
 * @param root - sandbox root
 */
function withAccessibility(root) {
  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.commands.accessibility = "true";
  writeFileSync(path, JSON.stringify(config, null, 2));
}

describe("apply-profile: a skill can name the project types it applies to", () => {
  /**
   * Writes a core skill carrying an optional `applies_to` line.
   *
   * @param root - sandbox root
   * @param name - skill directory name
   * @param appliesTo - value of the frontmatter line, or null to omit it
   */
  function writeSkill(root, name, appliesTo) {
    const dir = join(root, "agent-pipeline", "skills", name);
    mkdirSync(dir, { recursive: true });
    const header = appliesTo == null ? "" : `applies_to: ${appliesTo}\n`;
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: x\n${header}---\n\nbody\n`);
  }

  const DESIGN = { tokens: "src/tokens.css", primitives: "own", decided_at: "2026-08-19", direction: { genre: "editorial", because: "long-form reading, the type does the work" } };

  test("wants a screen skill installed on a frontend project", () => {
    sandbox = withProject("frontend", DESIGN);
    seedFramework(sandbox);
    withAccessibility(sandbox);
    writeSkill(sandbox, "ui-design", "frontend, mobile, fullstack");
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.match(result.output, /skills\/ui-design/);
  });

  test("leaves it out of a back-end project, which has no screen", () => {
    sandbox = withProject("backend");
    seedFramework(sandbox);
    writeSkill(sandbox, "ui-design", "frontend, mobile, fullstack");
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.doesNotMatch(
      result.output,
      /skills\/ui-design/,
      "advice about screens dropped into a service that has none is not inert: an agent reads it and follows it",
    );
  });

  test("leaves out every file of a skipped skill, not only its SKILL.md", () => {
    sandbox = withProject("backend");
    seedFramework(sandbox);
    writeSkill(sandbox, "ui-design", "frontend");
    writeFileSync(join(sandbox, "agent-pipeline", "skills", "ui-design", "layout.md"), "x\n");
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.doesNotMatch(result.output, /ui-design/);
  });

  test("a skill that names no type is wanted everywhere, as before", () => {
    sandbox = withProject("backend");
    seedFramework(sandbox);
    writeSkill(sandbox, "always", null);
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.match(result.output, /skills\/always/);
  });

  test("refuses a project type no skill could ever match", () => {
    sandbox = withProject("backend");
    seedFramework(sandbox);
    writeSkill(sandbox, "ui-design", "frontend, embarque");
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /embarque/, "a typo in applies_to silently hides a skill forever");
  });
});

describe("apply-profile: a project with screens is checked for accessibility", () => {
  const DESIGN = { tokens: "src/tokens.css", primitives: "own", decided_at: "2026-08-19", direction: { genre: "editorial", because: "long-form reading, the type does the work" } };

  test("refuses a frontend project that declares no accessibility command", () => {
    sandbox = withProject("frontend", DESIGN);
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /commands\.accessibility/);
    assert.match(
      result.output,
      /measur|contrast|number/i,
      "the refusal says why this one is a command and the rest of the design advice is not",
    );
  });

  test("asks nothing of a back-end project", () => {
    sandbox = withProject("backend");
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.doesNotMatch(result.output, /commands\.accessibility/);
  });

  test("accepts any tool, as with every other command", () => {
    sandbox = withProject("frontend", DESIGN);
    const path = join(sandbox, "pipeline.config.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.commands.accessibility = "axe --exit";
    writeFileSync(path, JSON.stringify(config, null, 2));
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.doesNotMatch(result.output, /accessibility/, "the core does not judge the tool, only the presence of the key");
  });
});

describe("apply-profile: the visual direction is written down, not remembered", () => {
  test("refuses a screen project that names no visual direction", () => {
    sandbox = withProject("frontend", { tokens: "src/tokens.css", primitives: "own", decided_at: "2026-08-19" });
    withAccessibility(sandbox);
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /design_system\.direction/);
    assert.match(
      result.output,
      /converge|same|resemble/i,
      "the refusal says what the silence costs across projects, not only that a key is missing",
    );
  });

  test("accepts a direction that carries its justification", () => {
    sandbox = withProject("frontend", {
      tokens: "src/tokens.css",
      primitives: "own",
      decided_at: "2026-08-19",
      direction: { genre: "editorial", because: "the product is long-form reading, and the type does the work" },
    });
    withAccessibility(sandbox);
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.doesNotMatch(result.output, /design_system\.direction/);
  });

  test("refuses a direction asserted without a reason", () => {
    sandbox = withProject("frontend", {
      tokens: "src/tokens.css",
      primitives: "own",
      decided_at: "2026-08-19",
      direction: { genre: "premium dark" },
    });
    withAccessibility(sandbox);
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /because/);
  });

  test("asks nothing of a back-end project", () => {
    sandbox = withProject("backend");
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.doesNotMatch(result.output, /direction/);
  });
});
