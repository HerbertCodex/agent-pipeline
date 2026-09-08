import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./lib.mjs";
import { validateDataModelContract } from "./data-model-contract.mjs";

function readJson(path, label) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new Error(`${label} cannot be read: ${error.message}`); }
}

function appendIgnore(root, entry) {
  const path = join(root, ".gitignore");
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (current.split(/\r?\n/).includes(entry)) return;
  writeFileSync(path, `${current}${current.length === 0 || current.endsWith("\n") ? "" : "\n"}${entry}\n`);
}

/** Activates v2 data governance from a reviewed project-owned contract. */
export function configureDataModel(inputPath, root = process.cwd()) {
  const configPath = join(root, "pipeline.config.json");
  const config = loadConfig(configPath);
  if (config.data_model?.governance_version === 2) throw new Error("data-model governance v2 is already configured; review and edit its existing contract");
  const input = readJson(inputPath, "data-model configuration input");
  if (input?.data_model == null || input?.contract == null) throw new Error("input must contain data_model and contract");
  const contractPath = input.data_model.contract ?? "docs/data-model.contract.json";
  const reportsDir = input.data_model.reports_dir ?? "pipeline/evidence/data-model";
  for (const [label, path] of [["data_model.contract", contractPath], ["data_model.reports_dir", reportsDir]]) {
    const absolute = resolve(root, path);
    const base = resolve(root);
    if (isAbsolute(path) || (absolute !== base && !absolute.startsWith(`${base}${sep}`))) throw new Error(`${label} must stay inside the project`);
  }
  if (existsSync(join(root, contractPath))) throw new Error(`refusing to overwrite existing data-model contract: ${contractPath}`);
  if (input.contract.database?.schema_source !== input.data_model.schema) {
    throw new Error("contract.database.schema_source must match data_model.schema");
  }

  const commands = {
    ...config.commands,
    data_model: "node agent-pipeline/scripts/data-model-check.mjs",
  };
  const candidateConfig = { ...config, commands };
  const validated = validateDataModelContract(input.contract, { root, config: candidateConfig });
  const closureProofs = Object.values(validated.proofs).filter((proof) => proof.replay === "closure").map((proof) => proof.gate);
  const perIssueProofs = Object.values(validated.proofs).filter((proof) => proof.replay === "per_issue").map((proof) => proof.gate);
  for (const [name, suite] of Object.entries(config.test_suites ?? {})) {
    if (perIssueProofs.includes(suite.gate) && suite.replay === "closure") {
      throw new Error(`proof gate ${suite.gate} is deferred by test_suites.${name}; change that suite to per_issue`);
    }
  }

  const oldModel = config.data_model ?? {};
  const model = {
    ...oldModel,
    ...input.data_model,
    governance_version: 2,
    contract: contractPath,
    reports_dir: reportsDir,
    proof_gates: validated.proofs,
    normalization: {
      target: validated.contract.policy.normalization.target,
      exceptions: validated.contract.policy.normalization.exceptions,
    },
    timestamps: {
      authority: validated.contract.policy.timestamps.authority,
      timezone: "UTC",
      created_at: validated.contract.policy.timestamps.created_at,
      updated_at: validated.contract.policy.timestamps.updated_at,
      exceptions: validated.contract.policy.normalization.exceptions,
    },
  };
  const directClosure = new Set(config.closure_gates ?? []);
  perIssueProofs.forEach((gate) => directClosure.delete(gate));
  closureProofs.forEach((gate) => directClosure.add(gate));
  const evidenceGlob = `${reportsDir}/**/*.json`;
  const next = {
    ...config,
    commands,
    data_model: model,
    closure_gates: [...directClosure],
    risk: {
      ...config.risk,
      high: [...new Set([
        ...(config.risk?.high ?? []),
        model.schema,
        `${model.migrations}/**`,
        model.contract,
        "**/auth/**",
        "**/authorization/**",
      ])],
    },
    human_review_paths: [...new Set([
      ...(config.human_review_paths ?? []),
      model.contract,
      model.schema,
      `${model.migrations}/**`,
    ])],
    ci: {
      ...config.ci,
      artifacts: {
        name: config.ci?.artifacts?.name ?? "pipeline-evidence",
        paths: [...new Set([...(config.ci?.artifacts?.paths ?? []), evidenceGlob])],
      },
    },
  };

  mkdirSync(dirname(join(root, contractPath)), { recursive: true });
  writeFileSync(join(root, contractPath), `${JSON.stringify(input.contract, null, 2)}\n`, { flag: "wx" });
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
  appendIgnore(root, `/${reportsDir}`);
  return next;
}

function main() {
  const [input] = process.argv.slice(2);
  if (!input) throw new Error("usage: configure-data-model.mjs <reviewed-data-model.json>");
  const config = configureDataModel(input);
  console.log(`data-model governance v2 configured: ${config.data_model.contract}`);
  console.log("Run apply-profile.mjs, then data-model-check.mjs and the project-owned proof gates.");
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
