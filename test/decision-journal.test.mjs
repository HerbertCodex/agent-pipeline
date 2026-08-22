import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, destroySandbox, writeJson, run } from "./harness.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

const BASE = {
  schema_version: 1,
  produced_at: "2026-08-21T09:00:00.000Z",
  mode: "architecture_decision_proposal",
  agent: "product",
  scope: { spec_id: "s-0001" },
  basis: { record_hash: "abc", pipeline_version: 1 },
  outcome: "awaiting_operator_decision",
  context: { heading: "## Context for orchestrator", body: "x" },
  decision: {
    title: "La couche d'interface vit dans src/lib/ui",
    because: "hors des adaptateurs, pour ne pas user la revue humaine obligatoire jusqu'a ce que plus personne ne la lise",
    consequences: "toute issue touchant l'interface reserve src/lib/ui, jamais src/adapters",
  },
};

/**
 * Writes a journal entry into the sandbox.
 *
 * @param name - file name under the journal directory
 * @param body - the entry's content
 * @returns the path relative to the project root
 */
function entry(name, body) {
  const relative = join("docs", "decisions", name);
  mkdirSync(join(sandbox, "docs", "decisions"), { recursive: true });
  writeFileSync(join(sandbox, relative), body);
  return relative;
}

/**
 * Submits a decision proposal.
 *
 * @param overrides - fields to merge into the handoff
 * @returns validate-handoff's result
 */
function propose(overrides = {}) {
  sandbox ??= createSandbox();
  return run(sandbox, "validate-handoff.mjs", [writeJson(sandbox, "h.json", { ...BASE, ...overrides })]);
}

describe("validate-handoff: a cross-spec decision reaches the journal, not just the spec", () => {
  test("refuses a decision that names no journal entry", () => {
    sandbox = createSandbox();
    const result = propose();
    assert.notEqual(result.status, 0);
    assert.match(result.output, /journal_entry/);
    assert.match(
      result.output,
      /next spec|another spec|cross-spec|outlive/i,
      "the refusal says what is lost, or it reads as one more field",
    );
  });

  test("refuses an entry the journal does not carry", () => {
    sandbox = createSandbox();
    const result = propose({ journal_entry: { path: "docs/decisions/0009-fantome.md" } });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /0009-fantome/);
  });

  test("refuses an entry written outside the journal", () => {
    sandbox = createSandbox();
    writeFileSync(join(sandbox, "ailleurs.md"), "# une decision\n");
    const result = propose({ journal_entry: { path: "ailleurs.md" } });
    assert.notEqual(result.status, 0);
    assert.match(
      result.output,
      /docs\/decisions/,
      "a decision filed elsewhere is a decision the next Product will not read",
    );
  });

  test("refuses an entry that does not carry the reason", () => {
    sandbox = createSandbox();
    const path = entry("0004-ui.md", "# La couche d'interface vit dans src/lib/ui\n\nVoila.\n");
    const result = propose({ journal_entry: { path } });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /because|reason/i);
  });

  test("accepts a decision the journal actually carries", () => {
    sandbox = createSandbox();
    const path = entry(
      "0004-ui.md",
      "# La couche d'interface vit dans src/lib/ui\n\n" +
        "hors des adaptateurs, pour ne pas user la revue humaine obligatoire jusqu'a ce que plus personne ne la lise\n\n" +
        "toute issue touchant l'interface reserve src/lib/ui, jamais src/adapters\n",
    );
    const result = propose({ journal_entry: { path } });
    assert.equal(result.status, 0, result.output);
  });

  test("refuses a decision with no consequence stated", () => {
    sandbox = createSandbox();
    const path = entry("0004-ui.md", "# t\n\nbecause x\n");
    const { consequences, ...without } = BASE.decision;
    void consequences;
    const result = propose({ decision: without, journal_entry: { path } });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /consequences/);
  });
});

describe("validate-handoff: a mode nobody implemented is refused, not ignored", () => {
  test("refuses a mode the validator does not know", () => {
    sandbox = createSandbox();
    const result = run(
      sandbox,
      "validate-handoff.mjs",
      [writeJson(sandbox, "h.json", { ...BASE, mode: "quelque_chose_invente" })],
    );
    assert.notEqual(result.status, 0);
    assert.match(result.output, /quelque_chose_invente/);
    assert.match(
      result.output,
      /known|recognised|spec_proposal/i,
      "a mode that passes unseen is a mode whose rules were never applied",
    );
  });
});
