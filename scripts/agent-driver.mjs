import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadConfig, loadRules, fail } from "./lib.mjs";

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
  const runId = randomUUID();
  emit({ type: "started", run_id: runId, role, package: packagePath, at: new Date().toISOString() }, json);

  const child = spawn(runtime.command, args, {
    cwd: runtime.cwd ?? process.cwd(),
    env: process.env,
    shell: false,
    stdio: ["inherit", "pipe", "pipe"],
  });

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

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  }).finally(() => {
    clearInterval(heartbeat);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  });

  if (interrupted) emit({ type: "interrupted", run_id: runId, role, at: new Date().toISOString() }, json);
  emit({
    type: "completed",
    run_id: runId,
    role,
    exit_code: exitCode,
    elapsed_ms: Date.now() - started,
    at: new Date().toISOString(),
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
