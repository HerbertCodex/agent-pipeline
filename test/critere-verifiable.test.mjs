import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createSandbox, destroySandbox, writeJson, run } from "./harness.mjs";
import { createHash } from "node:crypto";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

const PLAN = {
  schema_version: 1,
  produced_at: "2026-08-21T09:00:00.000Z",
  mode: "spec_plan",
  agent: "product",
  scope: { spec_id: "s-0001" },
  basis: { record_hash: "abc", pipeline_version: 1 },
  outcome: "plan_ready",
  context: { heading: "## Context for orchestrator", body: "x" },
};

/**
 * Prepares a project declaring a token file, and submits a plan.
 *
 * @param criteria - the acceptance criteria of the single issue
 * @param options - reservations, and the tokens the project declares
 * @returns validate-handoff's result
 */
function plan(criteria, { reservations = ["src/route.ts"], tokens = ["--font-display", "--ink"] } = {}) {
  sandbox = createSandbox();
  const path = join(sandbox, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.design_system = { tokens: "src/tokens.css", primitives: "own", decided_at: "2026-08-21" };
  writeFileSync(path, JSON.stringify(config, null, 2));
  const sheet = join(sandbox, "src", "tokens.css");
  mkdirSync(dirname(sheet), { recursive: true });
  writeFileSync(sheet, `:root {\n${tokens.map((t) => `  ${t}: 0;`).join("\n")}\n}\n`);

  const approved = join(sandbox, "approved.md");
  const body = "# scope\n";
  writeFileSync(approved, body);
  const digest = createHash("sha256").update(body).digest("hex");

  return run(sandbox, "validate-handoff.mjs", [
    writeJson(sandbox, "h.json", {
      ...PLAN,
      approved_proposal: { digest_sha256: digest, approved_at: "2026-08-21", round: 1, path: "approved.md" },
      issues: [{ id: "i-0001", title: "une issue", acceptance_criteria: criteria, file_reservations: reservations }],
    }),
  ]);
}

describe("a criterion naming a token names it exactly", () => {
  test("refuses a criterion that speaks of tokens without naming one", () => {
    // The real block, translated: the criterion said AmountField renders its
    // input with the fixed-pitch family and the right alignment FROM THE
    // TOKENS. Two tokens designated in prose, neither of which existed. The
    // implementer found it eleven hours later and stopped before writing a
    // line, and the operator waited forty-one minutes to answer.
    const result = plan(["1. [unit] `AmountField` rend son entree avec la famille de chasse fixe issue des jetons."]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /i-0001/);
    assert.match(result.output, /--/, "the refusal shows the shape expected, or Product rewrites the same prose");
  });

  test("refuses a token the project does not declare", () => {
    const result = plan(["1. [unit] `AmountField` declare `font-family: var(--font-mono)`."]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /--font-mono/);
    assert.match(result.output, /src\/tokens\.css/);
  });

  test("accepts a token the sheet carries", () => {
    const result = plan(["1. [unit] `AmountField` declare `font-family: var(--font-display)`."]);
    assert.equal(result.status, 0, result.output);
  });

  test("a criterion mentioning no token at all is left alone", () => {
    const result = plan(["1. [unit] `Button` rend un element `<button>` et le test echoue sans lui."]);
    assert.equal(result.status, 0, result.output);
  });

  test("a project with no declared design system is not held to it", () => {
    sandbox = createSandbox();
    const result = run(sandbox, "validate-handoff.mjs", [
      writeJson(sandbox, "h.json", {
        ...PLAN,
        approved_proposal: { digest_sha256: "a".repeat(64), approved_at: "2026-08-21", round: 1, path: "approved.md" },
        issues: [
          {
            id: "i-0001",
            title: "une issue",
            acceptance_criteria: ["1. [unit] la route repond 200 avec le jeton d authentification"],
            file_reservations: ["src/route.ts"],
          },
        ],
      }),
    ]);
    assert.match(result.output, /approved_proposal\.path/, result.output);
    assert.ok(!result.output.includes("names no token"), "a backend project has no token sheet to check against");
  });
});

describe("a criterion naming a file names one that exists, or one the issue creates", () => {
  test("refuses a path that exists nowhere and is reserved by nobody", () => {
    const result = plan(["1. [unit] le test vit dans `src/lib/absent.test.ts` et echoue sans le code."], {
      reservations: ["src/route.ts"],
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /src\/lib\/absent\.test\.ts/);
  });

  test("accepts a path the issue reserves, because it is about to create it", () => {
    const result = plan(["1. [unit] le test vit dans `src/lib/nouveau.test.ts` et echoue sans le code."], {
      reservations: ["src/lib/nouveau.test.ts"],
    });
    assert.equal(result.status, 0, result.output);
  });

  test("accepts a path already on disk", () => {
    const result = plan(["1. [unit] `src/tokens.css` declare la palette."], { reservations: ["src/route.ts"] });
    assert.equal(result.status, 0, result.output);
  });
});
