import { archiveHandoff, extractHandoff } from "./handoff-archive.mjs";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
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
  const task = JSON.parse(taskPackage);
  const record = {
    issue_id: task.record?.id ?? null,
    attempt_id: task.attempt_id ?? runId,
    base_sha: task.base_sha ?? null,
    workspace: config.agent_runtime?.cwd ?? process.cwd(),
    workspace_branch: task.workspace?.branch ?? null,
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

  let captured = "";
  child.stdout.on("data", (chunk) => {
    captured = (captured + chunk.toString()).slice(-2_000_000);
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

  const gateDirectory = join(runtime.cwd ?? process.cwd(), config.agent_runtime?.runs_dir ?? join(config.store_dir, "runs"), "gates");
  if (existsSync(gateDirectory)) for (const name of readdirSync(gateDirectory).filter((file) => /^[a-f0-9-]+\.json$/.test(file))) {
    try {
      const report = JSON.parse(readFileSync(join(gateDirectory, name), "utf8"));
      if (report.attempt_id === run.record.attempt_id && report.issue_id === run.record.issue_id) {
        atomicWrite(join(config.agent_runtime?.runs_dir ?? join(config.store_dir, "runs"), "gates", name), JSON.stringify(report, null, 2) + "\n");
      }
    } catch { /* An invalid report is not evidence and is never imported. */ }
  }
  const endedAt = new Date().toISOString();
  const elapsedMs = Date.now() - started;
  let handoff = null;
  let handoffError = null;
  try {
    const document = extractHandoff(captured, config.handoffs_dir, runtime.cwd ?? process.cwd());
    if (document != null) {
      handoff = archiveHandoff(document, config.handoffs_dir);
      if (runtime.require_handoff) {
        if (document.attempt_id !== run.record.attempt_id || document.scope?.issue_id !== run.record.issue_id) throw new Error("Handoff does not match the dispatched attempt and issue");
        execFileSync(process.execPath, [fileURLToPath(new URL("./validate-handoff.mjs", import.meta.url)), resolve(handoff.path)], { encoding: "utf8", cwd: runtime.cwd ?? process.cwd() });
      }
    }
    else if (runtime.require_handoff && exitCode === 0 && !interrupted) throw new Error("Agent returned no complete handoff");
  } catch (error) { handoffError = error.message; exitCode = 1; }
  const status = interrupted ? "interrupted" : exitCode === 0 ? "completed" : "failed";
  persistRun(run, { status, ended_at: endedAt, elapsed_ms: elapsedMs, exit_code: exitCode, handoff, handoff_error: handoffError });
  if (interrupted) emit({ type: "interrupted", run_id: runId, role, at: endedAt }, json);
  emit({
    type: "completed",
    run_id: runId,
    role,
    exit_code: exitCode,
    elapsed_ms: elapsedMs,
    run_record: run.path,
    handoff,
    handoff_error: handoffError,
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
