import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { atomicWrite, loadConfig, loadRules, sha256, fail } from "./lib.mjs";

/**
 * Replaces exact runtime placeholders without invoking a shell.
 *
 * @param value - configured argument
 * @param role - role name
 * @param packagePath - task package path
 * @returns rendered argument
 */
function renderArgument(value, role, packagePath) {
  return String(value).replaceAll("{role}", role).replaceAll("{package}", packagePath);
}

/**
 * Prints one portable lifecycle event in machine or human form.
 *
 * @param event - event payload
 * @param json - whether stdout is NDJSON
 */
function emit(event, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
    return;
  }
  if (event.type === "started") {
    console.log(`[agent] ${event.role} started (${event.run_id})`);
  } else if (event.type === "heartbeat") {
    console.log(`[agent] ${event.role} still working — ${Math.round(event.elapsed_ms / 1000)}s elapsed`);
  } else if (event.type === "output") {
    process.stdout.write(event.text);
  } else if (event.type === "completed") {
    console.log(`[agent] ${event.role} completed with exit ${event.exit_code}`);
  } else if (event.type === "interrupted") {
    console.log(`[agent] ${event.role} interrupted`);
  }
}

function runRecord(config, runId, role, packagePath, startedAt) {
  const directory = config.agent_runtime?.runs_dir ?? join(config.store_dir, "runs");
  const path = join(directory, `${runId}.json`);
  const taskPackage = readFileSync(packagePath, "utf8");
  const record = {
    schema_version: 1,
    run_id: runId,
    role,
    package: relative(process.cwd(), packagePath),
    package_sha256: sha256(taskPackage),
    adapter: config.agent_runtime.command,
    parent_process_id: process.pid,
    process_id: null,
    status: "starting",
    started_at: startedAt,
    ended_at: null,
    elapsed_ms: null,
    exit_code: null,
  };
  atomicWrite(path, `${JSON.stringify(record, null, 2)}\n`);
  return { path, record };
}

function persistRun(run, changes) {
  Object.assign(run.record, changes);
  atomicWrite(run.path, `${JSON.stringify(run.record, null, 2)}\n`);
}

/**
 * Runs one configured agent command while streaming output and heartbeats.
 *
 * The core knows no vendor CLI. The executable and its argument vector come
 * from `agent_runtime`; `{role}` and `{package}` are the only substitutions.
 * `shell: false` keeps the task package data from becoming a command.
 *
 * @param role - pipeline role
 * @param packagePath - validated task package path
 * @param config - project configuration
 * @param json - emit NDJSON events
 * @returns the child exit code
 */
export async function runAgent(role, packagePath, config, json = false) {
  const runtime = config.agent_runtime ?? {};
  if (typeof runtime.command !== "string" || runtime.command.trim().length === 0) {
    throw new Error(
      "agent_runtime.command missing: configure the CLI adapter for this harness, or hand the package path to it manually",
    );
  }
  if (!Array.isArray(runtime.args)) throw new Error("agent_runtime.args must be a list");

  const args = runtime.args.map((value) => renderArgument(value, role, packagePath));
  const intervalSeconds = Number(runtime.progress_interval_seconds ?? 20);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error("agent_runtime.progress_interval_seconds must be a positive number");
  }
  const intervalMs = Math.max(50, intervalSeconds * 1000);
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  const run = runRecord(config, runId, role, packagePath, startedAt);
  emit({ type: "started", run_id: runId, role, package: packagePath, at: startedAt }, json);

  const child = spawn(runtime.command, args, {
    cwd: runtime.cwd ?? process.cwd(),
    env: {
      ...process.env,
      AGENT_PIPELINE_RUN_ID: runId,
      AGENT_PIPELINE_ROLE: role,
      AGENT_PIPELINE_TASK_PACKAGE: packagePath,
    },
    shell: false,
    stdio: ["inherit", "pipe", "pipe"],
  });
  persistRun(run, { status: "running", process_id: child.pid ?? null });

  child.stdout.on("data", (chunk) => {
    emit({ type: "output", run_id: runId, role, stream: "stdout", text: chunk.toString() }, json);
  });
  child.stderr.on("data", (chunk) => {
    emit({ type: "output", run_id: runId, role, stream: "stderr", text: chunk.toString() }, json);
  });

  const heartbeat = setInterval(() => {
    emit({ type: "heartbeat", run_id: runId, role, elapsed_ms: Date.now() - started }, json);
  }, intervalMs);

  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    child.kill("SIGTERM");
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  let exitCode;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
  } catch (error) {
    persistRun(run, {
      status: "failed",
      ended_at: new Date().toISOString(),
      elapsed_ms: Date.now() - started,
      exit_code: 1,
      error: error.message,
    });
    throw error;
  } finally {
    clearInterval(heartbeat);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }

  const endedAt = new Date().toISOString();
  const elapsedMs = Date.now() - started;
  const status = interrupted ? "interrupted" : exitCode === 0 ? "completed" : "failed";
  persistRun(run, { status, ended_at: endedAt, elapsed_ms: elapsedMs, exit_code: exitCode });
  if (interrupted) emit({ type: "interrupted", run_id: runId, role, at: endedAt }, json);
  emit({
    type: "completed",
    run_id: runId,
    role,
    exit_code: exitCode,
    elapsed_ms: elapsedMs,
    run_record: run.path,
    at: endedAt,
  }, json);
  return exitCode;
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  const [role, packagePath] = positional;
  if (!role || !packagePath) fail("usage: agent-driver.mjs <role> <package.json> [--json]");
  if (!existsSync(packagePath)) fail(`task package not found: ${packagePath}`);

  const config = loadConfig();
  const rules = loadRules();
  if (rules.phases == null || !Object.values(rules.phases).some((phase) => phase.owner === role)) {
    fail(`unknown pipeline role: ${role}`);
  }

  try {
    process.exitCode = await runAgent(role, packagePath, config, json);
  } catch (error) {
    fail(error.message);
  }
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
