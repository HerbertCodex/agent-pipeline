import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createSandbox, destroySandbox, writeStore, writeJson, run, issue, state, seedFramework } from "./harness.mjs";
import { computeWave } from "../scripts/next-issues.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const RULES = JSON.parse(readFileSync(join(here, "..", "schemas", "rules.json"), "utf8"));

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Prepares a sandbox that declares a generated project map.
 *
 * @param overrides - fields merged into the configuration
 * @returns the sandbox root
 */
function withMap(overrides = {}) {
  const root = createSandbox();
  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.project_map = { out: "docs/project-map.md", roots: ["src"], regenerate: "true" };
  config.commands = {
    check: "true", lint: "true", build: "true", test_unit: "true", audit: "true",
    secrets_scan: "true", design_limits: "true", duplication: "true", smoke: "true", project_map: "true",
  };
  config.closure_gates = ["project_map"];
  config.architecture = { id: "feature-modules", project_type: "backend" };
  config.file_policy = {
    ...config.file_policy,
    orchestrator: { allow: ["pipeline/store/**", "docs/project-map.md"] },
  };
  writeFileSync(path, JSON.stringify({ ...config, ...overrides }, null, 2));
  return root;
}

describe("the project map is generated, so it never serialises a wave", () => {
  test("two issues sharing only the map start together", () => {
    const map = "docs/project-map.md";
    const records = [
      issue({ id: "i-1", pipeline_state: state({ file_reservations: ["src/a/**", map] }) }),
      issue({ id: "i-2", pipeline_state: state({ file_reservations: ["src/b/**", map] }) }),
    ];
    const config = { project_map: { out: map } };
    const { ready, waiting } = computeWave(records, RULES, null, config);
    assert.deepEqual(ready.map((r) => r.id), ["i-1", "i-2"], `serialise encore : ${JSON.stringify(waiting)}`);
  });

  test("an issue reserving nothing but the map is unguarded, not ready", () => {
    const map = "docs/project-map.md";
    const records = [issue({ id: "i-1", pipeline_state: state({ file_reservations: [map] }) })];
    const config = { project_map: { out: map } };
    const { ready, waiting } = computeWave(records, RULES, null, config);
    assert.deepEqual(ready, []);
    assert.match(waiting[0].reason, /unguarded|no reservation/i);
  });

  test("real overlaps still serialise, or the gate stopped guarding anything", () => {
    const records = [
      issue({ id: "i-1", pipeline_state: state({ file_reservations: ["src/a/**"] }) }),
      issue({ id: "i-2", pipeline_state: state({ file_reservations: ["src/a/deep/**"] }) }),
    ];
    const { ready } = computeWave(records, RULES, null, {});
    assert.deepEqual(ready.map((r) => r.id), ["i-1"]);
  });

  test("check-reservations reports no collision on the map alone", () => {
    sandbox = withMap();
    writeStore(sandbox, "issues", [
      issue({ id: "i-1", pipeline_state: state({ phase: "in_progress", file_reservations: ["src/a/**", "docs/project-map.md"] }) }),
      issue({ id: "i-2", pipeline_state: state({ file_reservations: ["src/b/**", "docs/project-map.md"] }) }),
    ]);
    const result = run(sandbox, "check-reservations.mjs", ["i-2"]);
    assert.equal(result.status, 0, result.output);
  });
});

describe("a reservation-safe issue also needs one role able to author it", () => {
  const config = {
    file_policy: {
      implementer: { allow: ["src/**", "test/**"] },
      product: { allow: ["docs/**"] },
      qa: { allow: [] },
      orchestrator: { allow: ["pipeline/store/**"] },
    },
  };

  test("a source issue is ready with its authoring role", () => {
    const records = [issue({ id: "i-source", pipeline_state: state({ file_reservations: ["src/a.ts"] }) })];
    const { ready, waiting } = computeWave(records, RULES, null, config);
    assert.equal(waiting.length, 0);
    assert.deepEqual(ready.map(({ id, role }) => ({ id, role })), [
      { id: "i-source", role: "implementer" },
    ]);
  });

  test("an operator chore is not advertised as dispatchable", () => {
    const records = [issue({ id: "i-ci", pipeline_state: state({ file_reservations: [".github/workflows/ci.yml"] }) })];
    const { ready, waiting } = computeWave(records, RULES, null, config);
    assert.deepEqual(ready, []);
    assert.match(waiting[0].reason, /no eligible role/i);
  });

  test("a scope split across roles is not advertised as dispatchable", () => {
    const records = [
      issue({
        id: "i-split",
        eligible_roles: ["implementer", "product"],
        pipeline_state: state({ file_reservations: ["src/a.ts", "docs/a.md"] }),
      }),
    ];
    const { ready, waiting } = computeWave(records, RULES, null, config);
    assert.deepEqual(ready, []);
    assert.match(waiting[0].reason, /complete reserved scope/i);
  });
});

describe("a generated file has one writer, and it is never an issue", () => {
  test("a plan reserving the map is refused, with the reason", () => {
    sandbox = withMap();
    const handoff = writeJson(sandbox, "h.json", {
      schema_version: 1,
      produced_at: "2026-08-21T09:00:00.000Z",
      mode: "spec_plan",
      agent: "product",
      scope: { spec_id: "s-0001" },
      basis: { record_hash: "abc", pipeline_version: 1 },
      outcome: "plan_ready",
      context: { heading: "## Context for orchestrator", body: "x" },
      approved_proposal: { digest_sha256: "a".repeat(64) },
      issues: [
        {
          id: "i-0001",
          title: "ajouter une route",
          acceptance_criteria: ["1. [unit] la route repond 200"],
          file_reservations: ["src/route.ts", "docs/project-map.md"],
        },
      ],
    });
    const result = run(sandbox, "validate-handoff.mjs", [handoff]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /docs\/project-map\.md/);
    assert.match(
      result.output,
      /generated|regenerat/i,
      "the refusal says why, or Product removes the line and reserves it again next spec",
    );
  });

  test("verify-scope refuses the map in an implementer's diff", () => {
    sandbox = withMap();
    const sha = seedCommits(sandbox);
    const handoff = writeJson(sandbox, "h.json", {
      schema_version: 1,
      produced_at: "2026-08-21T09:00:00.000Z",
      mode: "issue_handoff",
      agent: "implementer",
      evidence: { commit_sha: sha, files: ["src/a.ts", "docs/project-map.md"] },
    });
    const result = run(sandbox, "verify-scope.mjs", [handoff, "HEAD~1"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /docs\/project-map\.md/);
    assert.match(result.output, /generated|orchestrator/i);
  });

  test("verify-scope accepts the map in the orchestrator's own diff", () => {
    sandbox = withMap();
    const sha = seedCommits(sandbox, false);
    const handoff = writeJson(sandbox, "h.json", {
      schema_version: 1,
      produced_at: "2026-08-21T09:00:00.000Z",
      mode: "issue_handoff",
      agent: "orchestrator",
      evidence: { commit_sha: sha, files: [] },
    });
    const result = run(sandbox, "verify-scope.mjs", [handoff, "HEAD~1"]);
    assert.equal(result.status, 0, result.output);
  });
});

/**
 * Builds two commits in the sandbox, the second touching the map.
 *
 * @param root - sandbox root
 * @param withSource - whether the second commit also carries source
 * @returns the sha of the second commit
 */
function seedCommits(root, withSource = true) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "seed.ts"), "export const seed = 1;\n");
  git("add", "-A");
  git("commit", "-qm", "seed");
  mkdirSync(join(root, "docs"), { recursive: true });
  if (withSource) writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "docs", "project-map.md"), "# map\n");
  git("add", "-A");
  git("commit", "-qm", "work");
  return git("rev-parse", "HEAD").trim();
}

describe("a closure gate does not run on every push, or the branch stays red", () => {
  test("apply-profile refuses a map with no policy allowing its writer", () => {
    sandbox = withMap();
    const path = join(sandbox, "pipeline.config.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.file_policy.orchestrator = { allow: ["pipeline/store/**"] };
    writeFileSync(path, JSON.stringify(config, null, 2));
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /file_policy\.orchestrator/);
    assert.match(result.output, /docs\/project-map\.md/);
  });

  test("apply-profile refuses a closure gate naming no command", () => {
    sandbox = withMap({ closure_gates: ["project_map", "mutation"] });
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /mutation/);
  });

  test("apply-profile requires a way to regenerate what it forbids editing", () => {
    sandbox = withMap({ project_map: { out: "docs/project-map.md", roots: ["src"] } });
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /project_map\.regenerate/);
  });

  test("the map gate is deferred without anyone having to declare it", () => {
    sandbox = withMap({
      closure_gates: [],
      ci: {
        provider: "github",
        install: "npm ci",
        runtime_setup: { uses: "actions/setup-node@v4", with: { "node-version": "24" } },
      },
    });
    seedFramework(sandbox);
    const applied = run(sandbox, "apply-profile.mjs", []);
    assert.equal(applied.status, 0, applied.output);
    const workflow = readFileSync(join(sandbox, ".github", "workflows", "ci.yml"), "utf8");
    const step = workflow.slice(workflow.indexOf("- name: project-map"));
    assert.match(
      step.slice(0, 200),
      /if: \$\{\{ github\.event_name == 'pull_request' \}\}/,
      "a gate the branch cannot satisfy turns every push red until the PR",
    );
    assert.ok(!workflow.slice(workflow.indexOf("- name: check"), workflow.indexOf("- name: project-map")).includes("event_name"));
  });

  test("the pre-push hook leaves closure gates to the pull request", () => {
    sandbox = withMap();
    execFileSync("git", ["init", "-q"], { cwd: sandbox });
    const result = run(sandbox, "install-hooks.mjs", []);
    assert.equal(result.status, 0, result.output);
    const hook = readFileSync(join(sandbox, ".git", "hooks", "pre-push"), "utf8");
    assert.ok(
      !hook.includes("project_map"),
      "the map is stale on the branch by design: checking it at push blocks every issue",
    );
  });
});

describe("something rewrites the map, or the closure gate is red at the pull request", () => {
  test("regenerate runs the declared command and names what moved", () => {
    sandbox = withMap({
      project_map: {
        out: "docs/project-map.md",
        roots: ["src"],
        regenerate: "mkdir -p docs && printf '# map\\n' > docs/project-map.md",
      },
    });
    const result = run(sandbox, "regenerate.mjs", []);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /docs\/project-map\.md/);
    assert.equal(readFileSync(join(sandbox, "docs", "project-map.md"), "utf8"), "# map\n");
  });

  test("a second run says nothing moved, instead of claiming work", () => {
    sandbox = withMap({
      project_map: {
        out: "docs/project-map.md",
        roots: ["src"],
        regenerate: "mkdir -p docs && printf '# map\\n' > docs/project-map.md",
      },
    });
    run(sandbox, "regenerate.mjs", []);
    const again = run(sandbox, "regenerate.mjs", []);
    assert.equal(again.status, 0, again.output);
    assert.match(again.output, /already current/i);
  });

  test("a regeneration that fails is reported, not swallowed", () => {
    sandbox = withMap({
      project_map: { out: "docs/project-map.md", roots: ["src"], regenerate: "exit 3" },
    });
    const result = run(sandbox, "regenerate.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /exit 3|regeneration failed/i);
  });

  test("it refuses a project that declares no way to rewrite the map", () => {
    sandbox = withMap({ project_map: { out: "docs/project-map.md", roots: ["src"] } });
    const result = run(sandbox, "regenerate.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /project_map\.regenerate/);
  });
});
