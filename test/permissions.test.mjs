import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, run } from "./harness.mjs";

const roots = [];
afterEach(() => roots.splice(0).forEach(destroySandbox));

/** A policy where every role owns something, which is the ordinary case. */
const POLICY = {
  orchestrator: { allow: ["pipeline/store/**"], deny: ["src/**"] },
  product: { allow: ["pipeline/pages/**"], deny: ["src/**", "pipeline/**", "agent-pipeline/**"] },
  implementer: { allow: ["src/**", "scripts/routes.mjs"], deny: ["scripts/**", "agent-pipeline/**"] },
  qa: { allow: [], deny: ["**"] },
};

function sandbox(filePolicy) {
  const root = createSandbox();
  roots.push(root);
  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.file_policy = filePolicy;
  writeFileSync(path, JSON.stringify(config, null, 2));
  return root;
}

describe("derived platform permissions", () => {
  test("never refuses globally a path some role must be able to write", () => {
    const root = sandbox(POLICY);
    const result = run(root, "permissions.mjs", ["--format", "claude"]);
    assert.equal(result.status, 0, result.output);
    const deny = JSON.parse(result.stdout).permissions.deny;

    // `**` is QA refusing everything. Written into a session-global settings
    // file it refuses every write for every role, the implementer included:
    // the derivation would hand the operator a rule that stops the pipeline.
    assert.ok(!deny.includes("Write(**)"), `a rule refusing every path was derived: ${deny.join(", ")}`);
    // `pipeline/**` covers `pipeline/pages/**`, which product owns.
    assert.ok(!deny.includes("Write(pipeline/**)"), "product can no longer write its pages");
    // `scripts/**` covers `scripts/routes.mjs`, which the implementer owns.
    assert.ok(!deny.includes("Write(scripts/**)"), "the implementer can no longer write the script it owns");

    // What no role may write stays refusable: the derivation must still derive.
    assert.ok(deny.includes("Write(agent-pipeline/**)"), `nothing was derived: ${deny.join(", ")}`);
    assert.ok(deny.includes("Edit(agent-pipeline/**)"));
  });

  test("checking a settings file demands the same rules the derivation prints", () => {
    const root = sandbox(POLICY);
    const settings = join(root, "settings.json");
    writeFileSync(settings, JSON.stringify({ permissions: { deny: [] } }));
    const result = run(root, "permissions.mjs", ["--check", settings]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /does not refuse/);
    assert.doesNotMatch(result.output, /Write\(\*\*\)/);
  });
});
