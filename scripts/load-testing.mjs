import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { atomicWrite, loadConfig } from "./lib.mjs";
import { runStep as defaultRunStep } from "./setup-runner.mjs";
import { waitForHealth } from "./security-scan.mjs";

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

function relativePath(value, name) {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    throw new Error(`${name} must stay inside the project`);
  }
}

/** Validates a project-owned performance command separately from ZAP. */
export function validateLoadTesting(value, security, env = process.env) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("load_testing must be an object");
  if (value.version !== 1) throw new Error("load_testing.version must be 1");
  if (typeof value.command !== "string" || value.command.trim().length === 0) throw new Error("load_testing.command is required");
  if (!ENV_NAME.test(value.target_env ?? "")) throw new Error("load_testing.target_env is malformed");
  if (!Array.isArray(value.allowed_targets) || value.allowed_targets.length === 0) throw new Error("load_testing.allowed_targets is required");
  const target = env[value.target_env];
  if (!target || !value.allowed_targets.includes(target)) throw new Error(`${value.target_env} must exactly match load_testing.allowed_targets`);
  if (!Number.isSafeInteger(value.timeout_seconds) || value.timeout_seconds <= 0) throw new Error("load_testing.timeout_seconds must be a positive integer");
  relativePath(value.reports_dir, "load_testing.reports_dir");
  relativePath(value.summary_file, "load_testing.summary_file");
  if (!Array.isArray(value.result_files)) throw new Error("load_testing.result_files must be a list");
  for (const file of value.result_files) relativePath(file, "load_testing.result_files entry");
  if (!value.result_files.includes(value.summary_file)) throw new Error("load_testing.summary_file must be listed in result_files");
  if (value.use_security_environment === true && security?.environment?.disposable !== true) {
    throw new Error("load testing requires a disposable security environment");
  }
  if (value.use_security_environment === true && security?.environment?.external_side_effects !== "disabled") {
    throw new Error("load testing requires external side effects to be disabled");
  }
  return value;
}

function gitRevision(cwd) {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

const failed = (result) => result.code !== 0 || result.timed_out || result.interrupted || result.error;

function loadSummary(path) {
  let raw;
  try { raw = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new Error(`load summary cannot be read: ${error.message}`); }
  const required = ["requests", "error_rate", "p95_ms", "p99_ms", "throughput_per_second"];
  if (raw.metrics == null || typeof raw.metrics !== "object" || Array.isArray(raw.metrics)) throw new Error("load summary metrics must be an object");
  const metrics = {};
  for (const key of required) {
    if (!Number.isFinite(raw.metrics[key]) || raw.metrics[key] < 0) throw new Error(`load summary metric ${key} must be a non-negative number`);
    metrics[key] = raw.metrics[key];
  }
  if (raw.thresholds == null || typeof raw.thresholds !== "object" || Array.isArray(raw.thresholds) || Object.keys(raw.thresholds).length === 0) {
    throw new Error("load summary thresholds must be a non-empty object");
  }
  for (const [key, value] of Object.entries(raw.thresholds)) {
    if (!required.includes(key)) throw new Error(`load summary threshold ${key} does not name a normalized metric`);
    if (!["string", "number"].includes(typeof value)) throw new Error(`load summary threshold ${key} must be a string or number`);
  }
  const thresholds = Object.fromEntries(Object.entries(raw.thresholds).map(([key, value]) => [key, String(value)]));
  return { metrics, thresholds };
}

/** Runs the declared load tool and records its duration and declared artifacts. */
export async function runLoadTest(value, security, dependencies = {}) {
  const cwd = resolve(dependencies.cwd ?? process.cwd());
  const env = dependencies.env ?? process.env;
  const load = validateLoadTesting(value, security, env);
  const runStep = dependencies.runStep ?? defaultRunStep;
  const health = dependencies.waitForHealth ?? waitForHealth;
  const gitSha = dependencies.gitSha ?? (() => gitRevision(cwd));
  const reportsDir = resolve(cwd, load.reports_dir);
  mkdirSync(reportsDir, { recursive: true });
  const evidenceDir = resolve(reportsDir, `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID()}`);
  mkdirSync(evidenceDir, { recursive: true });
  const record = {
    kind: "load", target: env[load.target_env], commit_sha: gitSha(),
    started_at: new Date().toISOString(), status: "running", duration_ms: 0,
    result_files: [], evidence_dir: evidenceDir,
  };
  const started = performance.now();
  let primaryError = null;
  let startedEnvironment = false;
  try {
    if (load.use_security_environment) {
      const start = await runStep("start security environment", security.environment.start, [], { cwd, shell: true, timeoutMs: 120000, env });
      if (failed(start)) throw new Error("security environment start failed");
      startedEnvironment = true;
      await health(security.environment.health_url, security.environment.health_timeout_seconds);
      if (security.environment.prepare) {
        const prepare = await runStep("prepare security data", security.environment.prepare, [], { cwd, shell: true, timeoutMs: 120000, env });
        if (failed(prepare)) throw new Error("security data preparation failed");
      }
    }
    const result = await runStep("load test", load.command, [], { cwd, shell: true, timeoutMs: load.timeout_seconds * 1000, env: { ...env, PIPELINE_LOAD_EVIDENCE_DIR: evidenceDir } });
    record.exit_code = result.code;
    if (failed(result)) throw new Error("load test failed");
    record.status = "passed";
  } catch (error) {
    primaryError = error;
    record.status = "failed";
    record.error = error.message;
  } finally {
    if (startedEnvironment) {
      const stop = await runStep("stop security environment", security.environment.stop, [], { cwd, shell: true, timeoutMs: 120000, env });
      if (failed(stop) && primaryError == null) {
        primaryError = new Error("security environment cleanup failed");
        record.status = "failed";
        record.error = primaryError.message;
      }
    }
    record.duration_ms = Math.round(performance.now() - started);
    record.finished_at = new Date().toISOString();
    record.result_files = load.result_files.filter((file) => existsSync(resolve(evidenceDir, file)));
    const missing = load.result_files.filter((file) => !record.result_files.includes(file));
    if (missing.length > 0 && primaryError == null) {
      primaryError = new Error(`load test missing declared result files: ${missing.join(", ")}`);
      record.status = "failed";
      record.error = primaryError.message;
    }
    if (missing.length === 0 && primaryError == null) {
      try { record.summary = loadSummary(resolve(evidenceDir, load.summary_file)); }
      catch (error) {
        primaryError = error;
        record.status = "failed";
        record.error = error.message;
      }
    }
    atomicWrite(join(evidenceDir, "run.json"), `${JSON.stringify(record, null, 2)}\n`);
  }
  if (primaryError) throw primaryError;
  return record;
}

async function main() {
  const config = loadConfig();
  const result = await runLoadTest(config.load_testing, config.security_testing);
  console.log(`load evidence: ${join(result.evidence_dir, "run.json")}`);
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
