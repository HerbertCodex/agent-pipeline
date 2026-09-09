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

/**
 * Prepares a sandbox carrying stylesheets and a primitives sheet.
 *
 * @param files - pairs of relative path and content
 * @param settings - `design_system` fields to write, or null to write none
 * @returns the sandbox root
 */
function withSheets(files, settings = {}) {
  const root = createSandbox();
  const config = JSON.parse(readFileSync(join(root, "pipeline.config.json"), "utf8"));
  config.project_map = { roots: ["src"] };
  if (settings != null) config.design_system = { primitives_sheet: "src/app.css", ...settings };
  writeFileSync(join(root, "pipeline.config.json"), JSON.stringify(config, null, 2));
  for (const [path, body] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  return root;
}

describe("css ownership: one class name has one owner", () => {
  test("refuses a class name claimed by two stylesheets that own each other nothing", () => {
    sandbox = withSheets({
      "src/app.css": "body { margin: 0; }\n",
      "src/shared/bar.css": ".bar { display: flex; }\n\n.mark { font-weight: bold; }\n",
      "src/features/journey.css": ".row { display: grid; }\n.mark { background: red; }\n",
    });
    const result = run(sandbox, "css-ownership.mjs");
    assert.equal(result.status, 1);
    assert.match(result.output, /1 class name\(s\) claimed by two stylesheets/);
    assert.match(result.output, /\.mark\n\s+src\/features\/journey\.css:2\n\s+src\/shared\/bar\.css:3/);
    assert.match(result.output, /declare the primitive in src\/app\.css/);
  });

  test("accepts a name the primitives sheet declares and two stylesheets extend", () => {
    sandbox = withSheets({
      "src/app.css": ".links { display: flex; }\n",
      "src/shared/bar.css": ".links a { color: red; }\n",
      "src/features/journey.css": ".links { gap: 1px; }\n.row { display: grid; }\n",
    });
    const result = run(sandbox, "css-ownership.mjs");
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /2 stylesheet\(s\), 2 class name\(s\), 1 extended from src\/app\.css, none claimed twice/);
  });

  test("names the line past a multi-line comment, not the line the comment swallowed", () => {
    const comment = "/*\n * one\n * two\n * three\n */\n";
    sandbox = withSheets({
      "src/app.css": "body { margin: 0; }\n",
      "src/a.css": `${comment}.mark { color: red; }\n`,
      "src/b.css": `.x { color: red; }\n${comment}\n.mark { color: blue; }\n`,
    });
    const result = run(sandbox, "css-ownership.mjs");
    assert.equal(result.status, 1);
    assert.match(result.output, /src\/a\.css:6\n\s+src\/b\.css:8/);
  });

  test("reads selector preludes only: a body or an at-rule prelude declares nothing", () => {
    sandbox = withSheets({
      "src/app.css": "body { margin: 0; }\n",
      "src/a.css": '.x { content: ".mark"; background: url(.mark/a.png); }\n@media (min-width: 1px) { .y { color: red; } }\n',
      "src/b.css": ".mark { color: blue; }\n",
    });
    const result = run(sandbox, "css-ownership.mjs");
    assert.equal(result.status, 0, result.output);
  });

  test("reads a rule nested inside a media query as a claim all the same", () => {
    sandbox = withSheets({
      "src/app.css": "body { margin: 0; }\n",
      "src/a.css": "@media (min-width: 1px) {\n  .mark { color: red; }\n}\n",
      "src/b.css": ".mark { color: blue; }\n",
    });
    const result = run(sandbox, "css-ownership.mjs");
    assert.equal(result.status, 1);
    assert.match(result.output, /src\/a\.css:2\n\s+src\/b\.css:1/);
  });

  test("refuses to pass when no stylesheet names a class", () => {
    sandbox = withSheets({
      "src/app.css": "body { margin: 0; }\n",
      "src/a.css": "body { color: red; }\n",
    });
    const result = run(sandbox, "css-ownership.mjs");
    assert.equal(result.status, 1);
    assert.match(result.output, /green by emptiness/);
  });

  test("refuses a configuration that names no primitives sheet", () => {
    sandbox = withSheets({ "src/a.css": ".a { color: red; }\n" }, null);
    const result = run(sandbox, "css-ownership.mjs");
    assert.equal(result.status, 1);
    assert.match(result.output, /design_system\.primitives_sheet missing/);
  });

  test("refuses a primitives sheet that does not exist", () => {
    sandbox = withSheets({ "src/a.css": ".a { color: red; }\n" }, { primitives_sheet: "src/nowhere.css" });
    const result = run(sandbox, "css-ownership.mjs");
    assert.equal(result.status, 1);
    assert.match(result.output, /does not name a readable file: src\/nowhere\.css/);
  });
});
