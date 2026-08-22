import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, writeStore, writeJson, readRecord, recordHash, run, issue, state, seedFramework } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Prepares a sandbox holding one issue that fixes an escaped defect.
 *
 * @param overrides - fields to merge into that issue's record
 * @param pitfalls - content of the pitfalls document, or null to omit the file
 * @returns the sandbox root
 */
function withEscape(overrides = {}, pitfalls = "- A book id was read as an id.\n") {
  const root = createSandbox();
  const closed = issue({
    id: "i-0009",
    escaped_from: "i-0002",
    pipeline_state: state({ phase: "closed", owner: "none" }),
    acceptance_criteria: ["the swapped identifier is refused"],
    criteria_ledger: [{ status: "verified", evidence: "e2e run 41" }],
    ...overrides,
  });
  writeStore(root, "issues", [closed]);
  if (pitfalls != null) {
    mkdirSync(join(root, "agent-pipeline", "profiles", "test"), { recursive: true });
    writeFileSync(join(root, "agent-pipeline", "profiles", "test", "pitfalls.md"), pitfalls);
  }
  return root;
}

describe("store-verify: an escaped defect leaves a rule behind, not only a fix", () => {
  test("refuses to close an escaped-defect issue that prevents nothing", () => {
    sandbox = withEscape();
    const result = run(sandbox, "store-verify.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /prevention/);
    assert.match(
      result.output,
      /again|recur|next/i,
      "the refusal says what it is for, or it reads as one more field to fill",
    );
  });

  test("accepts a prevention that names the command now refusing it", () => {
    sandbox = withEscape({ prevention: { gate: "check" } });
    const result = run(sandbox, "store-verify.mjs");
    assert.equal(result.status, 0, result.output);
  });

  test("refuses a command that the configuration does not declare", () => {
    sandbox = withEscape({ prevention: { gate: "imaginary_gate" } });
    const result = run(sandbox, "store-verify.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /imaginary_gate/);
  });

  test("accepts a prevention written into the pitfalls document", () => {
    sandbox = withEscape({ prevention: { pitfall: "A book id was read as an id" } });
    const result = run(sandbox, "store-verify.mjs");
    assert.equal(result.status, 0, result.output);
  });

  test("refuses a pitfall the document does not actually carry", () => {
    sandbox = withEscape({ prevention: { pitfall: "something nobody wrote down" } });
    const result = run(sandbox, "store-verify.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /pitfall/);
  });

  test("refuses a prevention block that names neither", () => {
    sandbox = withEscape({ prevention: { note: "we will be careful" } });
    const result = run(sandbox, "store-verify.mjs");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /gate|pitfall/);
  });

  test("asks nothing of an issue that escaped nothing", () => {
    const root = createSandbox();
    writeStore(root, "issues", [
      issue({
        id: "i-0010",
        pipeline_state: state({ phase: "closed", owner: "none" }),
        acceptance_criteria: ["x"],
        criteria_ledger: [{ status: "verified", evidence: "e" }],
      }),
    ]);
    sandbox = root;
    const result = run(sandbox, "store-verify.mjs");
    assert.doesNotMatch(result.output, /prevention/);
  });

  test("asks nothing while the issue is still open", () => {
    sandbox = withEscape({ pipeline_state: state({ phase: "in_progress", owner: "implementer" }) });
    const result = run(sandbox, "store-verify.mjs");
    assert.doesNotMatch(result.output, /prevention/, "the question is asked at closure, when the answer is known");
  });
});

describe("apply-profile: a profile carries the traps it has already paid for", () => {
  test("refuses a profile with no pitfalls document", () => {
    const root = createSandbox();
    const path = join(root, "pipeline.config.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.commands = {
      check: "true",
      lint: "true",
      build: "true",
      test_unit: "true",
      audit: "true",
      secrets_scan: "true",
      project_map: "true",
      design_limits: "true",
      duplication: "true",
    smoke: "true",
    };
    config.architecture = { id: "feature-modules", project_type: "backend" };
    config.decisions_dir = "docs/decisions";
    writeFileSync(path, JSON.stringify(config, null, 2));
    seedFramework(root);
    rmSync(join(root, "agent-pipeline", "profiles", "test", "pitfalls.md"));
    sandbox = root;
    const result = run(root, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /pitfalls\.md/);
    assert.match(
      result.output,
      /escaped|paid for|again/i,
      "the refusal says what the file receives, or it becomes an empty file nobody reads",
    );
  });
});

describe("apply-profile: the decisions journal has a place, not only a mention", () => {
  /**
   * Prepares a configured sandbox, with the journal present or absent.
   *
   * @param decisions - value of the `decisions_dir` key, or null to omit it
   * @param create - whether the directory is created
   * @returns the sandbox root
   */
  function withJournal(decisions, create) {
    const root = createSandbox();
    seedFramework(root);
    const path = join(root, "pipeline.config.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.commands = {
      check: "true", lint: "true", build: "true", test_unit: "true", audit: "true",
      secrets_scan: "true", project_map: "true", design_limits: "true", duplication: "true", smoke: "true",
    };
    config.architecture = { id: "feature-modules", project_type: "backend" };
    // The sandbox declares a journal by default, since every other suite
    // needs a configured project. Its absence is staged here, not assumed.
    if (decisions == null) delete config.decisions_dir;
    else config.decisions_dir = decisions;
    writeFileSync(path, JSON.stringify(config, null, 2));
    // `seedFramework` creates the journal, since every other suite needs a
    // configured project. The absence is staged here, not assumed.
    if (!create) rmSync(join(root, "docs", "decisions"), { recursive: true, force: true });
    return root;
  }

  test("refuses a project that names no journal, though three prompts point at one", () => {
    sandbox = withJournal(null, false);
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /decisions_dir/);
    assert.match(
      result.output,
      /read it|points at|nowhere|no path/i,
      "the refusal says which instruction it makes possible, or it reads as one more key",
    );
  });

  test("refuses a journal named but never created", () => {
    sandbox = withJournal("docs/decisions", false);
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /docs\/decisions/);
  });

  test("accepts an empty journal, because a new project has decided nothing yet", () => {
    sandbox = withJournal("docs/decisions", true);
    const result = run(sandbox, "apply-profile.mjs", ["--check"]);
    assert.doesNotMatch(result.output, /decisions_dir/);
  });
});

describe("what store-verify demands, store-update can write", () => {
  test("an escape and its prevention are written through the one writer", () => {
    // Reported from a real spec: `store-verify` refuses to close an escaped
    // issue with no prevention, and no request field could set either. The
    // agent hand-edited a line of the store — the one thing the framework
    // forbids — and said so. Its two other ways out were both lies: drop
    // `escaped_from`, or name a gate that does not exist.
    const root = createSandbox();
    writeStore(root, "issues", [
      issue({ id: "i-old", pipeline_state: state({ phase: "closed", owner: "none" }) }),
      issue({ id: "i-fix" }),
    ]);
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id: "i-fix" },
      expected_record_hash: recordHash(root, "issues", "i-fix"),
      escaped_from: "i-old",
      prevention: { pitfall: "une phrase repetee est correcte pour un compilateur" },
    });
    const result = run(root, "store-update.mjs", [request]);
    assert.equal(result.status, 0, result.output);
    const stored = readRecord(root, "issues", "i-fix");
    assert.equal(stored.escaped_from, "i-old");
    assert.equal(stored.prevention.pitfall, "une phrase repetee est correcte pour un compilateur");
    destroySandbox(root);
  });

  test("an escape naming an issue the store does not carry is refused", () => {
    const root = createSandbox();
    writeStore(root, "issues", [issue({ id: "i-fix" })]);
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id: "i-fix" },
      expected_record_hash: recordHash(root, "issues", "i-fix"),
      escaped_from: "i-fantome",
    });
    const result = run(root, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /i-fantome/);
    destroySandbox(root);
  });

  test("a prevention naming neither a gate nor a pitfall is refused", () => {
    const root = createSandbox();
    writeStore(root, "issues", [issue({ id: "i-fix" })]);
    const request = writeJson(root, "r.json", {
      target: { kind: "issue", id: "i-fix" },
      expected_record_hash: recordHash(root, "issues", "i-fix"),
      prevention: { note: "on fera attention" },
    });
    const result = run(root, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /gate|pitfall/);
    destroySandbox(root);
  });
});
