import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, run, seedFramework } from "./harness.mjs";

const roots = [];
afterEach(() => roots.splice(0).forEach(destroySandbox));

function project({ gateEvents = null } = {}) {
  const root = createSandbox();
  roots.push(root);
  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.ci = { provider: "github", install: "project install", runtime_setup: { uses: "owner/runtime@v1", with: {} } };
  if (gateEvents) config.ci.gate_events = gateEvents;
  config.architecture = { id: "feature-modules", project_type: "backend" };
  config.commands = {
    check: "true", lint: "true", build: "true", test_unit: "true", audit: "true",
    secrets_scan: "true", project_map: "true", design_limits: "true", duplication: "true", smoke: "true",
  };
  writeFileSync(path, JSON.stringify(config, null, 2));
  seedFramework(root);
  const result = run(root, "apply-profile.mjs", []);
  assert.equal(result.status, 0, result.output);
  return readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
}

/** Returns the `if:` a named step carries, or null when it carries none. */
function condition(workflow, step) {
  const block = workflow.split(/\n(?=      - name: )/).find((part) => part.includes(`- name: ${step}\n`));
  assert.ok(block, `step ${step} is absent from the workflow`);
  return block.match(/if: \$\{\{ (.+) \}\}/)?.[1] ?? null;
}

describe("generated workflow conditions", () => {
  test("a step the workflow always reaches carries no condition", () => {
    const workflow = project({ gateEvents: { audit: ["pull_request"] } });
    assert.match(workflow, /on:\n {2}push:/);

    // `on:` declares push and pull_request and nothing else, so a step
    // guarded by "push or pull_request" runs every time the job does. The
    // condition states nothing, and repeated on every ordinary gate it hides
    // the one condition that decides something.
    assert.equal(condition(workflow, "check"), null);
    assert.equal(condition(workflow, "lint"), null);

    // The gate that decides is the one that selects: it stays on pull requests.
    assert.equal(condition(workflow, "audit"), "github.event_name == 'pull_request'");
  });

  test("a condition survives when the workflow gains an event the step refuses", () => {
    const workflow = project({ gateEvents: { audit: ["schedule", "workflow_dispatch"] } });
    assert.match(workflow, /^ {2}schedule:/m);

    // The workflow now also runs on schedule and workflow_dispatch, so
    // "push or pull_request" excludes something and must be kept.
    assert.equal(condition(workflow, "check"), "github.event_name == 'push' || github.event_name == 'pull_request'");
    assert.equal(condition(workflow, "audit"), "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'");
  });
});
