import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configureDataModel } from "../scripts/configure-data-model.mjs";
import { checkDataModel } from "../scripts/data-model-check.mjs";
import { validateDataModelContract } from "../scripts/data-model-contract.mjs";
import { gatesForIssue } from "../scripts/gates.mjs";
import { createSandbox, destroySandbox, run, seedFramework } from "./harness.mjs";

let sandbox;
afterEach(() => { if (sandbox) destroySandbox(sandbox); sandbox = null; });

function evidence(root) {
  mkdirSync(join(root, "docs", "decisions"), { recursive: true });
  mkdirSync(join(root, "docs", "evidence"), { recursive: true });
  mkdirSync(join(root, "db", "migrations"), { recursive: true });
  writeFileSync(join(root, "docs", "decisions", "persistence.md"), "# Persistence\n");
  writeFileSync(join(root, "docs", "evidence", "account-plan.txt"), "Index Scan using accounts_tenant_email_uq\n");
  writeFileSync(join(root, "docs", "data-model.md"), "# Data model\n");
  writeFileSync(join(root, "db", "schema.sql"), "-- schema\n");
  writeFileSync(join(root, "db", "migrations", "0001.sql"), "-- migration\n");
}

function contract() {
  const decision = "docs/decisions/persistence.md";
  return {
    version: 1,
    title: "Accounts",
    database: { kind: "relational", workload: "oltp", dialect: "postgresql", schema_source: "db/schema.sql" },
    policy: {
      normalization: { target: "3NF", dependencies_complete: true, exceptions: decision },
      timestamps: { authority: "database", timezone: "UTC", created_at: "created_at", updated_at: "updated_at", exceptions: [{ entity: "audit_log", reason: "append only", decision }] },
      audit: { enabled: true, entity: "audit_log", actor: "actor_id", action: "action", resource_type: "resource_type", resource_id: "resource_id", occurred_at: "occurred_at", correlation_id: "correlation_id", append_only: true, secrets_excluded: true, retention_decision: decision },
      security: { parameterized_queries: true, least_privilege: true, separate_migration_identity: true, tls: "required", public_network: false, secrets_source: "secret_manager", default_classification: "internal", authorization_default: "deny", connection_limit: 20, statement_timeout_ms: 5000, decision },
      migrations: { strategy: "expand_contract", rollback_or_forward_fix: true, lock_budget_ms: 500, decision },
      recovery: { backups_encrypted: true, restore_target: "isolated", recovery_time_objective_minutes: 60, recovery_point_objective_minutes: 15, retention_decision: decision },
    },
    entities: [
      {
        name: "accounts",
        fields: [
          { name: "id", type: "uuid", nullable: false },
          { name: "tenant_id", type: "uuid", nullable: false, filterable: true },
          { name: "email", type: "text", nullable: false, filterable: true, classification: "restricted" },
          { name: "created_at", type: "timestamptz", nullable: false },
          { name: "updated_at", type: "timestamptz", nullable: false },
        ],
        primary_key: ["id"],
        candidate_keys: [["tenant_id", "email"]],
        functional_dependencies: [
          { determinant: ["id"], dependent: ["tenant_id", "email", "created_at", "updated_at"] },
          { determinant: ["tenant_id", "email"], dependent: ["id", "created_at", "updated_at"] },
        ],
        normalization: { atomic_values: true, no_repeating_groups: true, normal_form: "3NF" },
        ownership: { scope: "tenant", field: "tenant_id", row_level_security: "enabled" },
        indexes: [{ name: "accounts_tenant_email_uq", fields: ["tenant_id", "email"], unique: true }],
      },
      {
        name: "audit_log",
        fields: [
          { name: "id", type: "uuid", nullable: false },
          { name: "actor_id", type: "uuid", nullable: false },
          { name: "action", type: "text", nullable: false },
          { name: "resource_type", type: "text", nullable: false },
          { name: "resource_id", type: "uuid", nullable: false },
          { name: "occurred_at", type: "timestamptz", nullable: false },
          { name: "correlation_id", type: "text", nullable: false },
        ],
        primary_key: ["id"], candidate_keys: [],
        functional_dependencies: [{ determinant: ["id"], dependent: ["actor_id", "action", "resource_type", "resource_id", "occurred_at", "correlation_id"] }],
        normalization: { atomic_values: true, no_repeating_groups: true, normal_form: "3NF" },
        ownership: { scope: "system" }, indexes: [],
      },
    ],
    relations: [],
    access_patterns: [{ id: "account_lookup", entity: "accounts", filters: ["tenant_id", "email"], operators: { tenant_id: ["eq"], email: ["eq"] }, select: ["id", "email"], sort: [], pagination: "none", max_page_size: 1, audience: "authenticated", supporting_index: "accounts_tenant_email_uq", budget_ms: 20, representative_rows: 100000, plan_evidence: "docs/evidence/account-plan.txt" }],
    denormalizations: [],
    proofs: {
      anomalies: { gate: "test_data", replay: "per_issue" },
      authorization: { gate: "test_data", replay: "per_issue" },
      performance: { gate: "test_data_performance", replay: "closure" },
      database_security: { gate: "test_data", replay: "per_issue" },
      backup_restore: { gate: "test_backup_restore", replay: "closure" },
    },
  };
}

function prepared() {
  sandbox = createSandbox();
  evidence(sandbox);
  return sandbox;
}

describe("relational governance v2", () => {
  test("validates normalization, audit, ownership, filters and proof contracts", () => {
    const root = prepared();
    const config = { commands: { test_data: "true", test_data_performance: "true", test_backup_restore: "true" } };
    const result = validateDataModelContract(contract(), { root, config });
    assert.deepEqual(result.summary, { entities: 2, relations: 0, access_patterns: 1, denormalizations: 0, target_normal_form: "3NF", workload: "oltp" });
  });

  test("rejects a transitive dependency hidden behind a 3NF label", () => {
    const root = prepared();
    const value = contract();
    value.entities[0].fields.push({ name: "tenant_name", type: "text", nullable: false });
    value.entities[0].functional_dependencies.push({ determinant: ["tenant_id"], dependent: ["tenant_name"] });
    assert.throws(() => validateDataModelContract(value, { root }), /violates (?:2NF|3NF)/);
  });

  test("rejects relations to missing fields and access without tenant scope", () => {
    const root = prepared();
    const relation = contract();
    relation.relations.push({ from: { entity: "accounts", fields: ["missing"] }, to: { entity: "audit_log", fields: ["id"] }, cardinality: "many-to-one", on_delete: "restrict", on_update: "no_action" });
    assert.throws(() => validateDataModelContract(relation, { root }), /unknown field missing/);
    const access = contract();
    access.access_patterns[0].filters = ["email"];
    access.access_patterns[0].operators = { email: ["eq"] };
    assert.throws(() => validateDataModelContract(access, { root }), /ownership field tenant_id/);
  });

  test("rejects public classified fields, arbitrary filter operators and conflicting proof schedules", () => {
    const root = prepared();
    const publicData = contract();
    publicData.access_patterns[0].audience = "public";
    assert.throws(() => validateDataModelContract(publicData, { root }), /classified data/);
    const operator = contract();
    operator.access_patterns[0].operators.email = ["raw_sql"];
    assert.throws(() => validateDataModelContract(operator, { root }), /unsupported filter operator/);
    const replay = contract();
    replay.proofs.performance = { gate: "test_data", replay: "closure" };
    assert.throws(() => validateDataModelContract(replay, { root }), /conflicting replay points/);
  });

  test("requires timestamps and measured denormalization gains", () => {
    const root = prepared();
    const missingTimestamp = contract();
    missingTimestamp.entities[0].fields = missingTimestamp.entities[0].fields.filter((field) => field.name !== "updated_at");
    missingTimestamp.entities[0].functional_dependencies[0].dependent = missingTimestamp.entities[0].functional_dependencies[0].dependent.filter((field) => field !== "updated_at");
    missingTimestamp.entities[0].functional_dependencies[1].dependent = missingTimestamp.entities[0].functional_dependencies[1].dependent.filter((field) => field !== "updated_at");
    assert.throws(() => validateDataModelContract(missingTimestamp, { root }), /must carry non-null updated_at/);
    const denormalized = contract();
    denormalized.denormalizations.push({ entity: "accounts", fields: ["email"], reason: "lookup", consistency_strategy: "transaction", review_trigger: "at 1M rows", decision: "docs/decisions/persistence.md", benchmark: { evidence: "docs/evidence/account-plan.txt", representative_rows: 100000, before_ms: 10, after_ms: 12 } });
    assert.throws(() => validateDataModelContract(denormalized, { root }), /does not demonstrate a latency gain/);
  });

  test("upgrades an existing profile without overwriting application artifacts", () => {
    const root = prepared();
    seedFramework(root);
    const configPath = join(root, "pipeline.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.commands = {
      check: "true", lint: "true", build: "true", test_unit: "true", audit: "true", secrets_scan: "true",
      project_map: "true", design_limits: "true", duplication: "true", smoke: "true", migrations: "true",
      test_data: "true", test_data_performance: "true", test_backup_restore: "true",
    };
    config.test_suites = { ...config.test_suites, integration: { gate: "test_data", replay: "per_issue" } };
    config.workflow = { gates: { normal: ["check"] } };
    config.architecture = { id: "feature-modules", project_type: "backend" };
    config.project_map = { out: "docs/map.md", roots: ["src"], regenerate: "true" };
    config.file_policy = { ...config.file_policy, orchestrator: { allow: ["pipeline/store/**", "docs/map.md"] } };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const input = { data_model: { decision: "docs/decisions/persistence.md", model: "docs/data-model.md", schema: "db/schema.sql", migrations: "db/migrations", migration_gate: "migrations", integration_suite: "integration", contract: "docs/data-model.contract.json" }, contract: contract() };
    const inputPath = join(root, "reviewed.json");
    writeFileSync(inputPath, JSON.stringify(input));
    const next = configureDataModel(inputPath, root);
    assert.equal(next.data_model.governance_version, 2);
    assert.equal(next.commands.data_model, "node agent-pipeline/scripts/data-model-check.mjs");
    const gates = gatesForIssue(["db/schema.sql"], next);
    assert.ok(gates.includes("data_model"));
    assert.ok(gates.includes("migrations"));
    assert.ok(gates.includes("test_data"));
    assert.ok(!gates.includes("test_data_performance"));
    const checked = checkDataModel(root);
    assert.equal(checked.report.controls.find((item) => item.name === "auditability").status, "contract_verified");
    assert.match(readFileSync(checked.path, "utf8"), /backup_recovery/);
    const applied = run(root, "apply-profile.mjs", []);
    assert.equal(applied.status, 0, JSON.stringify(applied));
  });
});
