import { loadConfig, fail } from "./lib.mjs";
import { writeTaskPackage } from "./task-package.mjs";
import { runAgent } from "./agent-driver.mjs";

const [issueId, role] = process.argv.slice(2).filter((arg) => arg !== "--json");
const json = process.argv.includes("--json");
if (!issueId || !role) fail("usage: dispatch.mjs <issue-id> <role> [--json]");

try {
  const config = loadConfig();
  const packagePath = writeTaskPackage(issueId, role, config);
  process.exitCode = await runAgent(role, packagePath, config, json);
} catch (error) {
  fail(error.message);
}
