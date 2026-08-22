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
 * Prepares a project declaring an extra documents directory.
 *
 * @param files - files to create inside it, name to content
 * @returns the sandbox root
 */
function withDocsDir(files) {
  const root = createSandbox();
  seedFramework(root);
  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.docs_dirs = ["agent-pipeline/docs", "docs/stack"];
  config.commands = Object.fromEntries(
    ["check", "lint", "build", "test_unit", "audit", "secrets_scan", "project_map", "design_limits", "duplication", "smoke"]
      .map((key) => [key, "true"]),
  );
  config.architecture = { id: "feature-modules", project_type: "backend" };
  config.project_map = { out: "docs/map.md", roots: ["src"], regenerate: "true" };
  config.file_policy = { ...config.file_policy, orchestrator: { allow: ["pipeline/store/**", "docs/map.md"] } };
  writeFileSync(path, JSON.stringify(config, null, 2));
  mkdirSync(join(root, "docs", "stack"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, "docs", "stack", name), body);
  }
  return root;
}

describe("a declared directory that git will not carry is refused here, not on the runner", () => {
  test("an empty documents directory is refused", () => {
    // Observed on a real port: `docs/stack` was declared and empty. Git does
    // not version empty directories, so it existed on one machine and nowhere
    // else, and `sync-briefs --check` died on the runner with a path that was
    // present locally. The gate that could have said so ran nowhere.
    sandbox = withDocsDir({});
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /docs\/stack/);
    assert.match(
      result.output,
      /empty|vide|git/i,
      "the refusal must say why an empty directory is a problem, not merely that it is empty",
    );
  });

  test("a directory carrying a document is accepted", () => {
    sandbox = withDocsDir({ "standards.md": "<!-- brief:qa -->\n## Standards\n\nx\n<!-- /brief -->\n" });
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.doesNotMatch(result.output, /docs\/stack/, result.output);
  });

  test("a directory holding files that are not documents is still refused", () => {
    // A `.gitkeep` makes git carry the directory and changes nothing for the
    // reader: no section reaches a brief, and the directory was declared to
    // be read.
    sandbox = withDocsDir({ ".gitkeep": "" });
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /docs\/stack/);
  });

  test("a directory that does not exist at all is still refused", () => {
    sandbox = withDocsDir({});
    const path = join(sandbox, "pipeline.config.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.docs_dirs = ["agent-pipeline/docs", "docs/absent"];
    writeFileSync(path, JSON.stringify(config, null, 2));
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /docs\/absent/);
  });
});
