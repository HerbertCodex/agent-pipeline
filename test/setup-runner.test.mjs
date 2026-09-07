import { test } from "node:test";
import assert from "node:assert/strict";
import { runStep } from "../scripts/setup-runner.mjs";

test("setup runner records a successful process and its duration", async () => {
  const result = await runStep("fixture", process.execPath, ["-e", "process.exit(0)"]);
  assert.equal(result.code, 0);
  assert.equal(result.timed_out, false);
  assert.ok(result.duration_ms >= 0);
});

test("setup runner identifies unavailable executables", async () => {
  const result = await runStep("missing", "pipeline-nonexistent-setup-tool");
  assert.ok(result.error);
  assert.notEqual(result.code, 0);
});

test("setup runner terminates a process that ignores the first timeout signal", async () => {
  const result = await runStep("timeout", process.execPath,
    ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { timeoutMs: 300 });
  assert.equal(result.timed_out, true);
  assert.notEqual(result.code, 0);
  assert.ok(result.duration_ms < 5000);
});
