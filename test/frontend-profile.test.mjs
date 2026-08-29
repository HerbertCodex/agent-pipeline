import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, destroySandbox, run } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, "..", "profile-bundles", "frontend-typescript");

function manifest() {
  return JSON.parse(readFileSync(join(bundle, "profile.json"), "utf8"));
}

describe("frontend TypeScript reference profile: measurable structure", () => {
  test("stays framework-neutral while naming the required quality surfaces", () => {
    const profile = manifest();
    const commands = new Set(Object.keys(profile.commands));

    assert.equal(profile.project_type, "frontend");
    for (const key of [
      "check",
      "lint",
      "build",
      "test_unit",
      "test_e2e",
      "coverage",
      "accessibility",
      "architecture",
      "design_tokens",
      "visual_regression",
      "dead_code",
      "duplication",
      "design_limits",
      "audit",
      "secrets_scan",
      "smoke",
      "project_map",
    ]) {
      assert.ok(commands.has(key), `the frontend profile has no ${key} gate`);
    }
    const serialized = JSON.stringify(profile);
    assert.doesNotMatch(serialized, /react|vue|svelte|angular|solid/i);
  });

  test("requires calibration instead of trusting thresholds from another codebase", () => {
    assert.equal(manifest().calibration_required, true);
  });

  test("binds every invariant to a command that can refuse it", () => {
    const profile = manifest();
    const invariants = readFileSync(join(bundle, "invariants.md"), "utf8")
      .split("\n")
      .filter((line) => line.startsWith("- "));

    assert.ok(invariants.length >= 8);
    for (const invariant of invariants) {
      const gate = invariant.match(/\(`([a-z0-9_]+)`\)\s*$/)?.[1];
      assert.ok(gate != null, `invariant names no gate: ${invariant}`);
      assert.equal(typeof profile.commands[gate], "string", `invariant names undeclared gate ${gate}`);
    }
  });

  test("keeps coding agents away from policy files and limits Product to Sudocode", () => {
    const policy = manifest().file_policy;
    const denied = policy.implementer.deny.join("\n");

    assert.match(denied, /package\.json/);
    assert.match(denied, /agent-pipeline/);
    assert.match(denied, /pipeline\.config\.json/);
    assert.match(denied, /AGENTS\.md/);
    assert.deepEqual(policy.qa.allow, []);
    assert.deepEqual(policy.product.allow, [".sudocode/**"]);
    assert.ok(policy.orchestrator.allow.includes(".sudocode/**"));
  });

  test("maps production and test code before allowing a new export", () => {
    const map = manifest().project_map;

    assert.ok(map.roots.includes("src"));
    assert.ok(map.roots.some((root) => /test|e2e/.test(root)));
    assert.equal(typeof map.regenerate, "string");
    assert.match(manifest().commands.project_map, /--check/);
  });

  test("imports through the same profile mechanism as a project-owned bundle", () => {
    const root = createSandbox();
    try {
      const host = join(root, "host");
      mkdirSync(join(host, "agent-pipeline"), { recursive: true });
      const result = run(root, "import-profile.mjs", [bundle, host]);
      const config = JSON.parse(readFileSync(join(host, "pipeline.config.json"), "utf8"));

      assert.equal(result.status, 0, result.output);
      assert.equal(config.profile, "frontend-typescript");
      assert.match(config.commands.accessibility, /test:a11y/);
      assert.ok(
        existsSync(join(host, "pipeline", "profiles", "frontend-typescript", "invariants.md")),
      );
    } finally {
      destroySandbox(root);
    }
  });
});
