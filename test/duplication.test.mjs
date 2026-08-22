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
 * Prepares a sandbox carrying sources and a `duplication` block.
 *
 * @param files - pairs of relative path and content
 * @param settings - settings to write into the configuration
 * @returns the sandbox root
 */
function withSources(files, settings = {}) {
  const root = createSandbox();
  const config = JSON.parse(readFileSync(join(root, "pipeline.config.json"), "utf8"));
  config.duplication = { roots: ["src"], min_lines: 6, ...settings };
  writeFileSync(join(root, "pipeline.config.json"), JSON.stringify(config, null, 2));
  for (const [path, body] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  return root;
}

/**
 * Builds a block of distinct, predictable lines.
 *
 * @param count - number of lines
 * @param prefix - text placed before the index
 * @returns the block, one line per element
 */
function block(count, prefix = "const value") {
  return Array.from({ length: count }, (_, index) => `${prefix}${index} = compute(${index});`).join("\n");
}

describe("duplication: what the reuse note cannot enforce on its own", () => {
  test("finds a block copied into another file and names both sites", () => {
    sandbox = withSources({
      "src/card.ts": `export function card() {\n${block(8)}\n}\n`,
      "src/tile.ts": `export function tile() {\n${block(8)}\n}\n`,
    });
    const result = run(sandbox, "duplication.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /src\/card\.ts/);
    assert.match(result.output, /src\/tile\.ts/);
  });

  test("says nothing when the two files merely resemble each other", () => {
    sandbox = withSources({
      "src/card.ts": `export function card() {\n${block(8, "const a")}\n}\n`,
      "src/tile.ts": `export function tile() {\n${block(8, "const b")}\n}\n`,
    });
    const result = run(sandbox, "duplication.mjs");
    assert.equal(result.status, 0, result.output);
  });

  test("ignores a repeat shorter than the declared threshold", () => {
    sandbox = withSources({
      "src/a.ts": `${block(6, "const own")}\n${block(4)}\n`,
      "src/b.ts": `${block(6, "const other")}\n${block(4)}\n`,
    });
    const result = run(sandbox, "duplication.mjs");
    assert.equal(result.status, 0, "a four-line echo is a coincidence, not a component rewritten");
  });

  test("sees through reindentation, because a paste is usually reindented", () => {
    const body = block(8);
    sandbox = withSources({
      "src/a.ts": `function a() {\n${body}\n}\n`,
      "src/b.ts": `class B {\n  run() {\n${body
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n")}\n  }\n}\n`,
    });
    const result = run(sandbox, "duplication.mjs");
    assert.notEqual(result.status, 0, "an indented paste is the same paste");
  });

  test("counts one clone, not one per sliding window", () => {
    sandbox = withSources({
      "src/a.ts": `export function a() {\n${block(30)}\n}\n`,
      "src/b.ts": `export function b() {\n${block(30)}\n}\n`,
    });
    const parsed = JSON.parse(run(sandbox, "duplication.mjs", ["--json"]).stdout);
    assert.equal(parsed.clones.length, 1, "a thirty-line copy is one finding; twenty-five of them is a wall nobody reads");
    assert.ok(parsed.clones[0].lines >= 30, `expected the whole run, got ${parsed.clones[0].lines}`);
  });

  test("honours the skip pattern, because generated files are copies by design", () => {
    sandbox = withSources(
      {
        "src/a.ts": `export function a() {\n${block(8)}\n}\n`,
        "src/generated/b.ts": `export function b() {\n${block(8)}\n}\n`,
      },
      { skip: "generated" },
    );
    const result = run(sandbox, "duplication.mjs");
    assert.equal(result.status, 0, result.output);
  });

  test("catches a block repeated twice inside a single file", () => {
    const body = block(8);
    sandbox = withSources({ "src/a.ts": `function one() {\n${body}\n}\n\nfunction two() {\n${body}\n}\n` });
    const result = run(sandbox, "duplication.mjs");
    assert.notEqual(result.status, 0, "the second component of a file is as rewritten as the second file");
  });

  test("the refusal says what to do, not only that it refuses", () => {
    sandbox = withSources({
      "src/card.ts": `export function card() {\n${block(8)}\n}\n`,
      "src/tile.ts": `export function tile() {\n${block(8)}\n}\n`,
    });
    const result = run(sandbox, "duplication.mjs");
    assert.match(result.output, /extract|reuse|shared/i);
  });

  test("refuses to run without a declared scope instead of guessing one", () => {
    const root = createSandbox();
    const result = run(root, "duplication.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /duplication\.roots/);
  });

  test("reports nothing on a project with no source file, and says so", () => {
    sandbox = withSources({});
    const result = run(sandbox, "duplication.mjs");
    assert.notEqual(result.status, 0, "an empty scan is a misconfigured scan, not a clean bill of health");
    assert.match(result.output, /no file/i);
  });
});

describe("apply-profile: the framework requires a gate against duplication", () => {
  test("refuses a configuration that declares none", () => {
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
    smoke: "true",
    };
    config.architecture = { id: "feature-modules", project_type: "backend" };
    writeFileSync(path, JSON.stringify(config));
    const result = run(root, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /commands\.duplication/);
    assert.match(
      result.output,
      /reuse note|judged|review/i,
      "the refusal says which existing rule it makes enforceable, or it reads as one more chore",
    );
  });

  test("accepts any tool, including the one the framework ships", () => {
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
      duplication: "pmd cpd --minimum-tokens 100",
    smoke: "true",
    };
    config.architecture = { id: "feature-modules", project_type: "backend" };
    writeFileSync(path, JSON.stringify(config));
    const result = run(root, "apply-profile.mjs", ["--check"]);
    assert.doesNotMatch(result.output, /duplication/, "the core does not judge the tool, only the presence of the key");
  });
});
