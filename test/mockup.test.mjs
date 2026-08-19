import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createSandbox, destroySandbox, run } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

const TOKENS = `:root {
  --ink: #16161a;
  --paper: #fffdf8;
  --accent: #b4451f;
  --space-2: 8px;
  --space-4: 16px;
  --radius: 2px;
  --font-display: "Playfair Display", Georgia, serif;
}
`;

/**
 * Prepares a sandbox carrying a tokens file and a mockup.
 *
 * @param mockup - content of the mockup file
 * @param tokens - content of the tokens file
 * @returns the sandbox root
 */
function withMockup(mockup, tokens = TOKENS) {
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
  writeFileSync(path, JSON.stringify(config, null, 2));
  for (const [file, body] of [
    ["src/tokens.css", tokens],
    ["mockup/home.html", mockup],
  ]) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  return root;
}

describe("mockup-check: a mockup assembles what exists, it does not invent a scale", () => {
  test("accepts a mockup built entirely from declared tokens", () => {
    sandbox = withMockup(
      `<style>.hero { color: var(--ink); background: var(--paper); padding: var(--space-4); }</style><h1>Hello</h1>`,
    );
    const result = run(sandbox, "mockup-check.mjs", ["mockup/home.html"]);
    assert.equal(result.status, 0, result.output);
  });

  test("refuses a colour that exists nowhere in the tokens", () => {
    sandbox = withMockup(`<style>.hero { color: #3b82f6; }</style>`);
    const result = run(sandbox, "mockup-check.mjs", ["mockup/home.html"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /#3b82f6/i);
  });

  test("names the nearest declared token, so the fix is obvious", () => {
    sandbox = withMockup(`<style>.hero { color: #16161b; }</style>`);
    const result = run(sandbox, "mockup-check.mjs", ["mockup/home.html"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /--ink/, "a refusal that only says no makes the agent invent a second value");
  });

  test("accepts a literal that matches a declared token exactly", () => {
    sandbox = withMockup(`<style>.hero { color: #16161a; }</style>`);
    const result = run(sandbox, "mockup-check.mjs", ["mockup/home.html"]);
    assert.equal(result.status, 0, result.output);
  });

  test("refuses a font the design system never declared", () => {
    sandbox = withMockup(`<style>.hero { font-family: Inter, sans-serif; }</style>`);
    const result = run(sandbox, "mockup-check.mjs", ["mockup/home.html"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Inter/i, "the default font is the single most recognisable tell");
  });

  test("refuses a spacing value off the declared scale", () => {
    sandbox = withMockup(`<style>.hero { padding: 13px; }</style>`);
    const result = run(sandbox, "mockup-check.mjs", ["mockup/home.html"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /13px/);
  });

  test("says how many values it checked, because a silent pass proves nothing", () => {
    sandbox = withMockup(`<style>.hero { color: var(--ink); }</style>`);
    const result = run(sandbox, "mockup-check.mjs", ["mockup/home.html"]);
    assert.match(result.output, /value\(s\) checked/);
  });

  test("refuses a mockup that declares no value at all", () => {
    sandbox = withMockup(`<h1>Hello</h1>`);
    const result = run(sandbox, "mockup-check.mjs", ["mockup/home.html"]);
    assert.notEqual(result.status, 0, "a mockup with no styling is not a mockup, and would pass every check");
    assert.match(result.output, /no colour, length or font/i);
  });

  test("refuses when the tokens file the configuration names does not exist", () => {
    sandbox = withMockup(`<style>.hero { color: var(--ink); }</style>`);
    writeFileSync(join(sandbox, "pipeline.config.json"), JSON.stringify({
      ...JSON.parse(readFileSync(join(sandbox, "pipeline.config.json"), "utf8")),
      design_system: { tokens: "src/ghost.css", primitives: "own", decided_at: "x", direction: { genre: "g", because: "b" } },
    }));
    const result = run(sandbox, "mockup-check.mjs", ["mockup/home.html"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /ghost\.css/);
  });

  test("refuses a project that declares no design system", () => {
    const root = createSandbox();
    const result = run(root, "mockup-check.mjs", ["anything.html"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /design_system/);
  });

  test("the refusal explains what a mockup off the tokens costs", () => {
    sandbox = withMockup(`<style>.hero { color: #3b82f6; }</style>`);
    const result = run(sandbox, "mockup-check.mjs", ["mockup/home.html"]);
    assert.match(
      result.output,
      /assembl|invent|scale/i,
      "without the reason, the fix is to add the value to the tokens rather than to use one",
    );
  });
});
