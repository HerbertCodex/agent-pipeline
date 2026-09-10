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
 * Prepares a sandbox carrying sources and a `sast` block.
 *
 * @param files - pairs of relative path and content
 * @param settings - extra `sast` fields, for example `skip`
 * @returns the sandbox root
 */
function withSources(files, settings = {}) {
  const root = createSandbox();
  const config = JSON.parse(readFileSync(join(root, "pipeline.config.json"), "utf8"));
  config.sast = { roots: ["src"], ...settings };
  writeFileSync(join(root, "pipeline.config.json"), JSON.stringify(config, null, 2));
  for (const [path, body] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  return root;
}

/**
 * Sources whose only dangerous construct lives under `src/generated`.
 *
 * @returns the files for {@link withSources}
 */
function withGeneratedFinding() {
  return {
    "src/a.ts": "export const safe = 1;\n",
    "src/generated/b.ts": "const result = eval(input);\n",
  };
}

describe("sast: the skip configuration reaches the walk", () => {
  test("honours the skip pattern given as a regex string", () => {
    sandbox = withSources(withGeneratedFinding(), { skip: "generated" });
    const result = run(sandbox, "sast.mjs");
    assert.equal(result.status, 0, result.output);
  });

  test("accepts a skip list of glob patterns, the shape the frontend bundles ship", () => {
    // A list was silently read as "skip nothing" on 2026-09-10: only the
    // string shape reached the regular expression, so the generated file was
    // scanned and its construct reported.
    sandbox = withSources(withGeneratedFinding(), { skip: ["**/generated/**"] });
    const result = run(sandbox, "sast.mjs");
    assert.equal(result.status, 0, `a skip list must skip, not crash or be ignored: ${result.output}`);
  });

  test("refuses a skip that is neither a regex string nor a list of patterns", () => {
    sandbox = withSources({ "src/a.ts": "export const safe = 1;\n" }, { skip: 42 });
    const result = run(sandbox, "sast.mjs");
    assert.notEqual(result.status, 0, "a skip read as nothing is a scan of everything, green for the wrong reason");
    assert.match(result.output, /sast\.skip/);
  });
});
