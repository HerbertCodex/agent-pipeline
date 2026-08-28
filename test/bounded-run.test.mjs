import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, issue, run, state } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

function projectAt(version) {
  sandbox = createSandbox({ issues: [issue({ pipeline_state: state({ version }) })] });
  const path = join(sandbox, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.workflow = { max_transitions_per_run: 4 };
  writeFileSync(path, JSON.stringify(config));
  return sandbox;
}

describe("an orchestration run is bounded without forcing one cold start per transition", () => {
  test("one nominal four-transition issue cycle fits", () => {
    const root = projectAt(5);
    const result = run(root, "next-step.mjs", ["--assert-advanced", "i-t1", "1"]);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /4\/4 transition/);
  });

  test("a fifth transition overflows the run", () => {
    const root = projectAt(6);
    const result = run(root, "next-step.mjs", ["--assert-advanced", "i-t1", "1"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /above the run limit 4/);
  });

  test("zero progress remains a failure", () => {
    const root = projectAt(1);
    const result = run(root, "next-step.mjs", ["--assert-advanced", "i-t1", "1"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /did not advance/);
  });
});
