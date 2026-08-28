import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adaptPrompt, promptAdapter, promptBody, rendersClaudeEntry } from "../scripts/runtime-adapters.mjs";
import { createSandbox, destroySandbox, run, seedFramework } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

const prompt = `---
name: implementer
tools: Read, Edit
model: inherit
---

You are the Implementer.
`;

describe("prompt adapters isolate harness metadata from the role contract", () => {
  test("portable prompts contain the shared body and no Claude metadata", () => {
    const rendered = adaptPrompt(prompt, "portable");
    assert.equal(rendered, "You are the Implementer.\n");
    assert.doesNotMatch(rendered, /^tools:/m);
  });

  test("Claude Code keeps its native metadata envelope", () => {
    const rendered = adaptPrompt(prompt, "claude-code", "implementer");
    assert.match(rendered, /^---\nname: implementer\n/);
    assert.match(rendered, /^tools: /m);
    assert.match(rendered, /You are the Implementer/);
    assert.equal(rendersClaudeEntry("claude-code"), true);
    assert.equal(rendersClaudeEntry("portable"), false);
  });

  test("existing Claude paths remain compatible while new neutral paths default portable", () => {
    assert.equal(promptAdapter({ prompts_dir: ".claude/agents" }), "claude-code");
    assert.equal(promptAdapter({ prompts_dir: "pipeline/agents" }), "portable");
    assert.equal(promptAdapter({ prompts_dir: ".claude/agents", agent_runtime: { prompt_adapter: "portable" } }), "portable");
  });

  test("malformed and unknown adapter inputs fail instead of silently changing a prompt", () => {
    assert.throws(() => promptBody("---\nname: x\nbody"), /not closed/);
    assert.throws(() => adaptPrompt(prompt, "mystery"), /unknown/);
    assert.throws(() => promptAdapter({ agent_runtime: { prompt_adapter: "mystery" } }), /unknown/);
  });
});

describe("apply-profile renders the selected harness surface", () => {
  test("a portable project gets plain prompts and no Claude entry point", () => {
    sandbox = createSandbox();
    seedFramework(sandbox);
    const configPath = join(sandbox, "pipeline.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.commands = {
      check: "true", lint: "true", build: "true", test_unit: "true", audit: "true",
      secrets_scan: "true", project_map: "true", design_limits: "true", duplication: "true", smoke: "true",
    };
    config.architecture = { id: "feature-modules", project_type: "backend" };
    config.project_map = { out: "docs/map.md", roots: ["src"], regenerate: "true" };
    config.file_policy.orchestrator.allow.push("docs/map.md");
    config.prompts_dir = "pipeline/agents";
    config.agent_runtime = { prompt_adapter: "portable", progress_interval_seconds: 20 };
    writeFileSync(configPath, JSON.stringify(config));

    const result = run(sandbox, "apply-profile.mjs", []);
    assert.equal(result.status, 0, result.output);
    const rendered = readFileSync(join(sandbox, "pipeline", "agents", "implementer.md"), "utf8");
    assert.match(rendered, /^You are the Implementer/);
    assert.doesNotMatch(rendered, /^tools:/m);
    assert.equal(existsSync(join(sandbox, "CLAUDE.md")), false);
    assert.equal(run(sandbox, "apply-profile.mjs", ["--check"]).status, 0);
  });
});
