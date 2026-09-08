import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "./lib.mjs";
import { validateLoadTesting } from "./load-testing.mjs";
import { validateSecurityTesting, zapExecutionBudgetMinutes } from "./security-testing.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MATRIX_TEMPLATE = join(HERE, "..", "templates", "owasp-top10-2025.template.json");

function writeNew(path, body) {
  if (existsSync(path)) throw new Error(`refusing to overwrite existing security file: ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

function ignored(path, entries) {
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = current.split(/\r?\n/);
  const missing = entries.filter((entry) => !lines.includes(entry));
  if (missing.length > 0) writeFileSync(path, `${current}${current.length === 0 || current.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
}

/** Installs a reviewed security contract into an already configured project. */
export function configureSecurity(inputPath, root = process.cwd()) {
  const configPath = join(root, "pipeline.config.json");
  const config = loadConfig(configPath);
  if (config.security_testing != null || config.load_testing != null) throw new Error("security testing is already configured; edit and review the existing contract");
  let input;
  try { input = JSON.parse(readFileSync(inputPath, "utf8")); }
  catch (error) { throw new Error(`security configuration input cannot be read: ${error.message}`); }
  const security = validateSecurityTesting(input.security_testing, "baseline", {}, { requireSecrets: false });
  if (input.load_testing != null) {
    validateLoadTesting(input.load_testing, security, { [input.load_testing.target_env]: input.load_testing.allowed_targets?.[0] });
  }
  const artifactUpload = input.ci_artifact_upload ?? config.ci?.artifact_upload;
  if (config.ci?.provider !== "none" && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/.test(artifactUpload?.uses ?? "")) {
    throw new Error("ci_artifact_upload.uses must pin the evidence upload action to an immutable 40-character commit SHA");
  }
  const next = { ...config, security_testing: security };
  next.commands = {
    ...config.commands,
    security_scope: "node agent-pipeline/scripts/security-scan.mjs check",
    dast_baseline: "node agent-pipeline/scripts/security-scan.mjs baseline",
    ...(security.allow_active ? { dast_active: "node agent-pipeline/scripts/security-scan.mjs active" } : {}),
    ...(security.allow_active && security.api ? { dast_api: "node agent-pipeline/scripts/security-scan.mjs api" } : {}),
    ...(input.load_testing ? { load: "node agent-pipeline/scripts/load-testing.mjs" } : {}),
  };
  if (input.load_testing) next.load_testing = input.load_testing;
  const deferred = ["dast_baseline", ...(security.allow_active ? ["dast_active"] : []), ...(security.allow_active && security.api ? ["dast_api"] : []), ...(input.load_testing ? ["load"] : [])];
  next.closure_gates = [...new Set([...(config.closure_gates ?? []), ...deferred])];
  const scheduledMinutes = 10
    + (security.allow_active ? zapExecutionBudgetMinutes(security, "active") : 0)
    + (security.allow_active && security.api ? zapExecutionBudgetMinutes(security, "api") : 0)
    + (input.load_testing ? Math.ceil(input.load_testing.timeout_seconds / 60) : 0);
  const pullRequestMinutes = zapExecutionBudgetMinutes(security, "baseline") + 10;
  const evidencePaths = [
    ...(config.ci?.artifacts?.paths ?? []),
    `${security.zap.reports_dir}/**/run.json`,
    ...(input.load_testing ? [`${input.load_testing.reports_dir}/**/run.json`] : []),
  ];
  next.ci = {
    ...config.ci,
    gate_events: {
      ...(config.ci?.gate_events ?? {}),
      dast_baseline: ["pull_request"],
      ...(security.allow_active ? { dast_active: ["schedule", "workflow_dispatch"] } : {}),
      ...(security.allow_active && security.api ? { dast_api: ["schedule", "workflow_dispatch"] } : {}),
      ...(input.load_testing ? { load: ["schedule", "workflow_dispatch"] } : {}),
    },
    timeout_minutes: Math.max(config.ci?.timeout_minutes ?? 0, scheduledMinutes, pullRequestMinutes),
    secret_environment: [...new Set([
      ...(config.ci?.secret_environment ?? []),
      ...Object.values(security.authentication?.credentials ?? {}).filter((value) => typeof value === "string"),
      ...(security.authentication?.method === "header" ? [security.authentication.value_env] : []),
    ])].sort(),
    environment: {
      ...(config.ci?.environment ?? {}),
      ...(input.load_testing ? { [input.load_testing.target_env]: input.load_testing.allowed_targets[0] } : {}),
    },
    artifacts: {
      name: config.ci?.artifacts?.name ?? "security-and-load-evidence",
      paths: [...new Set(evidencePaths)],
    },
    ...(artifactUpload ? { artifact_upload: artifactUpload } : {}),
  };

  const assurancePath = join(root, security.assurance.top10_2025);
  const findingsPath = join(root, security.accepted_findings);
  for (const path of [assurancePath, findingsPath]) {
    if (existsSync(path)) throw new Error(`refusing to overwrite existing security file: ${path}`);
  }
  writeNew(assurancePath, readFileSync(MATRIX_TEMPLATE, "utf8"));
  writeNew(findingsPath, "[]\n");
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
  ignored(join(root, ".gitignore"), [`/${security.zap.reports_dir}`, "/pipeline/.env.security.local", ...(input.load_testing ? [`/${input.load_testing.reports_dir}`] : [])]);
  return next;
}

function main() {
  const [input] = process.argv.slice(2);
  if (!input) throw new Error("usage: configure-security.mjs <reviewed-security-config.json>");
  const config = configureSecurity(input);
  console.log(`security testing configured with ${config.closure_gates.filter((key) => /^(?:dast_|load)/.test(key)).length} deferred deep gate(s)`);
  console.log("Run apply-profile.mjs to regenerate pipeline-owned instructions and CI, then run security-scan.mjs check.");
  console.log("Set the referenced secret environment variables before running authenticated scans.");
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
