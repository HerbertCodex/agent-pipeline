import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, writeJson, run } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

function configure(runtime) {
  sandbox = createSandbox();
  const path = join(sandbox, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.agent_runtime = runtime;
  writeFileSync(path, JSON.stringify(config, null, 2));
  return writeJson(sandbox, "package.json", { task: "bounded work" });
}

describe("the agent runtime is a command adapter, not a vendor dependency", () => {
  test("streams child output and periodic progress as portable events", () => {
    const packagePath = configure({
      command: process.execPath,
      args: ["-e", "setTimeout(() => console.log(process.argv[1]), 130)", "{role}:{package}"],
      progress_interval_seconds: 0.05,
    });
    const result = run(sandbox, "agent-driver.mjs", ["implementer", packagePath, "--json"]);
    assert.equal(result.status, 0, result.output);
    const events = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(events[0].type, "started");
    assert.ok(events.some((event) => event.type === "heartbeat"), result.output);
    assert.ok(events.some((event) => event.type === "output" && event.text.includes("implementer:")));
    assert.equal(events.at(-1).type, "completed");
    const files = readdirSync(join(sandbox, "pipeline", "store", "runs"));
    assert.equal(files.length, 1);
    const record = JSON.parse(readFileSync(join(sandbox, "pipeline", "store", "runs", files[0]), "utf8"));
    assert.equal(record.run_id, events[0].run_id);
    assert.equal(record.role, "implementer");
    assert.equal(record.status, "completed");
    assert.equal(record.exit_code, 0);
    assert.equal(typeof record.process_id, "number");
    assert.match(record.package_sha256, /^[a-f0-9]{64}$/);
    assert.equal(events.at(-1).run_record, join("pipeline", "store", "runs", files[0]));
  });

  test("passes the durable run identity to the child process", () => {
    const packagePath = configure({
      command: process.execPath,
      args: ["-e", "console.log(process.env.AGENT_PIPELINE_RUN_ID)"],
      progress_interval_seconds: 1,
    });
    const result = run(sandbox, "agent-driver.mjs", ["qa", packagePath, "--json"]);
    assert.equal(result.status, 0, result.output);
    const events = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.type === "output" && event.text.trim() === events[0].run_id));
  });

  test("refuses to pretend an agent ran when no adapter is configured", () => {
    const packagePath = configure({});
    const result = run(sandbox, "agent-driver.mjs", ["implementer", packagePath]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /agent_runtime\.command/);
  });
});
