import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { createSandbox, destroySandbox, run } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Prepares a sandbox able to render a token sheet.
 *
 * @param overrides - fields to merge into the configuration
 * @returns the sandbox root
 */
function withDesign(overrides = {}) {
  const root = createSandbox();
  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.architecture = { id: "feature-sliced", project_type: "frontend" };
  config.design_system = {
    tokens: "src/tokens.css",
    primitives: "own",
    decided_at: "2026-08-19",
    direction: { genre: "editorial", because: "long-form reading" },
  };
  writeFileSync(path, JSON.stringify({ ...config, ...overrides }, null, 2));
  const tokens = join(root, "src", "tokens.css");
  mkdirSync(dirname(tokens), { recursive: true });
  writeFileSync(tokens, ":root {\n  --ink: #16161a;\n  --paper: #fffdf8;\n}\n");
  return root;
}

describe("the pages have a home, instead of piling up at the root", () => {
  test("a bare name lands in the configured directory", () => {
    sandbox = withDesign({ pages_dir: "pipeline/pages" });
    const result = run(sandbox, "render-tokens.mjs", ["tokens.html"]);
    assert.equal(result.status, 0, result.output);
    assert.ok(
      existsSync(join(sandbox, "pipeline", "pages", "tokens.html")),
      "a page written where the operator happened to stand accumulates at the root",
    );
    assert.ok(!existsSync(join(sandbox, "tokens.html")));
  });

  test("the output says where the file actually went", () => {
    sandbox = withDesign({ pages_dir: "pipeline/pages" });
    const result = run(sandbox, "render-tokens.mjs", ["tokens.html"]);
    assert.match(
      result.output,
      /pipeline\/pages\/tokens\.html/,
      "a file that moves without saying so is a file the reader looks for in the wrong place",
    );
  });

  test("an explicit path is honoured, wherever it points", () => {
    sandbox = withDesign({ pages_dir: "pipeline/pages" });
    const result = run(sandbox, "render-tokens.mjs", ["./ailleurs/t.html"]);
    assert.equal(result.status, 0, result.output);
    assert.ok(existsSync(join(sandbox, "ailleurs", "t.html")), "naming a path is asking for that path");
  });

  test("a project that declares no directory keeps the old behaviour", () => {
    sandbox = withDesign();
    const result = run(sandbox, "render-tokens.mjs", ["tokens.html"]);
    assert.equal(result.status, 0, result.output);
    assert.ok(existsSync(join(sandbox, "tokens.html")), "an existing project must not have its pages moved under it");
  });

  test("render-architecture still runs before any configuration exists", () => {
    // It is the one page produced before the configuration, since it carries
    // the decision the configuration then records. Adding a page directory
    // broke exactly that, and no test noticed: the first helper wrapped a
    // function that exits the process in a try/catch that could never fire.
    sandbox = createSandbox();
    rmSync(join(sandbox, "pipeline.config.json"));
    const result = run(sandbox, "render-architecture.mjs", ["archi.html", "backend"]);
    assert.equal(result.status, 0, result.output);
    assert.ok(existsSync(join(sandbox, "archi.html")));
  });

  test("every renderer uses the same rule", () => {
    sandbox = withDesign({ pages_dir: "pipeline/pages" });
    const architecture = run(sandbox, "render-architecture.mjs", ["archi.html", "frontend"]);
    assert.equal(architecture.status, 0, architecture.output);
    assert.ok(existsSync(join(sandbox, "pipeline", "pages", "archi.html")));

    const design = run(sandbox, "render-design-system.mjs", ["design.html", "frontend"]);
    assert.equal(design.status, 0, design.output);
    assert.ok(existsSync(join(sandbox, "pipeline", "pages", "design.html")));

    const decisions = run(sandbox, "render-decisions.mjs", ["decisions.html"]);
    assert.equal(decisions.status, 0, decisions.output);
    assert.ok(existsSync(join(sandbox, "pipeline", "pages", "decisions.html")));
  });
});
