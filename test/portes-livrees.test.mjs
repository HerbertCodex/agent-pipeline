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
 * Prepares a sandbox holding the given source files.
 *
 * @param files - map of relative path to content
 * @param settings - configuration blocks merged in
 * @returns the sandbox root
 */
function withSource(files, settings = {}) {
  const root = createSandbox();
  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...config, project_map: { out: "docs/map.md", roots: ["src"] }, ...settings }, null, 2));
  for (const [name, body] of Object.entries(files)) {
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  return root;
}

describe("dead-code: an export nobody cites", () => {
  test("refuses an export no other file imports", () => {
    sandbox = withSource({
      "src/used.ts": "export function used() {}\n",
      "src/orphan.ts": "export function neverCalled() {}\n",
      "src/main.ts": "import { used } from './used';\nused();\n",
    }, { dead_code: { roots: ["src"], entry: ["src/main.ts"] } });
    const result = run(sandbox, "dead-code.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /neverCalled/);
    assert.ok(!result.output.includes("used("), "the cited export must not be reported");
  });

  test("accepts a surface entirely cited", () => {
    sandbox = withSource({
      "src/used.ts": "export function used() {}\n",
      "src/main.ts": "import { used } from './used';\nused();\n",
    }, { dead_code: { roots: ["src"], entry: ["src/main.ts"] } });
    const result = run(sandbox, "dead-code.mjs", []);
    assert.equal(result.status, 0, result.output);
  });

  test("an entry point is never dead, whoever calls it", () => {
    sandbox = withSource({
      "src/main.ts": "export function bootstrap() {}\n",
    }, { dead_code: { roots: ["src"], entry: ["src/main.ts"] } });
    const result = run(sandbox, "dead-code.mjs", []);
    assert.equal(result.status, 0, result.output);
  });

  test("it refuses a tree it recognises nothing in, rather than passing green", () => {
    // The failure that matters is not a red gate, it is a green one: a
    // sweep that reads no declaration reports nothing and looks identical
    // to a clean codebase.
    sandbox = withSource({ "src/thing.rb": "puts 'hello'\n" }, { dead_code: { roots: ["src"] } });
    const result = run(sandbox, "dead-code.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /not one declaration|recognised/i);
  });

  test("it says what it cannot see", () => {
    sandbox = withSource({
      "src/used.ts": "export function used() {}\n",
      "src/main.ts": "import { used } from './used';\nused();\n",
    }, { dead_code: { roots: ["src"], entry: ["src/main.ts"] } });
    const result = run(sandbox, "dead-code.mjs", []);
    assert.match(result.output, /runtime|dynamic|convention/i, "a gate believed wider than it is protects less than none");
  });
});

describe("doc-lint: the contract of an export", () => {
  test("refuses an export with no documentation at all", () => {
    sandbox = withSource({ "src/a.ts": "export function compute(value) {\n  return value;\n}\n" });
    const result = run(sandbox, "doc-lint.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /compute/);
  });

  test("refuses a parameter the contract does not name", () => {
    sandbox = withSource({
      "src/a.ts": "/**\n * Computes.\n *\n * @returns the value\n */\nexport function compute(value) {\n  return value;\n}\n",
    });
    const result = run(sandbox, "doc-lint.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /value/);
  });

  test("refuses a renamed parameter whose documentation stayed behind", () => {
    sandbox = withSource({
      "src/a.ts": "/**\n * Computes.\n *\n * @param old - the input\n * @returns the value\n */\nexport function compute(fresh) {\n  return fresh;\n}\n",
    });
    const result = run(sandbox, "doc-lint.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /fresh|old/);
  });

  test("accepts a complete contract", () => {
    sandbox = withSource({
      "src/a.ts": "/**\n * Computes.\n *\n * @param value - the input\n * @returns the value\n */\nexport function compute(value) {\n  return value;\n}\n",
    });
    const result = run(sandbox, "doc-lint.mjs", []);
    assert.equal(result.status, 0, result.output);
  });

  test("a constant owes a description, not a parameter list", () => {
    sandbox = withSource({ "src/a.ts": "/**\n * The limit.\n */\nexport const LIMIT = 3;\n" });
    const result = run(sandbox, "doc-lint.mjs", []);
    assert.equal(result.status, 0, result.output);
  });
});

describe("sast: the shapes that carry an injection", () => {
  test("refuses eval and its family", () => {
    sandbox = withSource({ "src/a.ts": "export function run(input) {\n  return eval(input);\n}\n" });
    const result = run(sandbox, "sast.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /eval/);
  });

  test("refuses a command assembled from a value", () => {
    sandbox = withSource({
      "src/a.ts": "import { execSync } from 'node:child_process';\nexport function run(name) {\n  return execSync(`ls ${name}`);\n}\n",
    });
    const result = run(sandbox, "sast.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /execSync|command/i);
  });

  test("accepts a fixed command, because the shape is what is dangerous", () => {
    sandbox = withSource({
      "src/a.ts": "import { execFileSync } from 'node:child_process';\nexport function run() {\n  return execFileSync('ls', ['-la']);\n}\n",
    });
    const result = run(sandbox, "sast.mjs", []);
    assert.equal(result.status, 0, result.output);
  });

  test("it states that it reads patterns, not intentions", () => {
    sandbox = withSource({ "src/a.ts": "export const safe = 1;\n" });
    const result = run(sandbox, "sast.mjs", []);
    assert.match(result.output, /pattern|intention/i);
  });
});
