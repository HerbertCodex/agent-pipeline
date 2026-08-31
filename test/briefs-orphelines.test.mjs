import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, run, seedFramework } from "./harness.mjs";
import { orphanGates, stripUndeclaredGates, answered } from "../scripts/gates.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

const MINIMAL = {
  commands: { check: "true", lint: "true" },
  file_policy: {},
};

/**
 * Prepares a sandbox with one document directory of its own.
 *
 * @param document - content of the single source document
 * @param commands - commands the project declares
 * @returns the sandbox root
 */
function withDocument(document, commands = { check: "true" }) {
  const root = createSandbox();
  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.docs_dirs = ["docs/stack"];
  config.commands = commands;
  writeFileSync(path, JSON.stringify(config, null, 2));
  mkdirSync(join(root, "docs", "stack"), { recursive: true });
  writeFileSync(join(root, "docs", "stack", "gates.md"), document);
  return root;
}

describe("a brief that prescribes a gate nothing answers for is refused", () => {
  test("the compilation stops and names the gate", () => {
    sandbox = withDocument("<!-- brief:implementer -->\n`dead_code` refuses an unused export.\n<!-- /brief -->\n");
    const result = run(sandbox, "sync-briefs.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /dead_code/);
    assert.match(
      result.output,
      /binds nobody|Declare the command/i,
      "the refusal says what to do, or the reader deletes the sentence and loses the rule",
    );
  });

  test("declaring the command is enough to make it legitimate", () => {
    sandbox = withDocument(
      "<!-- brief:implementer -->\n`dead_code` refuses an unused export.\n<!-- /brief -->\n",
      { check: "true", dead_code: "true" },
    );
    const result = run(sandbox, "sync-briefs.mjs", []);
    assert.equal(result.status, 0, result.output);
  });

  test("shipping a script is not answering for it", () => {
    // The framework ships dead-code.mjs, and that changes nothing here: QA
    // invokes a gate by its key and CI renders a step per key, so a gate the
    // configuration does not declare is a gate nobody runs. Accepting a
    // shipped script silenced the check for exactly the rules it exists to
    // catch.
    assert.equal(answered("dead_code", MINIMAL), false);
    assert.equal(answered("check", MINIMAL), true);
  });

  test("an enumeration without a verb is caught too", () => {
    // The pattern that found this class of defect matched `name` + a
    // prescriptive verb, and a battery listed as `check`, `lint`, `sast`
    // carries no verb at all — which is exactly how the longest list of
    // orphan rules stayed invisible.
    const battery = "Per-issue battery: `check`, `lint`, `sast`, `doc_lint`.";
    assert.deepEqual(orphanGates(battery, MINIMAL), ["sast", "doc_lint"]);
  });

  test("a configuration key is not a gate, whatever verb follows it", () => {
    const prose = "`file_policy` forbids the path, and `pipeline_state` carries the phase.";
    assert.deepEqual(orphanGates(prose, { ...MINIMAL, file_policy: {}, pipeline_state: {} }), []);
  });
});

describe("a passage can depend on a gate, and disappear without it", () => {
  test("the block is dropped when nothing answers for the gate", () => {
    const document = "Before.\n<!-- gate:sast -->\n`sast` refuses eval.\n<!-- /gate -->\nAfter.\n";
    const kept = stripUndeclaredGates(document, MINIMAL);
    assert.ok(!kept.includes("sast"), kept);
    assert.match(kept, /Before/);
    assert.match(kept, /After/);
  });

  test("the block is kept, markers gone, when the gate exists", () => {
    const document = "Before.\n<!-- gate:sast -->\n`sast` refuses eval.\n<!-- /gate -->\nAfter.\n";
    const kept = stripUndeclaredGates(document, { commands: { sast: "true" } });
    assert.match(kept, /`sast` refuses eval/);
    assert.ok(!kept.includes("<!-- gate:"), kept);
    assert.ok(!kept.includes("<!-- /gate -->"), kept);
  });

  test("the brief compiles when the rule is conditioned rather than removed", () => {
    sandbox = withDocument(
      "<!-- brief:implementer -->\n## Gates\n\n<!-- gate:dead_code -->\n`dead_code` refuses an unused export.\n<!-- /gate -->\n\nAlways true.\n<!-- /brief -->\n",
    );
    const result = run(sandbox, "sync-briefs.mjs", []);
    assert.equal(result.status, 0, result.output);
    const brief = readFileSync(join(sandbox, "pipeline", "briefs", "implementer.md"), "utf8");
    assert.match(brief, /Always true/);
    assert.ok(!brief.includes("dead_code"), "a rule that binds nobody was compiled into the brief anyway");
  });
});

describe("the framework's own documents pass on a bare project", () => {
  test("a project declaring only the mandatory commands gets no orphan rule", () => {
    // The measurement that started this: nine orphan rules across the four
    // briefs of a real project, in the pages that teach the rules.
    const config = {
      commands: Object.fromEntries(
        ["check", "lint", "build", "test_unit", "audit", "secrets_scan", "project_map", "design_limits", "duplication", "smoke"]
          .map((key) => [key, "true"]),
      ),
      file_policy: {},
    };
    const OPEN = /<!--\s*brief:([a-z-,\s]+?)\s*-->/g;
    const CLOSE = "<!-- /brief -->";
    const docs = join(import.meta.dirname, "..", "docs");
    let composed = "";
    for (const name of readdirSync(docs).filter((file) => file.endsWith(".md"))) {
      const text = stripUndeclaredGates(readFileSync(join(docs, name), "utf8"), config);
      let match;
      OPEN.lastIndex = 0;
      while ((match = OPEN.exec(text)) !== null) {
        const start = match.index + match[0].length;
        const end = text.indexOf(CLOSE, start);
        composed += text.slice(start, end);
        OPEN.lastIndex = end + CLOSE.length;
      }
    }
    assert.deepEqual(orphanGates(composed, config), []);
  });
});

describe("a prompt is held to the same rule as a brief", () => {
  test("a prompt naming an undeclared gate stops apply-profile", () => {
    sandbox = createSandbox();
    seedFramework(sandbox);
    const path = join(sandbox, "pipeline.config.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.commands = Object.fromEntries(
      ["check", "lint", "build", "test_unit", "audit", "secrets_scan", "project_map", "design_limits", "duplication", "smoke"]
        .map((key) => [key, "true"]),
    );
    config.architecture = { id: "feature-modules", project_type: "backend" };
    config.project_map = { out: "docs/map.md", roots: ["src"], regenerate: "true" };
    config.file_policy = { ...config.file_policy, orchestrator: { allow: ["pipeline/store/**", "docs/map.md"] } };
    writeFileSync(path, JSON.stringify(config, null, 2));
    writeFileSync(
      join(sandbox, "agent-pipeline", "prompts", "qa.md"),
      "# QA\n\n`mutation` refuses a surviving mutant.\n",
    );
    const result = run(sandbox, "apply-profile.mjs", []);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /mutation/);
  });

  test("the framework's own prompts render clean on a bare project", () => {
    // Whichever gates a project declares, the prompts must not prescribe one
    // it does not have: a prompt is the first thing a role reads.
    sandbox = createSandbox();
    seedFramework(sandbox);
    const path = join(sandbox, "pipeline.config.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.commands = Object.fromEntries(
      ["check", "lint", "build", "test_unit", "audit", "secrets_scan", "project_map", "design_limits", "duplication", "smoke"]
        .map((key) => [key, "true"]),
    );
    config.architecture = { id: "feature-modules", project_type: "backend" };
    config.project_map = { out: "docs/map.md", roots: ["src"], regenerate: "true" };
    config.file_policy = { ...config.file_policy, orchestrator: { allow: ["pipeline/store/**", "docs/map.md"] } };
    writeFileSync(path, JSON.stringify(config, null, 2));
    const result = run(sandbox, "apply-profile.mjs", []);
    assert.equal(result.status, 0, result.output);
    const qa = readFileSync(join(sandbox, ".claude", "agents", "qa.md"), "utf8");
    assert.ok(!qa.includes("mutation"), "a rule binding nobody was rendered into the prompt");
    assert.ok(!qa.includes("<!-- gate:"), "the marker itself must not reach the reader");
    const policy = readFileSync(join(sandbox, "AGENTS.md"), "utf8");
    assert.ok(!policy.includes("dead_code"), "AGENTS.md must not promise a gate the project omitted");
    assert.match(policy, /No remote CI is configured/);
  });
});
