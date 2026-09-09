import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { secretKind } from "../profile-bundles/nest/tools/secrets.mjs";
import { violations } from "../profile-bundles/nest/tools/design.mjs";
import { chdirToFramework } from "./framework-root.mjs";

chdirToFramework();

test("the Nest secret scanner detects credential shapes without accepting ordinary identifiers", () => {
  assert.equal(secretKind("-----BEGIN " + "PRIVATE KEY-----"), "private key");
  assert.equal(secretKind("AKIA" + "A".repeat(16)), "AWS access key");
  assert.equal(secretKind("ghp_" + "a".repeat(36)), "GitHub token");
  assert.equal(secretKind("xoxb-" + "a".repeat(24)), "Slack token");
  assert.equal(secretKind("const token = process.env.API_TOKEN;"), null);
});

test("the Nest design policy refuses each bound independently", () => {
  const limits = { complexity: 12, function_lines: 80, parameters: 5, nesting: 4 };
  const base = { line: 1, name: "fixture", ...limits };
  assert.deepEqual(violations([base], limits), []);
  for (const key of Object.keys(limits)) {
    const result = violations([{ ...base, [key]: limits[key] + 1 }], limits);
    assert.equal(result.length, 1);
    assert.ok(result[0].includes(key));
  }
});

test("the Nest type gate uses the test runner's real module resolution", () => {
  const root = mkdtempSync(join(tmpdir(), "pipeline-nest-typecheck-"));
  try {
    const packageRoot = join(root, "node_modules", "typescript");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ bin: { tsc: "bin.mjs" } }));
    writeFileSync(join(packageRoot, "bin.mjs"), "import { writeFileSync } from 'node:fs'; writeFileSync('arguments.json', JSON.stringify(process.argv.slice(2)));\n");
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    writeFileSync(join(root, "pipeline.config.json"), JSON.stringify({ setup: { test_runner: "vitest" } }));
    const result = spawnSync(process.execPath, [resolve("profile-bundles/nest/tools/gate.mjs"), "check"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.deepEqual(JSON.parse(readFileSync(join(root, "arguments.json"), "utf8")),
      ["--noEmit", "--incremental", "false", "--module", "Preserve", "--moduleResolution", "Bundler"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
