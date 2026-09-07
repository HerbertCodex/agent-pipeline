import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dispatchPreflight } from "./dispatch-preflight.mjs";
import { prepareWorkspace } from "./agent-workspace.mjs";
import { loadConfig, fail } from "./lib.mjs";
import { writeTaskPackage } from "./task-package.mjs";
import { runAgent } from "./agent-driver.mjs";

const [issueId, role] = process.argv.slice(2).filter((arg) => arg !== "--json");
const json = process.argv.includes("--json");
if (!issueId || !role) fail("usage: dispatch.mjs <issue-id> <role> [--json]");

let lock;
try {
  const config = loadConfig();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(issueId)) throw new Error("Invalid issue id");
  if (typeof config.handoffs_dir !== "string" || !config.handoffs_dir) throw new Error("Configure handoffs_dir before dispatch");
  const locks = join(config.handoffs_dir, "dispatch-locks");
  mkdirSync(locks, { recursive: true });
  const candidate = join(locks, issueId);
  try { mkdirSync(candidate); } catch { throw new Error("Issue dispatch lock exists; inspect the active process before recovering a stale lock"); }
  lock = candidate;
  dispatchPreflight(issueId, role, config);
  const packagePath = writeTaskPackage(issueId, role, config);
  const task = JSON.parse(readFileSync(packagePath, "utf8"));
  const workspace = prepareWorkspace(task, config);
  writeFileSync(workspace.packagePath, JSON.stringify(task, null, 2) + "\n");
  process.exitCode = await runAgent(role, workspace.packagePath, {
    ...config, agent_runtime: { ...config.agent_runtime, cwd: workspace.path, require_handoff: true },
  }, json);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (lock) rmSync(lock, { recursive: true, force: true });
}
