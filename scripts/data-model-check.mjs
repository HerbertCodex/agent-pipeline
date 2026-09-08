import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { atomicWrite, loadConfig } from "./lib.mjs";
import { readDataModelContract } from "./data-model-contract.mjs";

function git(args) {
  try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

/** Builds an honest report: this gate validates the contract while named proof gates execute behavior. */
export function checkDataModel(root = process.cwd(), { write = true } = {}) {
  const config = loadConfig(join(root, "pipeline.config.json"));
  const model = config.data_model;
  if (model?.governance_version !== 2 || typeof model.contract !== "string") {
    throw new Error("data_model governance v2 is not configured; run configure-data-model.mjs with a reviewed contract");
  }
  const validated = readDataModelContract(join(root, model.contract), { root, config });
  const controls = [
    ["normalization", "contract_verified", `Target ${validated.summary.target_normal_form}; declared functional dependencies checked.`],
    ["schema_integrity", "contract_verified", `${validated.summary.entities} entities and ${validated.summary.relations} relations reference existing fields and keys.`],
    ["timestamps", "contract_verified", "UTC policy, required created/updated field presence and reviewed exceptions checked."],
    ["auditability", "contract_verified", "Append-only audit shape, retention decision, correlation and secret exclusion checked."],
    ["query_performance", "proof_required", "Access patterns, supporting indexes, budgets and plan evidence checked; execute the named performance gate."],
    ["data_authorization", "proof_required", "Ownership filters and deny-by-default policy checked; execute the named authorization gate."],
    ["database_security", "proof_required", "Reviewed least-privilege, TLS, network and secret policy checked; execute the named security gate."],
    ["migration_safety", "proof_required", "Expand-contract and lock budget checked; execute the configured migration gate."],
    ["backup_recovery", "proof_required", "Execute the named restoration gate; configuration is not restoration evidence."],
  ].map(([name, status, statement]) => ({ name, status, statement }));
  const report = {
    version: 1,
    generated_at: new Date().toISOString(),
    revision: git(["rev-parse", "HEAD"]),
    working_tree: git(["status", "--short"]),
    contract: model.contract,
    summary: validated.summary,
    controls,
    proofs: {
      contract: { gate: "data_model", replay: "per_issue" },
      migrations: { gate: model.migration_gate, replay: "per_issue" },
      integration: { gate: config.test_suites?.[model.integration_suite]?.gate ?? null, replay: "per_issue" },
      ...validated.proofs,
    },
  };
  const path = join(root, model.reports_dir ?? "pipeline/evidence/data-model", "latest.json");
  const historyPath = join(root, model.reports_dir ?? "pipeline/evidence/data-model", `${report.generated_at.replaceAll(":", "-")}-${randomUUID()}.json`);
  if (write) {
    const body = `${JSON.stringify(report, null, 2)}\n`;
    atomicWrite(historyPath, body);
    atomicWrite(path, body);
  }
  return { report, path, historyPath };
}

function main() {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== "--check")) throw new Error("usage: data-model-check.mjs [--check]");
  const result = checkDataModel(process.cwd(), { write: !flags.includes("--check") });
  console.log(`data model contract: ok (${result.report.summary.entities} entities, ${result.report.summary.access_patterns} access patterns)`);
  if (!flags.includes("--check")) console.log(`evidence: ${result.path}`);
  if (!flags.includes("--check")) console.log(`history: ${result.historyPath}`);
  for (const control of result.report.controls) console.log(`${control.name}: ${control.status}`);
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
