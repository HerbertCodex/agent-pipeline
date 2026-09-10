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
 * Prepares a sandbox carrying sources and a `dead_code` block.
 *
 * @param files - pairs of relative path and content
 * @param settings - extra `dead_code` fields, for example `skip`
 * @returns the sandbox root
 */
function withSources(files, settings = {}) {
  const root = createSandbox();
  const config = JSON.parse(readFileSync(join(root, "pipeline.config.json"), "utf8"));
  config.dead_code = { roots: ["src"], ...settings };
  writeFileSync(join(root, "pipeline.config.json"), JSON.stringify(config, null, 2));
  for (const [path, body] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  return root;
}

/**
 * Sources whose only orphan lives under `src/generated`: cited export at the
 * root, uncited one in the generated directory.
 *
 * @returns the files for {@link withSources}
 */
function withGeneratedOrphan() {
  return {
    "src/a.ts": "export const used = 1;\n",
    "src/b.ts": 'import { used } from "./a";\nconsole.log(used);\n',
    "src/generated/c.ts": "export const orphanGen = 1;\n",
  };
}

describe("dead-code: the skip configuration reaches the walk", () => {
  test("honours the skip pattern given as a regex string", () => {
    sandbox = withSources(withGeneratedOrphan(), { skip: "generated" });
    const result = run(sandbox, "dead-code.mjs");
    assert.equal(result.status, 0, result.output);
  });

  test("accepts a skip list of glob patterns, the shape the frontend bundles ship", () => {
    // A list was silently read as "skip nothing" on 2026-09-10: only the
    // string shape reached the regular expression, so the generated orphan
    // was reported even though the configuration named its directory.
    sandbox = withSources(withGeneratedOrphan(), { skip: ["**/generated/**"] });
    const result = run(sandbox, "dead-code.mjs");
    assert.equal(result.status, 0, `a skip list must skip, not crash or be ignored: ${result.output}`);
  });

  test("refuses a skip that is neither a regex string nor a list of patterns", () => {
    sandbox = withSources({ "src/a.ts": "export const used = 1;\n" }, { skip: 42 });
    const result = run(sandbox, "dead-code.mjs");
    assert.notEqual(result.status, 0, "a skip read as nothing is a sweep of everything, green for the wrong reason");
    assert.match(result.output, /dead_code\.skip/);
  });
});
