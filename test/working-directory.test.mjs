import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK = resolve(HERE, "..");
const GUARD = "AGENT_PIPELINE_CWD_GUARD";

/**
 * Proves what the installation guide and the generated CI actually do: run
 * the suite from the host repository, not from the framework directory.
 *
 * A suite that resolves fixtures, shipped templates or the durable run store
 * against the working directory reads the host's files instead of its own,
 * and reports the host's state as its own result. That is invisible from
 * this repository, whose root is already the framework root.
 *
 * The guard replays the whole suite once from an unrelated directory.
 * Files are listed rather than globbed, because a glob left to the runner
 * needs a Node version this project does not require. `NODE_TEST_CONTEXT`
 * is removed because the runner sets it for every test process: inherited,
 * it makes the inner run report as a child instead of running, and the
 * guard then passes without having measured anything.
 */
test("the core suite passes from a working directory that is not the framework root", { skip: process.env[GUARD] === "1" }, () => {
  const files = readdirSync(HERE).filter((name) => name.endsWith(".test.mjs")).sort().map((name) => join(HERE, name));
  assert.ok(files.length > 1, "the guard found no suite to replay");
  const elsewhere = mkdtempSync(join(tmpdir(), "agent-pipeline-cwd-"));
  const env = { ...process.env, [GUARD]: "1" };
  delete env.NODE_TEST_CONTEXT;
  try {
    const result = spawnSync(process.execPath, ["--test", ...files], { cwd: elsewhere, encoding: "utf8", env });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  } finally {
    rmSync(elsewhere, { recursive: true, force: true });
  }
});
