import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, run, seedFramework } from "./harness.mjs";
import { gatesForIssue } from "../scripts/gates.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/** Creates the smallest honest relational-project declaration. */
function relationalProject(overrides = {}) {
  const root = createSandbox();
  seedFramework(root);
  mkdirSync(join(root, "db", "migrations"), { recursive: true });
  writeFileSync(join(root, "db", "schema.sql"), "-- physical source of truth\n");
  writeFileSync(join(root, "db", "migrations", "0001-initial.sql"), "-- first upgrade\n");
  writeFileSync(join(root, "docs", "data-model.md"), "# Data model\n");
  writeFileSync(join(root, "docs", "decisions", "0001-persistence.md"), "# Persistence\n");

  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.commands = {
    check: "true", lint: "true", build: "true", test_unit: "true", audit: "true",
    secrets_scan: "true", project_map: "true", design_limits: "true", duplication: "true", smoke: "true",
    migrations: "true", test_integration: "true",
  };
  config.test_suites = {
    unit: { gate: "test_unit", replay: "per_issue" },
    integration: { gate: "test_integration", replay: "per_issue" },
  };
  config.workflow = { gates: { normal: ["check"] } };
  config.architecture = { id: "feature-modules", project_type: "backend" };
  config.project_map = { out: "docs/map.md", roots: ["src"], regenerate: "true" };
  config.file_policy = { ...config.file_policy, orchestrator: { allow: ["pipeline/store/**", "docs/map.md"] } };
  config.data_model = {
    decision: "docs/decisions/0001-persistence.md",
    model: "docs/data-model.md",
    schema: "db/schema.sql",
    migrations: "db/migrations",
    migration_gate: "migrations",
    integration_suite: "integration",
    normalization: { target: "3NF", exceptions: "docs/decisions/0001-persistence.md" },
    timestamps: {
      authority: "database",
      timezone: "UTC",
      created_at: "created_at",
      updated_at: "updated_at",
      exceptions: "docs/decisions/0001-persistence.md",
    },
  };
  writeFileSync(path, JSON.stringify({ ...config, ...overrides }, null, 2));
  return root;
}

describe("optional relational data governance", () => {
  test("accepts committed artefacts and a real migration and integration proof", () => {
    sandbox = relationalProject();
    const result = run(sandbox, "apply-profile.mjs", []);
    assert.equal(result.status, 0, result.output);
  });

  test("requires the selected normal form and the UTC temporal policy", () => {
    sandbox = relationalProject();
    const path = join(sandbox, "pipeline.config.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.data_model.normalization.target = "2NF";
    writeFileSync(path, JSON.stringify(config, null, 2));
    const result = run(sandbox, "apply-profile.mjs", []);
    assert.notEqual(result.status, 0);
  });

  test("forces migration and integration proof for schema changes, not ordinary source work", () => {
    sandbox = relationalProject();
    const config = JSON.parse(readFileSync(join(sandbox, "pipeline.config.json"), "utf8"));
    const schemaGates = gatesForIssue(["db/migrations/0002-books.sql"], config);
    assert.ok(schemaGates.includes("migrations"));
    assert.ok(schemaGates.includes("test_integration"));
    const sourceGates = gatesForIssue(["src/catalogue/service.ts"], config);
    assert.ok(!sourceGates.includes("migrations"));
    assert.ok(!sourceGates.includes("test_integration"));
  });

  test("refuses to defer either proof to final closure", () => {
    sandbox = relationalProject({ closure_gates: ["migrations"] });
    const result = run(sandbox, "apply-profile.mjs", []);
    assert.notEqual(result.status, 0);
  });
});
